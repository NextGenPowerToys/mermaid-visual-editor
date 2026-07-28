// End-to-end stdio smoke test: spawn the server, drive it with JSON-RPC,
// and assert a real round-trip edit lands on disk. Requires `npm install` first.
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mermaid-mcp-'));
const file = path.join(dir, 'doc.md');
await fs.writeFile(file, 'Title\n\n```mermaid\nflowchart TD\n  A --> B\n```\n\nEnd\n');

const srv = spawn('node', ['./src/index.js'], { stdio: ['pipe', 'pipe', 'inherit'] });

let buf = '';
const pending = new Map();
srv.stdout.on('data', (d) => {
  buf += d.toString();
  let nl;
  while ((nl = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    const msg = JSON.parse(line);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  }
});

let id = 0;
function rpc(method, params) {
  const reqId = ++id;
  return new Promise((resolve) => {
    pending.set(reqId, resolve);
    srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: reqId, method, params }) + '\n');
  });
}

await rpc('initialize', {
  protocolVersion: '2024-11-05',
  capabilities: {},
  clientInfo: { name: 'smoke', version: '0' },
});

const tools = await rpc('tools/list', {});
const names = tools.result.tools.map((t) => t.name).sort();
assert.deepEqual(names, [
  'append_mermaid_block', 'create_diagram_file', 'list_mermaid_blocks',
  'read_mermaid_block', 'validate_mermaid', 'write_mermaid_block',
]);

const list = await rpc('tools/call', { name: 'list_mermaid_blocks', arguments: { path: file } });
assert.equal(JSON.parse(list.result.content[0].text).count, 1);

const write = await rpc('tools/call', {
  name: 'write_mermaid_block',
  arguments: { path: file, index: 0, code: 'flowchart LR\n  C --> D' },
});
assert.ok(!write.result.isError, 'write should succeed: ' + write.result.content[0].text);

const after = await fs.readFile(file, 'utf8');
assert.ok(after.includes('flowchart LR\n  C --> D'), 'edit landed');
assert.ok(after.startsWith('Title\n\n') && after.trimEnd().endsWith('End'), 'prose preserved');

const bad = await rpc('tools/call', {
  name: 'write_mermaid_block',
  arguments: { path: file, index: 0, code: 'notADiagram foo' },
});
assert.ok(bad.result.isError, 'invalid mermaid should be rejected');

srv.kill();
await fs.rm(dir, { recursive: true, force: true });
console.log('SMOKE OK — tools:', names.join(', '));
