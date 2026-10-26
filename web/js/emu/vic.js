const FETCH_OUTSIDE_MATRIX = 0;
const FETCH_IN_MATRIX_Y = 1;
const FETCH_IN_MATRIX_X = 2;
const FETCH_MATRIX_LINE = 3;
const FETCH_MATRIX_DLY_1 = 5;
const FETCH_MATRIX_DLY_2 = 6;
const FETCH_MATRIX_DLY_3 = 7;
const FETCH_SCREEN_CODE = 8;
const FETCH_CHAR_DATA = 9;
const FETCH_MATRIX_END = 10;

const PAL_HBLANK_END = 12;
const PAL_HBLANK_START = 70;
const PAL_VSYNC_START = 4;
const PAL_VSYNC_END = 6;
const PAL_VBLANK_END = 9;
const PAL_LAST_LINE = 311;
const PAL_LINE_BLANK = 3 + 20 + 3 + 17 + 4;
const PAL_FRONTPORCH_1 = 4;

const NTSC_HBLANK_END = 9;
const NTSC_HBLANK_START = 59;
const NTSC_VSYNC_START = 4;
const NTSC_VSYNC_END = 6;
const NTSC_VBLANK_END = 9;
const NTSC_NORM_LAST_LINE = 261;
const NTSC_INTL_LAST_LINE = 262;
const NTSC_FRONTPORCH_1 = 12;
const NTSC_LINE_BLANK = 4 + 20 + 2 + 20 + 2;

export const VIC_TIMING = {
  pal: {
    clock: 1108405, cyclesPerLine: 71, linesPerFrame: 312, lineWidth: 284,
    visibleX: 47, visibleW: 233, visibleY: 9, visibleH: 303,
  },
  ntsc: {
    clock: 1022727, cyclesPerLine: 65, linesPerFrame: 261, lineWidth: 260,
    visibleX: 48, visibleW: 200, visibleY: 8, visibleH: 253,
  },
};

export class Vic {
  constructor(bus, sound, ntsc) {
    this.bus = bus;
    this.sound = sound;
    this.ntsc = !!ntsc;
    this.timing = this.ntsc ? VIC_TIMING.ntsc : VIC_TIMING.pal;
    this.lineWidth = this.timing.lineWidth;
    this.fb = new Uint8Array(this.lineWidth * (this.timing.linesPerFrame + 2));
    this.fbLen = this.fb.length;
    this.regs = new Uint8Array(16);
    this.mct = new Uint8Array(4);
    this.lightPenLatched = false;
    this.reset();
  }

  reset() {
    this.hc = 0; this.prevHc = 0; this.vc = 0;
    this.pos = 0;
    this.hcc = 0; this.vcc = 0; this.cdc = 0;
    this.vmc = 0; this.vml = 0;
    this.hlc = 0;
    this.cellIndex = 0;
    this.fetchState = FETCH_OUTSIDE_MATRIX;
    this.p1 = this.p2 = this.p3 = this.p4 = this.p5 = this.p6 = this.p7 = this.p8 = 1;
    this.hires = false;
    this.colourData = 0x08;
    this.charData = this.charDataLatch = 0x55;
    this.mct.fill(0);
    this.vblanking = false;
    this.doVblank = 0;
    this.regs.fill(0);
    this.regs[8] = this.regs[9] = 0xFF;
    this.decode();
  }

  decode() {
    const r = this.regs;
    this.borderIdx = r[15] & 0x07;
    this.bgIdx = r[15] >> 4;
    this.auxIdx = r[14] >> 4;
    this.nonReverse = r[15] & 0x08;
    this.interlaced = r[0] & 0x80;
    this.originX = r[0] & 0x7F;
    this.originY = r[1];
    this.numCols = r[2] & 0x7F;
    this.numRows = (r[3] & 0x7E) >> 1;
    const dbl = r[3] & 0x01;
    this.lastLineOfCell = 7 | (dbl << 3);
    this.charShift = 3 + dbl;
    this.screenBase = ((r[5] & 0xF0) << 6) | ((r[2] & 0x80) << 2);
    this.charBase = (r[5] & 0x0F) << 10;
  }

  read(addr) {
    return this.regs[addr & 0x0F];
  }

