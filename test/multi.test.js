// Mehrere QR-Codes in einem Bild (2x2-Raster) mit zxing-wasm erkennen.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const QRS = require('../src/codec.js');
const qrcode = require('qrcode-generator');

globalThis.ImageData ??= class ImageData {
  constructor(data, width, height) { Object.assign(this, { data, width, height }); }
};
const ZX = require('zxing-wasm/reader');

function renderGrid(texts, cols, scale) {
  const qrs = texts.map(t => { const q = qrcode(0, 'L'); q.addData(t, 'Alphanumeric'); q.make(); return q; });
  const n = qrs[0].getModuleCount(), quiet = 4, cell = (n + 2 * quiet) * scale;
  const rows = Math.ceil(texts.length / cols), w = cols * cell, h = rows * cell;
  const img = new Uint8ClampedArray(w * h * 4).fill(255);
  qrs.forEach((q, i) => {
    const ox = (i % cols) * cell, oy = Math.floor(i / cols) * cell;
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
      if (!q.isDark(r, c)) continue;
      for (let y = 0; y < scale; y++) for (let x = 0; x < scale; x++) {
        const o = ((oy + (r + quiet) * scale + y) * w + ox + (c + quiet) * scale + x) * 4;
        img[o] = img[o + 1] = img[o + 2] = 0;
      }
    }
  });
  return new ImageData(img, w, h);
}

test('4 Codes im 2x2-Raster werden alle erkannt', async () => {
  const wasm = fs.readFileSync(path.join(__dirname, '../node_modules/zxing-wasm/dist/reader/zxing_reader.wasm'));
  await ZX.prepareZXingModule({ overrides: { wasmBinary: wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.length) }, fireImmediately: true });
  const enc = new QRS.Encoder(new Uint8Array(crypto.randomBytes(20000)), 500, 99);
  const texts = [0, 1, 2, 3].map(id => enc.frame(id));
  for (const scale of [4, 3, 2]) {
    const img = renderGrid(texts, 2, scale);
    const t0 = performance.now();
    const res = await ZX.readBarcodes(img, { formats: ['QRCode'], maxNumberOfSymbols: 8, tryHarder: true });
    const ms = (performance.now() - t0).toFixed(0);
    const found = res.filter(r => r.isValid).map(r => r.text);
    console.log(`Skalierung ${scale}px/Modul, Bild ${img.width}x${img.height}: ${found.length}/4 erkannt in ${ms} ms`);
    assert.deepStrictEqual(new Set(found), new Set(texts));
  }
});
