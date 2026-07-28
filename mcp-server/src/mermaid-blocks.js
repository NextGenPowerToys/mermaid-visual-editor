// ---------------------------------------------------------------------------
// Mermaid block extraction & round-trip rewriting.
//
// This is a framework-free port of the proven parsing logic in
// `vscode-extension/extension.js`. It understands the same two container
// syntaxes the extension does — CommonMark ```mermaid fences and Azure DevOps
// Wiki / Pandoc `::: mermaid ... :::` divs — plus whole-file `.mmd` / `.mermaid`
// documents. Keeping the regexes byte-identical to the extension guarantees the
// MCP server and the editor agree on what a "diagram block" is.
// ---------------------------------------------------------------------------

/**
 * Guess a diagram's family from its first non-empty line.
 * @param {string} content
 * @returns {string}
 */
export function detectKind(content) {
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

/**
 * Extract every mermaid diagram block from a file's text.
 * @param {string} text  Raw file contents.
 * @param {string} ext   File extension (with or without leading dot).
 * @returns {Array<{index:number,content:string,offset:number,length:number,lineNumber:number,isWholeFile:boolean,fenceOpen:(string|null),fenceClose:(string|null),kind:string}>}
 */
export function extractMermaidBlocks(text, ext) {
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
  // We collect blocks from two distinct syntaxes and then sort by offset so a
  // file that mixes them (rare but possible) still yields a stable,
  // document-ordered list.
  const found = [];

  // 1. CommonMark fenced code block: 3+ backticks/tildes, info string starts
  //    with "mermaid". Closing fence must match the opening character and be at
  //    least as long. Up to 3 leading spaces of indentation.
  const fenceRe = /(^|\n)([ \t]{0,3})(`{3,}|~{3,})[ \t]*mermaid\b[^\n]*\n([\s\S]*?)(?:\r?\n)\2\3+[ \t]*(?=\r?\n|$)/gi;
  // 2. Azure DevOps Wiki / Pandoc fenced-div container: ::: mermaid ... :::
  const divRe = /(^|\n)([ \t]{0,3})(:{3,})[ \t]*mermaid\b[^\n]*\n([\s\S]*?)(?:\r?\n)\2:{3,}[ \t]*(?=\r?\n|$)/gi;

  let m;
  while ((m = fenceRe.exec(text)) !== null) {
    const leadNl = m[1].length;
    const startOffset = m.index + leadNl;
    const fullLen = m[0].length - leadNl;
    found.push({
      content: m[4],
      offset: startOffset,
      length: fullLen,
      fenceOpen: m[2] + m[3] + 'mermaid',
      fenceClose: m[2] + m[3],
    });
  }
  while ((m = divRe.exec(text)) !== null) {
    const leadNl = m[1].length;
    const startOffset = m.index + leadNl;
    const fullLen = m[0].length - leadNl;
    // Preserve the user's exact colon counts on both ends so save-back
    // round-trips byte-for-byte where possible.
    const closeMatch = m[0].slice(0, m[0].length - (m[0].endsWith('\n') ? 1 : 0))
      .match(/:{3,}[ \t]*$/);
    const closeColons = closeMatch ? closeMatch[0].replace(/[ \t]+$/, '') : ':::';
    found.push({
      content: m[4],
      offset: startOffset,
      length: fullLen,
      fenceOpen: m[2] + m[3] + ' mermaid',
      fenceClose: m[2] + closeColons,
    });
  }

  found.sort((a, b) => a.offset - b.offset);

  return found.map((b, idx) => ({
    index: idx,
    content: b.content,
    offset: b.offset,
    length: b.length,
    lineNumber: text.slice(0, b.offset).split('\n').length,
    isWholeFile: false,
    fenceOpen: b.fenceOpen,
    fenceClose: b.fenceClose,
    kind: detectKind(b.content),
  }));
}

/**
 * Emit one fenced mermaid block. `style === 'div'` yields the Azure DevOps
 * Wiki / Pandoc `::: mermaid ... :::` form; anything else yields a backtick
 * fence (the most portable, GitHub-flavored syntax).
 * @param {string} code
 * @param {'fence'|'div'} [style]
 * @returns {string}
 */
export function renderFenced(code, style) {
  const body = String(code || '').replace(/\n+$/, '');
  if (style === 'div') return '::: mermaid\n' + body + '\n:::';
  return '```mermaid\n' + body + '\n```';
}

/**
 * Pick the dominant fence style from a file's existing blocks so appended
 * diagrams match its convention. Defaults to backtick fences.
 * @param {Array<{fenceOpen:(string|null)}>} blocks
 * @returns {'fence'|'div'}
 */
export function dominantFenceStyle(blocks) {
  if (!blocks || blocks.length === 0) return 'fence';
  const colonHits = blocks.reduce(
    (n, b) => n + ((b.fenceOpen || '').trimStart().startsWith(':') ? 1 : 0),
    0
  );
  return colonHits > blocks.length / 2 ? 'div' : 'fence';
}

/**
 * Replace a single diagram block (by index) with new code, preserving all
 * surrounding prose and the block's original fence characters. For whole-file
 * `.mmd` / `.mermaid` documents, replaces the entire file body.
 * @param {string} text  Raw file contents.
 * @param {string} ext   File extension.
 * @param {number} index Zero-based block index to replace.
 * @param {string} code  New diagram source.
 * @returns {string} The rewritten file text.
 */
export function replaceBlock(text, ext, index, code) {
  const blocks = extractMermaidBlocks(text, ext);
  const block = blocks[index];
  if (!block) {
    throw new Error(
      `Block index ${index} out of range (file has ${blocks.length} block(s)).`
    );
  }
  const body = String(code || '').replace(/\n+$/, '');
  if (block.isWholeFile) {
    return body + '\n';
  }
  const fenceOpen = block.fenceOpen || '```mermaid';
  const fenceClose = block.fenceClose || '```';
  const replacement = fenceOpen + '\n' + body + '\n' + fenceClose;
  return text.slice(0, block.offset) + replacement + text.slice(block.offset + block.length);
}

/**
 * Append a new diagram block to an existing markdown file, matching its
 * dominant fence style. Not for `.mmd` / `.mermaid` files, which hold exactly
 * one diagram.
 * @param {string} text
 * @param {string} ext
 * @param {string} code
 * @returns {string}
 */
export function appendBlock(text, ext, code) {
  const e = (ext || '').toLowerCase().replace(/^\./, '');
  if (e === 'mmd' || e === 'mermaid') {
    throw new Error('.mmd / .mermaid files hold a single diagram; cannot append.');
  }
  const blocks = extractMermaidBlocks(text, ext);
  const style = dominantFenceStyle(blocks);
  const out = text.replace(/\n*$/, '\n');
  return out + '\n' + renderFenced(code, style) + '\n';
}

/**
 * Build a fresh file body for a new diagram file.
 * @param {string} ext   Target extension (decides fenced vs. bare).
 * @param {string} code  Diagram source.
 * @param {string} [title] Optional H1 title for markdown files.
 * @returns {string}
 */
export function newFileBody(ext, code, title) {
  const e = (ext || '').toLowerCase().replace(/^\./, '');
  const body = String(code || '').replace(/\n+$/, '');
  if (e === 'mmd' || e === 'mermaid') {
    return body + '\n';
  }
  const heading = title ? '# ' + title + '\n\n' : '';
  return heading + renderFenced(body) + '\n';
}