  write(addr, v, cycle) {
    const reg = addr & 0x0F;
    switch (reg) {
      case 4: case 6: case 7: case 8: case 9: return;
      case 3: this.regs[3] = (this.regs[3] & 0x80) | (v & 0x7F); break;
      default: this.regs[reg] = v; break;
    }
    if (reg >= 10 && reg <= 14) this.sound.write(reg, v, cycle);
    this.decode();
  }

  setPaddles(x, y) {
    this.regs[8] = x & 0xFF;
    this.regs[9] = y & 0xFF;
  }

  triggerLightPen() {
    if (this.lightPenLatched) return;
    this.lightPenLatched = true;
    this.regs[6] = (this.hc * 2) & 0xFF;
    this.regs[7] = (this.vc >> 1) & 0xFF;
  }

  fetchScreen() {
    const addr = (this.screenBase + this.vmc) & 0x3FFF;
    const bank = addr >> 10;
    const bus = this.bus;
    if ((bank >= 4 && bank <= 7) || (bank >= 9 && bank <= 11)) {
      this.cellIndex = bus.lastBus;
    } else {
      this.cellIndex = bus.lastBus = bus.mem[addr < 0x2000 ? addr + 0x8000 : addr - 0x2000];
    }
    this.colourData = bus.mem[0x9400 + (addr & 0x3FF)] & 0x0F;
  }

  fetchChar() {
    const addr = (this.charBase + (this.cellIndex << this.charShift) + this.cdc) & 0x3FFF;
    const bank = addr >> 10;
    const bus = this.bus;
    if ((bank >= 4 && bank <= 7) || (bank >= 9 && bank <= 11)) {
      this.charDataLatch = bus.lastBus;
    } else {
      this.charDataLatch = bus.lastBus = bus.mem[addr < 0x2000 ? addr + 0x8000 : addr - 0x2000];
    }
  }

  simpleAdvance() {
    switch (this.fetchState) {
      case FETCH_OUTSIDE_MATRIX:
        if ((this.vc >> 1) === this.originY) {
          this.fetchState = (this.prevHc === this.originX) ? FETCH_MATRIX_DLY_1 : FETCH_IN_MATRIX_Y;
        }
        break;
      case FETCH_IN_MATRIX_Y:
      case FETCH_MATRIX_LINE:
        if (this.prevHc === this.originX) this.fetchState = FETCH_MATRIX_DLY_1;
        break;
      case FETCH_MATRIX_DLY_1:
      case FETCH_MATRIX_DLY_2:
      case FETCH_MATRIX_DLY_3:
        this.fetchState++;
        break;
      case FETCH_SCREEN_CODE:
        this.fetchState = (this.hcc-- > 0) ? FETCH_CHAR_DATA : FETCH_MATRIX_END;
        break;
      case FETCH_CHAR_DATA:
        this.vmc++;
        this.fetchState = FETCH_SCREEN_CODE;
        break;
      case FETCH_MATRIX_END:
        this.fetchState = FETCH_MATRIX_LINE;
        break;
    }
  }

  checkOutsideMatrix() {
    if ((this.vc >> 1) === this.originY) {
      this.fetchState = (this.prevHc === this.originX) ? FETCH_MATRIX_DLY_1 : FETCH_IN_MATRIX_Y;
    }
  }

  px(c) {
    if (this.pos < this.fbLen) this.fb[this.pos] = c;
    this.pos++;
  }

  resetPixelPipe() {
    this.p1 = this.p2 = this.p3 = this.p4 = this.p5 = this.p6 = this.p7 = this.p8 = 1;
    this.hires = false;
    this.colourData = 0x08;
    this.charData = this.charDataLatch = 0x55;
  }

  updateRasterRegs() {
    this.regs[4] = (this.vc >> 1) & 0xFF;
    if (this.vc & 1) this.regs[3] |= 0x80; else this.regs[3] &= 0x7F;
  }

