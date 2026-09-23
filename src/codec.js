/*
 * QR-Stream Codec
 *
 * Eine Datei wird in Blöcke geteilt und mit einem LT-Fountain-Code als
 * endloser Strom von Paketen verschickt. Der Empfänger braucht nur irgendwelche
 * ~k Pakete (k = Anzahl Blöcke), egal welche und in welcher Reihenfolge.
 *
 * Pakete werden Base45-kodiert, damit sie in den kompakten Alphanumerik-Modus
 * von QR-Codes passen (nur ~3 % Overhead statt 33 % bei Base64).
 *
 * Paket (binär, vor Base45):
 *   [0]      Version
 *   [1..4]   Session-ID (zufällig pro Datei)
 *   [5..8]   Länge der Nutzlast (verpackte Datei)
 *   [9..10]  Blockgröße (Vielfaches von 4)
 *   [11..14] Paket-ID (< k: Originalblock, >= k: XOR-Kombination)
 *   [15..]   Block (Blockgröße Bytes)
 *
 * Nutzlast (verpackte Datei):
 *   [0] Flags (Bit 0: deflate)   [1..2] Namenslänge   Name (UTF-8)
 *   [.] MIME-Länge   MIME   [4] CRC32 der Datei   [4] Dateigröße   Daten
 */
