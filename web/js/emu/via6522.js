const IFR_CA2 = 0x01, IFR_CA1 = 0x02, IFR_SR = 0x04, IFR_CB2 = 0x08;
const IFR_CB1 = 0x10, IFR_T2 = 0x20, IFR_T1 = 0x40;

const noop = () => {};
const high = () => 0xFF;

export class Via6522 {
  constructor() {
    this.readPA = high;
    this.readPB = high;
    this.onPA = noop;
    this.onPB = noop;
    this.onCA2 = noop;
    this.onCB2 = noop;
    this.onIrq = noop;
    this.reset();
  }

  reset() {
    this.ora = 0; this.orb = 0; this.ddra = 0; this.ddrb = 0;
    this.ira = 0xFF; this.irb = 0xFF;
    this.t1c = 0xFFFF; this.t1l = 0xFFFF; this.t1Loaded = false; this.t1Reload = false;
    this.t1Armed = false; this.pb7 = 0x80;
    this.t2c = 0xFFFF; this.t2ll = 0xFF; this.t2Loaded = false; this.t2Armed = false;
    this.sr = 0; this.srCount = 0; this.srActive = false; this.srClock = 1;
    this.acr = 0; this.pcr = 0; this.ifr = 0; this.ier = 0;
    this.ca1 = 1; this.ca2 = 1; this.cb1 = 1; this.cb2 = 1;
    this.ca2Pulse = 0; this.cb2Pulse = 0;
    this.pb6 = 1;
    this.irqOut = false;
    this.onCA2(1); this.onCB2(1);
    this.onPA(this.driveA());
    this.onPB(this.driveB());
    this.onIrq(false);
  }

  driveA() { return (this.ora | ~this.ddra) & 0xFF; }
  driveB() {
    let v = (this.orb | ~this.ddrb) & 0xFF;
    if (this.acr & 0x80) v = (v & 0x7F) | this.pb7;
    return v;
  }

  updateIrq() {
    const on = (this.ifr & this.ier & 0x7F) !== 0;
    if (on !== this.irqOut) {
      this.irqOut = on;
      this.onIrq(on);
    }
  }

  setIfr(bits) { this.ifr |= bits; this.updateIrq(); }
  clearIfr(bits) { this.ifr &= ~bits; this.updateIrq(); }

  setCA2(level) {
    if (level !== this.ca2) {
      this.ca2 = level;
      this.onCA2(level);
    }
  }

  setCB2(level) {
    if (level !== this.cb2) {
      this.cb2 = level;
      this.onCB2(level);
    }
  }

  setCA1(level) {
    level = level ? 1 : 0;
    if (level === this.ca1) return;
    this.ca1 = level;
    if (level === (this.pcr & 0x01)) {
      if (this.acr & 0x01) this.ira = this.readPA(this.driveA());
      this.setIfr(IFR_CA1);
      if (((this.pcr >> 1) & 7) === 4) this.setCA2(1);
    }
  }

  setCB1(level) {
    level = level ? 1 : 0;
    if (level === this.cb1) return;
    this.cb1 = level;
    if (level === ((this.pcr >> 4) & 0x01)) {
      if (this.acr & 0x02) this.irb = this.readPB(this.driveB());
      this.setIfr(IFR_CB1);
      if (((this.pcr >> 5) & 7) === 4) this.setCB2(1);
    }
    if (level === 1 && this.srActive && (this.acr & 0x0C) === 0x0C) this.shiftBit();
  }

  inputCA2(level) {
    const mode = (this.pcr >> 1) & 7;
    if (mode >= 4) return;
    level = level ? 1 : 0;
    if (level === this.ca2) return;
    this.ca2 = level;
    if (level === ((mode >> 1) & 1)) this.setIfr(IFR_CA2);
  }

