class ViccyAudio extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buf = new Float32Array(32768);
    this.read = 0;
    this.write = 0;
    this.count = 0;
    this.last = 0;
    this.frames = 0;
    this.port.onmessage = (e) => {
      const d = e.data;
      if (d === 'clear') { this.read = this.write = this.count = 0; return; }
      const n = d.length, buf = this.buf, size = buf.length;
      for (let i = 0; i < n; i++) {
        if (this.count === size) { this.read = (this.read + 1) % size; this.count--; }
        buf[this.write] = d[i];
        this.write = (this.write + 1) % size;
        this.count++;
      }
    };
  }

  process(inputs, outputs) {
    const out = outputs[0];
    const ch0 = out[0];
    const buf = this.buf, size = buf.length;
    for (let i = 0; i < ch0.length; i++) {
      if (this.count > 0) {
        this.last = buf[this.read];
        this.read = (this.read + 1) % size;
        this.count--;
      } else {
        this.last *= 0.995;
      }
      ch0[i] = this.last;
    }
    for (let c = 1; c < out.length; c++) out[c].set(ch0);
    if (++this.frames % 8 === 0) this.port.postMessage(this.count);
    return true;
  }
}

registerProcessor('viccy-audio', ViccyAudio);