  newLineLogic() {
    if (this.fetchState >= FETCH_MATRIX_DLY_1) {
      if (this.fetchState === FETCH_CHAR_DATA) this.vmc++;
      this.fetchState = FETCH_MATRIX_LINE;
    }
    if (this.cdc === this.lastLineOfCell || this.cdc === 0xF) {
      this.cdc = 0;
      this.vml = this.vmc;
      if (this.vc > 0) {
        this.vcc--;
        if (this.vcc === 0 && this.originX > 0) {
          this.fetchState = FETCH_OUTSIDE_MATRIX;
        } else if (this.prevHc === this.originX) {
          this.fetchState = FETCH_MATRIX_DLY_1;
        }
      }
    } else if (this.fetchState >= FETCH_MATRIX_LINE) {
      if (this.vcc > 0) {
        this.cdc++;
        if (this.prevHc === this.originX) this.fetchState = FETCH_MATRIX_DLY_1;
      } else {
        this.fetchState = FETCH_OUTSIDE_MATRIX;
      }
    } else if (this.fetchState === FETCH_IN_MATRIX_Y) {
      if (this.prevHc === this.originX) this.fetchState = FETCH_IN_MATRIX_X;
    } else if (this.ntsc && this.fetchState === FETCH_OUTSIDE_MATRIX) {
      this.checkOutsideMatrix();
    }
  }

  hc2() {
    if (this.fetchState === FETCH_IN_MATRIX_X) this.fetchState = FETCH_MATRIX_DLY_2;
    else this.simpleAdvance();
    this.vmc = this.vml;
    this.hcc = this.numCols;
  }

  hc3() {
    this.simpleAdvance();
    if (this.vc === 0) this.vcc = this.numRows;
  }

  lastPixel() {
    if (this.hires) {
      const on = (this.charData & 0x01) !== 0;
      return (this.nonReverse ? on : !on) ? 2 : 0;
    }
    return this.charData & 0x03;
  }

  loadChar(full) {
    this.p8 = this.lastPixel();
    this.hires = (this.colourData & 0x08) === 0;
    const d = this.charData = this.charDataLatch;
    if (this.hires) {
      const on = this.nonReverse ? 2 : 0, off = 2 - on;
      this.p1 = (d & 0x80) ? on : off;
      if (full) {
        this.p2 = (d & 0x40) ? on : off;
        this.p3 = (d & 0x20) ? on : off;
      }
    } else {
      this.p1 = (d >> 6) & 0x03;
      if (full) {
        this.p2 = this.p1;
        this.p3 = (d >> 4) & 0x03;
      }
    }
  }

  charPixels() {
    const d = this.charData;
    if (this.hires) {
      const on = this.nonReverse ? 2 : 0, off = 2 - on;
      this.p4 = (d & 0x10) ? on : off;
      this.p5 = (d & 0x08) ? on : off;
      this.p6 = (d & 0x04) ? on : off;
      this.p7 = (d & 0x02) ? on : off;
    } else {
      this.p4 = (d >> 4) & 0x03;
      this.p5 = this.p6 = (d >> 2) & 0x03;
      this.p7 = d & 0x03;
    }
  }

  latchColours() {
    const m = this.mct;
    m[0] = this.bgIdx;
    m[1] = this.borderIdx;
    m[3] = this.auxIdx;
  }

  closeRowPixels(showFirst) {
    const m = this.mct;
    if (showFirst) {
      this.px(m[this.p6]);
      this.px(m[this.p7]);
    }
    this.p8 = this.lastPixel();
    this.hires = false;
    this.colourData = 0x08;
    this.charData = this.charDataLatch = 0x55;
    this.p1 = (this.charData >> 6) & 0x03;
    if (showFirst) this.px(m[this.p8]);
    this.px(m[this.p1]);
    this.p6 = this.p2 = this.p1;
    this.p7 = this.p3 = (this.charData >> 4) & 0x03;
    this.p8 = this.p1 = this.p2 = this.p3 = this.p4 = this.p5 = 1;
  }

  border4(n) {
    const b = this.borderIdx;
    for (let i = 0; i < n; i++) this.px(b);
  }

  cycle() {
    return this.ntsc ? this.cycleNtsc() : this.cyclePal();
  }

