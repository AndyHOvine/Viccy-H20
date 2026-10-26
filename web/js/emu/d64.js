export function sectorsPerTrack(t) {
  return t <= 17 ? 21 : t <= 24 ? 19 : t <= 30 ? 18 : 17;
}

const ZONE_TRACK_BYTES = [6250, 6666, 7142, 7692];

export function speedZone(t) {
  return t <= 17 ? 3 : t <= 24 ? 2 : t <= 30 ? 1 : 0;
}

const GCR = [0x0A, 0x0B, 0x12, 0x13, 0x0E, 0x0F, 0x16, 0x17, 0x09, 0x19, 0x1A, 0x1B, 0x0D, 0x1D, 0x1E, 0x15];
const GCR_REV = new Int8Array(32).fill(-1);
GCR.forEach((v, i) => { GCR_REV[v] = i; });

export class D64 {
  constructor(bytes) {
    const len = bytes.length;
    if (len === 174848 || len === 175531) this.tracks = 35;
    else if (len === 196608 || len === 197376) this.tracks = 40;
    else if (len === 205312 || len === 206114) this.tracks = 42;
    else throw new Error('Unsupported D64 size: ' + len);
    this.data = new Uint8Array(this.tracks === 35 ? 174848 : this.tracks === 40 ? 196608 : 205312);
    this.data.set(bytes.subarray(0, this.data.length));
    this.offsets = [0];
    let off = 0;
    for (let t = 1; t <= this.tracks; t++) {
      this.offsets[t] = off;
      off += sectorsPerTrack(t) * 256;
    }
    this.modified = false;
  }

  static blank() {
    return new D64(new Uint8Array(174848));
  }

  offset(t, s) {
    if (t < 1 || t > this.tracks || s < 0 || s >= sectorsPerTrack(t)) return -1;
    return this.offsets[t] + s * 256;
  }

  sector(t, s) {
    const o = this.offset(t, s);
    return o < 0 ? null : this.data.subarray(o, o + 256);
  }

  get id() {
    const bam = this.sector(18, 0);
    return [bam[0xA2], bam[0xA3]];
  }

  get name() {
    const bam = this.sector(18, 0);
    return petsciiName(bam.subarray(0x90, 0xA0));
  }

  directory() {
    const files = [];
    let t = 18, s = 1;
    const seen = new Set();
    while (t !== 0 && !seen.has(t * 256 + s)) {
      seen.add(t * 256 + s);
      const sec = this.sector(t, s);
      if (!sec) break;
      for (let i = 0; i < 8; i++) {
        const e = sec.subarray(i * 32, i * 32 + 32);
        const type = e[2];
        if (type === 0) continue;
        files.push({
          type: type & 0x07,
          closed: (type & 0x80) !== 0,
          locked: (type & 0x40) !== 0,
          track: e[3], sector: e[4],
          rawName: e.slice(5, 21),
          name: petsciiName(e.subarray(5, 21)),
          blocks: e[30] | (e[31] << 8),
        });
      }
      t = sec[0]; s = sec[1];
    }
    return files;
  }

  readChain(t, s) {
    const parts = [];
    const seen = new Set();
    while (t !== 0 && !seen.has(t * 256 + s)) {
      seen.add(t * 256 + s);
      const sec = this.sector(t, s);
      if (!sec) break;
      if (sec[0] === 0) {
        parts.push(sec.slice(2, Math.max(2, sec[1] + 1)));
        break;
      }
      parts.push(sec.slice(2, 256));
      t = sec[0]; s = sec[1];
    }
    const total = parts.reduce((n, p) => n + p.length, 0);
    const out = new Uint8Array(total);
    let o = 0;
    for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
  }

  findFile(pattern) {
    const files = this.directory().filter((f) => f.type !== 0 && f.closed);
    if (!pattern || pattern.length === 0 || (pattern.length === 1 && pattern[0] === 0x2A)) {
      return files.find((f) => f.type === 2) || files[0] || null;
    }
    return files.find((f) => matchPattern(pattern, f.rawName)) || null;
  }

  directoryListing(loadAddr = 0x0401) {
    const lines = [];
    const bam = this.sector(18, 0);
    const header = [0x12, 0x22, ...trimA0(bam.subarray(0x90, 0xA0), true), 0x22, 0x20,
      ...Array.from(bam.subarray(0xA2, 0xA7)).map((c) => (c === 0xA0 ? 0x20 : c))];
    lines.push({ num: 0, text: header });
    const types = ['DEL', 'SEQ', 'PRG', 'USR', 'REL', 'CBM', 'DIR', '???'];
    for (const f of this.directory()) {
      const name = trimA0(f.rawName, false);
      const pad = Math.max(0, 3 - String(f.blocks).length);
      const text = [];
      for (let i = 0; i < pad; i++) text.push(0x20);
      text.push(0x22, ...name, 0x22);
      for (let i = name.length; i < 17; i++) text.push(0x20);
      text.push(f.closed ? 0x20 : 0x2A);
      for (const ch of types[f.type]) text.push(ch.charCodeAt(0));
      if (f.locked) text.push(0x3C);
      lines.push({ num: f.blocks, text });
    }
    let free = 0;
    for (let t = 1; t <= 35; t++) if (t !== 18) free += bam[4 * t];
    lines.push({ num: free, text: Array.from('BLOCKS FREE.             ', (c) => c.charCodeAt(0)) });

    const out = [loadAddr & 0xFF, loadAddr >> 8];
    let addr = loadAddr;
    for (const l of lines) {
      const next = addr + 4 + l.text.length + 1;
      out.push(next & 0xFF, next >> 8, l.num & 0xFF, l.num >> 8, ...l.text, 0);
      addr = next;
    }
    out.push(0, 0);
    return new Uint8Array(out);
  }

