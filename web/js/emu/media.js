const CART_BLOCKS = [0x2000, 0x4000, 0x6000, 0xA000, 0xB000];

function ext(name) {
  const m = /\.([a-z0-9]+)$/i.exec(name || '');
  return m ? m[1].toLowerCase() : '';
}

function ascii(bytes, start, len) {
  return String.fromCharCode(...bytes.subarray(start, start + len));
}

export function isD64(bytes) {
  return [174848, 175531, 196608, 197376, 205312, 206114].includes(bytes.length);
}

export function isTap(bytes) {
  const s = ascii(bytes, 0, 12);
  return s === 'C64-TAPE-RAW' || s === 'C16-TAPE-RAW';
}

export function isT64(bytes) {
  const s = ascii(bytes, 0, 32);
  return s.startsWith('C64 tape image') || s.startsWith('C64S tape');
}

export function isCrt(bytes) {
  return ascii(bytes, 0, 16) === 'VIC20 CARTRIDGE ';
}

export function isZip(bytes) {
  return bytes[0] === 0x50 && bytes[1] === 0x4B && bytes[2] === 0x03 && bytes[3] === 0x04;
}

export function addressFromName(name) {
  const n = (name || '').toLowerCase();
  let m = /[-_ .\[(]([246ab])000[\])]?\.[a-z0-9]+$/.exec(n) || /[-_ .\[(]([246ab])000[\])]?$/.exec(n);
  if (m) return parseInt(m[1], 16) << 12;
  m = /\.([2467]0|a0|b0)$/.exec(n);
  if (m) return parseInt(m[1], 16) << 8;
  return null;
}

export function detectType(name, bytes) {
  const e = ext(name);
  if (isZip(bytes)) return 'zip';
  if (isTap(bytes)) return 'tape';
  if (isCrt(bytes)) return 'cart';
  if (isT64(bytes)) return 'prg';
  if (e === 'd64' || (isD64(bytes) && !['prg', 'bin', 'rom', 'crt'].includes(e))) return 'disk';
  if (e === 'prg' || e === 'p00') {
    const load = loadAddress(bytes, e);
    if (load !== null && (load === 0xA000 || load === 0xB000) && addressFromName(name) !== null) return 'cart';
    if (load === 0xA000 && bytes.length <= 0x2002 + 2) return 'cart';
    return 'prg';
  }
  if (['bin', 'rom', 'a0', 'b0', '20', '40', '60', 'crt', 'cart'].includes(e)) return 'cart';
  return null;
}

function loadAddress(bytes, e) {
  if (e === 'p00') return bytes.length > 0x1C ? bytes[0x1A] | (bytes[0x1B] << 8) : null;
  return bytes.length >= 2 ? bytes[0] | (bytes[1] << 8) : null;
}

export function toPrg(name, bytes) {
  if (isT64(bytes)) return t64FirstFile(bytes);
  if (ext(name) === 'p00' && ascii(bytes, 0, 7) === 'C64File') return bytes.subarray(0x1A);
  return bytes;
}

function t64FirstFile(bytes) {
  const used = bytes[0x24] | (bytes[0x25] << 8);
  const entries = Math.max(1, used);
  for (let i = 0; i < entries; i++) {
    const e = 0x40 + i * 32;
    if (e + 32 > bytes.length) break;
    if (bytes[e] !== 1) continue;
    const start = bytes[e + 2] | (bytes[e + 3] << 8);
    let end = bytes[e + 4] | (bytes[e + 5] << 8);
    const off = bytes[e + 8] | (bytes[e + 9] << 8) | (bytes[e + 10] << 16) | (bytes[e + 11] << 24);
    if (end <= start || off + (end - start) > bytes.length) end = start + (bytes.length - off);
    const out = new Uint8Array(2 + end - start);
    out[0] = start & 0xFF; out[1] = start >> 8;
    out.set(bytes.subarray(off, off + end - start), 2);
    return out;
  }
  throw new Error('T64 image contains no files');
}

