// #1778 research (Opus): run the bundled host probe in real Chrome through the
// Chrome DevTools Protocol, using only Node built-ins (global WebSocket/fetch).
// Starts a static server for <dir>, launches headless Chrome with a remote
// debugging port, navigates, waits for window.__result, writes
// <dir>/browser-result.json and <dir>/parity.json (vs <dir>/node-result.json).
//   node cdp-browser-run.mjs <dir> <chrome-executable>
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join, extname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';

const [dir, chrome] = process.argv.slice(2);
const types = { '.html': 'text/html', '.mjs': 'text/javascript', '.js': 'text/javascript', '.json': 'application/json' };
const server = createServer((req, res) => { try { const p = join(dir, decodeURIComponent(new URL(req.url, 'http://x').pathname)); res.writeHead(200, { 'content-type': types[extname(p)] ?? 'application/octet-stream' }); res.end(readFileSync(p)); } catch { res.writeHead(404); res.end(); } });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const cdpPort = 9300 + Math.floor(Math.random() * 500);
const proc = spawn(chrome, ['--headless=new', '--disable-gpu', '--no-first-run', '--remote-allow-origins=*', `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'opus-cdp-'))}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
let chromeErr = ''; proc.stderr.on('data', (d) => { chromeErr += d; });
const log = (m) => process.stderr.write(`[cdp] ${m}\n`);
let target;
for (let i = 0; i < 100 && !target; i++) { try { target = (await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json()).find((t) => t.type === 'page'); } catch { /* not up yet */ } if (!target) await new Promise((r) => setTimeout(r, 100)); }
if (!target) throw new Error(`Chrome DevTools endpoint did not start: ${chromeErr.slice(0, 500)}`);
log(`target ${target.webSocketDebuggerUrl}`);
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = (e) => j(new Error(`CDP websocket failed: ${e.message ?? e.type}`)); });
log('websocket open');
let id = 0; const pending = new Map();
ws.onmessage = async (m) => { const text = typeof m.data === 'string' ? m.data : await new Response(m.data).text(); if (process.env.CDP_DEBUG) log(`recv ${text.slice(0, 160)}`); const d = JSON.parse(text); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } };
ws.onclose = (e) => log(`websocket closed ${e.code} ${e.reason}`);
const send = (method, params = {}) => new Promise((r) => { const n = ++id; pending.set(n, r); ws.send(JSON.stringify({ id: n, method, params })); });
const v = await (await fetch(`http://127.0.0.1:${cdpPort}/json/version`)).json();
const version = { product: v.Browser, userAgent: v['User-Agent'] }; log(`browser ${version.product}`);
const nav = await send('Page.navigate', { url: `http://127.0.0.1:${port}/index.html` }); log(`navigated ${JSON.stringify(nav.result ?? nav.error)}`);
let result = null;
for (let i = 0; i < 300 && !result; i++) { const r = await send('Runtime.evaluate', { expression: 'window.__result ? JSON.stringify(window.__result) : null', returnByValue: true }); result = r.result?.result?.value ? JSON.parse(r.result.result.value) : null; if (!result) { if (i % 50 === 49) log(`waiting; title=${(await send('Runtime.evaluate', { expression: 'document.title', returnByValue: true })).result?.result?.value}`); await new Promise((r2) => setTimeout(r2, 100)); } }
ws.close(); proc.kill(); server.closeAllConnections(); server.close();
if (!result) throw new Error('probe did not finish in the browser');
writeFileSync(join(dir, 'browser-result.json'), JSON.stringify({ browser: version.product, userAgent: version.userAgent, result }, null, 1));
const node = JSON.parse(readFileSync(join(dir, 'node-result.json'), 'utf8')).result;
const comparison = Object.fromEntries(Object.keys(node).map((k) => [k, { nodeOk: node[k].ok, browserOk: result[k]?.ok, sameChecks: JSON.stringify(node[k].checks) === JSON.stringify(result[k]?.checks), sameHash: node[k].hash === result[k]?.hash, failed: result[k]?.failed }]));
writeFileSync(join(dir, 'parity.json'), JSON.stringify({ browser: version.product, comparison }, null, 1));
console.log(version.product, JSON.stringify(comparison));
