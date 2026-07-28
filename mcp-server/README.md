# Mermaid NG — MCP Server

An [MCP](https://modelcontextprotocol.io) server that exposes the **[Mermaid NG
— Visual Editor](../README.md)** project's diagram capabilities to any
MCP-compatible AI agent (Claude Desktop, Claude Code, Cursor, Windsurf, …).

It lets an agent **list, read, edit, validate, and create** Mermaid diagrams
inside your `.md` / `.mdx` / `.markdown` / `.mmd` / `.mermaid` files — reusing
the *exact* block-parsing and round-trip logic the VSCode extension uses, so
edits preserve all surrounding prose and the file's fence style
(` ```mermaid ` **or** Azure DevOps Wiki `::: mermaid`).

Same philosophy as the extension: **fully offline, zero network calls, no
telemetry.**

## Tools

| Tool | What it does |
| --- | --- |
| `list_mermaid_blocks` | List every diagram block in a file — index, kind, line, preview. |
| `read_mermaid_block` | Return the raw source of one block by index. |
| `write_mermaid_block` | Replace one block in place, preserving prose & fence style. |
| `append_mermaid_block` | Append a new block to a markdown file, matching its fence style. |
| `create_diagram_file` | Create a new `.md`/`.mmd` diagram file. |
| `validate_mermaid` | Fast structural lint of diagram source (kind, fences, brackets). |

`write_` / `append_` / diagram creation validate the source first; pass
`validate: false` to bypass. Validation is a lightweight structural lint, not a
full Mermaid parse (which needs a browser DOM).

## Install

```bash
cd mcp-server
npm install
```

Node.js 18+ is required.

## Configure your MCP client

### Claude Desktop / Claude Code

Add to your MCP config (e.g. `claude_desktop_config.json`, or via
`claude mcp add`):

```json
{
  "mcpServers": {
    "mermaid-ng": {
      "command": "node",
      "args": ["/absolute/path/to/mermaid-visual-editor/mcp-server/src/index.js"]
    }
  }
}
```

For Claude Code, the equivalent one-liner:

```bash
claude mcp add mermaid-ng -- node /absolute/path/to/mermaid-visual-editor/mcp-server/src/index.js
```

The server speaks JSON-RPC over **stdio**; it prints only a single startup line
to `stderr` and never writes to `stdout` except protocol messages.

## Example agent flow

```
list_mermaid_blocks { "path": "docs/architecture.md" }
  → { "count": 2, "blocks": [ { "index": 0, "kind": "flowchart", "line": 12 }, … ] }

read_mermaid_block  { "path": "docs/architecture.md", "index": 0 }
  → "flowchart TD\n  A --> B"

write_mermaid_block { "path": "docs/architecture.md", "index": 0,
                      "code": "flowchart LR\n  A --> B --> C" }
  → "Wrote block 0 in docs/architecture.md."
```

## Development

```bash
npm test              # pure-logic unit tests (no deps needed)
node test/smoke.mjs   # end-to-end stdio round-trip (needs npm install first)
```

The block-parsing core lives in [`src/mermaid-blocks.js`](src/mermaid-blocks.js)
and is a framework-free port of the logic in
[`../vscode-extension/extension.js`](../vscode-extension/extension.js) — keep
the two in sync when the extension's fence handling changes.

## License

MIT — see [../LICENSE](../LICENSE). A [NGPowerToys](https://github.com/NextGenPowerToys) project.
