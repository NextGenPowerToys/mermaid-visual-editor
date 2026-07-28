#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Mermaid NG — MCP server
//
// Exposes the Mermaid Visual Editor's diagram-handling capabilities to any
// MCP-compatible AI agent (Claude Desktop, Claude Code, Cursor, …) over stdio.
// It reuses the exact block-extraction and round-trip logic the VSCode
// extension uses, so an agent can list, read, edit, validate, and create
// Mermaid diagrams inside `.md` / `.mdx` / `.markdown` / `.mmd` / `.mermaid`
// files — preserving all surrounding prose and the file's fence style.
//
// No network calls, no telemetry: same offline philosophy as the extension.
// ---------------------------------------------------------------------------

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ErrorCode,
} from '@modelcontextprotocol/sdk/types.js';

import {
  extractMermaidBlocks,
  replaceBlock,
  appendBlock,
  newFileBody,
} from './mermaid-blocks.js';
import { validateMermaid } from './validate.js';

const MD_EXTS = new Set(['.md', '.mdx', '.markdown', '.mmd', '.mermaid']);

function extOf(p) {
  return path.extname(p).toLowerCase();
}

async function readFileOrThrow(p) {
  try {
    return await fs.readFile(p, 'utf8');
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      throw new McpError(ErrorCode.InvalidParams, `File not found: ${p}`);
    }
    throw new McpError(ErrorCode.InternalError, `Could not read ${p}: ${err.message}`);
  }
}

function requireString(args, name) {
  const v = args && args[name];
  if (typeof v !== 'string' || !v) {
    throw new McpError(ErrorCode.InvalidParams, `Missing required string parameter "${name}".`);
  }
  return v;
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

const TOOLS = [
  {
    name: 'list_mermaid_blocks',
    description:
      'List every Mermaid diagram block in a markdown (.md/.mdx/.markdown) or ' +
      '.mmd/.mermaid file. Returns each block\'s index, detected diagram kind, ' +
      '1-based line number, and a short preview. Use the returned index with ' +
      'read_mermaid_block / write_mermaid_block.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to the file to scan.' },
      },
      required: ['path'],
    },
  },
  {
    name: 'read_mermaid_block',
    description:
      'Return the raw Mermaid source of one diagram block in a file, selected ' +
      'by its zero-based index (see list_mermaid_blocks).',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to the file.' },
        index: { type: 'integer', description: 'Zero-based block index. Defaults to 0.', minimum: 0 },
      },
      required: ['path'],
    },
  },
  {
    name: 'write_mermaid_block',
    description:
      'Replace one diagram block\'s source in place, preserving all surrounding ' +
      'prose and the file\'s original fence style (```mermaid or ::: mermaid). ' +
      'For .mmd/.mermaid files, replaces the whole-file diagram. The new code is ' +
      'validated first; pass validate:false to skip that check.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to the file.' },
        index: { type: 'integer', description: 'Zero-based block index. Defaults to 0.', minimum: 0 },
        code: { type: 'string', description: 'New Mermaid diagram source (body only, no fences).' },
        validate: { type: 'boolean', description: 'Validate before writing (default true).' },
      },
      required: ['path', 'code'],
    },
  },
  {
    name: 'append_mermaid_block',
    description:
      'Append a new Mermaid diagram block to the end of an existing markdown ' +
      'file, matching the file\'s dominant fence style. Not for .mmd/.mermaid ' +
      'files (they hold a single diagram).',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to the markdown file.' },
        code: { type: 'string', description: 'New Mermaid diagram source (body only, no fences).' },
        validate: { type: 'boolean', description: 'Validate before writing (default true).' },
      },
      required: ['path', 'code'],
    },
  },
  {
    name: 'create_diagram_file',
    description:
      'Create a new diagram file. Markdown extensions get a fenced ```mermaid ' +
      'block (with an optional H1 title); .mmd/.mermaid get the bare diagram. ' +
      'Fails if the file already exists unless overwrite:true.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Destination path (.md/.mdx/.markdown/.mmd/.mermaid).' },
        code: { type: 'string', description: 'Mermaid diagram source (body only, no fences).' },
        title: { type: 'string', description: 'Optional H1 heading for markdown files.' },
        overwrite: { type: 'boolean', description: 'Overwrite if the file exists (default false).' },
      },
      required: ['path', 'code'],
    },
  },
  {
    name: 'validate_mermaid',
    description:
      'Structurally validate Mermaid diagram source without a browser: checks ' +
      'for an empty body, a recognized diagram directive, leftover code fences, ' +
      'and unbalanced brackets. Returns { valid, kind, errors, warnings }. ' +
      'Note: this is a fast lint, not a full Mermaid parse.',
    inputSchema: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'Mermaid diagram source (body only, no fences).' },
      },
      required: ['code'],
    },
  },
];

