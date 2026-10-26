// Derived from VICE src/vic20/vic20sound.c, written by Rami Rasanen and
// Ville-Matias Heikkila, Copyright (C) The VICE Team.
// Ported to JavaScript and modified for Viccy H20, 2026. GPL v2 or later, see LICENSE.

import { NOISE_PATTERN, VOLTAGE_FUNCTION } from './vicsound-tables.js';

const SPEEDS = [4, 3, 2];

export class VicSound {
  constructor(clockHz, sampleRate) {
    this.clockHz = clockHz;
    this.out = new Float32Array(16384);
    this.outLen = 0;
    this.enabled = true;
    this.setSampleRate(sampleRate || 48000);
    this.reset(0);
  }

  setSampleRate(rate) {
    this.sampleRate = rate;
    this.cps = this.clockHz / rate;
    this.lowBeta = 1 - this.cps / (this.cps + 62);
    this.highBeta = 1 - this.cps / (this.cps + 0.04);
  }

  setRateTrim(factor) {
    this.cps = (this.clockHz / this.sampleRate) * factor;
  }

  reset(cycle) {
    this.reg = new Uint8Array(4);
    this.shift = new Uint8Array(4);
    this.chOut = new Uint8Array(4);
    this.ctr = new Int32Array(4);
    this.noiseCtr = 0;
    this.volume = 0;
    this.accum = 0;
    this.accumCycles = 0;
    this.leftover = 0;
    this.lowBuf = 0;
    this.highBuf = 0;
    this.lastOut = 0;
    this.lastCycle = cycle || 0;
  }

  write(reg, v, cycle) {
    this.update(cycle);
    switch (reg) {
      case 10: case 11: case 12: case 13: this.reg[reg - 10] = v; break;
      case 14: this.volume = v & 0x0F; break;
      default: break;
    }
  }

  update(cycle) {
    let delta = cycle - this.lastCycle;
    if (delta <= 0) return;
    this.lastCycle = cycle;
    if (!this.enabled) return;

    while (delta >= this.cps - this.leftover) {
      const todo = Math.floor(this.cps - this.leftover);
      this.leftover += todo - this.cps;
      this.clock(todo);
      let o = this.lastOut;
      if (this.accumCycles > 0) {
        o = VOLTAGE_FUNCTION[(Math.floor((this.accum * 7) / this.accumCycles) + 1) * this.volume];
      }
      o = this.lowBuf * this.lowBeta + o * (1 - this.lowBeta);
      this.lowBuf = o;
      o -= this.highBuf;
      this.highBuf += o * this.highBeta;
      this.lastOut = o;
      if (this.outLen === this.out.length) this.grow();
      this.out[this.outLen++] = o < -32768 ? -1 : o > 32767 ? 1 : o / 32768;
      this.accum = 0;
      this.accumCycles = 0;
      delta -= todo;
    }
    if (delta > 0) {
      this.leftover += delta;
      this.clock(delta);
    }
  }

  grow() {
    const n = new Float32Array(this.out.length * 2);
    n.set(this.out);
    this.out = n;
  }

  take() {
    const v = this.out.subarray(0, this.outLen);
    this.outLen = 0;
    return v;
  }

  clock(cycles) {
    const reg = this.reg, ctr = this.ctr, chOut = this.chOut, shift = this.shift;
    let accum = 0;

    for (let j = 0; j < 4; j++) {
      let c = cycles;
      let out = chOut[j];
      let t = ctr[j];
      const speed = j < 3 ? SPEEDS[j] : 4;
      while (c > 0) {
        if (t > c) { accum += out * c; t -= c; break; }
        const k = t > 0 ? t : 1;
        accum += out * (k - 1);
        c -= k;
        t -= k;
        const r = reg[j];
        let a = (~r) & 127;
        if (a === 0) a = 128;
        t += a << speed;
        if (j < 3) {
          if (r & 128) {
            const s = shift[j];
            const ns = (((s << 1) | ((s & 128) >> 7)) ^ 1) & 0xFF;
            shift[j] = ns;
            out = ns & 1;
          } else {
            shift[j] = (shift[j] << 1) & 0xFF;
            out = 0;
          }
        } else {
          out = (r & 128)
            ? (NOISE_PATTERN[(this.noiseCtr >> 3) & 1023] >> (this.noiseCtr & 7)) & 1
            : 0;
          this.noiseCtr = (this.noiseCtr + 1) & 0xFFFF;
        }
        accum += out;
      }
      chOut[j] = out;
      ctr[j] = t;
    }

    this.accum += accum;
    this.accumCycles += cycles;
  }
}
