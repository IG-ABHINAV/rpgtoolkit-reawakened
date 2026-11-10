// #1778 research (Opus): run the bundled host probe in real Chrome over the
// Chrome DevTools Protocol, driven by puppeteer-core (scratch install, never a
// workspace dependency). Serves <dir>, opens index.html, waits for
// window.__result, then writes <dir>/browser-result.json and <dir>/parity.json
// (compared with <dir>/node-result.json).
//   node cdp-browser-run.mjs <dir> <chrome-executable> <scratch-root-with-node_modules>
import { createServer } from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, extname } from 'node:path';
import { createRequire } from 'node:module';

const [dir, chrome, scratch] = process.argv.slice(2);
const puppeteer = createRequire(join(scratch, 'package.json'))('puppeteer-core');
const types = { '.html': 'text/html', '.mjs': 'text/javascript', '.js': 'text/javascript', '.json': 'application/json' };
const server = createServer((req, res) => { let body; const p = join(dir, decodeURIComponent(new URL(req.url, 'http://x').pathname)); try { body = readFileSync(p); } catch { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'content-type': types[extname(p)] ?? 'application/octet-stream' }); res.end(body); });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--disable-gpu', '--no-first-run'] });
let result; let product; let userAgent;
try {
  product = await browser.version(); userAgent = await browser.userAgent();
  const page = await browser.newPage();
  const pageErrors = []; page.on('pageerror', (e) => pageErrors.push(String(e)));
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);
  try { await page.waitForFunction('window.__result', { timeout: 120000 }); } catch (e) { throw new Error(`probe did not finish: ${e.message}; page errors: ${pageErrors.join(' | ')}`); }
  result = await page.evaluate(() => window.__result);
} finally { await browser.close(); server.closeAllConnections(); server.close(); }
writeFileSync(join(dir, 'browser-result.json'), JSON.stringify({ browser: product, userAgent, driver: `puppeteer-core ${createRequire(join(scratch, 'package.json'))('puppeteer-core/package.json').version}`, result }, null, 1));
const node = JSON.parse(readFileSync(join(dir, 'node-result.json'), 'utf8')).result;
const comparison = Object.fromEntries(Object.keys(node).map((k) => [k, { nodeOk: node[k].ok, browserOk: result[k]?.ok, sameChecks: JSON.stringify(node[k].checks) === JSON.stringify(result[k]?.checks), sameHash: node[k].hash === result[k]?.hash, failed: result[k]?.failed }]));
writeFileSync(join(dir, 'parity.json'), JSON.stringify({ browser: product, comparison }, null, 1));
console.log(product, JSON.stringify(comparison));
