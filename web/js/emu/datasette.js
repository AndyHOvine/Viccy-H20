const PULSE_WIDTH = 8;

export class Datasette {
  constructor() {
    this.data = null;
    this.version = 0;
    this.pos = 0;
    this.playing = false;
    this.motor = false;
    this.countdown = 0;
    this.pulseLow = 0;
    this.onRead = null;
    this.onSense = null;
    this.recording = false;
    this.recordBuf = null;
    this.lastEdge = -1;
  }

  record() {
    this.data = null;
    this.recordBuf = [];
    this.lastEdge = -1;
    this.recording = true;
    this.playing = true;
    if (this.onSense) this.onSense();
  }

  writeEdge(cycle) {
    if (!this.recording || !this.motor) return;
    if (this.lastEdge >= 0) {
      const d = cycle - this.lastEdge;
      if (d < 0x800) this.recordBuf.push(Math.max(1, d >> 3));
      else this.recordBuf.push(0, d & 0xFF, (d >> 8) & 0xFF, (d >> 16) & 0xFF);
    }
    this.lastEdge = cycle;
  }

  finishRecording() {
    this.recording = false;
    this.playing = false;
    const body = Uint8Array.from(this.recordBuf || []);
    const out = new Uint8Array(20 + body.length);
    out.set(Array.from('C64-TAPE-RAW', (c) => c.charCodeAt(0)));
    out[12] = 1;
    out[13] = 1;
    out[16] = body.length & 0xFF; out[17] = (body.length >> 8) & 0xFF;
    out[18] = (body.length >> 16) & 0xFF; out[19] = (body.length >> 24) & 0xFF;
    out.set(body, 20);
    this.recordBuf = null;
    this.insert(out);
    if (this.onSense) this.onSense();
    return out;
  }

  insert(bytes) {
    const sig = String.fromCharCode(...bytes.subarray(0, 12));
    if (sig !== 'C64-TAPE-RAW' && sig !== 'C16-TAPE-RAW') throw new Error('Not a TAP image');
    this.version = bytes[12];
    const size = bytes[16] | (bytes[17] << 8) | (bytes[18] << 16) | (bytes[19] << 24);
    this.data = bytes.subarray(20, Math.min(bytes.length, 20 + (size || bytes.length)));
    this.machine = bytes[13];
    this.video = bytes[14];
    this.rewind();
  }

  eject() {
    this.stop();
    this.data = null;
  }

  rewind() {
    this.pos = 0;
    this.countdown = 0;
  }

  play() {
    if (!this.data) return;
    if (this.pos >= this.data.length) this.rewind();
    this.playing = true;
    if (this.onSense) this.onSense();
  }

  stop() {
    this.playing = false;
    if (this.onSense) this.onSense();
  }

  get running() { return this.playing && this.motor && this.data !== null && !this.recording; }

  get present() { return this.data !== null || this.recording; }

  get progress() { return this.data ? this.pos / this.data.length : 0; }

  nextPulse() {
    const d = this.data;
    if (this.pos >= d.length) return 0;
    let v = d[this.pos++];
    if (v !== 0) return v * 8;
    if (this.version === 0) return 256 * 8;
    if (this.pos + 3 > d.length) { this.pos = d.length; return 0; }
    v = d[this.pos] | (d[this.pos + 1] << 8) | (d[this.pos + 2] << 16);
    this.pos += 3;
    return v || 1;
  }

  tick() {
    if (this.pulseLow && --this.pulseLow === 0) this.onRead(1);
    if (--this.countdown > 0) return;
    const n = this.nextPulse();
    if (n === 0) {
      this.stop();
      return;
    }
    this.countdown = n;
    this.onRead(0);
    this.pulseLow = PULSE_WIDTH;
  }
}
