const vscode = require('vscode');
const fs = require('fs');
const path = require('path');

const allPanels = new Set();
let currentPanel = null;
const pendingCodeRequests = new Map();
let nextRequestId = 1;

function getHtml(context, initialCode) {
  const htmlPath = path.join(context.extensionPath, 'media', 'mermaid-editor.html');
  let html = fs.readFileSync(htmlPath, 'utf8');

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
  const bridge =
    '<script>\n' +
    '(function () {\n' +
    '  if (typeof acquireVsCodeApi === "undefined") return;\n' +
    '  var vscode = acquireVsCodeApi();\n' +
    '  var initialCode = ' + initialCodeJson + ';\n' +
    '\n' +
    '  function getCodeEl() { return document.getElementById("code"); }\n' +
    '  function fire(el) { el.dispatchEvent(new Event("input", { bubbles: true })); }\n' +
    '\n' +
    '  function applyInitial() {\n' +
    '    if (!initialCode) return;\n' +
    '    var el = getCodeEl();\n' +
    '    if (!el) { setTimeout(applyInitial, 50); return; }\n' +
    '    el.value = initialCode;\n' +
    '    fire(el);\n' +
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
    '    }\n' +
    '  });\n' +
    '\n' +
    '  if (document.readyState === "complete") {\n' +
    '    applyInitial();\n' +
    '  } else {\n' +
    '    window.addEventListener("load", applyInitial);\n' +
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

function createPanel(context, initialCode) {
  const panel = vscode.window.createWebviewPanel(
    'mermaidLiveEditor',
    'Mermaid Live Editor',
    vscode.ViewColumn.Active,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')]
    }
  );

  panel.webview.html = getHtml(context, initialCode);

  panel.webview.onDidReceiveMessage((msg) => {
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'codeResponse') {
      const pending = pendingCodeRequests.get(msg.requestId);
      if (pending) {
        pending.resolve(msg.code || '');
        pendingCodeRequests.delete(msg.requestId);
      }
    }
  });

  panel.onDidChangeViewState(() => {
    if (panel.active) currentPanel = panel;
  });

  panel.onDidDispose(() => {
    allPanels.delete(panel);
    if (currentPanel === panel) currentPanel = null;
  });

  allPanels.add(panel);
  currentPanel = panel;
  return panel;
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

function activate(context) {
  context.subscriptions.push(
    vscode.commands.registerCommand('mermaidLiveEditor.open', () => {
      createPanel(context, null);
    }),
    vscode.commands.registerCommand('mermaidLiveEditor.openWithSelection', () => {
      const editor = vscode.window.activeTextEditor;
      const selected =
        editor && !editor.selection.isEmpty
          ? editor.document.getText(editor.selection)
          : null;
      createPanel(context, selected);
    }),
    vscode.commands.registerCommand('mermaidLiveEditor.insertIntoEditor', async () => {
      const panel = currentPanel || Array.from(allPanels)[0];
      if (!panel) {
        vscode.window.showWarningMessage('Open the Mermaid Live Editor first.');
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
    })
  );
}

function deactivate() {}

module.exports = { activate, deactivate };