export function parseCartridge(name, bytes, address) {
  if (isCrt(bytes)) return parseCrt(bytes);
  const e = ext(name);
  let data = bytes;
  let addr = address ?? addressFromName(name);
  if (e === 'prg' || (addr === null && hasLoadHeader(bytes))) {
    const load = bytes[0] | (bytes[1] << 8);
    data = bytes.subarray(2);
    if (addr === null) addr = load;
  }
  if (addr === null) addr = 0xA000;
  return splitIntoBlocks(addr, data);
}

function hasLoadHeader(bytes) {
  const load = bytes[0] | (bytes[1] << 8);
  return CART_BLOCKS.includes(load) && (bytes.length & 0x0FFF) === 2;
}

function splitIntoBlocks(addr, data) {
  const chunks = [];
  if (data.length > 0x2000 && addr === 0xA000) {
    chunks.push({ addr: 0x6000, data: data.subarray(0, 0x2000) });
    chunks.push({ addr: 0xA000, data: data.subarray(0x2000, 0x4000) });
    return chunks;
  }
  for (let o = 0; o < data.length; o += 0x2000) {
    chunks.push({ addr: (addr + o) & 0xFFFF, data: data.subarray(o, Math.min(data.length, o + 0x2000)) });
  }
  return chunks;
}

function parseCrt(bytes) {
  const be32 = (o) => ((bytes[o] << 24) | (bytes[o + 1] << 16) | (bytes[o + 2] << 8) | bytes[o + 3]) >>> 0;
  const be16 = (o) => (bytes[o] << 8) | bytes[o + 1];
  const headerLen = be32(0x10);
  const hwType = be16(0x16);
  if (hwType !== 0) throw new Error(`Unsupported VIC-20 cartridge hardware type ${hwType}`);
  const chunks = [];
  let p = headerLen;
  while (p + 16 <= bytes.length && ascii(bytes, p, 4) === 'CHIP') {
    const len = be32(p + 4);
    const load = be16(p + 0x0C);
    const size = be16(p + 0x0E);
    chunks.push({ addr: load, data: bytes.subarray(p + 0x10, p + 0x10 + size) });
    p += len;
  }
  if (!chunks.length) throw new Error('No CHIP packets in cartridge');
  return chunks;
}

export async function unzip(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (dv.getUint32(i, true) === 0x06054B50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Invalid ZIP file');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const files = [];
  for (let i = 0; i < count; i++) {
    if (dv.getUint32(p, true) !== 0x02014B50) break;
    const method = dv.getUint16(p + 10, true);
    const crc = dv.getUint32(p + 16, true);
    const csize = dv.getUint32(p + 20, true);
    const usize = dv.getUint32(p + 24, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith('/')) continue;
    const lNameLen = dv.getUint16(local + 26, true);
    const lExtraLen = dv.getUint16(local + 28, true);
    const start = local + 30 + lNameLen + lExtraLen;
    const raw = bytes.subarray(start, start + csize);
    let data;
    if (method === 0) data = raw.slice();
    else if (method === 8) data = await inflate(raw, crc, usize);
    else continue;
    files.push({ name: name.split('/').pop(), data });
  }
  return files;
}

async function inflate(raw, crc, size) {
  const gz = new Uint8Array(raw.length + 18);
  gz.set([0x1F, 0x8B, 8, 0, 0, 0, 0, 0, 0, 0xFF]);
  gz.set(raw, 10);
  const t = raw.length + 10;
  for (let i = 0; i < 4; i++) {
    gz[t + i] = (crc >>> (8 * i)) & 0xFF;
    gz[t + 4 + i] = (size >>> (8 * i)) & 0xFF;
  }
  const stream = new Blob([gz]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function expand(name, bytes) {
  const type = detectType(name, bytes);
  if (type !== 'zip') return type ? [{ name, type, data: bytes }] : [];
  const out = [];
  for (const f of await unzip(bytes)) {
    const t = detectType(f.name, f.data);
    if (t && t !== 'zip') out.push({ name: f.name, type: t, data: f.data });
  }
  return out;
}
