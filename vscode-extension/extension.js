const vscode = require('vscode');
const fs = require('fs');
const path = require('path');

const allPanels = new Set();
let currentPanel = null;
const panelSource = new WeakMap();
const pendingCodeRequests = new Map();
let nextRequestId = 1;

// ---------------------------------------------------------------------------
// Mermaid bundle + HTML generation
// ---------------------------------------------------------------------------

function readEditorHtml(context) {
  const htmlPath = path.join(context.extensionPath, 'media', 'mermaid-editor.html');
  return fs.readFileSync(htmlPath, 'utf8');
}

// The first <script> in the page is the Mermaid 10.9.0 UMD bundle. We pull
// it out so the thumbnail picker can reuse the exact same code path without
// shipping a second copy on disk.
//
// The marker we look for is the specific inline comment that lives on line 1
// of the bundle script — `/* mermaid 10.9.0 — inlined for fully offline use`.
// The string "mermaid 10.9.0" also appears in this file's third-party
// attribution comment, so a loose marker would point us at the wrong block.
function extractMermaidBundle(html) {
  const BUNDLE_MARKER = '/* mermaid 10.9.0 — inlined for fully offline use';
  const markerIdx = html.indexOf(BUNDLE_MARKER);
  let open, close;
  if (markerIdx !== -1) {
    open = html.lastIndexOf('<script>', markerIdx);
    close = html.indexOf('</script>', markerIdx);
  } else {
    open = html.indexOf('<script>');
    close = open === -1 ? -1 : html.indexOf('</script>', open);
  }
  if (open === -1 || close === -1) return '';
  return html.slice(open + '<script>'.length, close);
}

