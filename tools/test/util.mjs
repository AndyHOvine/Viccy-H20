import fs from 'node:fs';
import zlib from 'node:zlib';
import { Vic20 } from '../../web/js/emu/vic20.js';

const ROM_DIR = new URL('../../web/roms/', import.meta.url);

export function loadRoms() {
  const r = (n) => new Uint8Array(fs.readFileSync(new URL(n, ROM_DIR)));
  return {
    basic: r('basic.rom'),
    char: r('char.rom'),
    kernalPal: r('kernal_pal.rom'),
    kernalNtsc: r('kernal_ntsc.rom'),
    dos1541: r('dos1541.rom'),
  };
}

export function makeMachine(opts = {}) {
  return new Vic20({ roms: loadRoms(), ...opts });
}

export function runSeconds(m, s) {
  const frames = Math.round(s * m.clock / m.cyclesPerFrame);
  for (let i = 0; i < frames; i++) m.runFrame();
}

export function screenText(m) {
  const base = m.mem[0x0288] << 8;
  const cols = m.vic.regs[2] & 0x7F, rows = (m.vic.regs[3] >> 1) & 0x3F;
  const lines = [];
  for (let r = 0; r < rows; r++) {
    let s = '';
    for (let c = 0; c < cols; c++) {
      const code = m.mem[base + r * cols + c] & 0x7F;
      s += code < 0x20 ? String.fromCharCode(code + 0x40) : code < 0x40 ? String.fromCharCode(code) : '#';
    }
    lines.push(s.replace(/\s+$/, ''));
  }
  return lines;
}

const PAL = [
  0x000000, 0xFFFFFF, 0xB61F21, 0x4DF0FF, 0xB43FFF, 0x44E237, 0x1A34FF, 0xDCD71B,
  0xCA5400, 0xE9B072, 0xE79293, 0x9AF7FD, 0xE09FFF, 0x8FE493, 0x8290FF, 0xE5DE85,
];

export function writePng(file, m, full = false) {
  const t = m.timing;
  const x0 = full ? 0 : t.visibleX, y0 = full ? 0 : t.visibleY;
  const w = full ? t.lineWidth : t.visibleW, h = full ? t.linesPerFrame : t.visibleH;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  let o = 0;
  for (let y = 0; y < h; y++) {
    raw[o++] = 0;
    for (let x = 0; x < w; x++) {
      const c = PAL[m.vic.fb[(y0 + y) * t.lineWidth + x0 + x] & 15];
      raw[o++] = c >> 16; raw[o++] = (c >> 8) & 255; raw[o++] = c & 255;
    }
  }
  const crcTable = new Int32Array(256).map((_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    return c;
  });
  const crc = (buf) => {
    let c = -1;
    for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  fs.writeFileSync(file, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]));
}