(function (root) {
  'use strict';

  const VERSION = 1;
  const HEADER = 15;

  // ---- Base45 (RFC 9285) --------------------------------------------------

  const B45 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';
  const B45_MAP = new Int8Array(128).fill(-1);
  for (let i = 0; i < 45; i++) B45_MAP[B45.charCodeAt(i)] = i;

  function b45encode(bytes) {
    let out = '';
    let i = 0;
    for (; i + 1 < bytes.length; i += 2) {
      const n = bytes[i] * 256 + bytes[i + 1];
      out += B45[n % 45] + B45[((n / 45) | 0) % 45] + B45[(n / 2025) | 0];
    }
    if (i < bytes.length) {
      const n = bytes[i];
      out += B45[n % 45] + B45[(n / 45) | 0];
    }
    return out;
  }

  function b45decode(str) {
    const len = str.length;
    if (len % 3 === 1) return null;
    const out = new Uint8Array(Math.floor(len / 3) * 2 + (len % 3 ? 1 : 0));
    const val = i => { const c = str.charCodeAt(i); return c < 128 ? B45_MAP[c] : -1; };
    let o = 0;
    for (let i = 0; i < len; i += 3) {
      const c = val(i), d = val(i + 1);
      if (c < 0 || d < 0) return null;
      if (i + 2 < len) {
        const e = val(i + 2);
        if (e < 0) return null;
        const n = c + d * 45 + e * 2025;
        if (n > 0xffff) return null;
        out[o++] = n >> 8;
        out[o++] = n & 0xff;
      } else {
        const n = c + d * 45;
        if (n > 0xff) return null;
        out[o++] = n;
      }
    }
    return out;
  }

  // ---- CRC32 --------------------------------------------------------------

  const CRC_TABLE = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    CRC_TABLE[n] = c >>> 0;
  }

  function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  // ---- LT-Fountain-Code ---------------------------------------------------

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Kumulative Robust-Soliton-Verteilung für k Blöcke.
  function solitonCdf(k) {
    const c = 0.1, delta = 0.05;
    const R = c * Math.log(k / delta) * Math.sqrt(k);
    const pivot = Math.max(1, Math.min(k, Math.floor(k / R)));
    const p = new Float64Array(k + 1);
    let sum = 0;
    for (let d = 1; d <= k; d++) {
      let v = d === 1 ? 1 / k : 1 / (d * (d - 1));
      if (d < pivot) v += R / (d * k);
      else if (d === pivot) v += Math.max(0, (R * Math.log(R / delta)) / k);
      sum += v;
      p[d] = sum;
    }
    for (let d = 1; d <= k; d++) p[d] /= sum;
    p[k] = 1;
    return p;
  }

  // Welche Blöcke stecken in Paket `id`? Deterministisch auf beiden Seiten.
  // Der Sender beginnt bei id = k, sendet also nie Originalblöcke: Mit dem
  // Gauß-Decoder ist so fast jedes empfangene Paket nützlich.
  function neighbors(id, k, session, cdf) {
    if (id < k) return [id];
    const rnd = mulberry32((session ^ Math.imul(id, 0x9e3779b1)) >>> 0);
    if (k <= 64) {
      // Kleine Dateien: zufällige dichte Teilmenge (optimal, ~k + 2 Pakete).
      const out = [];
      for (let i = 0; i < k; i++) if (rnd() < 0.5) out.push(i);
      if (!out.length) out.push(Math.floor(rnd() * k));
      return out;
    }
    const r = rnd();
    let lo = 1, hi = k;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cdf[mid] < r) lo = mid + 1; else hi = mid;
    }
    const d = lo;
    if (d * 2 <= k) {
      const set = new Set();
      while (set.size < d) set.add(Math.floor(rnd() * k));
      return [...set];
    }
    const all = Array.from({ length: k }, (_, i) => i);
    for (let i = 0; i < d; i++) {
      const j = i + Math.floor(rnd() * (k - i));
      [all[i], all[j]] = [all[j], all[i]];
    }
    return all.slice(0, d);
  }

  function xorInto(dst, src) {
    for (let i = 0; i < dst.length; i++) dst[i] ^= src[i];
  }

  class Encoder {
    constructor(payload, chunkSize, session) {
      if (chunkSize % 4 || chunkSize < 4) throw new Error('Blockgröße muss ein Vielfaches von 4 sein');
      this.payload = payload;
      this.chunkSize = chunkSize;
      this.session = session >>> 0;
      this.k = Math.max(1, Math.ceil(payload.length / chunkSize));
      this.chunks = [];
      for (let i = 0; i < this.k; i++) {
        const c = new Uint8Array(chunkSize);
        c.set(payload.subarray(i * chunkSize, (i + 1) * chunkSize));
        this.chunks.push(c);
      }
      this.cdf = solitonCdf(this.k);
    }

    packet(id) {
      const buf = new Uint8Array(HEADER + this.chunkSize);
      const v = new DataView(buf.buffer);
      v.setUint8(0, VERSION);
      v.setUint32(1, this.session);
      v.setUint32(5, this.payload.length);
      v.setUint16(9, this.chunkSize);
      v.setUint32(11, id);
      const body = buf.subarray(HEADER);
      for (const i of neighbors(id, this.k, this.session, this.cdf)) xorInto(body, this.chunks[i]);
      return buf;
    }

    // Paket als Text für den QR-Code.
    frame(id) {
      return b45encode(this.packet(id));
    }
  }

  function parsePacket(text) {
    const buf = b45decode(text);
    if (!buf || buf.length < HEADER + 1 || buf[0] !== VERSION) return null;
    const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const chunkSize = v.getUint16(9);
    if (chunkSize % 4 || buf.length !== HEADER + chunkSize) return null;
    return {
      session: v.getUint32(1),
      length: v.getUint32(5),
      chunkSize,
      id: v.getUint32(11),
      body: buf.subarray(HEADER),
    };
  }

  function lowestBit(w, x) {
    return w * 32 + (31 - Math.clz32(x & -x));
  }

  // Dekodiert per inkrementeller Gauß-Elimination über GF(2). Jedes Paket ist
  // eine Gleichung "XOR dieser Blöcke = Daten". Sobald k linear unabhängige
  // Pakete da sind (Rang k), ist die Datei vollständig - typisch nach k bis
  // k + 2 Paketen, egal welche verpasst wurden.
  class Decoder {
    constructor(session, length, chunkSize) {
      this.session = session;
      this.length = length;
      this.chunkSize = chunkSize;
      this.k = Math.max(1, Math.ceil(length / chunkSize));
      this.words = (this.k + 31) >>> 5;
      this.cdf = solitonCdf(this.k);
      this.pivots = new Array(this.k).fill(null);
      this.rank = 0;
      this.seen = new Set();
      this.solved = false;
    }

    matches(p) {
      return p.session === this.session && p.length === this.length && p.chunkSize === this.chunkSize;
    }

    get done() {
      return this.rank === this.k;
    }

    // Gibt true zurück, wenn das Paket neue Information enthielt.
    add(id, body) {
      if (this.done || this.seen.has(id)) return false;
      this.seen.add(id);
      const coef = new Uint32Array(this.words);
      for (const i of neighbors(id, this.k, this.session, this.cdf)) coef[i >>> 5] ^= 1 << (i & 31);
      const data = new Uint32Array(body.slice().buffer);
      let w = 0;
      for (;;) {
        while (w < this.words && coef[w] === 0) w++;
        if (w === this.words) return false;
        const bit = lowestBit(w, coef[w]);
        const p = this.pivots[bit];
        if (!p) {
          this.pivots[bit] = { coef, data };
          this.rank++;
          return true;
        }
        // p hat keine Bits unterhalb von `bit` -> ab Wort w reicht.
        for (let j = w; j < this.words; j++) coef[j] ^= p.coef[j];
        xorInto(data, p.data);
      }
    }

    // Rückwärts einsetzen: danach enthält pivots[i].data genau Block i.
    _solve() {
      for (let col = this.k - 1; col >= 0; col--) {
        const row = this.pivots[col];
        const w0 = col >>> 5;
        const sh = (col & 31) + 1;
        for (let w = w0; w < this.words; w++) {
          let x = row.coef[w];
          if (w === w0) x = sh === 32 ? 0 : x & (-1 << sh);
          while (x) {
            xorInto(row.data, this.pivots[lowestBit(w, x)].data);
            x &= x - 1;
          }
        }
      }
      this.solved = true;
    }

    result() {
      if (!this.done) return null;
      if (!this.solved) this._solve();
      const out = new Uint8Array(this.k * this.chunkSize);
      this.pivots.forEach((p, i) => out.set(new Uint8Array(p.data.buffer), i * this.chunkSize));
      return out.subarray(0, this.length);
    }
  }

  // ---- Datei verpacken / entpacken ---------------------------------------

  async function transform(bytes, stream) {
    const s = new Blob([bytes]).stream().pipeThrough(stream);
    return new Uint8Array(await new Response(s).arrayBuffer());
  }

  async function packFile(name, mime, data) {
    let flags = 0;
    let body = data;
    if (typeof CompressionStream !== 'undefined' && data.length > 64) {
      const z = await transform(data, new CompressionStream('deflate-raw'));
      if (z.length < data.length * 0.95) { body = z; flags |= 1; }
    }
    const enc = new TextEncoder();
    const nameB = enc.encode(name).subarray(0, 1000);
    const mimeB = enc.encode(mime || '').subarray(0, 255);
    const out = new Uint8Array(1 + 2 + nameB.length + 1 + mimeB.length + 8 + body.length);
    const v = new DataView(out.buffer);
    let o = 0;
    v.setUint8(o, flags); o += 1;
    v.setUint16(o, nameB.length); o += 2;
    out.set(nameB, o); o += nameB.length;
    v.setUint8(o, mimeB.length); o += 1;
    out.set(mimeB, o); o += mimeB.length;
    v.setUint32(o, crc32(data)); o += 4;
    v.setUint32(o, data.length); o += 4;
    out.set(body, o);
    return out;
  }

  async function unpackFile(buf) {
    const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const dec = new TextDecoder();
    let o = 0;
    const flags = v.getUint8(o); o += 1;
    const nameLen = v.getUint16(o); o += 2;
    const name = dec.decode(buf.subarray(o, o + nameLen)); o += nameLen;
    const mimeLen = v.getUint8(o); o += 1;
    const mime = dec.decode(buf.subarray(o, o + mimeLen)); o += mimeLen;
    const crc = v.getUint32(o); o += 4;
    const size = v.getUint32(o); o += 4;
    let data = buf.subarray(o);
    if (flags & 1) data = await transform(data, new DecompressionStream('deflate-raw'));
    const ok = data.length === size && crc32(data) === crc;
    return { name, mime, data, ok };
  }

  function randomSession() {
    const a = new Uint32Array(1);
    crypto.getRandomValues(a);
    return a[0];
  }

  const api = {
    HEADER, b45encode, b45decode, crc32, neighbors, solitonCdf,
    Encoder, Decoder, parsePacket, packFile, unpackFile, randomSession,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.QRS = api;
})(typeof self !== 'undefined' ? self : this);
