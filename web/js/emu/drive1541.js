import { Cpu6502 } from './cpu6502.js';
import { Via6522 } from './via6522.js';

const CYCLES_PER_BYTE = [32, 30, 28, 26];

export const DRIVE_CLOCK = 1000000;

export class Drive1541 {
  constructor(rom, iec) {
    this.rom = rom;
    this.iec = iec;
    this.ram = new Uint8Array(0x800);
    this.cycles = 0;
    this.lastBus = 0;

    this.cpu = new Cpu6502(this);
    this.via1 = new Via6522();
    this.via2 = new Via6522();
    this.wire();

    this.disk = null;
    this.tracks = [];
    this.dirty = new Set();
    this.writeProtect = false;
    this.wpOverride = 0;

    this.halfTrack = 36;
    this.stepPhase = this.halfTrack & 3;
    this.headPos = 0;
    this.byteTimer = 0;
    this.prevByte = 0;
    this.sync = false;
    this.readLatch = 0;
    this.motor = false;
    this.led = false;
    this.zone = 3;
    this.byteReadyLow = 0;
    this.idleCycles = 0;

    this.reset();
  }

  wire() {
    const iec = this.iec;
    const v1 = this.via1, v2 = this.via2;

    v1.readPB = () =>
      (iec.data() ? 0x01 : 0) | (iec.clk() ? 0x04 : 0) | (iec.atn ? 0x80 : 0) | 0x1A;
    v1.onPB = (pins) => {
      iec.drvData = (pins & 0x02) !== 0;
      iec.drvClk = (pins & 0x08) !== 0;
      iec.drvAtnAck = (pins & 0x10) !== 0;
    };
    v1.onIrq = (on) => this.cpu.setIrq(1, on);

    v2.readPA = () => this.readLatch;
    v2.readPB = () => {
      const wp = this.wpOverride > 0 ? (this.wpOverride & 0x1000 ? 0 : 1) : (this.writeProtect ? 0 : 1);
      return 0x6F | (wp << 4) | (this.sync && this.cb2Read() ? 0 : 0x80);
    };
    v2.onPB = (pins) => this.mechanics(pins);
    v2.onIrq = (on) => this.cpu.setIrq(2, on);
  }

  cb2Read() { return this.via2.cb2 === 1; }

  reset() {
    this.ram.fill(0);
    this.via1.reset();
    this.via2.reset();
    this.iec.drvData = this.iec.drvClk = false;
    this.cpu.reset();
  }

  insert(d64) {
    this.flush();
    this.disk = d64;
    this.tracks = [];
    this.dirty.clear();
    if (d64) {
      for (let t = 1; t <= d64.tracks; t++) {
        const gcr = d64.encodeTrack(t);
        this.tracks[t * 2] = gcr;
        this.tracks[t * 2 + 1] = gcr;
      }
    }
    this.wpOverride = 0x6000;
  }

  eject() { this.insert(null); }

  flush() {
    if (!this.disk) return;
    for (const ht of this.dirty) this.disk.decodeTrack(ht >> 1, this.tracks[ht]);
    this.dirty.clear();
  }

  mechanics(pins) {
    const driven = this.via2.ddrb;
    if ((driven & 3) === 3) {
      const oldPhase = this.stepPhase;
      const phase = pins & 3;
      if (phase !== oldPhase) {
        const track = this.tracks[this.halfTrack];
        const frac = track ? this.headPos / track.length : 0;
        if (phase === ((oldPhase + 1) & 3) && this.halfTrack < 84) this.halfTrack++;
        else if (phase === ((oldPhase - 1) & 3) && this.halfTrack > 2) this.halfTrack--;
        const nt = this.tracks[this.halfTrack];
        this.headPos = nt ? Math.floor(frac * nt.length) : 0;
      }
      this.stepPhase = phase;
    }
    this.motor = (driven & 0x04) !== 0 && (pins & 0x04) !== 0;
    this.led = (driven & 0x08) !== 0 && (pins & 0x08) !== 0;
    this.zone = (pins >> 5) & 3;
  }

  tick() {
    this.cycles++;
    this.via1.tick();
    this.via2.tick();
    if (this.wpOverride > 0) this.wpOverride--;
    if (this.byteReadyLow && --this.byteReadyLow === 0) this.via2.setCA1(1);
    if (this.motor && --this.byteTimer <= 0) {
      this.byteTimer += CYCLES_PER_BYTE[this.zone];
      this.rotate();
    }
    const c = this.cpu;
    c.irqSample = c.irq !== 0;
    c.nmiSample = false;
  }

  rotate() {
    const track = this.tracks[this.halfTrack];
    const v2 = this.via2;
    if (!track) {
      this.sync = false;
      return;
    }
    if (++this.headPos >= track.length) this.headPos = 0;
    const writing = v2.cb2 === 0;
    if (writing) {
      track[this.headPos] = v2.ora;
      this.dirty.add(this.halfTrack & ~1);
      this.sync = false;
      this.byteReady();
    } else {
      const b = track[this.headPos];
      this.sync = b === 0xFF && this.prevByte === 0xFF;
      this.prevByte = b;
      if (!this.sync) {
        this.readLatch = b;
        this.byteReady();
      }
    }
  }

  byteReady() {
    if (this.via2.ca2 !== 1) return;
    this.cpu.v = 1;
    this.via2.setCA1(0);
    this.byteReadyLow = 2;
  }

  read(addr) {
    this.tick();
    let v;
    if (addr & 0x8000) {
      v = this.rom[addr & 0x3FFF];
    } else {
      const a = addr & 0x1FFF;
      if (a < 0x0800) v = this.ram[a];
      else if (a >= 0x1C00) v = this.via2.read(a);
      else if (a >= 0x1800) v = this.via1.read(a);
      else v = this.lastBus;
    }
    this.lastBus = v;
    return v;
  }

  write(addr, v) {
    this.tick();
    this.lastBus = v;
    if (addr & 0x8000) return;
    const a = addr & 0x1FFF;
    if (a < 0x0800) this.ram[a] = v;
    else if (a >= 0x1C00) this.via2.write(a, v);
    else if (a >= 0x1800) this.via1.write(a, v);
  }

  step() {
    const start = this.cycles;
    this.cpu.step();
    return this.cycles - start;
  }

  get busy() { return this.motor; }

  atnChanged(asserted) {
    this.via1.setCA1(asserted ? 1 : 0);
  }
}

export class IecBus {
  constructor() {
    this.atn = false;
    this.vicClk = false;
    this.vicData = false;
    this.drvClk = false;
    this.drvData = false;
    this.drvAtnAck = false;
    this.drivePresent = false;
  }

  clk() { return this.vicClk || this.drvClk; }

  data() {
    if (this.vicData) return true;
    if (!this.drivePresent) return false;
    return this.drvData || (this.drvAtnAck !== this.atn);
  }
}
