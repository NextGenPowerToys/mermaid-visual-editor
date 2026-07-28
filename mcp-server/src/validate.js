import { detectKind } from './mermaid-blocks.js';

// Diagram directives Mermaid recognises on the first meaningful line. Used for a
// fast structural sanity check — this is NOT a full Mermaid parse (that needs a
// browser DOM), but it catches the common mistakes agents make: empty input, a
// stray closing fence left in the source, or an unknown/misspelled directive.
const KNOWN_HEADERS = [
  'flowchart', 'graph', 'sequencediagram', 'classdiagram', 'statediagram',
  'statediagram-v2', 'erdiagram', 'gantt', 'pie', 'journey', 'mindmap',
  'gitgraph', 'timeline', 'quadrantchart', 'requirementdiagram', 'c4context',
  'c4container', 'c4component', 'c4dynamic', 'c4deployment', 'sankey-beta',
  'xychart-beta', 'block-beta', 'architecture-beta', 'packet-beta', 'kanban',
  'zenuml', 'radar-beta', 'treemap',
];

/**
 * Lightweight structural validation of a Mermaid diagram's source.
 * @param {string} code
 * @returns {{valid:boolean, kind:string, errors:string[], warnings:string[]}}
 */
export function validateMermaid(code) {
  const errors = [];
  const warnings = [];
  const raw = String(code || '');

  if (!raw.trim()) {
    return { valid: false, kind: 'unknown', errors: ['Diagram source is empty.'], warnings };
  }

  // Strip an optional YAML frontmatter block (--- ... ---) and %% comments /
  // %%{init}%% directives before locating the diagram header.
  let body = raw.replace(/^\s*---\s*\n[\s\S]*?\n---\s*(?:\n|$)/, '');
  const lines = body.split('\n');
  let headerLine = '';
  for (const line of lines) {
    const t = line.trim();
    if (!t || t.startsWith('%%')) continue;
    headerLine = t;
    break;
  }

  const firstWord = (headerLine.split(/[\s({]/)[0] || '').toLowerCase();
  const kind = detectKind(body);

  if (!headerLine) {
    errors.push('No diagram directive found (only comments / frontmatter).');
  } else if (!KNOWN_HEADERS.includes(firstWord)) {
    errors.push(
      `Unrecognized diagram type "${headerLine.split(/\s/)[0]}". ` +
      `Expected one of: ${KNOWN_HEADERS.join(', ')}.`
    );
  }

  // A leftover code fence almost always means the caller passed the whole
  // markdown block instead of just the diagram source.
  if (/^\s*(```|~~~|:::)/m.test(body)) {
    errors.push('Source contains a code fence (``` / ~~~ / :::). Pass only the diagram body, not the fenced block.');
  }

  // Unbalanced brackets are a frequent flowchart typo. Report as a warning
  // because strings and some shapes legitimately unbalance them.
  for (const [open, close, name] of [['[', ']', 'square'], ['(', ')', 'round'], ['{', '}', 'curly']]) {
    const o = (body.match(new RegExp('\\' + open, 'g')) || []).length;
    const c = (body.match(new RegExp('\\' + close, 'g')) || []).length;
    if (o !== c) warnings.push(`Unbalanced ${name} brackets (${o} "${open}" vs ${c} "${close}").`);
  }

  return { valid: errors.length === 0, kind, errors, warnings };
}