function buildEditorHtml(context, initialCode, options) {
  const opts = options || {};
  const hasSource = !!opts.hasSource;
  // Sheets: array of { name, code } in source-file order.
  // If supplied, drives the in-editor tab bar; otherwise the editor opens
  // as a single anonymous sheet, prefilled with initialCode if present.
  const sheets = Array.isArray(opts.sheets) && opts.sheets.length > 0
    ? opts.sheets
    : null;
  const activeIdx = Math.max(0, Math.min(
    Number(opts.activeIdx) || 0,
    sheets ? sheets.length - 1 : 0
  ));
  let html = readEditorHtml(context);

  // The bundled Mermaid build uses Function() in places, so 'unsafe-eval' is required.
  const csp =
    '<meta http-equiv="Content-Security-Policy" content="' +
    "default-src 'none'; " +
    "script-src 'unsafe-inline' 'unsafe-eval'; " +
    "style-src 'unsafe-inline'; " +
    "img-src data: blob:; " +
    "font-src data:; " +
    "connect-src 'none';" +
    '">';
  html = html.replace(/<head>/i, '<head>\n' + csp);

  const initialCodeJson = JSON.stringify(initialCode || null);
  const hasSourceJson = JSON.stringify(hasSource);
  const sheetsJson = JSON.stringify(sheets);
  const activeIdxJson = JSON.stringify(activeIdx);
  // Downloads via `<a href=blob: download>` are blocked inside VSCode
  // webviews, so the bridge intercepts the SVG/PNG buttons and ships the
  // bytes to the extension host, which then opens a native Save dialog.
  const bridge =
    '<script>\n' +
    '(function () {\n' +
    '  if (typeof acquireVsCodeApi === "undefined") return;\n' +
    '  var vscode = acquireVsCodeApi();\n' +
    '  var initialCode = ' + initialCodeJson + ';\n' +
    '  var HAS_SOURCE = ' + hasSourceJson + ';\n' +
    '  var INITIAL_SHEETS = ' + sheetsJson + ';\n' +
    '  var INITIAL_ACTIVE_IDX = ' + activeIdxJson + ';\n' +
    '\n' +
    '  function getCodeEl() { return document.getElementById("code"); }\n' +
    '  function getOutputEl() { return document.getElementById("output"); }\n' +
    '  function fire(el) { el.dispatchEvent(new Event("input", { bubbles: true })); }\n' +
    '\n' +
    '  // -- Sheets (draw.io-style tabs) ---------------------------------\n' +
    '  var sheets = [];\n' +
    '  var activeIdx = 0;\n' +
    '  function defaultSheetName(i) { return "Sheet " + (i + 1); }\n' +
    '\n' +
    '  // The bundled HTML loads a starter template when the diagram-type combo\n' +
    '  // fires `change`. Re-picking the SAME type never fires change, so on a\n' +
    '  // brand-new empty sheet we swap the combo to a hidden placeholder. The\n' +
    '  // user\'s next pick then always fires change → starter template loads.\n' +
    '  function ensurePlaceholderTypeOption() {\n' +
    '    var sel = document.getElementById("type");\n' +
    '    if (!sel) return null;\n' +
    '    var ph = sel.querySelector("option[data-vsx-placeholder]");\n' +
    '    if (!ph) {\n' +
    '      ph = document.createElement("option");\n' +
    '      ph.setAttribute("data-vsx-placeholder", "1");\n' +
    '      ph.value = "";\n' +
    '      ph.textContent = "— Pick diagram type —";\n' +
    '      ph.hidden = true;\n' +
    '      sel.insertBefore(ph, sel.firstChild);\n' +
    '    }\n' +
    '    return ph;\n' +
    '  }\n' +
    '  function activatePlaceholderType() {\n' +
    '    var sel = document.getElementById("type");\n' +
    '    if (!sel) return;\n' +
    '    ensurePlaceholderTypeOption();\n' +
    '    sel.value = "";\n' +
    '  }\n' +
    '  function isSheetEmpty(s) { return !s || !s.code || !s.code.trim(); }\n' +
    '  function applyActiveSheetCode() {\n' +
    '    var el = getCodeEl();\n' +
    '    if (!el) { setTimeout(applyActiveSheetCode, 50); return; }\n' +
    '    var s = sheets[activeIdx];\n' +
    '    if (s && s.code != null) { el.value = s.code; fire(el); }\n' +
    '  }\n' +
    '  function syncActiveSheetFromTextarea() {\n' +
    '    var el = getCodeEl();\n' +
    '    if (el && sheets[activeIdx]) sheets[activeIdx].code = el.value;\n' +
    '  }\n' +
    '  // Save the current sheet\'s undo history onto the sheet object so that\n' +
    '  // when we come back to it Cmd+Z keeps working where the user left off.\n' +
    '  function stashUndoState(idx) {\n' +
    '    if (sheets[idx] && typeof window.__vsxGetUndoState === "function") {\n' +
    '      sheets[idx]._undo = window.__vsxGetUndoState();\n' +
    '    }\n' +
    '  }\n' +
    '  function restoreUndoState(idx) {\n' +
    '    if (typeof window.__vsxSetUndoState === "function") {\n' +
    '      window.__vsxSetUndoState((sheets[idx] && sheets[idx]._undo) || null);\n' +
    '    }\n' +
    '  }\n' +
    '  function suppressNextSnapshot() {\n' +
    '    if (typeof window.__vsxSuppressNextInput === "function") window.__vsxSuppressNextInput();\n' +
    '  }\n' +
    '\n' +
    '  function switchSheet(i) {\n' +
    '    if (i === activeIdx || i < 0 || i >= sheets.length) return;\n' +
    '    syncActiveSheetFromTextarea();\n' +
    '    stashUndoState(activeIdx);\n' +
    '    activeIdx = i;\n' +
    '    suppressNextSnapshot();\n' +
    '    applyActiveSheetCode();\n' +
    '    restoreUndoState(activeIdx);\n' +
    '    if (isSheetEmpty(sheets[activeIdx])) activatePlaceholderType();\n' +
    '    renderTabs();\n' +
    '  }\n' +
    '  function addSheet() {\n' +
    '    syncActiveSheetFromTextarea();\n' +
    '    stashUndoState(activeIdx);\n' +
    '    sheets.push({ name: defaultSheetName(sheets.length), code: "" });\n' +
    '    activeIdx = sheets.length - 1;\n' +
    '    suppressNextSnapshot();\n' +
    '    var el = getCodeEl();\n' +
    '    if (el) { el.value = ""; fire(el); }\n' +
    '    restoreUndoState(activeIdx);\n' +
    '    activatePlaceholderType();\n' +
    '    renderTabs();\n' +
    '  }\n' +
    '  function removeSheet(i) {\n' +
    '    if (sheets.length <= 1) return;\n' +
    '    if (!window.confirm("Remove sheet \\"" + sheets[i].name + "\\"?")) return;\n' +
    '    syncActiveSheetFromTextarea();\n' +
    '    stashUndoState(activeIdx);\n' +
    '    sheets.splice(i, 1);\n' +
    '    if (activeIdx >= sheets.length) activeIdx = sheets.length - 1;\n' +
    '    else if (activeIdx > i) activeIdx -= 1;\n' +
    '    suppressNextSnapshot();\n' +
    '    applyActiveSheetCode();\n' +
    '    restoreUndoState(activeIdx);\n' +
    '    if (isSheetEmpty(sheets[activeIdx])) activatePlaceholderType();\n' +
    '    renderTabs();\n' +
    '  }\n' +
    '  function renameSheet(i) {\n' +
    '    var next = window.prompt("Sheet name", sheets[i].name);\n' +
    '    if (next == null) return;\n' +
    '    next = next.trim();\n' +
    '    if (!next) return;\n' +
    '    sheets[i].name = next;\n' +
    '    renderTabs();\n' +
    '  }\n' +
    '  function getAllSheets() {\n' +
    '    syncActiveSheetFromTextarea();\n' +
    '    return sheets.map(function (s) { return { name: s.name, code: s.code }; });\n' +
    '  }\n' +
    '\n' +
    '  function ensureSheetsUI() {\n' +
    '    if (document.getElementById("vsx-sheet-tabs")) { renderTabs(); return; }\n' +
    '    var app = document.querySelector(".app");\n' +
    '    if (!app) { setTimeout(ensureSheetsUI, 100); return; }\n' +
    '    var style = document.createElement("style");\n' +
    '    style.textContent = [\n' +
    '      ".vsx-tabs { display:flex; flex-direction:row; align-items:center; gap:4px; padding:6px 10px; background:var(--bg); border-top:0.5px solid var(--border); flex-shrink:0; overflow-x:auto; }",\n' +
    '      ".vsx-tab { padding:5px 10px; background:var(--bg-secondary); border:0.5px solid var(--border); border-radius:6px; cursor:pointer; font-size:12px; color:var(--text-secondary); white-space:nowrap; display:flex; align-items:center; gap:6px; user-select:none; }",\n' +
    '      ".vsx-tab:hover { color:var(--text-primary); border-color:var(--border-hover); }",\n' +
    '      ".vsx-tab.active { background:var(--bg); color:var(--text-primary); border-color:var(--border-active); font-weight:500; }",\n' +
    '      ".vsx-tab .vsx-tab-close { font-size:14px; line-height:1; opacity:0.5; padding:0 2px; cursor:pointer; }",\n' +
    '      ".vsx-tab .vsx-tab-close:hover { opacity:1; color:#e0564f; }",\n' +
    '      ".vsx-tab-add { padding:5px 10px; background:none; border:0.5px dashed var(--border); border-radius:6px; cursor:pointer; font-size:12px; color:var(--text-secondary); font-family:inherit; }",\n' +
    '      ".vsx-tab-add:hover { color:var(--text-primary); border-color:var(--border-active); }",\n' +
    '      ".vsx-tab-count { margin-left:auto; font-size:11px; color:var(--text-tertiary); padding-left:10px; }",\n' +
    '    ].join("\\n");\n' +
    '    document.head.appendChild(style);\n' +
    '    var bar = document.createElement("div");\n' +
    '    bar.id = "vsx-sheet-tabs";\n' +
    '    bar.className = "vsx-tabs";\n' +
    '    app.appendChild(bar);\n' +
    '    renderTabs();\n' +
    '  }\n' +
    '  function renderTabs() {\n' +
    '    var bar = document.getElementById("vsx-sheet-tabs");\n' +
    '    if (!bar) return;\n' +
    '    bar.innerHTML = "";\n' +
    '    sheets.forEach(function (sheet, i) {\n' +
    '      var tab = document.createElement("div");\n' +
    '      tab.className = "vsx-tab" + (i === activeIdx ? " active" : "");\n' +
    '      tab.title = "Click to switch · double-click to rename";\n' +
    '      tab.addEventListener("click", function () { switchSheet(i); });\n' +
    '      tab.addEventListener("dblclick", function (e) { e.preventDefault(); renameSheet(i); });\n' +
    '      var name = document.createElement("span");\n' +
    '      name.textContent = sheet.name;\n' +
    '      tab.appendChild(name);\n' +
    '      if (sheets.length > 1) {\n' +
    '        var close = document.createElement("span");\n' +
    '        close.className = "vsx-tab-close";\n' +
    '        close.title = "Remove sheet";\n' +
    '        close.textContent = "×";\n' +
    '        close.addEventListener("click", function (e) { e.stopPropagation(); removeSheet(i); });\n' +
    '        tab.appendChild(close);\n' +
    '      }\n' +
    '      bar.appendChild(tab);\n' +
    '    });\n' +
    '    var add = document.createElement("button");\n' +
    '    add.className = "vsx-tab-add";\n' +
    '    add.title = "Add a new diagram sheet";\n' +
    '    add.textContent = "+ Add sheet";\n' +
    '    add.addEventListener("click", addSheet);\n' +
    '    bar.appendChild(add);\n' +
    '    var count = document.createElement("span");\n' +
    '    count.className = "vsx-tab-count";\n' +
    '    count.textContent = sheets.length + " sheet" + (sheets.length === 1 ? "" : "s");\n' +
    '    bar.appendChild(count);\n' +
    '  }\n' +
    '\n' +
    '  function applyInitial() {\n' +
    '    if (INITIAL_SHEETS && INITIAL_SHEETS.length > 0) {\n' +
    '      for (var i = 0; i < INITIAL_SHEETS.length; i++) {\n' +
    '        sheets.push({\n' +
    '          name: INITIAL_SHEETS[i].name || defaultSheetName(i),\n' +
    '          code: INITIAL_SHEETS[i].code || "",\n' +
    '        });\n' +
    '      }\n' +
    '      activeIdx = Math.max(0, Math.min(INITIAL_ACTIVE_IDX | 0, sheets.length - 1));\n' +
    '      // Skip the initial-load snapshot so undo doesn\'t step back to the\n' +
    '      // bundled HTML\'s default starter the user never asked for.\n' +
    '      if (typeof window.__vsxSuppressNextInput === "function") window.__vsxSuppressNextInput();\n' +
    '      applyActiveSheetCode();\n' +
    '      if (typeof window.__vsxSetUndoState === "function") window.__vsxSetUndoState(null);\n' +
    '    } else if (initialCode) {\n' +
    '      sheets.push({ name: defaultSheetName(0), code: initialCode });\n' +
    '      activeIdx = 0;\n' +
    '      if (typeof window.__vsxSuppressNextInput === "function") window.__vsxSuppressNextInput();\n' +
    '      applyActiveSheetCode();\n' +
    '      if (typeof window.__vsxSetUndoState === "function") window.__vsxSetUndoState(null);\n' +
    '    } else {\n' +
    '      // No preset: let the bundled HTML populate its default starter.\n' +
    '      // Snapshot whatever the textarea ends up with into sheet 1.\n' +
    '      sheets.push({ name: defaultSheetName(0), code: "" });\n' +
    '      activeIdx = 0;\n' +
    '    }\n' +
    '  }\n' +
    '\n' +
    '  // Replace a node with a clone to drop any pre-existing listeners,\n' +
    '  // then return the clone so we can attach our host-bridged handler.\n' +
    '  function rebindBtn(id, handler) {\n' +
    '    var btn = document.getElementById(id);\n' +
    '    if (!btn) return null;\n' +
    '    var clone = btn.cloneNode(true);\n' +
    '    btn.parentNode.replaceChild(clone, btn);\n' +
    '    clone.addEventListener("click", handler);\n' +
    '    return clone;\n' +
    '  }\n' +
    '\n' +
    '  // Pull a human-readable title out of the diagram code, if one exists.\n' +
    '  // Mermaid supports `--- title: ... ---` YAML frontmatter and a bare\n' +
    '  // `title Foo` line in gantt / sequence / journey diagrams.\n' +
    '  function findDiagramTitle(code) {\n' +
    '    if (!code) return "";\n' +
    '    var fm = /^\\s*---\\s*\\n([\\s\\S]*?)\\n---\\s*(?:\\n|$)/.exec(code);\n' +
    '    if (fm) {\n' +
    '      var tm = /(^|\\n)\\s*title\\s*:\\s*(.+?)\\s*(?=\\n|$)/.exec(fm[1]);\n' +
    '      if (tm) return tm[2].replace(/^[\\\'"]|[\\\'"]$/g, "").trim();\n' +
    '    }\n' +
    '    var lines = code.split("\\n");\n' +
    '    for (var i = 0; i < lines.length && i < 25; i++) {\n' +
    '      var m = /^\\s*title\\s+(.+?)\\s*$/i.exec(lines[i]);\n' +
    '      if (m) return m[1].replace(/^[\\\'"]|[\\\'"]$/g, "").trim();\n' +
    '    }\n' +
    '    return "";\n' +
    '  }\n' +
    '  function currentTitle() {\n' +
    '    var el = getCodeEl();\n' +
    '    return el ? findDiagramTitle(el.value) : "";\n' +
    '  }\n' +
    '\n' +
    '  function downloadSvg() {\n' +
    '    var out = getOutputEl();\n' +
    '    var svg = out && out.querySelector("svg");\n' +
    '    if (!svg) return;\n' +
    '    // outerHTML strips namespaces because the node lives in an HTML\n' +
    '    // document; clone + XMLSerializer produces a valid standalone SVG.\n' +
    '    var clone = svg.cloneNode(true);\n' +
    '    if (!clone.getAttribute("xmlns")) clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");\n' +
    '    if (!clone.getAttribute("xmlns:xlink")) clone.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink");\n' +
    '    var bbox = svg.getBoundingClientRect();\n' +
    '    if (!clone.getAttribute("width") && bbox.width) clone.setAttribute("width", String(Math.round(bbox.width)));\n' +
    '    if (!clone.getAttribute("height") && bbox.height) clone.setAttribute("height", String(Math.round(bbox.height)));\n' +
    '    var xml = new XMLSerializer().serializeToString(clone);\n' +
    '    var doc = \'<?xml version="1.0" encoding="UTF-8" standalone="no"?>\\n\' + xml;\n' +
    '    vscode.postMessage({\n' +
    '      type: "saveFile",\n' +
    '      mimeType: "image/svg+xml",\n' +
    '      title: currentTitle(),\n' +
    '      sheetName: (sheets[activeIdx] && sheets[activeIdx].name) || "",\n' +
    '      data: doc,\n' +
    '      isBase64: false,\n' +
    '    });\n' +
    '  }\n' +
    '\n' +
    '  function downloadPng() {\n' +
    '    var out = getOutputEl();\n' +
    '    var svg = out && out.querySelector("svg");\n' +
    '    if (!svg) return;\n' +
    '    var xml = new XMLSerializer().serializeToString(svg);\n' +
    '    var svg64 = btoa(unescape(encodeURIComponent(xml)));\n' +
    '    var img = new Image();\n' +
    '    img.onload = function () {\n' +
    '      var bbox = svg.getBoundingClientRect();\n' +
    '      var scale = 2;\n' +
    '      var w = Math.max(1, Math.round((bbox.width || svg.clientWidth || 800) * scale));\n' +
    '      var h = Math.max(1, Math.round((bbox.height || svg.clientHeight || 600) * scale));\n' +
    '      var canvas = document.createElement("canvas");\n' +
    '      canvas.width = w; canvas.height = h;\n' +
    '      var ctx = canvas.getContext("2d");\n' +
    '      ctx.fillStyle = getComputedStyle(document.body).backgroundColor || "#ffffff";\n' +
    '      ctx.fillRect(0, 0, w, h);\n' +
    '      ctx.drawImage(img, 0, 0, w, h);\n' +
    '      var dataUrl;\n' +
    '      try { dataUrl = canvas.toDataURL("image/png"); }\n' +
    '      catch (e) {\n' +
    '        vscode.postMessage({ type: "saveError", message: "canvas tainted: " + e.message });\n' +
    '        return;\n' +
    '      }\n' +
    '      var b64 = (dataUrl.split(",")[1] || "");\n' +
    '      vscode.postMessage({\n' +
    '        type: "saveFile",\n' +
    '        mimeType: "image/png",\n' +
    '        title: currentTitle(),\n' +
    '        sheetName: (sheets[activeIdx] && sheets[activeIdx].name) || "",\n' +
    '        data: b64,\n' +
    '        isBase64: true,\n' +
    '      });\n' +
    '    };\n' +
    '    img.onerror = function () {\n' +
    '      vscode.postMessage({ type: "saveError", message: "failed to rasterize SVG" });\n' +
    '    };\n' +
    '    img.src = "data:image/svg+xml;base64," + svg64;\n' +
    '  }\n' +
    '\n' +
    '  function attachDownloadHandlers() {\n' +
    '    var s = rebindBtn("download-svg-btn", downloadSvg);\n' +
    '    var p = rebindBtn("download-png-btn", downloadPng);\n' +
    '    if (!s || !p) { setTimeout(attachDownloadHandlers, 100); }\n' +
    '  }\n' +
    '\n' +
    '  // Inject a primary-styled "Save" button into the canvas toolbar. It is\n' +
    '  // always shown: with a source file Save overwrites that block; without\n' +
    '  // one the host opens a Save As dialog and creates a new .md/.mmd file,\n' +
    '  // then links this panel to it so subsequent saves overwrite that file.\n' +
    '  function insertSaveButton() {\n' +
    '    if (document.getElementById("vsx-save-btn")) return;\n' +
    '    var resetBtn = document.getElementById("reset-btn");\n' +
    '    if (!resetBtn || !resetBtn.parentElement) { setTimeout(insertSaveButton, 100); return; }\n' +
    '    var btn = document.createElement("button");\n' +
    '    btn.id = "vsx-save-btn";\n' +
    '    btn.className = "icon-btn";\n' +
    '    btn.title = HAS_SOURCE\n' +
    '      ? "Save diagram back to source file  (⌘S / Ctrl+S)"\n' +
    '      : "Save diagram to a new file…  (⌘S / Ctrl+S)";\n' +
    '    btn.textContent = HAS_SOURCE ? "Save" : "Save…";\n' +
    '    btn.style.background = "var(--text-info, #175fa5)";\n' +
    '    btn.style.color = "var(--bg, #fff)";\n' +
    '    btn.style.borderColor = "var(--text-info, #175fa5)";\n' +
    '    btn.style.fontWeight = "500";\n' +
    '    btn.addEventListener("click", function () {\n' +
    '      vscode.postMessage({ type: "saveBack" });\n' +
    '    });\n' +
    '    resetBtn.parentElement.insertBefore(btn, resetBtn);\n' +
    '  }\n' +
    '  function flashSaveBtn(text) {\n' +
    '    var btn = document.getElementById("vsx-save-btn");\n' +
    '    if (!btn) return;\n' +
    '    var prev = btn.textContent;\n' +
    '    btn.textContent = text || "Saved";\n' +
    '    setTimeout(function () { if (btn.textContent === (text || "Saved")) btn.textContent = prev; }, 1100);\n' +
    '  }\n' +
    '  // Once the host links us to a file, swap the button copy from "Save…"\n' +
    '  // to "Save" so it no longer suggests another file picker.\n' +
    '  function markLinked() {\n' +
    '    HAS_SOURCE = true;\n' +
    '    var btn = document.getElementById("vsx-save-btn");\n' +
    '    if (!btn) return;\n' +
    '    btn.textContent = "Save";\n' +
    '    btn.title = "Save diagram back to source file  (⌘S / Ctrl+S)";\n' +
    '  }\n' +
    '\n' +
    '  // Intercept Cmd/Ctrl+S inside the webview so the keyboard shortcut\n' +
    '  // saves regardless of whether the panel has a source yet.\n' +
    '  function installSaveShortcut() {\n' +
    '    window.addEventListener("keydown", function (e) {\n' +
    '      var mod = e.metaKey || e.ctrlKey;\n' +
    '      if (mod && !e.shiftKey && !e.altKey && (e.key === "s" || e.key === "S")) {\n' +
    '        e.preventDefault(); e.stopPropagation();\n' +
    '        vscode.postMessage({ type: "saveBack" });\n' +
    '      }\n' +
    '    }, true);\n' +
    '  }\n' +
    '\n' +
    '  window.addEventListener("message", function (event) {\n' +
    '    var msg = event.data || {};\n' +
    '    var el = getCodeEl();\n' +
    '    if (msg.type === "setCode" && el) {\n' +
    '      el.value = msg.code || "";\n' +
    '      fire(el);\n' +
    '    } else if (msg.type === "getCode") {\n' +
    '      vscode.postMessage({ type: "codeResponse", code: el ? el.value : "", requestId: msg.requestId });\n' +
    '    } else if (msg.type === "getSheets") {\n' +
    '      vscode.postMessage({ type: "sheetsResponse", sheets: getAllSheets(), activeIdx: activeIdx, requestId: msg.requestId });\n' +
    '    } else if (msg.type === "linkedToSource") {\n' +
    '      markLinked();\n' +
    '    } else if (msg.type === "saveResult") {\n' +
    '      flashSaveBtn(msg.ok ? "Saved" : "Failed");\n' +
    '    }\n' +
    '  });\n' +
    '\n' +
    '  function onReady() {\n' +
    '    applyInitial();\n' +
    '    attachDownloadHandlers();\n' +
    '    insertSaveButton();\n' +
    '    installSaveShortcut();\n' +
    '    ensureSheetsUI();\n' +
    '  }\n' +
    '  if (document.readyState === "complete") {\n' +
    '    onReady();\n' +
    '  } else {\n' +
    '    window.addEventListener("load", onReady);\n' +
    '  }\n' +
    '  vscode.postMessage({ type: "ready" });\n' +
    '})();\n' +
    '</script>';

  // The Mermaid bundle contains literal "</body>" inside its JS strings, so
  // we splice into the LAST occurrence — the real document close.
  const bodyCloseIdx = html.lastIndexOf('</body>');
  if (bodyCloseIdx !== -1) {
    html = html.slice(0, bodyCloseIdx) + bridge + '\n' + html.slice(bodyCloseIdx);
  } else {
    html = html + bridge;
  }

  return html;
}

