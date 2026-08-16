/**
 * Raw stdio driver. No SDK, no Inspector — it spawns the server exactly the way a client would,
 * writes newline-delimited JSON-RPC to its stdin, and records every byte that comes back on stdout
 * and stderr separately.
 *
 * It exists to answer three things the Inspector cannot show directly:
 *   - are the FIRST BYTES on stdout a JSON-RPC frame (Constraint 2 of plans/06-mcp-server.md),
 *   - what is process.cwd() inside the server when the parent spawns it with the repo root as cwd,
 *   - how many progress notifications actually reached the wire during a call.
 *
 * Usage:
 *   node mcp/scripts/driver.mjs -- node mcp/dist/index.js                       # the spike default
 *   node mcp/scripts/driver.mjs --tool get_blast_radius --args '{"repo":"a/b","pr":1}' \
 *     --expect-tools 5 --no-progress -- node mcp/dist/index.js
 *
 * Flags: --protocol V · --cwd DIR · --tool NAME · --args JSON · --expect-tools N · --no-progress
 */
import { spawn } from 'node:child_process';

const argv = process.argv.slice(2);
const sep = argv.indexOf('--');
if (sep === -1) {
  console.error('usage: driver.mjs [--protocol V] [--cwd DIR] -- <command> [args...]');
  process.exit(2);
}
const flags = argv.slice(0, sep);
const [command, ...args] = argv.slice(sep + 1);

const flag = (name, fallback) => {
  const i = flags.indexOf(`--${name}`);
  return i === -1 ? fallback : flags[i + 1];
};

const protocolVersion = flag('protocol', '2025-06-18');
const cwd = flag('cwd', process.cwd());
const toolName = flag('tool', 'ping');
const toolArgs = JSON.parse(flag('args', '{"delay_ms":5000,"steps":5}'));
const expectTools = flags.includes('--expect-tools') ? Number(flag('expect-tools')) : null;
const progressRequired = !flags.includes('--no-progress');

const stdoutChunks = [];
const stderrChunks = [];
let firstStdoutBytes = null;

const child = spawn(command, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env } });

child.stdout.on('data', (b) => {
  if (firstStdoutBytes === null) firstStdoutBytes = Buffer.from(b.subarray(0, 200));
  stdoutChunks.push(b);
});
child.stderr.on('data', (b) => stderrChunks.push(b));

const inbox = [];
const waiters = [];
let buf = '';

child.stdout.on('data', (b) => {
  buf += b.toString('utf8');
  let nl;
  while ((nl = buf.indexOf('\n')) !== -1) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      msg = { __unparseable__: line };
    }
    inbox.push(msg);
    const w = waiters.shift();
    if (w) w();
  }
});

const send = (obj) => {
  process.stderr.write(`--> ${JSON.stringify(obj)}\n`);
  child.stdin.write(JSON.stringify(obj) + '\n');
};

const nextMessage = (timeoutMs = 30000) =>
  new Promise((resolve, reject) => {
    if (inbox.length) return resolve(inbox.shift());
    const t = setTimeout(() => reject(new Error(`timeout after ${timeoutMs}ms waiting for a frame`)), timeoutMs);
    waiters.push(() => {
      clearTimeout(t);
      resolve(inbox.shift());
    });
  });

/** Reads frames until one carries the given id; returns {response, notifications}. */
const awaitResponse = async (id, timeoutMs = 60000) => {
  const notifications = [];
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const msg = await nextMessage(Math.max(1, deadline - Date.now()));
    if (msg.id === id) return { response: msg, notifications };
    notifications.push(msg);
  }
};

const fail = (why, err) => {
  console.log(`\n### RESULT: FAIL — ${why}`);
  if (err) console.log(String(err.stack ?? err));
  console.log('\n### stderr from server:\n' + Buffer.concat(stderrChunks).toString('utf8'));
  child.kill('SIGKILL');
  process.exit(1);
};

