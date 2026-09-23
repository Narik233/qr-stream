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
