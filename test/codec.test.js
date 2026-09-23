// Aufruf: node --test test/
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const QRS = require('../src/codec.js');
const qrcode = require('qrcode-generator');
const jsQR = require('jsqr');

function mulberry(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Simuliert einen Empfänger, der bei Paket `start` einsteigt und `loss` verliert.
function transfer(payload, chunkSize, { start = 0, loss = 0, seed = 1 } = {}) {
  const session = QRS.randomSession();
  const enc = new QRS.Encoder(payload, chunkSize, session);
  const rnd = mulberry(seed);
  let dec = null, received = 0;
  const first = enc.k + start; // Sender beginnt bei id = k
  for (let id = first; id < first + enc.k * 20 + 100; id++) {
    if (rnd() < loss) continue;
    const p = QRS.parsePacket(enc.frame(id));
    dec ||= new QRS.Decoder(p.session, p.length, p.chunkSize);
    dec.add(p.id, p.body);
    received++;
    if (dec.done) return { data: dec.result(), received, k: enc.k };
  }
  throw new Error('nicht fertig geworden');
}

test('Base45 Roundtrip', () => {
  for (const len of [0, 1, 2, 3, 100, 1001]) {
    const b = crypto.randomBytes(len);
    assert.deepStrictEqual(Buffer.from(QRS.b45decode(QRS.b45encode(b))), b);
  }
  assert.strictEqual(QRS.b45encode(Buffer.from('AB')), 'BB8'); // RFC 9285 Beispiel
  assert.strictEqual(QRS.b45decode('abc'), null);
});

test('Datei verpacken und entpacken (mit und ohne Kompression)', async () => {
  for (const data of [crypto.randomBytes(5000), Buffer.from('Hallo Welt! '.repeat(500)), Buffer.alloc(0)]) {
    const packed = await QRS.packFile('Übung ä.txt', 'text/plain', new Uint8Array(data));
    const out = await QRS.unpackFile(packed);
    assert.ok(out.ok);
    assert.strictEqual(out.name, 'Übung ä.txt');
    assert.strictEqual(out.mime, 'text/plain');
    assert.deepStrictEqual(Buffer.from(out.data), data);
  }
});

test('Fountain-Code: Übertragung mit Verlust und spätem Einstieg', () => {
  const rows = [];
  for (const size of [1, 400, 5000, 30000, 60000, 300000, 1500000]) {
    for (const [start, loss] of [[0, 0], [0, 0.3], [0, 0.6], [10000, 0.3]]) {
      const payload = new Uint8Array(crypto.randomBytes(size));
      const r = transfer(payload, 500, { start, loss, seed: size + start });
      assert.deepStrictEqual(Buffer.from(r.data), Buffer.from(payload));
      assert.ok(r.received <= r.k * 1.1 + 4, `zu viele Pakete: ${r.received} für k=${r.k}`);
      rows.push(`${String(size).padStart(7)} B  k=${String(r.k).padStart(4)}  ` +
        `start=${String(start).padStart(5)} verlust=${loss}  -> ${r.received} Pakete ` +
        `(${(r.received / r.k).toFixed(2)}x)`);
    }
  }
  console.log(rows.join('\n'));
});

test('QR-Code erzeugen und wieder erkennen', () => {
  const payload = new Uint8Array(crypto.randomBytes(3000));
  const enc = new QRS.Encoder(payload, 500, 1234);
  for (const id of [0, 3, enc.k + 7]) {
    const text = enc.frame(id);
    const qr = qrcode(0, 'L');
    qr.addData(text, 'Alphanumeric');
    qr.make();
    const n = qr.getModuleCount(), quiet = 4, scale = 4, size = (n + 2 * quiet) * scale;
    const img = new Uint8ClampedArray(size * size * 4).fill(255);
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
      if (!qr.isDark(r, c)) continue;
      for (let y = 0; y < scale; y++) for (let x = 0; x < scale; x++) {
        const o = (((r + quiet) * scale + y) * size + (c + quiet) * scale + x) * 4;
        img[o] = img[o + 1] = img[o + 2] = 0;
      }
    }
    const res = jsQR(img, size, size, { inversionAttempts: 'dontInvert' });
    assert.ok(res, 'QR nicht erkannt');
    assert.strictEqual(res.data, text);
    if (id === 0) console.log(`500-Byte-Block -> ${text.length} Zeichen, QR-Version ${(n - 17) / 4}`);
  }
});
