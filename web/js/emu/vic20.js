import { Cpu6502 } from './cpu6502.js';
import { Via6522 } from './via6522.js';
import { Vic, VIC_TIMING } from './vic.js';
import { VicSound } from './vicsound.js';
import { Datasette } from './datasette.js';
import { Drive1541, IecBus, DRIVE_CLOCK } from './drive1541.js';
import { D64 } from './d64.js';
import { VIC_KEYS } from './keys.js';

const P_RAM = 0, P_ROM = 1, P_OPEN = 2, P_IO = 3, P_COLOR = 4;

const BLOCKS = {
  ram123: [0x04, 0x0C],
  blk1: [0x20, 0x20],
  blk2: [0x40, 0x20],
  blk3: [0x60, 0x20],
  blk5: [0xA0, 0x20],
};

export const MEMORY_PRESETS = {
  unexpanded: [],
  '3k': ['ram123'],
  '8k': ['blk1'],
  '16k': ['blk1', 'blk2'],
  '24k': ['blk1', 'blk2', 'blk3'],
  '32k': ['blk1', 'blk2', 'blk3', 'blk5'],
  '35k': ['ram123', 'blk1', 'blk2', 'blk3', 'blk5'],
};

export function resolveMemory(mem) {
  if (Array.isArray(mem)) return mem.filter((b) => BLOCKS[b]);
  const key = String(mem || 'unexpanded').toLowerCase();
  if (MEMORY_PRESETS[key]) return MEMORY_PRESETS[key].slice();
  throw new Error('Unknown memory configuration: ' + mem);
}

export function memoryForLoadAddress(addr) {
  if (addr === 0x1001) return MEMORY_PRESETS.unexpanded.slice();
  if (addr === 0x0401) return MEMORY_PRESETS['3k'].slice();
  return MEMORY_PRESETS['35k'].slice();
}

const JOY_UP = 1, JOY_DOWN = 2, JOY_LEFT = 4, JOY_RIGHT = 8, JOY_FIRE = 16;
export const JOY = { UP: JOY_UP, DOWN: JOY_DOWN, LEFT: JOY_LEFT, RIGHT: JOY_RIGHT, FIRE: JOY_FIRE };

const TRAP_READY = 0xE5E8;
const TRAP_LOAD = 0xF549;

export class Vic20 {
  constructor({ roms, model = 'pal', memory = 'unexpanded', sampleRate = 48000, driveEnabled = false, fastDisk = false } = {}) {
    this.roms = roms;
    this.mem = new Uint8Array(0x10000);
    this.ptype = new Uint8Array(256);
    this.lastBus = 0;
    this.cycles = 0;
    this.frameDone = false;
    this.frames = 0;

    this.keyCount = new Uint8Array(64);
    this.matrix = new Uint8Array(8);
    this.joy = 0;
    this.keyQueue = [];
    this.readyHandlers = [];
    this.readyCount = 0;

    this.iec = new IecBus();
    this.datasette = new Datasette();
    this.cartChunks = [];
    this.disk = null;
    this.drive = null;
    this.driveEnabled = driveEnabled;
    this.fastDisk = fastDisk;
    this.driveDebt = 0;

    this.sampleRate = sampleRate;
    this.configure({ model, memory });
  }

  configure({ model, memory }) {
    if (model) this.model = model === 'ntsc' ? 'ntsc' : 'pal';
    if (memory !== undefined) this.memory = resolveMemory(memory);
    const timing = VIC_TIMING[this.model];
    this.timing = timing;
    this.clock = timing.clock;
    this.cyclesPerFrame = timing.cyclesPerLine * timing.linesPerFrame;

    this.cpu = new Cpu6502(this);
    this.cpu.trapFlags = new Uint8Array(0x10000);
    this.cpu.trapFlags[TRAP_READY] = 1;
    this.cpu.trapFlags[TRAP_LOAD] = 1;
    this.cpu.onTrap = (pc) => this.trap(pc);

    this.sound = new VicSound(this.clock, this.sampleRate);
    this.vic = new Vic(this, this.sound, this.model === 'ntsc');
    this.via1 = new Via6522();
    this.via2 = new Via6522();
    this.wireVias();
    this.setupDrive();
    this.driveRatio = DRIVE_CLOCK / this.clock;
    this.hardReset();
  }