function buildPickerHtml(bundle, blocks, fileName) {
  const escHtml = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  const blocksJson = JSON.stringify(
    blocks.map((b) => ({
      index: b.index,
      content: b.content,
      kind: b.kind || 'diagram',
      lineNumber: b.lineNumber,
    }))
  );
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none';">
<title>Pick a Mermaid diagram</title>
<style>
  :root {
    --bg: #ffffff;
    --bg-secondary: #f5f4ef;
    --bg-tertiary: #ebebe5;
    --text-primary: #1a1a18;
    --text-secondary: #5f5e5a;
    --text-tertiary: #888780;
    --text-danger: #a32d2d;
    --border: rgba(0, 0, 0, 0.12);
    --border-hover: rgba(0, 0, 0, 0.25);
    --border-active: rgba(23, 95, 165, 0.6);
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #1f1f1d;
      --bg-secondary: #2c2c2a;
      --bg-tertiary: #161614;
      --text-primary: #f5f4ef;
      --text-secondary: #b4b2a9;
      --text-tertiary: #888780;
      --text-danger: #f09595;
      --border: rgba(255, 255, 255, 0.15);
      --border-hover: rgba(255, 255, 255, 0.3);
      --border-active: rgba(133, 183, 235, 0.6);
    }
  }
  * { box-sizing: border-box; }
  html, body {
    height: 100%; margin: 0; padding: 0;
    background: var(--bg-tertiary);
    color: var(--text-primary);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
    font-size: 14px;
  }
  .topbar {
    padding: 12px 16px;
    border-bottom: 0.5px solid var(--border);
    background: var(--bg);
    position: sticky; top: 0; z-index: 1;
  }
  .topbar h1 { margin: 0 0 2px 0; font-size: 15px; font-weight: 500; }
  .topbar .sub { font-size: 12px; color: var(--text-secondary); }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 14px;
    padding: 14px;
  }
  .card {
    border: 0.5px solid var(--border);
    border-radius: 8px;
    background: var(--bg);
    padding: 10px;
    cursor: pointer;
    display: flex;
    flex-direction: column;
    transition: border-color 0.1s, box-shadow 0.1s, transform 0.1s;
    outline: none;
  }
  .card:hover, .card:focus {
    border-color: var(--border-active);
    box-shadow: 0 4px 14px rgba(0,0,0,0.08);
  }
  .card:active { transform: translateY(1px); }
  .card-header {
    display: flex; align-items: baseline; justify-content: space-between;
    gap: 8px;
    margin-bottom: 8px;
  }
  .card-title {
    font-size: 13px; font-weight: 500; color: var(--text-primary);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .card-meta { font-size: 11px; color: var(--text-tertiary); flex-shrink: 0; }
  .thumb {
    height: 200px;
    background: var(--bg-secondary);
    border-radius: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    padding: 8px;
  }
  .thumb svg { max-width: 100%; max-height: 100%; height: auto; width: auto; }
  .thumb-err {
    color: var(--text-danger);
    font-size: 11px;
    padding: 8px;
    text-align: center;
    font-family: "SF Mono", Menlo, Monaco, Consolas, monospace;
    white-space: pre-wrap;
    overflow: auto;
    max-height: 100%;
  }
  .thumb-loading { color: var(--text-tertiary); font-size: 12px; }
  .empty {
    padding: 32px;
    color: var(--text-danger);
    font-family: "SF Mono", Menlo, Monaco, Consolas, monospace;
    font-size: 12px;
  }
</style>
</head>
<body>
<div class="topbar">
  <h1>Pick a diagram to edit</h1>
  <div class="sub">${escHtml(fileName)} contains ${blocks.length} Mermaid diagrams — click a thumbnail to open it in the live editor.</div>
</div>
<div id="grid" class="grid"></div>

<script>
${bundle}
</script>
<script>
(function(){
  var vscode = acquireVsCodeApi();
  var BLOCKS = ${blocksJson};
  var grid = document.getElementById('grid');

  function makeCard(block) {
    var card = document.createElement('div');
    card.className = 'card';
    card.tabIndex = 0;
    card.setAttribute('role', 'button');
    card.title = 'Edit diagram ' + (block.index + 1);
    function pick() { vscode.postMessage({ type: 'select', index: block.index }); }
    card.addEventListener('click', pick);
    card.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); }
    });

    var head = document.createElement('div');
    head.className = 'card-header';
    var title = document.createElement('div');
    title.className = 'card-title';
    title.textContent = 'Diagram ' + (block.index + 1) + ' · ' + block.kind;
    var meta = document.createElement('div');
    meta.className = 'card-meta';
    meta.textContent = 'line ' + block.lineNumber;
    head.appendChild(title);
    head.appendChild(meta);

    var thumb = document.createElement('div');
    thumb.className = 'thumb';
    var loading = document.createElement('div');
    loading.className = 'thumb-loading';
    loading.textContent = 'rendering…';
    thumb.appendChild(loading);

    card.appendChild(head);
    card.appendChild(thumb);
    return { card: card, thumb: thumb };
  }

  async function renderAll() {
    if (typeof mermaid === 'undefined') {
      grid.innerHTML = '<div class="empty">Mermaid bundle failed to load.</div>';
      return;
    }
    var isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    mermaid.initialize({
      startOnLoad: false,
      theme: isDark ? 'dark' : 'default',
      securityLevel: 'loose',
    });
    var i;
    var entries = [];
    for (i = 0; i < BLOCKS.length; i++) {
      var made = makeCard(BLOCKS[i]);
      grid.appendChild(made.card);
      entries.push({ block: BLOCKS[i], thumb: made.thumb });
    }
    for (i = 0; i < entries.length; i++) {
      var e = entries[i];
      try {
        var res = await mermaid.render(
          'thumb-' + e.block.index + '-' + Date.now() + '-' + i,
          e.block.content
        );
        e.thumb.innerHTML = res && res.svg ? res.svg : '';
      } catch (err) {
        var msg = (err && err.message) ? err.message.split('\\n')[0] : String(err);
        var div = document.createElement('div');
        div.className = 'thumb-err';
        div.textContent = 'render failed: ' + msg;
        e.thumb.innerHTML = '';
        e.thumb.appendChild(div);
      }
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', renderAll);
  } else {
    renderAll();
  }
})();
</script>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Mermaid block extraction
// ---------------------------------------------------------------------------

