// Baut dist/sender.html und dist/receiver.html als eigenständige Einzeldateien
// (alle Skripte und die WASM-Datei eingebettet, keine Netzwerkzugriffe nötig).
// Aufruf: node build.js
const fs = require('node:fs');
const path = require('node:path');

const root = __dirname;
const read = p => fs.readFileSync(path.join(root, p), 'utf8');

function script(code) {
  // "</script" würde das Skript-Tag vorzeitig beenden.
  return '<script>' + code.replace(/<\/script/gi, '<\\/script') + '</script>';
}

const wasm = fs.readFileSync(path.join(root, 'node_modules/zxing-wasm/dist/reader/zxing_reader.wasm'));

const INLINE = {
  qrcode: () => script(read('node_modules/qrcode-generator/dist/qrcode.js')),
  codec: () => script(read('src/codec.js')),
  zxing: () =>
    script(read('node_modules/zxing-wasm/dist/iife/reader/index.js')) +
    script(`window.ZXING_WASM_B64=${JSON.stringify(wasm.toString('base64'))};`),
};

fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
for (const name of ['sender', 'receiver']) {
  const html = read(`src/${name}.html`).replace(/<!-- @inline (\w+) -->/g, (_, key) => {
    if (!INLINE[key]) throw new Error(`Unbekannter Inline-Block: ${key}`);
    return INLINE[key]();
  });
  const out = path.join(root, 'dist', `${name}.html`);
  fs.writeFileSync(out, html);
  console.log(`${path.relative(root, out)}  ${(html.length / 1024).toFixed(0)} KB`);
}
// Für GitHub Pages & Co.: Startseite = Empfänger
fs.copyFileSync(path.join(root, 'dist/receiver.html'), path.join(root, 'dist/index.html'));

// ---- cimbar-Modus: libcimbar-Dateien unverändert kopieren, eigene Seiten dazu ----
// cimbar braucht Worker und nachgeladenes WASM, läuft daher nur über http(s), nicht als Einzeldatei.
const vendor = path.join(root, 'vendor/cimbar');
const cimbarOut = path.join(root, 'dist/cimbar');
fs.mkdirSync(cimbarOut, { recursive: true });
const vendorFiles = fs.readdirSync(vendor).filter(f => f !== 'README.md');
for (const f of vendorFiles) fs.copyFileSync(path.join(vendor, f), path.join(cimbarOut, f));

// {{cimbar:recv}} -> recv.2026-08-21T2336.js (Dateinamen enthalten den Build-Zeitstempel)
function cimbarFile(name) {
  const re = new RegExp(`^${name.replace(/[-_]/g, '[-_]')}\\.\\d{4}-[\\dT-]+\\.js$`);
  const hits = vendorFiles.filter(f => re.test(f));
  if (hits.length !== 1) throw new Error(`cimbar-Datei für "${name}" nicht eindeutig: ${hits.join(', ') || 'keine'}`);
  return hits[0];
}
for (const [src, dst] of [['cimbar-sender.html', 'sender.html'], ['cimbar-receiver.html', 'index.html']]) {
  const html = read(`src/${src}`).replace(/\{\{cimbar:([\w-]+)\}\}/g, (_, name) => cimbarFile(name));
  fs.writeFileSync(path.join(cimbarOut, dst), html);
  console.log(`dist/cimbar/${dst}`);
}
