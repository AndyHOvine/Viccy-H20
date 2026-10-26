export class Audio {
  constructor() {
    this.ctx = null;
    this.node = null;
    this.gain = null;
    this.level = 0;
    this.volume = 0.7;
    this.muted = false;
    this.sampleRate = 48000;
    this.ready = false;
  }

  async start() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') await this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC({ latencyHint: 'interactive' });
    this.sampleRate = this.ctx.sampleRate;
    try {
      await this.ctx.audioWorklet.addModule(new URL('./audio-worklet.js', import.meta.url));
    } catch (e) {
      console.warn('AudioWorklet unavailable; sound disabled', e);
      return;
    }
    this.node = new AudioWorkletNode(this.ctx, 'viccy-audio', { outputChannelCount: [2] });
    this.node.port.onmessage = (e) => { this.level = e.data; };
    this.gain = this.ctx.createGain();
    this.applyVolume();
    this.node.connect(this.gain).connect(this.ctx.destination);
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    this.ready = true;
    if (this.onReady) this.onReady(this.sampleRate);
  }

  applyVolume() {
    if (this.gain) this.gain.gain.value = this.muted ? 0 : this.volume;
  }

  setVolume(v) { this.volume = Math.max(0, Math.min(1, v)); this.applyVolume(); }
  setMuted(m) { this.muted = !!m; this.applyVolume(); }

  push(samples) {
    if (!this.ready || samples.length === 0) return;
    this.node.port.postMessage(samples.slice());
  }

  clear() {
    if (this.ready) this.node.port.postMessage('clear');
    this.level = 0;
  }

  suspend() { if (this.ctx) this.ctx.suspend(); }
  resume() { if (this.ctx && this.ready) this.ctx.resume(); }

  trim(target) {
    const err = (this.level - target) / target;
    return 1 + Math.max(-0.005, Math.min(0.005, err * 0.01));
  }
}