function detectKind(content) {
  const firstLine = (content.trim().split('\n')[0] || '').trim().toLowerCase();
  if (firstLine.startsWith('flowchart')) return 'flowchart';
  if (firstLine === 'graph' || firstLine.startsWith('graph ')) return 'flowchart';
  if (firstLine.startsWith('sequencediagram')) return 'sequence';
  if (firstLine.startsWith('classdiagram')) return 'class';
  if (firstLine.startsWith('statediagram')) return 'state';
  if (firstLine.startsWith('erdiagram')) return 'er';
  if (firstLine.startsWith('gantt')) return 'gantt';
  if (firstLine.startsWith('pie')) return 'pie';
  if (firstLine.startsWith('journey')) return 'journey';
  if (firstLine.startsWith('mindmap')) return 'mindmap';
  if (firstLine.startsWith('gitgraph')) return 'gitgraph';
  if (firstLine.startsWith('timeline')) return 'timeline';
  if (firstLine.startsWith('quadrantchart')) return 'quadrant';
  return 'diagram';
}

function extractMermaidBlocks(text, ext) {
  const e = (ext || '').toLowerCase().replace(/^\./, '');
  if (e === 'mmd' || e === 'mermaid') {
    const trimmed = text.replace(/^﻿/, '');
    if (!trimmed.trim()) return [];
    return [{
      index: 0,
      content: trimmed.replace(/\n+$/, ''),
      offset: 0,
      length: text.length,
      lineNumber: 1,
      isWholeFile: true,
      fenceOpen: null,
      fenceClose: null,
      kind: detectKind(trimmed),
    }];
  }
  const blocks = [];
  // Fenced code block: 3+ backticks (or tildes), info string starts with "mermaid".
  // The closing fence must match the opening fence character and have at least
  // the same length. CommonMark allows up to 3 leading spaces of indentation.
  const re = /(^|\n)([ \t]{0,3})(`{3,}|~{3,})[ \t]*mermaid\b[^\n]*\n([\s\S]*?)(?:\r?\n)\2\3+[ \t]*(?=\r?\n|$)/gi;
  let m;
  let idx = 0;
  while ((m = re.exec(text)) !== null) {
    const leadNl = m[1].length;
    const startOffset = m.index + leadNl;
    const fullMatch = m[0].slice(leadNl);
    const content = m[4];
    const lineNumber = text.slice(0, startOffset).split('\n').length;
    blocks.push({
      index: idx++,
      content,
      offset: startOffset,
      length: fullMatch.length,
      lineNumber,
      isWholeFile: false,
      fenceOpen: m[2] + m[3] + 'mermaid',
      fenceClose: m[2] + m[3],
      kind: detectKind(content),
    });
  }
  return blocks;
}

// ---------------------------------------------------------------------------
// Webview panels
// ---------------------------------------------------------------------------

function createPanel(context, initialCode, options) {
  const opts = options || {};
  const panel = vscode.window.createWebviewPanel(
    'mermaidVisualEditor',
    opts.title || 'Mermaid Visual Editor',
    vscode.ViewColumn.Active,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')],
    }
  );

  panel.webview.html = buildEditorHtml(context, initialCode, {
    hasSource: !!opts.hasSource,
    sheets: opts.sheets,
    activeIdx: opts.activeIdx,
  });

  panel.webview.onDidReceiveMessage(async (msg) => {
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'codeResponse') {
      const pending = pendingCodeRequests.get(msg.requestId);
      if (pending) {
        pending.resolve(msg.code || '');
        pendingCodeRequests.delete(msg.requestId);
      }
    } else if (msg.type === 'sheetsResponse') {
      const pending = pendingCodeRequests.get(msg.requestId);
      if (pending) {
        pending.resolve({
          sheets: Array.isArray(msg.sheets) ? msg.sheets : [],
          activeIdx: Number(msg.activeIdx) || 0,
        });
        pendingCodeRequests.delete(msg.requestId);
      }
    } else if (msg.type === 'saveFile') {
      await handleSaveFile(msg, panel);
    } else if (msg.type === 'saveBack') {
      await saveBackToSource(panel);
    } else if (msg.type === 'saveError') {
      vscode.window.showErrorMessage(
        'Mermaid export failed: ' + (msg.message || 'unknown error')
      );
    }
  });

  panel.onDidChangeViewState(() => {
    if (panel.active) currentPanel = panel;
  });

  panel.onDidDispose(() => {
    allPanels.delete(panel);
    panelSource.delete(panel);
    if (currentPanel === panel) currentPanel = null;
  });

  allPanels.add(panel);
  currentPanel = panel;
  return panel;
}

// Strip filesystem-hostile characters and collapse runs of whitespace/dashes
// so a title like "User → API: GET /items" becomes "User-API-GET-items".
function sanitizeForFilename(s, maxLen) {
  if (!s) return '';
  return String(s)
    .replace(/[<>:"/\\|?*\x00-\x1f]+/g, ' ')
    .replace(/[–—]/g, '-')
    .replace(/[^\w.\-]+/g, ' ')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[.\-]+|[.\-]+$/g, '')
    .slice(0, maxLen || 60);
}

// Compose a default filename (no extension): join the file's base with a
// title hint (active sheet's title, or sheet name, etc.) when provided.
function composeBaseName(src, hint) {
  const t = sanitizeForFilename(hint || '');
  if (src) {
    const base = src.sourceBase || 'diagram';
    return t ? `${base}-${t}` : base;
  }
  return t || 'diagram';
}

// Host-side handler for the bridge's `saveFile` message: SVG/PNG payloads
// from the webview are written to disk via a native Save dialog because
// programmatic `<a download>` of blob: URLs is blocked inside VSCode webviews.
async function handleSaveFile(msg, panel) {
  const mimeType = typeof msg.mimeType === 'string' ? msg.mimeType : 'application/octet-stream';
  const ext =
    mimeType === 'image/svg+xml' ? 'svg'
    : mimeType === 'image/png'   ? 'png'
    : 'bin';
  const src = panel ? panelSource.get(panel) : null;
  // Prefer the diagram's embedded title; if none, fall back to the active
  // sheet's name so multi-sheet exports stay distinguishable.
  const hint = (msg.title && String(msg.title).trim())
    || (msg.sheetName && String(msg.sheetName).trim())
    || '';
  const baseName = composeBaseName(src, hint) || 'diagram';
  const fileName = `${baseName}.${ext}`;

  // Default save location: same folder as the source file when we know it,
  // otherwise the first workspace folder, otherwise $HOME.
  let baseDir;
  if (src && src.uriString) {
    try {
      const srcUri = vscode.Uri.parse(src.uriString);
      baseDir = vscode.Uri.file(path.dirname(srcUri.fsPath));
    } catch (_) { /* fall through */ }
  }
  if (!baseDir) {
    const ws = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0];
    baseDir = ws ? ws.uri : vscode.Uri.file(require('os').homedir());
  }
  const defaultUri = vscode.Uri.joinPath(baseDir, fileName);
  const filters =
    mimeType === 'image/svg+xml' ? { 'SVG image': ['svg'] }
    : mimeType === 'image/png'   ? { 'PNG image': ['png'] }
    : undefined;
  const target = await vscode.window.showSaveDialog({ defaultUri, filters, saveLabel: 'Export' });
  if (!target) return;
  try {
    const buf = msg.isBase64
      ? Buffer.from(String(msg.data || ''), 'base64')
      : Buffer.from(String(msg.data || ''), 'utf8');
    await vscode.workspace.fs.writeFile(target, buf);
    vscode.window.setStatusBarMessage(
      `Mermaid: exported ${path.basename(target.fsPath)}`,
      3000
    );
  } catch (err) {
    vscode.window.showErrorMessage(
      'Export failed: ' + (err && err.message ? err.message : String(err))
    );
  }
}

function requestCode(panel) {
  return new Promise((resolve, reject) => {
    const requestId = String(nextRequestId++);
    pendingCodeRequests.set(requestId, { resolve, reject });
    panel.webview.postMessage({ type: 'getCode', requestId });
    setTimeout(() => {
      if (pendingCodeRequests.has(requestId)) {
        pendingCodeRequests.delete(requestId);
        reject(new Error('Timed out waiting for editor response'));
      }
    }, 5000);
  });
}

function requestSheets(panel) {
  return new Promise((resolve, reject) => {
    const requestId = String(nextRequestId++);
    pendingCodeRequests.set(requestId, {
      resolve: (payload) => resolve(payload || { sheets: [], activeIdx: 0 }),
      reject,
    });
    panel.webview.postMessage({ type: 'getSheets', requestId });
    setTimeout(() => {
      if (pendingCodeRequests.has(requestId)) {
        pendingCodeRequests.delete(requestId);
        reject(new Error('Timed out waiting for sheets response'));
      }
    }, 5000);
  });
}

// Pick a human-readable sheet name from a block: its embedded title if there
// is one, otherwise "Sheet N". Lets users keep meaningful names round-tripped
// through the title syntax without us having to invent a new file format.
function sheetNameFromBlock(block, index) {
  const title = findDiagramTitleHost(block.content);
  return title || ('Sheet ' + (index + 1));
}

// Open all mermaid blocks from a source file as sheets in one editor panel,
// with `activeIdx` initially selected. For a 1-block file this is just a
// single-sheet panel; for a multi-block file the user gets tabs.
function openEditorForFile(context, uri, blocks, activeIdx) {
  const fileName = path.basename(uri.fsPath || uri.path);
  const sourceBase = sanitizeForFilename(
    path.basename(fileName, path.extname(fileName))
  ) || 'diagram';
  const sheets = blocks.map((b, i) => ({
    name: sheetNameFromBlock(b, i),
    code: b.content,
  }));
  const idx = Math.max(0, Math.min(activeIdx || 0, sheets.length - 1));
  const isWholeFile = blocks.length === 1 && !!blocks[0].isWholeFile;
  const title = sheets.length > 1
    ? `Mermaid · ${fileName} (${sheets.length} sheets)`
    : `Mermaid · ${fileName}`;
  const panel = createPanel(context, null, {
    title,
    hasSource: true,
    sheets,
    activeIdx: idx,
  });
  panelSource.set(panel, {
    uriString: uri.toString(),
    sourceBase,
    isWholeFile,
  });
  return panel;
}

function openThumbnailPicker(context, uri, blocks) {
  const fileName = path.basename(uri.fsPath || uri.path);
  const panel = vscode.window.createWebviewPanel(
    'mermaidPicker',
    `Pick diagram · ${fileName}`,
    vscode.ViewColumn.Active,
    {
      enableScripts: true,
      retainContextWhenHidden: false,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')],
    }
  );

  const editorHtml = readEditorHtml(context);
  const bundle = extractMermaidBundle(editorHtml);
  panel.webview.html = buildPickerHtml(bundle, blocks, fileName);

  panel.webview.onDidReceiveMessage((msg) => {
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'select' && typeof msg.index === 'number') {
      const block = blocks.find((b) => b.index === msg.index);
      panel.dispose();
      if (block) openEditorForFile(context, uri, blocks, block.index);
    }
  });
}

async function openFromFileUri(context, uri) {
  let doc;
  try {
    doc = await vscode.workspace.openTextDocument(uri);
  } catch (err) {
    vscode.window.showErrorMessage(
      'Could not open ' + uri.fsPath + ': ' + (err && err.message ? err.message : String(err))
    );
    return;
  }
  const text = doc.getText();
  const ext = path.extname(uri.fsPath || uri.path);
  const blocks = extractMermaidBlocks(text, ext);
  if (blocks.length === 0) {
    vscode.window.showWarningMessage(
      'No Mermaid diagrams found in ' + path.basename(uri.fsPath || uri.path) + '.'
    );
    return;
  }
  if (blocks.length === 1) {
    openEditorForFile(context, uri, blocks, 0);
    return;
  }
  openThumbnailPicker(context, uri, blocks);
}

// ---------------------------------------------------------------------------
// Save back: rewrite the source file's diagram block with the panel's code.
// If the panel has no source yet, prompts Save As and creates a new file,
// then links the panel to that new file so subsequent saves overwrite it.
// ---------------------------------------------------------------------------

// Mirror of the bridge's title extractor so the host can pick a default
// filename for Save As without round-tripping another message.
function findDiagramTitleHost(code) {
  if (!code) return '';
  const fm = /^\s*---\s*\n([\s\S]*?)\n---\s*(?:\n|$)/.exec(code);
  if (fm) {
    const tm = /(^|\n)\s*title\s*:\s*(.+?)\s*(?=\n|$)/.exec(fm[1]);
    if (tm) return tm[2].replace(/^['"]|['"]$/g, '').trim();
  }
  const lines = code.split('\n');
  for (let i = 0; i < lines.length && i < 25; i++) {
    const m = /^\s*title\s+(.+?)\s*$/i.exec(lines[i]);
    if (m) return m[1].replace(/^['"]|['"]$/g, '').trim();
  }
  return '';
}

function postSaveResult(panel, ok) {
  try { panel.webview.postMessage({ type: 'saveResult', ok: !!ok }); } catch (_) { /* panel may be disposed */ }
}

// Emit one fenced mermaid block from a sheet's code.
function renderSheetAsFenced(sheet) {
  const code = String(sheet.code || '').replace(/\n+$/, '');
  return '```mermaid\n' + code + '\n```';
}

// Join every sheet as fenced blocks with a blank line between them — used
// when creating a brand-new markdown file via Save As.
function joinSheetsAsMarkdown(sheetsArr) {
  return sheetsArr.map(renderSheetAsFenced).join('\n\n') + '\n';
}

// Rewrite a markdown source file's mermaid blocks against a new sheets[]
// array, preserving everything else. Replaces in order, removes extras,
// appends new ones at the end. Each operation walks from last to first so
// earlier offsets don't shift.
function rewriteMarkdownBlocks(text, ext, sheetsArr) {
  const blocks = extractMermaidBlocks(text, ext);
  let out = text;
  for (let i = blocks.length - 1; i >= 0; i--) {
    const b = blocks[i];
    if (i < sheetsArr.length) {
      const fenceOpen = b.fenceOpen || '```mermaid';
      const fenceClose = b.fenceClose || '```';
      const code = String(sheetsArr[i].code || '').replace(/\n+$/, '');
      const replacement = fenceOpen + '\n' + code + '\n' + fenceClose;
      out = out.slice(0, b.offset) + replacement + out.slice(b.offset + b.length);
    } else {
      // Removal: take out the block bytes, plus one trailing newline so we
      // don't leave a stranded blank line where the block used to be.
      let end = b.offset + b.length;
      if (end < out.length && out[end] === '\n') end++;
      out = out.slice(0, b.offset) + out.slice(end);
    }
  }
  if (sheetsArr.length > blocks.length) {
    // Normalize to a single trailing \n, then append each new sheet as a
    // block separated by a blank line.
    out = out.replace(/\n*$/, '\n');
    for (let i = blocks.length; i < sheetsArr.length; i++) {
      out += '\n' + renderSheetAsFenced(sheetsArr[i]) + '\n';
    }
  }
  return out;
}

