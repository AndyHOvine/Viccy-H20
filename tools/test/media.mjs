import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';
import { makeMachine, runSeconds, screenText } from './util.mjs';
import { D64 } from '../../web/js/emu/d64.js';
import { expand, parseCartridge, detectType } from '../../web/js/emu/media.js';

let m = makeMachine({ memory: 'unexpanded' });
runSeconds(m, 3);
m.typeText('10 PRINT"INJECTED";PEEK(43)+256*PEEK(44)\r');
runSeconds(m, 1);
const start = m.mem[0x2B] | (m.mem[0x2C] << 8);
const end = m.mem[0x2D] | (m.mem[0x2E] << 8);
const prg = new Uint8Array(2 + end - start);
prg[0] = start & 0xFF; prg[1] = start >> 8;
prg.set(m.mem.subarray(start, end), 2);
assert.equal(start, 0x1001);

m = makeMachine({ memory: '8k' });
m.onReady(() => { const r = m.injectPrg(prg); assert.ok(r.basic); m.typeText('RUN\r'); });
runSeconds(m, 4);
let text = screenText(m);
assert.ok(text.some((l) => l.includes('INJECTED 4609')), 'relocated PRG did not run:\n' + text.join('\n'));
console.log('prg inject + relocate: ok');

const blank = new Uint8Array(fs.readFileSync(new URL('../../web/roms/blank.d64', import.meta.url)));
m = makeMachine({ driveEnabled: true });
m.insertDisk(blank);
runSeconds(m, 3);
m.typeText('10 PRINT"FROM DISK"\rSAVE"GAME",8\r');
runSeconds(m, 25);
const disk = new D64(m.diskImage());

m = makeMachine({ fastDisk: true });
m.insertDisk(disk.data);
runSeconds(m, 3);
m.typeText('LOAD"$",8\rLIST\r');
runSeconds(m, 2);
text = screenText(m);
assert.ok(/"GAME"\s+PRG/.test(text.join(' ')), 'directory listing:\n' + text.join('\n'));
m.typeText('LOAD"G*",8,1\rRUN\r');
runSeconds(m, 2);
text = screenText(m);
assert.ok(text.some((l) => l.includes('FROM DISK')), 'fast load did not run:\n' + text.join('\n'));
console.log('fast disk trap: ok');

const cart = new Uint8Array(0x1000).fill(0xEA);
const code = [0xA9, 0x2A, 0x8D, 0x0F, 0x90, 0xA9, 0x55, 0x8D, 0x00, 0xA1, 0x4C, 0x13, 0xA0];
cart.set([0x09, 0xA0, 0x09, 0xA0, 0x41, 0x30, 0xC3, 0xC2, 0xCD], 0);
cart.set(code, 9);
m = makeMachine();
m.setCartridges(parseCartridge('test-a000.bin', cart));
m.hardReset();
runSeconds(m, 0.5);
assert.equal(m.vic.regs[15], 0x2A, 'cartridge did not autostart');
assert.equal(m.mem[0xA100], 0xEA, 'cartridge ROM was written');
assert.equal(m.mem[0xB009], 0xA9, '4K cartridge not mirrored at $B000');
console.log('cartridge autostart: ok');

assert.equal(detectType('x.d64', disk.data), 'disk');
assert.equal(detectType('x.prg', prg), 'prg');
assert.equal(detectType('x-a000.prg', new Uint8Array([0, 0xA0, 1, 2])), 'cart');
assert.equal(detectType('x.bin', cart), 'cart');
const zipped = makeZip([['game/GAME.D64', disk.data], ['readme.txt', new TextEncoder().encode('hi')]]);
const items = await expand('game.zip', zipped);
assert.equal(items.length, 1);
assert.equal(items[0].type, 'disk');
assert.equal(items[0].data.length, 174848);
console.log('media detection + zip: ok');

function crc32(buf) {
  let c = -1;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
  }
  return (c ^ -1) >>> 0;
}

function makeZip(entries) {
  const parts = [], central = [];
  let off = 0;
  for (const [name, data] of entries) {
    const n = Buffer.from(name), body = zlib.deflateRawSync(data);
    const crc = zlib.crc32 ? zlib.crc32(data) : crc32(data);
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034B50, 0); h.writeUInt16LE(8, 8); h.writeUInt32LE(crc, 14);
    h.writeUInt32LE(body.length, 18); h.writeUInt32LE(data.length, 22); h.writeUInt16LE(n.length, 26);
    parts.push(h, n, body);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014B50, 0); c.writeUInt16LE(8, 10); c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(body.length, 20); c.writeUInt32LE(data.length, 24); c.writeUInt16LE(n.length, 28);
    c.writeUInt32LE(off, 42);
    central.push(c, n);
    off += 30 + n.length + body.length;
  }
  const cd = Buffer.concat(central);
  const e = Buffer.alloc(22);
  e.writeUInt32LE(0x06054B50, 0); e.writeUInt16LE(entries.length, 8); e.writeUInt16LE(entries.length, 10);
  e.writeUInt32LE(cd.length, 12); e.writeUInt32LE(off, 16);
  return new Uint8Array(Buffer.concat([...parts, cd, e]));
}