// ---------------------------------------------------------------------------
// Tool handlers
// ---------------------------------------------------------------------------

function textResult(text, isError) {
  return { content: [{ type: 'text', text }], ...(isError ? { isError: true } : {}) };
}

function assertMdExt(p) {
  const ext = extOf(p);
  if (!MD_EXTS.has(ext)) {
    throw new McpError(
      ErrorCode.InvalidParams,
      `Unsupported extension "${ext || '(none)'}". Expected one of: ${[...MD_EXTS].join(', ')}.`
    );
  }
  return ext;
}

const handlers = {
  async list_mermaid_blocks(args) {
    const p = requireString(args, 'path');
    const ext = assertMdExt(p);
    const text = await readFileOrThrow(p);
    const blocks = extractMermaidBlocks(text, ext);
    const summary = blocks.map((b) => ({
      index: b.index,
      kind: b.kind,
      line: b.lineNumber,
      isWholeFile: b.isWholeFile,
      preview: b.content.trim().split('\n')[0].slice(0, 80),
    }));
    return textResult(JSON.stringify({ path: p, count: blocks.length, blocks: summary }, null, 2));
  },

  async read_mermaid_block(args) {
    const p = requireString(args, 'path');
    const ext = assertMdExt(p);
    const index = Number.isInteger(args.index) ? args.index : 0;
    const text = await readFileOrThrow(p);
    const blocks = extractMermaidBlocks(text, ext);
    const block = blocks[index];
    if (!block) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `Block index ${index} out of range (file has ${blocks.length} block(s)).`
      );
    }
    return textResult(block.content);
  },

  async write_mermaid_block(args) {
    const p = requireString(args, 'path');
    const ext = assertMdExt(p);
    const code = requireString(args, 'code');
    const index = Number.isInteger(args.index) ? args.index : 0;
    if (args.validate !== false) {
      const v = validateMermaid(code);
      if (!v.valid) {
        return textResult(`Refusing to write: invalid Mermaid.\n${v.errors.join('\n')}`, true);
      }
    }
    const text = await readFileOrThrow(p);
    const updated = replaceBlock(text, ext, index, code);
    await fs.writeFile(p, updated, 'utf8');
    return textResult(`Wrote block ${index} in ${p}.`);
  },

  async append_mermaid_block(args) {
    const p = requireString(args, 'path');
    const ext = assertMdExt(p);
    const code = requireString(args, 'code');
    if (args.validate !== false) {
      const v = validateMermaid(code);
      if (!v.valid) {
        return textResult(`Refusing to write: invalid Mermaid.\n${v.errors.join('\n')}`, true);
      }
    }
    const text = await readFileOrThrow(p);
    const updated = appendBlock(text, ext, code);
    await fs.writeFile(p, updated, 'utf8');
    const count = extractMermaidBlocks(updated, ext).length;
    return textResult(`Appended a block to ${p} (now ${count} block(s)).`);
  },

  async create_diagram_file(args) {
    const p = requireString(args, 'path');
    const ext = assertMdExt(p);
    const code = requireString(args, 'code');
    if (!args.overwrite) {
      try {
        await fs.access(p);
        return textResult(`File already exists: ${p}. Pass overwrite:true to replace it.`, true);
      } catch { /* does not exist — good */ }
    }
    await fs.mkdir(path.dirname(path.resolve(p)), { recursive: true });
    await fs.writeFile(p, newFileBody(ext, code, args.title), 'utf8');
    return textResult(`Created ${p}.`);
  },

  async validate_mermaid(args) {
    const code = requireString(args, 'code');
    return textResult(JSON.stringify(validateMermaid(code), null, 2));
  },
};

// ---------------------------------------------------------------------------
// Wire up the server
// ---------------------------------------------------------------------------

const server = new Server(
  { name: 'mermaid-ng', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const handler = handlers[name];
  if (!handler) {
    throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
  }
  try {
    return await handler(args || {});
  } catch (err) {
    if (err instanceof McpError) throw err;
    return textResult(`Error: ${err.message}`, true);
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Announce on stderr so it never corrupts the stdio JSON-RPC stream.
  console.error('Mermaid NG MCP server running on stdio.');
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