// Active sheet (with safe fallback to index 0).
function activeSheet(sheetsPayload) {
  const arr = (sheetsPayload && sheetsPayload.sheets) || [];
  const i = sheetsPayload && Number(sheetsPayload.activeIdx) || 0;
  return arr[i] || arr[0] || { name: 'Sheet 1', code: '' };
}

// Create a brand-new file for an unlinked panel and link the panel to it.
// Markdown extensions persist every sheet as a fenced block; .mmd / .mermaid
// only hold one diagram, so we save the active sheet and warn if there were
// extras the user is about to lose.
async function saveAsNewFile(panel, sheetsPayload) {
  const sheetsArr = (sheetsPayload && sheetsPayload.sheets) || [];
  if (sheetsArr.length === 0) return false;
  const active = activeSheet(sheetsPayload);
  const titleHint = findDiagramTitleHost(active.code) || active.name || '';
  const baseName = composeBaseName(null, titleHint) || 'diagram';
  const ws = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0];
  const baseDir = ws ? ws.uri : vscode.Uri.file(require('os').homedir());
  const defaultUri = vscode.Uri.joinPath(baseDir, baseName + '.md');
  const target = await vscode.window.showSaveDialog({
    defaultUri,
    filters: {
      'Markdown': ['md', 'mdx', 'markdown'],
      'Mermaid':  ['mmd', 'mermaid'],
    },
    saveLabel: 'Save',
  });
  if (!target) return false;

  const ext = path.extname(target.fsPath).toLowerCase();
  const isMermaidExt = ext === '.mmd' || ext === '.mermaid';
  let content;
  if (isMermaidExt) {
    if (sheetsArr.length > 1) {
      vscode.window.showWarningMessage(
        '.mmd / .mermaid files hold a single diagram; only the active sheet ' +
        '"' + active.name + '" was saved. Pick a markdown extension to keep ' +
        'all ' + sheetsArr.length + ' sheets.'
      );
    }
    content = String(active.code || '').replace(/\n+$/, '') + '\n';
  } else {
    content = joinSheetsAsMarkdown(sheetsArr);
  }

  try {
    await vscode.workspace.fs.writeFile(target, Buffer.from(content, 'utf8'));
  } catch (err) {
    vscode.window.showErrorMessage(
      'Save failed: ' + (err && err.message ? err.message : String(err))
    );
    return false;
  }

  // Link the panel so subsequent Save presses overwrite this new file.
  const fileName = path.basename(target.fsPath);
  const sourceBase = sanitizeForFilename(
    path.basename(fileName, path.extname(fileName))
  ) || 'diagram';
  panelSource.set(panel, {
    uriString: target.toString(),
    sourceBase,
    isWholeFile: isMermaidExt,
  });
  try { panel.title = 'Mermaid · ' + fileName; } catch (_) { /* ignore */ }
  try { panel.webview.postMessage({ type: 'linkedToSource' }); } catch (_) { /* ignore */ }

  // Reveal the new file in a side editor without stealing focus.
  try {
    await vscode.window.showTextDocument(target, {
      preview: false,
      preserveFocus: true,
      viewColumn: vscode.ViewColumn.Beside,
    });
  } catch (_) { /* ignore */ }

  vscode.window.setStatusBarMessage('Mermaid: created ' + fileName, 3000);
  return true;
}

