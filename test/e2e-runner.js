// End-to-End-Tests im echten Browser (headless Chrome/Edge via puppeteer-core).
// Aufruf: npm run build && npm run test:e2e
// Browser: Umgebungsvariable CHROME_PATH, sonst übliche Installationspfade.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const puppeteer = require('puppeteer-core');

const root = path.join(__dirname, '..');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.wasm': 'application/wasm' };

function findBrowser() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ];
  const hit = candidates.find(p => p && fs.existsSync(p));
  if (!hit) throw new Error('Kein Chrome/Edge gefunden – CHROME_PATH setzen.');
  return hit;
}

function serve() {
  const server = http.createServer((req, res) => {
    const file = path.join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise(r => server.listen(0, '127.0.0.1', () => r(server)));
}

async function runPage(browser, base, page, cases) {
  const tab = await browser.newPage();
  await tab.setViewport({ width: 1600, height: 900 });
  const errors = [];
  tab.on('pageerror', e => errors.push(e.message));
  await tab.goto(`${base}/test/${page}`, { waitUntil: 'load' });
  const results = [];
  for (const c of cases) {
    const r = await tab.evaluate(c => window.run(c), c);
    console.log(`  ${page}  ${JSON.stringify(r)}`);
    results.push(r);
  }
  await tab.close();
  return { results, errors };
}

(async () => {
  if (!fs.existsSync(path.join(root, 'dist/cimbar/index.html'))) throw new Error('Erst `npm run build` ausführen.');
  const server = await serve();
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await puppeteer.launch({
    executablePath: findBrowser(),
    headless: true,
    protocolTimeout: 600000,
    args: ['--autoplay-policy=no-user-gesture-required', '--use-gl=angle', '--enable-unsafe-swiftshader'],
  });
  let failed = false;
  try {
    const qr = await runPage(browser, base, 'e2e.html', [
      { size: 100000, codes: 4, chunk: 500 },
      { size: 100000, codes: 4, chunk: 500, drop: 0.4 },
    ]);
    const cb = await runPage(browser, base, 'cimbar-e2e.html', [
      { size: 200000, mode: 'B' },
      { size: 100000, mode: '4C' },
      { size: 100000, mode: 'Bm' },
      { size: 100000, mode: 'Bu' },
      { size: 1000000, mode: 'B' },
    ]);
    for (const r of [...qr.results, ...cb.results]) if (!r.identical) failed = true;
    for (const e of [...qr.errors, ...cb.errors]) console.log('  Seitenfehler:', e);
  } catch (e) {
    console.error(e);
    failed = true;
  } finally {
    await browser.close();
    server.close();
  }
  console.log(failed ? 'FEHLGESCHLAGEN' : 'OK');
  process.exit(failed ? 1 : 0);
})();