  encodeTrack(t) {
    const zone = speedZone(t);
    const len = ZONE_TRACK_BYTES[zone];
    const n = sectorsPerTrack(t);
    const out = new Uint8Array(len).fill(0x55);
    const [id1, id2] = this.id;
    const sectorBytes = 5 + 10 + 9 + 5 + 325;
    const gap = Math.floor((len - n * sectorBytes) / n);
    let p = 0;
    for (let s = 0; s < n; s++) {
      const data = this.sector(t, s);
      for (let i = 0; i < 5; i++) out[p++] = 0xFF;
      p = gcr4(out, p, 0x08, s ^ t ^ id1 ^ id2, s, t);
      p = gcr4(out, p, id2, id1, 0x0F, 0x0F);
      p += 9;
      for (let i = 0; i < 5; i++) out[p++] = 0xFF;
      let sum = data[0] ^ data[1] ^ data[2];
      p = gcr4(out, p, 0x07, data[0], data[1], data[2]);
      for (let i = 3; i < 255; i += 4) {
        sum ^= data[i] ^ data[i + 1] ^ data[i + 2] ^ data[i + 3];
        p = gcr4(out, p, data[i], data[i + 1], data[i + 2], data[i + 3]);
      }
      sum ^= data[255];
      p = gcr4(out, p, data[255], sum, 0, 0);
      p += gap;
    }
    return out;
  }

  decodeTrack(t, gcr) {
    const len = gcr.length;
    const n = sectorsPerTrack(t);
    const buf = new Uint8Array(len * 2);
    buf.set(gcr); buf.set(gcr, len);
    let lastSector = -1;
    for (let i = 0; i < len; i++) {
      if (buf[i] !== 0xFF || buf[i + 1] !== 0xFF) continue;
      let j = i + 1;
      while (j < i + 40 && buf[j] === 0xFF) j++;
      const block = ungcr(buf, j, 4);
      if (!block) { i = j; continue; }
      if (block[0] === 0x08) {
        lastSector = (block[3] === t && block[2] < n) ? block[2] : -1;
      } else if (block[0] === 0x07 && lastSector >= 0) {
        const bytes = ungcr(buf, j, 260);
        if (bytes) {
          const dst = this.sector(t, lastSector);
          let sum = 0;
          for (let k = 0; k < 256; k++) sum ^= bytes[k + 1];
          if (sum === bytes[257]) {
            for (let k = 0; k < 256; k++) {
              if (dst[k] !== bytes[k + 1]) { dst[k] = bytes[k + 1]; this.modified = true; }
            }
          }
        }
        lastSector = -1;
      }
      i = j;
    }
  }
}

function gcr4(out, p, b1, b2, b3, b4) {
  const enc = (b) => (GCR[b >> 4] << 5) | GCR[b & 0x0F];
  const v1 = enc(b1), v2 = enc(b2), v3 = enc(b3), v4 = enc(b4);
  out[p] = v1 >> 2;
  out[p + 1] = ((v1 & 0x03) << 6) | (v2 >> 4);
  out[p + 2] = ((v2 & 0x0F) << 4) | (v3 >> 6);
  out[p + 3] = ((v3 & 0x3F) << 2) | (v4 >> 8);
  out[p + 4] = v4 & 0xFF;
  return p + 5;
}

function ungcr(buf, p, count) {
  const out = new Uint8Array(count);
  let acc = 0, bits = 0, o = 0;
  while (o < count) {
    while (bits < 10) {
      if (p >= buf.length) return null;
      acc = ((acc << 8) | buf[p++]) & 0xFFFFF;
      bits += 8;
    }
    bits -= 10;
    const code = (acc >> bits) & 0x3FF;
    const hi = GCR_REV[code >> 5], lo = GCR_REV[code & 0x1F];
    if (hi < 0 || lo < 0) return null;
    out[o++] = (hi << 4) | lo;
  }
  return out;
}

function trimA0(bytes, keepPadding) {
  const out = [];
  for (const b of bytes) {
    if (b === 0xA0) { if (keepPadding) out.push(0x20); else break; } else out.push(b);
  }
  return out;
}

export function petsciiName(bytes) {
  let s = '';
  for (const b of bytes) {
    if (b === 0xA0) break;
    s += petsciiToAscii(b);
  }
  return s;
}

export function petsciiToAscii(b) {
  if (b >= 0x41 && b <= 0x5A) return String.fromCharCode(b);
  if (b >= 0xC1 && b <= 0xDA) return String.fromCharCode(b - 0x80);
  if (b >= 0x20 && b < 0x41) return String.fromCharCode(b);
  if (b === 0x5B || b === 0x5D) return String.fromCharCode(b);
  return '?';
}

export function asciiToPetscii(str) {
  const out = [];
  for (const ch of str.toUpperCase()) {
    const c = ch.charCodeAt(0);
    out.push(c < 0x80 ? c : 0x3F);
  }
  return new Uint8Array(out);
}

function matchPattern(pattern, raw) {
  for (let i = 0; i < 16; i++) {
    const p = i < pattern.length ? pattern[i] : 0xA0;
    const c = raw[i];
    if (p === 0x2A) return true;
    if (p === 0x3F) { if (c === 0xA0) return false; continue; }
    if (p !== c) return false;
    if (c === 0xA0) return true;
  }
  return true;
}
