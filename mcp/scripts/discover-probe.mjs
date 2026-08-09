/**
 * Probes how each SDK line answers a 2026-07-28-era opening.
 *
 * Claude Code 2.1.226's binary contains a `server/discover` request builder and the string
 * "required _meta envelope for protocol revision 2026-07-28", so a modern opening is code the
 * client can emit. This asks both spike servers what happens if it does — the answer decides
 * whether choosing v1 risks a client we cannot drive from here.
 *
 * The envelope key names are taken verbatim from the Claude Code binary.
 */
import { spawn } from 'node:child_process';

const target = process.argv.slice(2);
const child = spawn(target[0], target.slice(1), {
  cwd: '/Users/Vitalik/WebstormProjects/dev-digest',
  stdio: ['pipe', 'pipe', 'pipe'],
});

let buf = '';
child.stdout.on('data', (b) => {
  buf += b.toString('utf8');
  let nl;
  while ((nl = buf.indexOf('\n')) !== -1) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (line) console.log('<-- ' + line);
  }
});

const req = {
  jsonrpc: '2.0',
  id: 1,
  method: 'server/discover',
  params: {
    _meta: {
      'io.modelcontextprotocol/protocolVersion': '2026-07-28',
      'io.modelcontextprotocol/clientInfo': { name: 'discover-probe', version: '0.0.0' },
      'io.modelcontextprotocol/clientCapabilities': {},
    },
  },
};

console.log('--> ' + JSON.stringify(req));
child.stdin.write(JSON.stringify(req) + '\n');

setTimeout(() => {
  child.kill('SIGKILL');
  process.exit(0);
}, 4000);