  cyclePal() {
    let frame = false;
    const hc = this.hc;

    switch (hc) {
      case 0:
        this.resetPixelPipe();
        this.simpleAdvance();
        this.prevHc = this.hc++;
        break;

      case 1:
        if (this.fetchState === FETCH_OUTSIDE_MATRIX) this.checkOutsideMatrix();
        if (this.vc === PAL_LAST_LINE) {
          this.vc = 0;
          this.fetchState = FETCH_OUTSIDE_MATRIX;
          this.cdc = 0;
        } else {
          this.vc++;
        }
        this.updateRasterRegs();
        if (this.vc === 0 || this.vc > PAL_VBLANK_END) {
          this.pos += PAL_LINE_BLANK;
        } else {
          if (this.vc === 1) {
            this.pos = 0;
            frame = true;
            this.lightPenLatched = false;
          }
          this.pos += this.lineWidth;
          if (this.vc >= PAL_VSYNC_START && this.vc <= PAL_VSYNC_END) this.vml = this.vmc = 0;
        }
        this.newLineLogic();
        this.prevHc = this.hc++;
        break;

      case 2:
        this.hc2();
        this.prevHc = this.hc++;
        break;

      case 3:
        this.hc3();
        this.prevHc = this.hc++;
        break;

      default:
        if (this.vc === 0 || this.vc > PAL_VBLANK_END) {
          if (hc === PAL_HBLANK_START) {
            this.palLineEnd();
            this.pos += PAL_FRONTPORCH_1;
            this.prevHc = this.hc;
            this.hc = 0;
          } else {
            this.visibleCycle(hc, PAL_HBLANK_END, true);
            this.prevHc = this.hc++;
          }
        } else {
          this.simpleAdvance();
          this.prevHc = this.hc;
          if (hc === PAL_HBLANK_START) this.hc = 0; else this.hc++;
        }
        break;
    }
    return frame;
  }

  palLineEnd() {
    const m = this.mct;
    switch (this.fetchState) {
      case FETCH_OUTSIDE_MATRIX:
        this.checkOutsideMatrix();
        this.border4(4);
        break;
      case FETCH_MATRIX_LINE:
        this.latchColours();
        this.px(m[this.p2]); this.px(m[this.p3]); this.px(m[this.p4]); this.px(m[this.p5]);
        break;
      case FETCH_MATRIX_DLY_1:
      case FETCH_MATRIX_DLY_2:
      case FETCH_MATRIX_DLY_3:
        this.fetchState++;
        this.border4(4);
        break;
      case FETCH_IN_MATRIX_Y:
        this.border4(4);
        break;
      case FETCH_SCREEN_CODE:
        this.latchColours();
        this.px(m[this.p6]); this.px(m[this.p7]);
        this.loadChar(false);
        this.px(m[this.p8]);
        m[2] = this.colourData & 0x07;
        this.px(m[this.p1]);
        this.fetchState = (this.hcc-- > 0) ? FETCH_CHAR_DATA : FETCH_MATRIX_END;
        break;
      case FETCH_CHAR_DATA:
      case FETCH_MATRIX_END:
        this.latchColours();
        this.px(m[this.p2]); this.px(m[this.p3]); this.px(m[this.p4]); this.px(m[this.p5]);
        if (this.fetchState === FETCH_MATRIX_END) {
          this.fetchState = FETCH_MATRIX_LINE;
        } else {
          this.vmc++;
          this.fetchState = FETCH_SCREEN_CODE;
        }
        break;
      default:
        break;
    }
  }

  visibleCycle(hc, hblankEnd, pal) {
    const m = this.mct;
    const inView = hc >= hblankEnd;
    const full = pal ? hc > hblankEnd : inView;

    switch (this.fetchState) {
      case FETCH_OUTSIDE_MATRIX:
        this.checkOutsideMatrix();
        if (inView) this.border4(full ? 4 : 1);
        break;

      case FETCH_IN_MATRIX_Y:
      case FETCH_MATRIX_LINE:
        if (inView) {
          this.latchColours();
          this.closeRowPixels(full);
          if (this.prevHc === this.originX) this.fetchState = FETCH_MATRIX_DLY_1;
        } else if (this.prevHc === this.originX) {
          this.fetchState = FETCH_MATRIX_DLY_1;
        }
        break;

      case FETCH_MATRIX_DLY_1:
      case FETCH_MATRIX_DLY_2:
      case FETCH_MATRIX_DLY_3:
        if (inView) this.border4(full ? 4 : 1);
        else this.p2 = this.p3 = this.p4 = this.p5 = this.p6 = this.p7 = this.p8 = 1;
        this.hires = false;
        this.colourData = 0x08;
        this.charDataLatch = 0x55;
        this.fetchState++;
        break;

      case FETCH_SCREEN_CODE:
        this.latchColours();
        if (full) { this.px(m[this.p6]); this.px(m[this.p7]); }
        this.loadChar(true);
        if (full) this.px(m[this.p8]);
        m[2] = this.colourData & 0x07;
        this.fetchScreen();
        if (inView) this.px(m[this.p1]);
        this.fetchState = (this.hcc-- > 0) ? FETCH_CHAR_DATA : FETCH_MATRIX_END;
        break;

      case FETCH_CHAR_DATA:
      case FETCH_MATRIX_END:
        this.latchColours();
        if (full) { this.px(m[this.p2]); this.px(m[this.p3]); }
        this.fetchChar();
        this.charPixels();
        if (inView) {
          if (full) this.px(m[this.p4]);
          this.px(m[this.p5]);
        }
        if (this.fetchState === FETCH_MATRIX_END) {
          this.fetchState = FETCH_MATRIX_LINE;
        } else {
          this.vmc++;
          this.fetchState = FETCH_SCREEN_CODE;
        }
        break;

      default:
        break;
    }
  }