  wireVias() {
    const v1 = this.via1, v2 = this.via2, iec = this.iec, ds = this.datasette;

    v1.readPA = (drive) => {
      let j = 0x3C;
      if (this.joy & JOY_UP) j &= ~0x04;
      if (this.joy & JOY_DOWN) j &= ~0x08;
      if (this.joy & JOY_LEFT) j &= ~0x10;
      if (this.joy & JOY_FIRE) j &= ~0x20;
      return (drive & 0x80) | (ds.playing && ds.present ? 0 : 0x40) | j |
        (iec.data() ? 0 : 0x02) | (iec.clk() ? 0 : 0x01);
    };
    v1.onPA = (drive) => {
      const atn = (drive & 0x80) !== 0;
      if (atn !== iec.atn) {
        iec.atn = atn;
        if (this.drive) this.drive.atnChanged(atn);
      }
    };
    v1.onCA2 = (level) => { ds.motor = level === 0; };
    v1.onIrq = (on) => { if (on) this.cpu.nmiEdge = true; };
    v1.setCA1(1);

    v2.readPA = (driveA) => {
      const pb = this.portBPins(v2.driveB(), driveA);
      let low = 0;
      for (let c = 0; c < 8; c++) if (!(pb & (1 << c))) low |= this.matrix[c];
      return driveA & ~low & 0xFF;
    };
    v2.readPB = (driveB) => this.portBPins(driveB, v2.driveA());
    let lastWrite = 0x08;
    v2.onPB = (pins) => {
      const w = pins & 0x08;
      if (w !== lastWrite) {
        lastWrite = w;
        if (w) ds.writeEdge(this.cycles);
      }
    };
    v2.onCA2 = (level) => { iec.vicClk = level === 1; };
    v2.onCB2 = (level) => { iec.vicData = level === 1; };
    v2.onIrq = (on) => this.cpu.setIrq(1, on);
    v2.setCA1(1);

    ds.onRead = (level) => v2.setCA1(level);

    v1.reset();
    v2.reset();
  }

  portBPins(driveB, driveA) {
    let pins = driveB;
    if (this.joy & JOY_RIGHT) pins &= 0x7F;
    const lowRows = ~driveA & 0xFF;
    if (lowRows) {
      for (let c = 0; c < 8; c++) if (this.matrix[c] & lowRows) pins &= ~(1 << c);
    }
    return pins & 0xFF;
  }

  setupDrive() {
    const want = this.driveEnabled && this.roms.dos1541;
    if (want && !this.drive) {
      this.drive = new Drive1541(this.roms.dos1541, this.iec);
      if (this.disk) this.drive.insert(this.disk);
    } else if (!want && this.drive) {
      this.drive.flush();
      this.drive = null;
    }
    this.iec.drivePresent = !!this.drive;
  }

  setDriveEnabled(on) {
    this.driveEnabled = !!on;
    this.setupDrive();
    if (this.drive) this.drive.reset();
  }

  buildMemoryMap() {
    const pt = this.ptype, mem = this.mem, roms = this.roms;
    pt.fill(P_OPEN);
    pt.fill(P_RAM, 0x00, 0x04);
    pt.fill(P_RAM, 0x10, 0x20);
    for (const b of this.memory) {
      const [first, count] = BLOCKS[b];
      pt.fill(P_RAM, first, first + count);
    }
    pt.fill(P_ROM, 0x80, 0x90);
    mem.set(roms.char.subarray(0, 0x1000), 0x8000);
    pt.fill(P_IO, 0x90, 0x94);
    pt.fill(P_COLOR, 0x94, 0x98);
    pt.fill(P_ROM, 0xC0, 0xE0);
    mem.set(roms.basic.subarray(0, 0x2000), 0xC000);
    pt.fill(P_ROM, 0xE0, 0x100);
    const kernal = this.model === 'ntsc' ? roms.kernalNtsc : roms.kernalPal;
    mem.set(kernal.subarray(0, 0x2000), 0xE000);

    const covered = new Uint8Array(256);
    for (const { addr, data } of this.cartChunks) {
      const first = addr >> 8, pages = Math.ceil(data.length / 256);
      for (let p = 0; p < pages && first + p < 256; p++) covered[first + p] = 1;
    }
    for (const { addr, data } of this.cartChunks) {
      const first = addr >> 8, pages = Math.ceil(data.length / 256);
      mem.set(data.subarray(0, Math.min(data.length, 0x10000 - addr)), addr);
      pt.fill(P_ROM, first, Math.min(256, first + pages));
      if (data.length <= 0x1000 && (addr & 0x1FFF) === 0 && addr >= 0x2000 && addr !== 0x8000) {
        const mirror = addr + 0x1000;
        if (!covered[mirror >> 8]) {
          mem.set(data, mirror);
          pt.fill(P_ROM, mirror >> 8, (mirror >> 8) + pages);
        }
      }
    }
  }

  setCartridges(chunks) {
    this.cartChunks = chunks.map((c) => ({ addr: c.addr, data: new Uint8Array(c.data) }));
  }