// Overwrite an already-linked source file with the panel's sheets[]. For
// markdown sources we re-extract blocks at write time so the replacement
// stays accurate even if the surrounding markdown was edited meanwhile.
async function rewriteSourceFile(src, sheetsPayload) {
  const sheetsArr = (sheetsPayload && sheetsPayload.sheets) || [];
  if (sheetsArr.length === 0) return false;
  const uri = vscode.Uri.parse(src.uriString);
  let doc;
  try {
    doc = await vscode.workspace.openTextDocument(uri);
  } catch (err) {
    vscode.window.showErrorMessage(
      'Could not open source file: ' + (err && err.message ? err.message : String(err))
    );
    return false;
  }
  const fullText = doc.getText();
  const ext = path.extname(uri.fsPath || uri.path);

  let replacement;
  if (src.isWholeFile) {
    const active = activeSheet(sheetsPayload);
    if (sheetsArr.length > 1) {
      vscode.window.showWarningMessage(
        '.mmd / .mermaid files hold a single diagram; only the active sheet ' +
        '"' + active.name + '" was saved. Use "Save As" to keep the other ' +
        (sheetsArr.length - 1) + ' sheet(s) as markdown.'
      );
    }
    const trailingNl = fullText.endsWith('\n') ? '\n' : '';
    replacement = String(active.code || '').replace(/\n+$/, '') + trailingNl;
  } else {
    replacement = rewriteMarkdownBlocks(fullText, ext, sheetsArr);
  }

  const edit = new vscode.WorkspaceEdit();
  edit.replace(
    uri,
    new vscode.Range(doc.positionAt(0), doc.positionAt(fullText.length)),
    replacement
  );
  const applied = await vscode.workspace.applyEdit(edit);
  if (!applied) {
    vscode.window.showErrorMessage('Edit was rejected by the workspace.');
    return false;
  }
  try {
    await doc.save();
  } catch (err) {
    vscode.window.showWarningMessage(
      'Applied changes but failed to save: ' + (err && err.message ? err.message : String(err))
    );
    return false;
  }

  vscode.window.setStatusBarMessage(
    `Mermaid: saved ${sheetsArr.length} sheet${sheetsArr.length === 1 ? '' : 's'} to ${path.basename(uri.fsPath || uri.path)}`,
    3000
  );
  return true;
}

