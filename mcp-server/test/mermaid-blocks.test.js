import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractMermaidBlocks,
  replaceBlock,
  appendBlock,
  newFileBody,
  detectKind,
} from '../src/mermaid-blocks.js';
import { validateMermaid } from '../src/validate.js';

test('extracts a single fenced block from markdown', () => {
  const md = 'Intro prose.\n\n```mermaid\nflowchart TD\n  A --> B\n```\n\nOutro.\n';
  const blocks = extractMermaidBlocks(md, '.md');
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].kind, 'flowchart');
  assert.equal(blocks[0].content, 'flowchart TD\n  A --> B');
  assert.equal(blocks[0].lineNumber, 3);
});

test('extracts multiple blocks in document order', () => {
  const md = '```mermaid\ngraph LR\nA-->B\n```\n\ntext\n\n```mermaid\nsequenceDiagram\nA->>B: hi\n```\n';
  const blocks = extractMermaidBlocks(md, '.md');
  assert.equal(blocks.length, 2);
  assert.deepEqual(blocks.map((b) => b.kind), ['flowchart', 'sequence']);
});

test('extracts an Azure DevOps ::: mermaid container', () => {
  const md = 'Doc\n\n::: mermaid\nclassDiagram\nAnimal <|-- Dog\n:::\n';
  const blocks = extractMermaidBlocks(md, '.md');
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].kind, 'class');
  assert.ok(blocks[0].fenceOpen.includes(':::'));
});

test('treats .mmd as a whole-file diagram', () => {
  const src = 'flowchart TD\n  X --> Y\n';
  const blocks = extractMermaidBlocks(src, '.mmd');
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].isWholeFile, true);
  assert.equal(blocks[0].content, 'flowchart TD\n  X --> Y');
});

test('replaceBlock preserves surrounding prose and fence style', () => {
  const md = 'Before\n\n```mermaid\nflowchart TD\n  A --> B\n```\n\nAfter\n';
  const out = replaceBlock(md, '.md', 0, 'flowchart LR\n  C --> D');
  assert.ok(out.startsWith('Before\n\n'));
  assert.ok(out.includes('```mermaid\nflowchart LR\n  C --> D\n```'));
  assert.ok(out.trimEnd().endsWith('After'));
});

test('replaceBlock round-trips the div fence style', () => {
  const md = '::: mermaid\ngraph TD\nA-->B\n:::\n';
  const out = replaceBlock(md, '.md', 0, 'graph LR\nC-->D');
  assert.ok(out.includes('::: mermaid\ngraph LR\nC-->D\n:::'));
});

test('replaceBlock rewrites a whole-file .mmd', () => {
  const out = replaceBlock('flowchart TD\nA-->B\n', '.mmd', 0, 'pie\n"A": 1');
  assert.equal(out, 'pie\n"A": 1\n');
});

test('replaceBlock rejects out-of-range index', () => {
  assert.throws(() => replaceBlock('```mermaid\ngraph TD\nA-->B\n```\n', '.md', 3, 'x'));
});

test('appendBlock adds a block matching dominant fence style', () => {
  const md = '::: mermaid\ngraph TD\nA-->B\n:::\n';
  const out = appendBlock(md, '.md', 'pie\n"A": 1');
  const blocks = extractMermaidBlocks(out, '.md');
  assert.equal(blocks.length, 2);
  assert.ok(out.includes('::: mermaid\npie'));
});

test('appendBlock refuses .mmd files', () => {
  assert.throws(() => appendBlock('flowchart TD\nA-->B\n', '.mmd', 'pie\n"A":1'));
});

test('newFileBody wraps markdown with title and fence', () => {
  const body = newFileBody('.md', 'graph TD\nA-->B', 'My Diagram');
  assert.ok(body.startsWith('# My Diagram\n\n```mermaid\n'));
  assert.ok(body.trimEnd().endsWith('```'));
});

test('newFileBody emits bare source for .mmd', () => {
  assert.equal(newFileBody('.mmd', 'graph TD\nA-->B'), 'graph TD\nA-->B\n');
});

test('detectKind recognizes families', () => {
  assert.equal(detectKind('sequenceDiagram\nA->>B: hi'), 'sequence');
  assert.equal(detectKind('erDiagram\nA ||--o{ B : has'), 'er');
  assert.equal(detectKind('mindmap\n  root'), 'mindmap');
  assert.equal(detectKind('something weird'), 'diagram');
});

test('validateMermaid accepts a good flowchart', () => {
  const v = validateMermaid('flowchart TD\n  A[Start] --> B[End]');
  assert.equal(v.valid, true);
  assert.equal(v.kind, 'flowchart');
  assert.equal(v.errors.length, 0);
});

test('validateMermaid rejects empty input', () => {
  assert.equal(validateMermaid('   ').valid, false);
});

test('validateMermaid rejects an unknown directive', () => {
  const v = validateMermaid('flowchrt TD\nA-->B');
  assert.equal(v.valid, false);
});

test('validateMermaid flags a leftover code fence', () => {
  const v = validateMermaid('```mermaid\nflowchart TD\nA-->B\n```');
  assert.equal(v.valid, false);
});

test('validateMermaid warns on unbalanced brackets', () => {
  const v = validateMermaid('flowchart TD\n  A[Start --> B[End]');
  assert.equal(v.valid, true);
  assert.ok(v.warnings.length >= 1);
});
