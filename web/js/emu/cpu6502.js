export class Cpu6502 {
  constructor(bus) {
    this.bus = bus;
    this.a = 0; this.x = 0; this.y = 0; this.s = 0xFD; this.pc = 0;
    this.n = 0; this.v = 0; this.d = 0; this.i = 1; this.z = 0; this.c = 0;
    this.irq = 0;
    this.nmiEdge = false;
    this.irqSample = false;
    this.nmiSample = false;
    this.jammed = false;
    this.trapFlags = null;
    this.onTrap = null;
  }

  reset() {
    const b = this.bus;
    b.read(this.pc); b.read(this.pc);
    b.read(0x100 | this.s); this.s = (this.s - 1) & 0xFF;
    b.read(0x100 | this.s); this.s = (this.s - 1) & 0xFF;
    b.read(0x100 | this.s); this.s = (this.s - 1) & 0xFF;
    this.i = 1;
    this.jammed = false;
    this.nmiEdge = false;
    const lo = b.read(0xFFFC);
    this.pc = lo | (b.read(0xFFFD) << 8);
  }

  setIrq(mask, on) {
    if (on) this.irq |= mask; else this.irq &= ~mask;
  }

  triggerNmi() { this.nmiEdge = true; }

  getP(brk) {
    return (this.n << 7) | (this.v << 6) | 0x20 | (brk << 4) | (this.d << 3) |
      (this.i << 2) | (this.z << 1) | this.c;
  }

  setP(p) {
    this.n = (p >> 7) & 1; this.v = (p >> 6) & 1; this.d = (p >> 3) & 1;
    this.i = (p >> 2) & 1; this.z = (p >> 1) & 1; this.c = p & 1;
  }

  fetch() {
    const v = this.bus.read(this.pc);
    this.pc = (this.pc + 1) & 0xFFFF;
    return v;
  }

  push(v) {
    this.bus.write(0x100 | this.s, v);
    this.s = (this.s - 1) & 0xFF;
  }

  pull() {
    this.s = (this.s + 1) & 0xFF;
    return this.bus.read(0x100 | this.s);
  }

  nz(v) { this.n = v >> 7; this.z = v === 0 ? 1 : 0; return v; }

  zpx() { const z = this.fetch(); this.bus.read(z); return (z + this.x) & 0xFF; }
  zpy() { const z = this.fetch(); this.bus.read(z); return (z + this.y) & 0xFF; }
  abs() { const lo = this.fetch(); return lo | (this.fetch() << 8); }

  absR(idx) {
    const lo = this.fetch(), hi = this.fetch();
    const t = lo + idx;
    if (t > 0xFF) this.bus.read((hi << 8) | (t & 0xFF));
    return ((hi << 8) + t) & 0xFFFF;
  }

  absW(idx) {
    const lo = this.fetch(), hi = this.fetch();
    const t = lo + idx;
    this.bus.read((hi << 8) | (t & 0xFF));
    return ((hi << 8) + t) & 0xFFFF;
  }

  izx() {
    const z = this.fetch();
    this.bus.read(z);
    const p = (z + this.x) & 0xFF;
    const lo = this.bus.read(p);
    return lo | (this.bus.read((p + 1) & 0xFF) << 8);
  }

  izyR() {
    const z = this.fetch();
    const lo = this.bus.read(z), hi = this.bus.read((z + 1) & 0xFF);
    const t = lo + this.y;
    if (t > 0xFF) this.bus.read((hi << 8) | (t & 0xFF));
    return ((hi << 8) + t) & 0xFFFF;
  }

  izyW() {
    const z = this.fetch();
    const lo = this.bus.read(z), hi = this.bus.read((z + 1) & 0xFF);
    const t = lo + this.y;
    this.bus.read((hi << 8) | (t & 0xFF));
    return ((hi << 8) + t) & 0xFFFF;
  }

  rmw(addr, fn) {
    const b = this.bus;
    const v = b.read(addr);
    b.write(addr, v);
    b.write(addr, fn.call(this, v));
  }

  branch(cond) {
    const off = this.fetch();
    if (!cond) return;
    this.bus.read(this.pc);
    const t = (this.pc + ((off << 24) >> 24)) & 0xFFFF;
    if ((t ^ this.pc) & 0xFF00) this.bus.read((this.pc & 0xFF00) | (t & 0xFF));
    this.pc = t;
  }

  ora(v) { this.nz(this.a |= v); }
  and(v) { this.nz(this.a &= v); }
  eor(v) { this.nz(this.a ^= v); }
  lda(v) { this.nz(this.a = v); }
  ldx(v) { this.nz(this.x = v); }
  ldy(v) { this.nz(this.y = v); }
  lax(v) { this.nz(this.a = this.x = v); }

  cmpr(r, v) {
    const t = r - v;
    this.c = t >= 0 ? 1 : 0;
    this.nz(t & 0xFF);
  }

  bit(v) {
    this.n = v >> 7; this.v = (v >> 6) & 1;
    this.z = (this.a & v) === 0 ? 1 : 0;
  }

  adc(v) {
    const a = this.a, c = this.c;
    if (this.d) {
      let t = (a & 0x0F) + (v & 0x0F) + c;
      if (t > 9) t += 6;
      if (t <= 0x0F) t = (t & 0x0F) + (a & 0xF0) + (v & 0xF0);
      else t = (t & 0x0F) + (a & 0xF0) + (v & 0xF0) + 0x10;
      this.z = ((a + v + c) & 0xFF) === 0 ? 1 : 0;
      this.n = (t >> 7) & 1;
      this.v = (((a ^ t) & 0x80) && !((a ^ v) & 0x80)) ? 1 : 0;
      if ((t & 0x1F0) > 0x90) t += 0x60;
      this.c = (t & 0xFF0) > 0xF0 ? 1 : 0;
      this.a = t & 0xFF;
    } else {
      const t = a + v + c;
      this.v = (~(a ^ v) & (a ^ t) & 0x80) ? 1 : 0;
      this.c = t > 0xFF ? 1 : 0;
      this.nz(this.a = t & 0xFF);
    }
  }

  sbc(v) {
    const a = this.a, borrow = 1 - this.c;
    const t = a - v - borrow;
    if (this.d) {
      let ta = (a & 0x0F) - (v & 0x0F) - borrow;
      if (ta & 0x10) ta = ((ta - 6) & 0x0F) | ((a & 0xF0) - (v & 0xF0) - 0x10);
      else ta = (ta & 0x0F) | ((a & 0xF0) - (v & 0xF0));
      if (ta & 0x100) ta -= 0x60;
      this.c = t >= 0 ? 1 : 0;
      this.nz(t & 0xFF);
      this.v = (((a ^ t) & 0x80) && ((a ^ v) & 0x80)) ? 1 : 0;
      this.a = ta & 0xFF;
    } else {
      this.v = ((a ^ v) & (a ^ t) & 0x80) ? 1 : 0;
      this.c = t >= 0 ? 1 : 0;
      this.nz(this.a = t & 0xFF);
    }
  }

  asl(v) { this.c = v >> 7; return this.nz((v << 1) & 0xFF); }
  lsr(v) { this.c = v & 1; return this.nz(v >> 1); }
  rol(v) { const t = ((v << 1) | this.c) & 0xFF; this.c = v >> 7; return this.nz(t); }
  ror(v) { const t = (v >> 1) | (this.c << 7); this.c = v & 1; return this.nz(t); }
  inc(v) { return this.nz((v + 1) & 0xFF); }
  dec(v) { return this.nz((v - 1) & 0xFF); }
  slo(v) { this.c = v >> 7; v = (v << 1) & 0xFF; this.ora(v); return v; }
  rla(v) { const t = ((v << 1) | this.c) & 0xFF; this.c = v >> 7; this.and(t); return t; }
  sre(v) { this.c = v & 1; v >>= 1; this.eor(v); return v; }
  rra(v) { const t = (v >> 1) | (this.c << 7); this.c = v & 1; this.adc(t); return t; }
  dcp(v) { v = (v - 1) & 0xFF; this.cmpr(this.a, v); return v; }
  isc(v) { v = (v + 1) & 0xFF; this.sbc(v); return v; }

  arr(v) {
    const t = this.a & v;
    if (this.d) {
      let r = (t >> 1) | (this.c << 7);
      this.n = this.c;
      this.z = r === 0 ? 1 : 0;
      this.v = ((r ^ t) & 0x40) ? 1 : 0;
      if (((t & 0x0F) + (t & 0x01)) > 5) r = (r & 0xF0) | ((r + 6) & 0x0F);
      if (((t & 0xF0) + (t & 0x10)) > 0x50) { r = (r & 0x0F) | ((r + 0x60) & 0xF0); this.c = 1; }
      else this.c = 0;
      this.a = r & 0xFF;
    } else {
      this.nz(this.a = (t >> 1) | (this.c << 7));
      this.c = (this.a >> 6) & 1;
      this.v = ((this.a >> 6) ^ (this.a >> 5)) & 1;
    }
  }

  shStore(lo, hi, idx, val) {
    const t = lo + idx;
    this.bus.read((hi << 8) | (t & 0xFF));
    const v = val & ((hi + 1) & 0xFF);
    let addr = ((hi << 8) + t) & 0xFFFF;
    if (t > 0xFF) addr = (v << 8) | (addr & 0xFF);
    this.bus.write(addr, v);
  }

  interrupt(vector) {
    const b = this.bus;
    b.read(this.pc); b.read(this.pc);
    this.push(this.pc >> 8);
    this.push(this.pc & 0xFF);
    if (vector === 0xFFFE && this.nmiEdge) { vector = 0xFFFA; this.nmiEdge = false; }
    this.push(this.getP(0));
    this.i = 1;
    const lo = b.read(vector);
    this.pc = lo | (b.read(vector + 1) << 8);
  }

  step() {
    const b = this.bus;
    if (this.jammed) { b.read(0xFFFF); return; }
    if (this.trapFlags !== null && this.trapFlags[this.pc] !== 0 && this.onTrap(this.pc)) return;

    const op = this.fetch();
    let iPoll = -1;
    let ea, t;

    switch (op) {
      case 0xA9: this.lda(this.fetch()); break;
      case 0xA5: this.lda(b.read(this.fetch())); break;
      case 0xB5: this.lda(b.read(this.zpx())); break;
      case 0xAD: this.lda(b.read(this.abs())); break;
      case 0xBD: this.lda(b.read(this.absR(this.x))); break;
      case 0xB9: this.lda(b.read(this.absR(this.y))); break;
      case 0xA1: this.lda(b.read(this.izx())); break;
      case 0xB1: this.lda(b.read(this.izyR())); break;
      case 0xA2: this.ldx(this.fetch()); break;
      case 0xA6: this.ldx(b.read(this.fetch())); break;
      case 0xB6: this.ldx(b.read(this.zpy())); break;
      case 0xAE: this.ldx(b.read(this.abs())); break;
      case 0xBE: this.ldx(b.read(this.absR(this.y))); break;
      case 0xA0: this.ldy(this.fetch()); break;
      case 0xA4: this.ldy(b.read(this.fetch())); break;
      case 0xB4: this.ldy(b.read(this.zpx())); break;
      case 0xAC: this.ldy(b.read(this.abs())); break;
      case 0xBC: this.ldy(b.read(this.absR(this.x))); break;

      case 0x85: b.write(this.fetch(), this.a); break;
      case 0x95: b.write(this.zpx(), this.a); break;
      case 0x8D: b.write(this.abs(), this.a); break;
      case 0x9D: b.write(this.absW(this.x), this.a); break;
      case 0x99: b.write(this.absW(this.y), this.a); break;
      case 0x81: b.write(this.izx(), this.a); break;
      case 0x91: b.write(this.izyW(), this.a); break;
      case 0x86: b.write(this.fetch(), this.x); break;
      case 0x96: b.write(this.zpy(), this.x); break;
      case 0x8E: b.write(this.abs(), this.x); break;
      case 0x84: b.write(this.fetch(), this.y); break;
      case 0x94: b.write(this.zpx(), this.y); break;
      case 0x8C: b.write(this.abs(), this.y); break;

      case 0x09: this.ora(this.fetch()); break;
      case 0x05: this.ora(b.read(this.fetch())); break;
      case 0x15: this.ora(b.read(this.zpx())); break;
      case 0x0D: this.ora(b.read(this.abs())); break;
      case 0x1D: this.ora(b.read(this.absR(this.x))); break;
      case 0x19: this.ora(b.read(this.absR(this.y))); break;
      case 0x01: this.ora(b.read(this.izx())); break;
      case 0x11: this.ora(b.read(this.izyR())); break;

      case 0x29: this.and(this.fetch()); break;
      case 0x25: this.and(b.read(this.fetch())); break;
      case 0x35: this.and(b.read(this.zpx())); break;
      case 0x2D: this.and(b.read(this.abs())); break;
      case 0x3D: this.and(b.read(this.absR(this.x))); break;
      case 0x39: this.and(b.read(this.absR(this.y))); break;
      case 0x21: this.and(b.read(this.izx())); break;
      case 0x31: this.and(b.read(this.izyR())); break;

      case 0x49: this.eor(this.fetch()); break;
      case 0x45: this.eor(b.read(this.fetch())); break;
      case 0x55: this.eor(b.read(this.zpx())); break;
      case 0x4D: this.eor(b.read(this.abs())); break;
      case 0x5D: this.eor(b.read(this.absR(this.x))); break;
      case 0x59: this.eor(b.read(this.absR(this.y))); break;
      case 0x41: this.eor(b.read(this.izx())); break;
      case 0x51: this.eor(b.read(this.izyR())); break;

      case 0x69: this.adc(this.fetch()); break;
      case 0x65: this.adc(b.read(this.fetch())); break;
      case 0x75: this.adc(b.read(this.zpx())); break;
      case 0x6D: this.adc(b.read(this.abs())); break;
      case 0x7D: this.adc(b.read(this.absR(this.x))); break;
      case 0x79: this.adc(b.read(this.absR(this.y))); break;
      case 0x61: this.adc(b.read(this.izx())); break;
      case 0x71: this.adc(b.read(this.izyR())); break;

      case 0xE9: case 0xEB: this.sbc(this.fetch()); break;
      case 0xE5: this.sbc(b.read(this.fetch())); break;
      case 0xF5: this.sbc(b.read(this.zpx())); break;
      case 0xED: this.sbc(b.read(this.abs())); break;
      case 0xFD: this.sbc(b.read(this.absR(this.x))); break;
      case 0xF9: this.sbc(b.read(this.absR(this.y))); break;
      case 0xE1: this.sbc(b.read(this.izx())); break;
      case 0xF1: this.sbc(b.read(this.izyR())); break;

      case 0xC9: this.cmpr(this.a, this.fetch()); break;
      case 0xC5: this.cmpr(this.a, b.read(this.fetch())); break;
      case 0xD5: this.cmpr(this.a, b.read(this.zpx())); break;
      case 0xCD: this.cmpr(this.a, b.read(this.abs())); break;
      case 0xDD: this.cmpr(this.a, b.read(this.absR(this.x))); break;
      case 0xD9: this.cmpr(this.a, b.read(this.absR(this.y))); break;
      case 0xC1: this.cmpr(this.a, b.read(this.izx())); break;
      case 0xD1: this.cmpr(this.a, b.read(this.izyR())); break;
      case 0xE0: this.cmpr(this.x, this.fetch()); break;
      case 0xE4: this.cmpr(this.x, b.read(this.fetch())); break;
      case 0xEC: this.cmpr(this.x, b.read(this.abs())); break;
      case 0xC0: this.cmpr(this.y, this.fetch()); break;
      case 0xC4: this.cmpr(this.y, b.read(this.fetch())); break;
      case 0xCC: this.cmpr(this.y, b.read(this.abs())); break;

      case 0x24: this.bit(b.read(this.fetch())); break;
      case 0x2C: this.bit(b.read(this.abs())); break;

      case 0x0A: b.read(this.pc); this.a = this.asl(this.a); break;
      case 0x4A: b.read(this.pc); this.a = this.lsr(this.a); break;
      case 0x2A: b.read(this.pc); this.a = this.rol(this.a); break;
      case 0x6A: b.read(this.pc); this.a = this.ror(this.a); break;
      case 0x06: this.rmw(this.fetch(), this.asl); break;
      case 0x16: this.rmw(this.zpx(), this.asl); break;
      case 0x0E: this.rmw(this.abs(), this.asl); break;
      case 0x1E: this.rmw(this.absW(this.x), this.asl); break;
      case 0x46: this.rmw(this.fetch(), this.lsr); break;
      case 0x56: this.rmw(this.zpx(), this.lsr); break;
      case 0x4E: this.rmw(this.abs(), this.lsr); break;
      case 0x5E: this.rmw(this.absW(this.x), this.lsr); break;
      case 0x26: this.rmw(this.fetch(), this.rol); break;
      case 0x36: this.rmw(this.zpx(), this.rol); break;
      case 0x2E: this.rmw(this.abs(), this.rol); break;
      case 0x3E: this.rmw(this.absW(this.x), this.rol); break;
      case 0x66: this.rmw(this.fetch(), this.ror); break;
      case 0x76: this.rmw(this.zpx(), this.ror); break;
      case 0x6E: this.rmw(this.abs(), this.ror); break;
      case 0x7E: this.rmw(this.absW(this.x), this.ror); break;
      case 0xE6: this.rmw(this.fetch(), this.inc); break;
      case 0xF6: this.rmw(this.zpx(), this.inc); break;
      case 0xEE: this.rmw(this.abs(), this.inc); break;
      case 0xFE: this.rmw(this.absW(this.x), this.inc); break;
      case 0xC6: this.rmw(this.fetch(), this.dec); break;
      case 0xD6: this.rmw(this.zpx(), this.dec); break;
      case 0xCE: this.rmw(this.abs(), this.dec); break;
      case 0xDE: this.rmw(this.absW(this.x), this.dec); break;

      case 0xAA: b.read(this.pc); this.nz(this.x = this.a); break;
      case 0xA8: b.read(this.pc); this.nz(this.y = this.a); break;
      case 0x8A: b.read(this.pc); this.nz(this.a = this.x); break;
      case 0x98: b.read(this.pc); this.nz(this.a = this.y); break;
      case 0xBA: b.read(this.pc); this.nz(this.x = this.s); break;
      case 0x9A: b.read(this.pc); this.s = this.x; break;
      case 0xE8: b.read(this.pc); this.nz(this.x = (this.x + 1) & 0xFF); break;
      case 0xC8: b.read(this.pc); this.nz(this.y = (this.y + 1) & 0xFF); break;
      case 0xCA: b.read(this.pc); this.nz(this.x = (this.x - 1) & 0xFF); break;
      case 0x88: b.read(this.pc); this.nz(this.y = (this.y - 1) & 0xFF); break;
      case 0x18: b.read(this.pc); this.c = 0; break;
      case 0x38: b.read(this.pc); this.c = 1; break;
      case 0x58: b.read(this.pc); iPoll = this.i; this.i = 0; break;
      case 0x78: b.read(this.pc); iPoll = this.i; this.i = 1; break;
      case 0xB8: b.read(this.pc); this.v = 0; break;
      case 0xD8: b.read(this.pc); this.d = 0; break;
      case 0xF8: b.read(this.pc); this.d = 1; break;
      case 0xEA: case 0x1A: case 0x3A: case 0x5A: case 0x7A: case 0xDA: case 0xFA:
        b.read(this.pc); break;

      case 0x48: b.read(this.pc); this.push(this.a); break;
      case 0x08: b.read(this.pc); this.push(this.getP(1)); break;
      case 0x68: b.read(this.pc); b.read(0x100 | this.s); this.nz(this.a = this.pull()); break;
      case 0x28: b.read(this.pc); b.read(0x100 | this.s); iPoll = this.i; this.setP(this.pull()); break;

      case 0x10: this.branch(!this.n); break;
      case 0x30: this.branch(this.n); break;
      case 0x50: this.branch(!this.v); break;
      case 0x70: this.branch(this.v); break;
      case 0x90: this.branch(!this.c); break;
      case 0xB0: this.branch(this.c); break;
      case 0xD0: this.branch(!this.z); break;
      case 0xF0: this.branch(this.z); break;

      case 0x4C: this.pc = this.abs(); break;
      case 0x6C: {
        const lo = this.fetch(), hi = this.fetch();
        const pl = b.read((hi << 8) | lo);
        const ph = b.read((hi << 8) | ((lo + 1) & 0xFF));
        this.pc = pl | (ph << 8);
        break;
      }
      case 0x20: {
        const lo = this.fetch();
        b.read(0x100 | this.s);
        this.push(this.pc >> 8);
        this.push(this.pc & 0xFF);
        this.pc = lo | (b.read(this.pc) << 8);
        break;
      }
      case 0x60: {
        b.read(this.pc);
        b.read(0x100 | this.s);
        const lo = this.pull();
        this.pc = lo | (this.pull() << 8);
        b.read(this.pc);
        this.pc = (this.pc + 1) & 0xFFFF;
        break;
      }
      case 0x40: {
        b.read(this.pc);
        b.read(0x100 | this.s);
        this.setP(this.pull());
        const lo = this.pull();
        this.pc = lo | (this.pull() << 8);
        break;
      }
      case 0x00: {
        this.fetch();
        this.push(this.pc >> 8);
        this.push(this.pc & 0xFF);
        let vec = 0xFFFE;
        if (this.nmiEdge) { vec = 0xFFFA; this.nmiEdge = false; }
        this.push(this.getP(1));
        this.i = 1;
        const lo = b.read(vec);
        this.pc = lo | (b.read(vec + 1) << 8);
        return;
      }

      case 0x80: case 0x82: case 0x89: case 0xC2: case 0xE2: this.fetch(); break;
      case 0x04: case 0x44: case 0x64: b.read(this.fetch()); break;
      case 0x14: case 0x34: case 0x54: case 0x74: case 0xD4: case 0xF4: b.read(this.zpx()); break;
      case 0x0C: b.read(this.abs()); break;
      case 0x1C: case 0x3C: case 0x5C: case 0x7C: case 0xDC: case 0xFC: b.read(this.absR(this.x)); break;

      case 0x07: this.rmw(this.fetch(), this.slo); break;
      case 0x17: this.rmw(this.zpx(), this.slo); break;
      case 0x0F: this.rmw(this.abs(), this.slo); break;
      case 0x1F: this.rmw(this.absW(this.x), this.slo); break;
      case 0x1B: this.rmw(this.absW(this.y), this.slo); break;
      case 0x03: this.rmw(this.izx(), this.slo); break;
      case 0x13: this.rmw(this.izyW(), this.slo); break;
      case 0x27: this.rmw(this.fetch(), this.rla); break;
      case 0x37: this.rmw(this.zpx(), this.rla); break;
      case 0x2F: this.rmw(this.abs(), this.rla); break;
      case 0x3F: this.rmw(this.absW(this.x), this.rla); break;
      case 0x3B: this.rmw(this.absW(this.y), this.rla); break;
      case 0x23: this.rmw(this.izx(), this.rla); break;
      case 0x33: this.rmw(this.izyW(), this.rla); break;
      case 0x47: this.rmw(this.fetch(), this.sre); break;
      case 0x57: this.rmw(this.zpx(), this.sre); break;
      case 0x4F: this.rmw(this.abs(), this.sre); break;
      case 0x5F: this.rmw(this.absW(this.x), this.sre); break;
      case 0x5B: this.rmw(this.absW(this.y), this.sre); break;
      case 0x43: this.rmw(this.izx(), this.sre); break;
      case 0x53: this.rmw(this.izyW(), this.sre); break;
      case 0x67: this.rmw(this.fetch(), this.rra); break;
      case 0x77: this.rmw(this.zpx(), this.rra); break;
      case 0x6F: this.rmw(this.abs(), this.rra); break;
      case 0x7F: this.rmw(this.absW(this.x), this.rra); break;
      case 0x7B: this.rmw(this.absW(this.y), this.rra); break;
      case 0x63: this.rmw(this.izx(), this.rra); break;
      case 0x73: this.rmw(this.izyW(), this.rra); break;
      case 0xC7: this.rmw(this.fetch(), this.dcp); break;
      case 0xD7: this.rmw(this.zpx(), this.dcp); break;
      case 0xCF: this.rmw(this.abs(), this.dcp); break;
      case 0xDF: this.rmw(this.absW(this.x), this.dcp); break;
      case 0xDB: this.rmw(this.absW(this.y), this.dcp); break;
      case 0xC3: this.rmw(this.izx(), this.dcp); break;
      case 0xD3: this.rmw(this.izyW(), this.dcp); break;
      case 0xE7: this.rmw(this.fetch(), this.isc); break;
      case 0xF7: this.rmw(this.zpx(), this.isc); break;
      case 0xEF: this.rmw(this.abs(), this.isc); break;
      case 0xFF: this.rmw(this.absW(this.x), this.isc); break;
      case 0xFB: this.rmw(this.absW(this.y), this.isc); break;
      case 0xE3: this.rmw(this.izx(), this.isc); break;
      case 0xF3: this.rmw(this.izyW(), this.isc); break;

      case 0xA7: this.lax(b.read(this.fetch())); break;
      case 0xB7: this.lax(b.read(this.zpy())); break;
      case 0xAF: this.lax(b.read(this.abs())); break;
      case 0xBF: this.lax(b.read(this.absR(this.y))); break;
      case 0xA3: this.lax(b.read(this.izx())); break;
      case 0xB3: this.lax(b.read(this.izyR())); break;
      case 0x87: b.write(this.fetch(), this.a & this.x); break;
      case 0x97: b.write(this.zpy(), this.a & this.x); break;
      case 0x8F: b.write(this.abs(), this.a & this.x); break;
      case 0x83: b.write(this.izx(), this.a & this.x); break;

      case 0x0B: case 0x2B: this.and(this.fetch()); this.c = this.n; break;
      case 0x4B: this.a &= this.fetch(); this.a = this.lsr(this.a); break;
      case 0x6B: this.arr(this.fetch()); break;
      case 0x8B: this.nz(this.a = (this.a | 0xEE) & this.x & this.fetch()); break;
      case 0xAB: this.lax((this.a | 0xEE) & this.fetch()); break;
      case 0xCB:
        t = (this.a & this.x) - this.fetch();
        this.c = t >= 0 ? 1 : 0;
        this.nz(this.x = t & 0xFF);
        break;

      case 0x9F: { const lo = this.fetch(), hi = this.fetch(); this.shStore(lo, hi, this.y, this.a & this.x); break; }
      case 0x9E: { const lo = this.fetch(), hi = this.fetch(); this.shStore(lo, hi, this.y, this.x); break; }
      case 0x9C: { const lo = this.fetch(), hi = this.fetch(); this.shStore(lo, hi, this.x, this.y); break; }
      case 0x9B: {
        const lo = this.fetch(), hi = this.fetch();
        this.s = this.a & this.x;
        this.shStore(lo, hi, this.y, this.s);
        break;
      }
      case 0x93: {
        const z = this.fetch();
        const lo = b.read(z), hi = b.read((z + 1) & 0xFF);
        this.shStore(lo, hi, this.y, this.a & this.x);
        break;
      }
      case 0xBB:
        ea = this.absR(this.y);
        this.nz(this.a = this.x = this.s = b.read(ea) & this.s);
        break;

      default:
        this.jammed = true;
        this.pc = (this.pc - 1) & 0xFFFF;
        return;
    }

    if (this.nmiSample) {
      this.nmiEdge = false;
      this.interrupt(0xFFFA);
    } else if (this.irqSample && !(iPoll >= 0 ? iPoll : this.i)) {
      this.interrupt(0xFFFE);
    }
  }
}