try {
  console.log(`### launching: ${command} ${args.join(' ')}`);
  console.log(`### parent cwd passed to spawn: ${cwd}`);
  console.log(`### client protocolVersion: ${protocolVersion}\n`);

  send({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion,
      capabilities: {},
      clientInfo: { name: 'devdigest-spike-driver', version: '0.0.0' },
    },
  });
  const init = await awaitResponse(1);
  console.log('### initialize response:\n' + JSON.stringify(init.response, null, 2));

  send({ jsonrpc: '2.0', method: 'notifications/initialized' });

  send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
  const list = await awaitResponse(2);
  console.log('\n### tools/list response:\n' + JSON.stringify(list.response, null, 2));

  const listedTools = list.response?.result?.tools ?? [];
  console.log(`\n### tools listed: ${listedTools.length} — ${listedTools.map((t) => t.name).join(', ')}`);
  const toolCountOk = expectTools === null || listedTools.length === expectTools;

  const callStartedAt = Date.now();
  send({
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: {
      name: toolName,
      arguments: toolArgs,
      _meta: { progressToken: 'spike-progress-1' },
    },
  });
  const call = await awaitResponse(3, 90000);
  const elapsed = Date.now() - callStartedAt;

  const progress = call.notifications.filter((n) => n.method === 'notifications/progress');
  console.log(`\n### tools/call took ${elapsed}ms`);
  console.log(`### progress notifications received during the call: ${progress.length}`);
  for (const p of progress) console.log('    ' + JSON.stringify(p));
  const otherNotifications = call.notifications.filter((n) => n.method !== 'notifications/progress');
  if (otherNotifications.length) {
    console.log('### other frames during the call:');
    for (const n of otherNotifications) console.log('    ' + JSON.stringify(n));
  }
  console.log('\n### tools/call response:\n' + JSON.stringify(call.response, null, 2));

  console.log('\n### FIRST 200 BYTES ON STDOUT (must be a JSON-RPC frame, no banner):');
  console.log(JSON.stringify(firstStdoutBytes?.toString('utf8') ?? null));
  const firstChar = firstStdoutBytes?.toString('utf8').trimStart()[0];
  const stdoutClean = firstChar === '{';

  const allStdout = Buffer.concat(stdoutChunks).toString('utf8');
  const nonJsonLines = allStdout
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((l) => {
      try {
        JSON.parse(l);
        return false;
      } catch {
        return true;
      }
    });

  console.log(`\n### stdout lines that are NOT valid JSON: ${nonJsonLines.length}`);
  for (const l of nonJsonLines.slice(0, 10)) console.log('    ' + JSON.stringify(l));

  console.log('\n### stderr from server:\n' + Buffer.concat(stderrChunks).toString('utf8'));

  const toolText = call.response?.result?.content?.[0]?.text;
  if (toolText) {
    console.log('### server-reported process facts:\n' + toolText);
  }

  const ok =
    stdoutClean &&
    nonJsonLines.length === 0 &&
    (!progressRequired || progress.length > 0) &&
    toolCountOk &&
    !call.response?.error &&
    call.response?.result != null;

  console.log(`\n### RESULT: ${ok ? 'PASS' : 'FAIL'}`);
  console.log(
    `    stdout first bytes are JSON-RPC: ${stdoutClean}\n` +
      `    stdout has zero non-JSON lines: ${nonJsonLines.length === 0}\n` +
      `    tools listed matches expected:  ${toolCountOk}${expectTools === null ? ' (not checked)' : ` (${expectTools})`}\n` +
      `    progress notifications > 0:     ${progress.length > 0}${progressRequired ? '' : ' (not required)'}\n` +
      `    tools/call returned a result:   ${call.response?.result != null}`,
  );

  child.kill('SIGTERM');
  setTimeout(() => process.exit(ok ? 0 : 1), 200);
} catch (err) {
  fail('driver threw', err);
}