  inputCB2(level) {
    const mode = (this.pcr >> 5) & 7;
    if (mode >= 4) return;
    level = level ? 1 : 0;
    if (level === this.cb2) return;
    this.cb2 = level;
    if (level === ((mode >> 1) & 1)) this.setIfr(IFR_CB2);
  }

  setPB6(level) {
    level = level ? 1 : 0;
    if (level === this.pb6) return;
    this.pb6 = level;
    if (level === 0 && (this.acr & 0x20)) {
      if (this.t2c === 0 && this.t2Armed) { this.t2Armed = false; this.setIfr(IFR_T2); }
      this.t2c = (this.t2c - 1) & 0xFFFF;
    }
  }

  tick() {
    if (this.t1Loaded) {
      this.t1Loaded = false;
    } else if (this.t1Reload) {
      this.t1Reload = false;
      this.t1c = this.t1l;
    } else if (this.t1c === 0) {
      this.t1c = 0xFFFF;
      if (this.acr & 0x40) {
        this.t1Reload = true;
        this.setIfr(IFR_T1);
        if (this.acr & 0x80) { this.pb7 ^= 0x80; this.onPB(this.driveB()); }
      } else if (this.t1Armed) {
        this.t1Armed = false;
        this.setIfr(IFR_T1);
        if (this.acr & 0x80) { this.pb7 = 0x80; this.onPB(this.driveB()); }
      }
    } else {
      this.t1c--;
    }

    if (this.t2Loaded) {
      this.t2Loaded = false;
    } else if (!(this.acr & 0x20)) {
      if (this.t2c === 0) {
        if (this.t2Armed) { this.t2Armed = false; this.setIfr(IFR_T2); }
        this.t2c = 0xFFFF;
      } else {
        this.t2c--;
      }
      if (this.srActive && ((this.acr >> 2) & 3) === 1 && (this.t2c & 0xFF) === 0xFF) {
        this.t2c = (this.t2c & 0xFF00) | this.t2ll;
        this.srToggle();
      }
    }

    if (this.srActive && ((this.acr >> 2) & 3) === 2) this.srToggle();

    if (this.ca2Pulse && --this.ca2Pulse === 0) this.setCA2(1);
    if (this.cb2Pulse && --this.cb2Pulse === 0) this.setCB2(1);
  }

  srToggle() {
    this.srClock ^= 1;
    if (this.srClock) this.shiftBit();
  }

  shiftBit() {
    const out = this.acr & 0x10;
    if (out) {
      const bit = this.sr >> 7;
      this.sr = ((this.sr << 1) | bit) & 0xFF;
      this.setCB2(bit);
    } else {
      this.sr = ((this.sr << 1) | this.cb2) & 0xFF;
    }
    if (((this.acr >> 2) & 7) === 4) return;
    if (++this.srCount === 8) {
      this.srCount = 0;
      this.srActive = false;
      this.setIfr(IFR_SR);
    }
  }

  startShift() {
    this.srCount = 0;
    this.srClock = 1;
    this.srActive = ((this.acr >> 2) & 7) !== 0;
  }

  portAAccess() {
    const mode = (this.pcr >> 1) & 7;
    if (mode === 4) this.setCA2(0);
    else if (mode === 5) { this.setCA2(0); this.ca2Pulse = 1; }
    this.clearIfr((mode === 1 || mode === 3) ? IFR_CA1 : (IFR_CA1 | IFR_CA2));
  }