  tick() {
    this.cycles++;
    if (this.vic.cycle()) this.frameDone = true;
    this.via1.tick();
    this.via2.tick();
    if (this.datasette.running) this.datasette.tick();
    const drive = this.drive;
    if (drive !== null) {
      this.driveDebt += this.driveRatio;
      while (this.driveDebt > 0) this.driveDebt -= drive.step();
    }
    const cpu = this.cpu;
    cpu.irqSample = cpu.irq !== 0;
    cpu.nmiSample = cpu.nmiEdge;
  }

  read(addr) {
    this.tick();
    const t = this.ptype[addr >> 8];
    let v;
    if (t <= P_ROM) v = this.mem[addr];
    else if (t === P_OPEN) v = this.lastBus;
    else if (t === P_COLOR) v = (this.mem[addr] & 0x0F) | (this.lastBus & 0xF0);
    else v = this.ioRead(addr);
    this.lastBus = v;
    return v;
  }

  write(addr, v) {
    this.tick();
    this.lastBus = v;
    const t = this.ptype[addr >> 8];
    if (t === P_RAM) this.mem[addr] = v;
    else if (t === P_COLOR) this.mem[addr] = v & 0x0F;
    else if (t === P_IO) this.ioWrite(addr, v);
  }

  ioRead(addr) {
    let v = 0xFF, hit = false;
    if ((addr & 0x0300) === 0) { v &= this.vic.read(addr); hit = true; }
    if (addr & 0x10) { v &= this.via1.read(addr); hit = true; }
    if (addr & 0x20) { v &= this.via2.read(addr); hit = true; }
    return hit ? v : this.lastBus;
  }

  ioWrite(addr, v) {
    if ((addr & 0x0300) === 0) this.vic.write(addr, v, this.cycles);
    if (addr & 0x10) this.via1.write(addr, v);
    if (addr & 0x20) this.via2.write(addr, v);
  }

  peek(addr) {
    const t = this.ptype[addr >> 8];
    if (t <= P_ROM || t === P_COLOR) return this.mem[addr];
    if (t === P_IO && (addr & 0x0300) === 0) return this.vic.regs[addr & 0x0F];
    return 0xFF;
  }

  poke(addr, v) {
    const t = this.ptype[addr >> 8];
    if (t === P_RAM) this.mem[addr] = v;
    else if (t === P_COLOR) this.mem[addr] = v & 0x0F;
  }

  isRam(addr) { return this.ptype[addr >> 8] === P_RAM; }

  hardReset() {
    this.mem.fill(0);
    this.buildMemoryMap();
    this.vic.reset();
    this.sound.reset(this.cycles);
    this.via1.reset();
    this.via2.reset();
    this.via1.setCA1(1);
    this.via2.setCA1(1);
    this.cpu.irq = 0;
    this.cpu.nmiEdge = false;
    this.keyQueue = [];
    this.readyHandlers = [];
    this.readyCount = 0;
    if (this.drive) this.warmUpDrive();
    this.cpu.reset();
  }

  warmUpDrive() {
    const iec = this.iec, drive = this.drive;
    const saved = [iec.atn, iec.vicClk, iec.vicData];
    iec.atn = iec.vicClk = iec.vicData = false;
    drive.reset();
    drive.atnChanged(false);
    const end = drive.cycles + 1500000;
    while (drive.cycles < end) drive.step();
    [iec.atn, iec.vicClk, iec.vicData] = saved;
    drive.atnChanged(iec.atn);
    this.driveDebt = 0;
  }

  runFrame() {
    this.frameDone = false;
    const limit = this.cycles + this.cyclesPerFrame * 2;
    const cpu = this.cpu;
    while (!this.frameDone && this.cycles < limit) cpu.step();
    this.frames++;
    this.sound.update(this.cycles);
  }

  runCycles(n) {
    const end = this.cycles + n;
    while (this.cycles < end) this.cpu.step();
    this.sound.update(this.cycles);
  }

  get busy() {
    return this.datasette.running || (this.drive !== null && this.drive.motor);
  }

  key(name, down) {
    if (name === 'RESTORE') { this.via1.setCA1(down ? 0 : 1); return; }
    const code = VIC_KEYS[name];
    if (code === undefined) return;
    if (down) this.keyCount[code]++;
    else if (this.keyCount[code] > 0) this.keyCount[code]--;
    const col = code >> 3, row = code & 7;
    if (this.keyCount[code]) this.matrix[col] |= 1 << row;
    else this.matrix[col] &= ~(1 << row);
  }

  releaseAllKeys() {
    this.keyCount.fill(0);
    this.matrix.fill(0);
    this.via1.setCA1(1);
  }

  setJoystick(bits) {
    if ((bits & JOY_FIRE) && !(this.joy & JOY_FIRE)) this.vic.triggerLightPen();
    this.joy = bits;
  }

  setPaddles(x, y) { this.vic.setPaddles(x, y); }