async function saveBackToSource(targetPanel) {
  const panel = targetPanel || currentPanel || Array.from(allPanels)[0];
  if (!panel) {
    vscode.window.showWarningMessage('Open a Mermaid Visual Editor panel first.');
    return;
  }
  let sheetsPayload;
  try {
    sheetsPayload = await requestSheets(panel);
  } catch (err) {
    vscode.window.showErrorMessage(
      'Failed to read diagram sheets: ' + (err && err.message ? err.message : String(err))
    );
    postSaveResult(panel, false);
    return;
  }

  const src = panelSource.get(panel);
  let ok;
  if (!src) {
    ok = await saveAsNewFile(panel, sheetsPayload);
  } else {
    ok = await rewriteSourceFile(src, sheetsPayload);
  }
  postSaveResult(panel, ok);
}

// ---------------------------------------------------------------------------
// Extension entry point
// ---------------------------------------------------------------------------

function activate(context) {
  context.subscriptions.push(
    vscode.commands.registerCommand('mermaidVisualEditor.open', () => {
      createPanel(context, null);
    }),
    vscode.commands.registerCommand('mermaidVisualEditor.openWithSelection', () => {
      const editor = vscode.window.activeTextEditor;
      const selected =
        editor && !editor.selection.isEmpty
          ? editor.document.getText(editor.selection)
          : null;
      createPanel(context, selected);
    }),
    vscode.commands.registerCommand('mermaidVisualEditor.openFromFile', async (uri) => {
      let target = uri;
      if (!target || typeof target.fsPath !== 'string') {
        const editor = vscode.window.activeTextEditor;
        target = editor && editor.document && editor.document.uri;
      }
      if (!target) {
        vscode.window.showWarningMessage('No file to open.');
        return;
      }
      await openFromFileUri(context, target);
    }),
    vscode.commands.registerCommand('mermaidVisualEditor.insertIntoEditor', async () => {
      const panel = currentPanel || Array.from(allPanels)[0];
      if (!panel) {
        vscode.window.showWarningMessage('Open the Mermaid Visual Editor first.');
        return;
      }
      const visibleEditors = vscode.window.visibleTextEditors;
      const editor =
        vscode.window.activeTextEditor ||
        (visibleEditors.length === 1 ? visibleEditors[0] : null);
      if (!editor) {
        vscode.window.showWarningMessage('Focus a text editor to insert into.');
        return;
      }
      try {
        const code = await requestCode(panel);
        await editor.edit((eb) => {
          if (editor.selection.isEmpty) {
            eb.insert(editor.selection.active, code);
          } else {
            eb.replace(editor.selection, code);
          }
        });
      } catch (err) {
        vscode.window.showErrorMessage(
          'Failed to read diagram code: ' + (err && err.message ? err.message : String(err))
        );
      }
    }),
    vscode.commands.registerCommand('mermaidVisualEditor.saveBackToSource', saveBackToSource)
  );
}

function deactivate() {}

module.exports = { activate, deactivate };