  read(reg) {
    switch (reg & 0x0F) {
      case 0x0: {
        const mode = (this.pcr >> 5) & 7;
        this.clearIfr((mode === 1 || mode === 3) ? IFR_CB1 : (IFR_CB1 | IFR_CB2));
        const pins = (this.acr & 0x02) ? this.irb : this.readPB(this.driveB());
        let v = (this.orb & this.ddrb) | (pins & ~this.ddrb);
        if (this.acr & 0x80) v = (v & 0x7F) | this.pb7;
        return v & 0xFF;
      }
      case 0x1:
        this.portAAccess();
        return (this.acr & 0x01) ? this.ira : this.readPA(this.driveA());
      case 0x2: return this.ddrb;
      case 0x3: return this.ddra;
      case 0x4: this.clearIfr(IFR_T1); return this.t1c & 0xFF;
      case 0x5: return this.t1c >> 8;
      case 0x6: return this.t1l & 0xFF;
      case 0x7: return this.t1l >> 8;
      case 0x8: this.clearIfr(IFR_T2); return this.t2c & 0xFF;
      case 0x9: return this.t2c >> 8;
      case 0xA: this.clearIfr(IFR_SR); this.startShift(); return this.sr;
      case 0xB: return this.acr;
      case 0xC: return this.pcr;
      case 0xD: return this.ifr | (this.irqOut ? 0x80 : 0);
      case 0xE: return this.ier | 0x80;
      default: return (this.acr & 0x01) ? this.ira : this.readPA(this.driveA());
    }
  }

  peek(reg) {
    switch (reg & 0x0F) {
      case 0x4: return this.t1c & 0xFF;
      case 0x8: return this.t2c & 0xFF;
      case 0xD: return this.ifr | (this.irqOut ? 0x80 : 0);
      default: return 0;
    }
  }

  write(reg, v) {
    switch (reg & 0x0F) {
      case 0x0: {
        const mode = (this.pcr >> 5) & 7;
        this.orb = v;
        if (mode === 4) this.setCB2(0);
        else if (mode === 5) { this.setCB2(0); this.cb2Pulse = 1; }
        this.clearIfr((mode === 1 || mode === 3) ? IFR_CB1 : (IFR_CB1 | IFR_CB2));
        this.onPB(this.driveB());
        break;
      }
      case 0x1:
        this.ora = v;
        this.portAAccess();
        this.onPA(this.driveA());
        break;
      case 0x2: this.ddrb = v; this.onPB(this.driveB()); break;
      case 0x3: this.ddra = v; this.onPA(this.driveA()); break;
      case 0x4: case 0x6: this.t1l = (this.t1l & 0xFF00) | v; break;
      case 0x5:
        this.t1l = (this.t1l & 0xFF) | (v << 8);
        this.t1c = this.t1l;
        this.t1Loaded = true;
        this.t1Reload = false;
        this.t1Armed = true;
        this.clearIfr(IFR_T1);
        if (this.acr & 0x80) { this.pb7 = 0; this.onPB(this.driveB()); }
        break;
      case 0x7:
        this.t1l = (this.t1l & 0xFF) | (v << 8);
        this.clearIfr(IFR_T1);
        break;
      case 0x8: this.t2ll = v; break;
      case 0x9:
        this.t2c = this.t2ll | (v << 8);
        this.t2Loaded = true;
        this.t2Armed = true;
        this.clearIfr(IFR_T2);
        break;
      case 0xA:
        this.sr = v;
        this.clearIfr(IFR_SR);
        this.startShift();
        break;
      case 0xB: {
        const old = this.acr;
        this.acr = v;
        if ((old ^ v) & 0x80) this.onPB(this.driveB());
        if (!((v >> 2) & 7)) this.srActive = false;
        break;
      }
      case 0xC: {
        this.pcr = v;
        const ca2m = (v >> 1) & 7, cb2m = (v >> 5) & 7;
        if (ca2m === 6) this.setCA2(0); else if (ca2m === 7) this.setCA2(1);
        else if (ca2m < 4) this.setCA2(1);
        if (cb2m === 6) this.setCB2(0); else if (cb2m === 7) this.setCB2(1);
        else if (cb2m < 4) this.setCB2(1);
        break;
      }
      case 0xD: this.clearIfr(v & 0x7F); break;
      case 0xE:
        if (v & 0x80) this.ier |= v & 0x7F; else this.ier &= ~v & 0x7F;
        this.updateIrq();
        break;
      default:
        this.ora = v;
        this.onPA(this.driveA());
        break;
    }
  }
}