  typeText(text) {
    for (const ch of text) {
      let c = ch.charCodeAt(0);
      if (ch === '\n') c = 13;
      else if (c >= 0x61 && c <= 0x7A) c -= 0x20;
      this.keyQueue.push(c & 0xFF);
    }
  }

  onReady(fn) { this.readyHandlers.push(fn); }

  trap(pc) {
    if (pc === TRAP_READY) {
      this.readyCount++;
      if (this.readyHandlers.length) {
        const handlers = this.readyHandlers;
        this.readyHandlers = [];
        for (const h of handlers) h(this);
      }
      if (this.keyQueue.length && this.mem[0xC6] === 0) {
        const n = Math.min(this.keyQueue.length, 10);
        for (let i = 0; i < n; i++) this.mem[0x0277 + i] = this.keyQueue.shift();
        this.mem[0xC6] = n;
      }
      return false;
    }
    if (pc === TRAP_LOAD) return this.fastLoad();
    return false;
  }

  trapReturn() {
    const cpu = this.cpu;
    cpu.s = (cpu.s + 1) & 0xFF;
    const lo = this.mem[0x100 | cpu.s];
    cpu.s = (cpu.s + 1) & 0xFF;
    const hi = this.mem[0x100 | cpu.s];
    cpu.pc = (((hi << 8) | lo) + 1) & 0xFFFF;
  }

  fastLoad() {
    const m = this.mem, cpu = this.cpu;
    if (!this.fastDisk || !this.disk || this.drive || m[0xBA] !== 8) return false;
    const verify = cpu.a !== 0;
    const len = m[0xB7], ptr = m[0xBB] | (m[0xBC] << 8);
    const name = new Uint8Array(len);
    for (let i = 0; i < len; i++) name[i] = this.peek((ptr + i) & 0xFFFF);
    const sa = m[0xB9];

    let data = null;
    if (len > 0 && name[0] === 0x24) {
      data = this.disk.directoryListing();
    } else {
      const f = this.disk.findFile(name);
      if (f) data = this.disk.readChain(f.track, f.sector);
    }
    m[0x93] = cpu.a;
    if (!data || data.length < 2) {
      m[0x90] = 0x42;
      cpu.a = 4;
      cpu.c = 1;
      this.trapReturn();
      return true;
    }
    let addr = sa === 0 ? (m[0xC3] | (m[0xC4] << 8)) : (data[0] | (data[1] << 8));
    for (let i = 2; i < data.length; i++) {
      const a = (addr + i - 2) & 0xFFFF;
      if (!verify) this.poke(a, data[i]);
    }
    const end = (addr + data.length - 2) & 0xFFFF;
    m[0xAE] = end & 0xFF; m[0xAF] = end >> 8;
    m[0x90] = 0x40;
    cpu.x = end & 0xFF; cpu.y = end >> 8;
    cpu.c = 0;
    cpu.a = 0;
    this.trapReturn();
    return true;
  }

  insertDisk(bytes) {
    this.disk = bytes ? (bytes instanceof D64 ? bytes : new D64(bytes)) : null;
    if (this.drive) this.drive.insert(this.disk);
  }

  ejectDisk() { this.insertDisk(null); }

  diskImage() {
    if (!this.disk) return null;
    if (this.drive) this.drive.flush();
    return this.disk.data;
  }

  insertTape(bytes) { this.datasette.insert(bytes); }
  ejectTape() { this.datasette.eject(); }

  injectPrg(prg) {
    const m = this.mem;
    let addr = prg[0] | (prg[1] << 8);
    const basicStart = m[0x2B] | (m[0x2C] << 8);
    const isBasicStart = addr === 0x0401 || addr === 0x1001 || addr === 0x1201;
    const relocate = isBasicStart && addr !== basicStart;
    if (relocate) addr = basicStart;
    for (let i = 2; i < prg.length; i++) this.poke((addr + i - 2) & 0xFFFF, prg[i]);
    const end = (addr + prg.length - 2) & 0xFFFF;
    m[0xAE] = end & 0xFF; m[0xAF] = end >> 8;
    if (addr === basicStart) {
      for (const p of [0x2D, 0x2F, 0x31]) { m[p] = end & 0xFF; m[p + 1] = end >> 8; }
      if (relocate) this.relinkBasic();
    }
    return { addr, end, basic: addr === basicStart };
  }

  relinkBasic() {
    const m = this.mem;
    let p = m[0x2B] | (m[0x2C] << 8);
    for (let guard = 0; guard < 10000 && m[p + 1] !== 0; guard++) {
      let q = p + 4;
      while (m[q] !== 0 && q < 0xFFFF) q++;
      const next = q + 1;
      m[p] = next & 0xFF;
      m[p + 1] = next >> 8;
      p = next;
    }
  }
}