  ntscVblank(long) {
    this.pos += this.lineWidth;
    if (long) this.vml = this.vmc = 0;
  }

  cycleNtsc() {
    let frame = false;
    const hc = this.hc;

    switch (hc) {
      case 0:
        this.resetPixelPipe();
        this.simpleAdvance();
        if (this.vc === 1) {
          this.pos = 0;
          frame = true;
          this.lightPenLatched = false;
        }
        this.prevHc = this.hc++;
        return frame;

      case 1:
        this.newLineLogic();
        this.prevHc = this.hc++;
        return frame;

      case 2:
        this.hc2();
        this.prevHc = this.hc++;
        return frame;

      case 3:
        this.hc3();
        this.prevHc = this.hc++;
        return frame;

      case 62:
        this.ntscHc62();
        this.simpleAdvance();
        this.prevHc = this.hc++;
        return frame;

      case 60:
      case 61:
      case 63:
        this.simpleAdvance();
        this.prevHc = this.hc++;
        return frame;

      case 64:
        this.simpleAdvance();
        this.prevHc = this.hc;
        this.hc = 0;
        return frame;

      case 29:
        this.ntscHc29();
        break;

      default:
        break;
    }

    if (!this.vblanking) {
      if (hc === NTSC_HBLANK_START) {
        this.simpleAdvance();
        this.pos += NTSC_FRONTPORCH_1;
      } else {
        this.visibleCycle(hc, NTSC_HBLANK_END, false);
      }
    } else {
      this.simpleAdvance();
      if (this.doVblank) {
        this.ntscVblank(this.doVblank === 1);
        this.doVblank = 0;
      }
    }
    this.prevHc = this.hc++;
    return frame;
  }

  ntscHc62() {
    if (this.interlaced) {
      if (this.vc >= NTSC_INTL_LAST_LINE && this.hlc === 0) {
        this.vc = 0;
        this.fetchState = FETCH_OUTSIDE_MATRIX;
        this.cdc = 0;
        this.hlc = 0;
        this.regs[4] = 0;
        this.regs[3] &= 0x7F;
      } else {
        this.hlc ^= 1;
      }
    } else if (this.vc === NTSC_NORM_LAST_LINE) {
      this.vc = 0;
      this.fetchState = FETCH_OUTSIDE_MATRIX;
      this.cdc = 0;
      this.hlc = 0;
      this.regs[4] = 0;
      this.regs[3] &= 0x7F;
    } else {
      this.hlc ^= 1;
    }

    if (this.hlc === 0) {
      if (this.vc > 0 && this.vc <= NTSC_VBLANK_END) {
        this.vblanking = true;
        this.ntscVblank(this.vc >= NTSC_VSYNC_START && this.vc <= NTSC_VSYNC_END);
      } else {
        this.vblanking = false;
      }
    }
    if (!this.vblanking) this.pos += NTSC_LINE_BLANK;
  }

  ntscHc29() {
    if (this.interlaced && this.vc === NTSC_INTL_LAST_LINE && this.hlc === 0) {
      this.vc = 0;
      this.fetchState = FETCH_OUTSIDE_MATRIX;
      this.cdc = 0;
      this.hlc = 0;
    } else {
      this.vc++;
      this.hlc ^= 1;
    }
    this.updateRasterRegs();
    if (this.hlc === 0) {
      if (this.vc > 0 && this.vc <= NTSC_VBLANK_END) {
        this.vblanking = true;
        if (this.vc >= NTSC_VSYNC_START && this.vc <= NTSC_VSYNC_END) {
          this.doVblank = 1;
          this.vml = this.vmc = 0;
        } else {
          this.doVblank = 2;
        }
      } else {
        this.vblanking = false;
      }
    }
  }
}
