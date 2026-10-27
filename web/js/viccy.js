import { Vic20, MEMORY_PRESETS, memoryForLoadAddress } from './emu/vic20.js';
import { D64 } from './emu/d64.js';
import { expand, toPrg, parseCartridge } from './emu/media.js';
import { Renderer, CRT_DEFAULTS } from './host/renderer.js';
import { FILTER_DEFAULTS } from './host/crtfilter.js';
import { Audio } from './host/audio.js';
import { Input, DEFAULT_JOY_KEYS } from './host/input.js';
import { createUi } from './host/ui.js';
import { SaveStates } from './host/savestates.js';
import { paletteRgb } from './host/palettes.js';

export const DEFAULTS = {
  romPath: 'roms/',
  model: 'pal',
  memory: 'auto',
  media: {},
  autostart: true,
  autostartFile: '*',
  autostartMode: 'absolute',
  type: '',
  drive: { enabled: 'auto', mode: 'accurate' },
  warp: { auto: true },
  joystick: { keyboard: true, keys: DEFAULT_JOY_KEYS, gamepad: true, buttons: {} },
  keyboardMap: 'symbolic',
  paddles: false,
  video: { crt: true, filter: true, palette: 'mike-pal', border: 'normal', aspect: 'tv', integerScale: false },
  audio: { volume: 0.7, muted: false },
  ui: {
    toolbar: true, settings: true, minimal: false, clickToStart: true, touchControls: 'auto',
    title: 'VIC-20', allowFileDrop: true, touchKeys: ['F1', 'F3', 'F5', 'F7', 'SPACE', 'RETURN', 'Y', 'N'],
    touchStick: ['up', 'down', 'left', 'right'], touchFire: ['fire'], touchSlide: false,
    saveStates: true,
  },
  hotkeys: { joystickToggle: 'F9', warp: 'F10', fullscreen: 'F11', reset: '', saveState: 'Shift+F9', loadState: 'Shift+F10' },
  persist: true,
  persistShared: true,
  urlParams: true,
};

const PREF_KEYS = ['crt', 'filter', 'joyKeyMap', 'palette', 'border', 'aspect', 'integerScale', 'volume', 'muted', 'joyKeys', 'keyboardMap',
  'touchSlide', 'touchLayout'];

const SHARED_PREF_KEYS = ['crt', 'filter', 'palette', 'border', 'aspect', 'integerScale', 'volume', 'muted', 'joyKeys', 'keyboardMap'];
const SHARED_PREFS_KEY = 'viccy:shared';

function merge(base, over) {
  const out = Array.isArray(base) ? base.slice() : { ...base };
  for (const [k, v] of Object.entries(over || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && base && typeof base[k] === 'object' && !Array.isArray(base[k])) {
      out[k] = merge(base[k], v);
    } else if (v !== undefined) {
      out[k] = v;
    }
  }
  return out;
}

async function fetchBytes(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not load ${url} (${res.status})`);
  return new Uint8Array(await res.arrayBuffer());
}

function fingerprint(bytes) {
  let h = 0x811C9DC5;
  for (let i = 0; i < bytes.length; i++) h = Math.imul(h ^ bytes[i], 0x01000193);
  return (h >>> 0).toString(16).padStart(8, '0') + bytes.length.toString(16);
}

function fileName(url) {
  return decodeURIComponent(String(url).split(/[?#]/)[0].split('/').pop());
}

function touchKeyList(s) {
  return s.toLowerCase() === 'none' ? [] : s.split(',').map((k) => k.trim()).filter(Boolean);
}

function urlOptions() {
  const p = new URLSearchParams(location.search);
  const o = {};
  const media = {};
  for (const k of ['disk', 'tape', 'prg', 'file']) if (p.has(k)) media[k] = p.get(k);
  if (p.has('cart')) media.carts = p.getAll('cart');
  if (Object.keys(media).length) o.media = media;
  if (p.has('model')) o.model = p.get('model');
  if (p.has('memory')) o.memory = p.get('memory');
  if (p.has('crt') || p.has('palette') || p.has('filter') || p.has('border')) {
    o.video = {};
    if (p.has('crt')) o.video.crt = p.get('crt') !== '0';
    if (p.has('filter')) o.video.filter = p.get('filter') !== '0';
    if (p.has('palette')) o.video.palette = p.get('palette');
    if (p.has('border')) o.video.border = p.get('border');
  }
  if (p.has('title') || p.has('minimal') || p.has('touchkeys') || p.has('touchstick') || p.has('touchfire') || p.has('touchslide')) {
    o.ui = {};
    if (p.has('title')) o.ui.title = p.get('title');
    if (p.has('minimal')) o.ui.minimal = p.get('minimal') !== '0';
    if (p.has('touchkeys')) o.ui.touchKeys = touchKeyList(p.get('touchkeys'));
    if (p.has('touchstick')) o.ui.touchStick = touchKeyList(p.get('touchstick'));
    if (p.has('touchfire')) o.ui.touchFire = touchKeyList(p.get('touchfire'));
    if (p.has('touchslide')) o.ui.touchSlide = p.get('touchslide') !== '0';
  }
  if (p.has('joykeys')) o.joystick = { keyboard: p.get('joykeys') !== '0' };
  if (p.has('drive')) o.drive = { mode: p.get('drive') };
  if (p.has('autostart')) o.autostart = p.get('autostart') === '0' ? false : p.get('autostart') === '1' ? true : p.get('autostart');
  return o;
}

export class Viccy {
  static async create(container, options = {}) {
    const v = new Viccy(container, options);
    await v.init();
    return v;
  }

  constructor(container, options) {
    let opts = merge(DEFAULTS, options);
    if (opts.urlParams) {
      const fromUrl = urlOptions();
      opts = merge(opts, fromUrl);
      if (fromUrl.media) opts.media = fromUrl.media;
    }
    this.opts = opts;
    this.container = container;
    this.prefsKey = 'viccy:' + location.pathname;
    this.prefs = this.loadPrefs();
    this.touchSlide = !!this.pref('touchSlide', opts.ui.touchSlide);
    this.paused = false;
    this.warp = false;
    this.started = false;
    this.media = { disk: null, tape: null, prg: null, carts: [] };
    this.mediaIds = new WeakMap();
    this.states = new SaveStates();
    this.quickSlot = 1;
    this.listeners = {};
  }

  isShared(key) {
    return this.opts.persistShared && SHARED_PREF_KEYS.includes(key);
  }

  loadPrefs() {
    if (!this.opts.persist) return {};
    const read = (k) => {
      try { return JSON.parse(localStorage.getItem(k)) || {}; } catch { return {}; }
    };
    const page = read(this.prefsKey), shared = read(SHARED_PREFS_KEY);
    const prefs = {};
    for (const [k, v] of Object.entries(page)) if (!this.isShared(k)) prefs[k] = v;
    for (const [k, v] of Object.entries(shared)) if (this.isShared(k)) prefs[k] = v;
    return prefs;
  }

  savePref(key, value) {
    this.prefs[key] = value;
    if (!this.opts.persist) return;
    const store = this.isShared(key) ? SHARED_PREFS_KEY : this.prefsKey;
    try {
      const saved = JSON.parse(localStorage.getItem(store)) || {};
      if (value === undefined) delete saved[key]; else saved[key] = value;
      localStorage.setItem(store, JSON.stringify(saved));
    } catch {  }
  }

  pref(key, fallback) {
    return PREF_KEYS.includes(key) && this.prefs[key] !== undefined ? this.prefs[key] : fallback;
  }

  async init() {
    const o = this.opts;
    this.ui = createUi(this, this.container);
    this.ui.message('Loading…');
    const rp = o.romPath.endsWith('/') ? o.romPath : o.romPath + '/';
    const [basic, char, kernalPal, kernalNtsc, dos1541] = await Promise.all(
      ['basic.rom', 'char.rom', 'kernal_pal.rom', 'kernal_ntsc.rom', 'dos1541.rom'].map((n) => fetchBytes(rp + n)));
    this.roms = { basic, char, kernalPal, kernalNtsc, dos1541 };

    const crtPref = this.pref('crt', null);
    const videoCrt = typeof o.video.crt === 'object' ? o.video.crt : { enabled: !!o.video.crt };
    const videoFilter = typeof o.video.filter === 'object' ? o.video.filter : { enabled: !!o.video.filter };
    this.renderer = new Renderer(this.ui.canvas);
    this.renderer.configure({
      palette: this.pref('palette', o.video.palette),
      border: this.pref('border', o.video.border),
      aspect: this.pref('aspect', o.video.aspect),
      integerScale: this.pref('integerScale', o.video.integerScale),
      crt: { ...CRT_DEFAULTS, ...videoCrt, ...(crtPref || {}) },
      filter: { ...FILTER_DEFAULTS, ...videoFilter, ...(this.pref('filter', null) || {}) },
    });

    this.audio = new Audio();
    this.audio.setVolume(this.pref('volume', o.audio.volume));
    this.audio.setMuted(this.pref('muted', o.audio.muted));
    this.audio.onReady = (rate) => { if (this.machine) this.machine.sound.setSampleRate(rate); };

    this.input = new Input(null, {
      keyboardMap: this.pref('keyboardMap', o.keyboardMap),
      joyKeys: this.pref('joyKeys', o.joystick.keyboard),
      joyKeyMap: this.pref('joyKeyMap', o.joystick.keys),
      gamepad: o.joystick.gamepad,
      gamepadButtons: o.joystick.buttons,
    });
    this.setupHotkeys();

    try {
      await this.loadConfiguredMedia();
    } catch (e) {
      console.error(e);
      this.ui.message(String(e.message || e), 6000);
    }
    this.model = o.model === 'ntsc' ? 'ntsc' : 'pal';
    this.boot();

    this.input.attach(window);
    this.ui.attachInput();
    this.ui.resize();
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.audio.suspend(); else { this.audio.resume(); this.lastTime = 0; }
    });

    if (!o.ui.clickToStart) this.start();
    else this.ui.showStart();
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
  }

  setupHotkeys() {
    const h = this.opts.hotkeys, hk = this.input.hotkeys;
    if (h.joystickToggle) hk[h.joystickToggle] = () => this.setJoystickKeys(!this.input.joyKeysEnabled);
    const minimal = this.opts.ui.minimal;
    if (h.warp && !minimal) hk[h.warp] = () => this.setWarp(!this.warp);
    if (h.fullscreen) hk[h.fullscreen] = () => this.ui.toggleFullscreen();
    if (h.reset && !minimal) hk[h.reset] = () => this.reset();
    if (this.opts.ui.saveStates) {
      if (h.saveState) hk[h.saveState] = () => this.saveState(this.quickSlot);
      if (h.loadState) hk[h.loadState] = () => this.loadState(this.quickSlot);
    }
  }

  async start() {
    if (this.started) return;
    this.started = true;
    this.ui.hideStart();
    try { await this.audio.start(); } catch (e) { console.warn(e); }
  }

  async loadConfiguredMedia() {
    const m = this.opts.media || {};
    if (m.file) await this.addFile(fileName(m.file), await fetchBytes(m.file));
    if (m.disk) await this.addFile(fileName(m.disk), await fetchBytes(m.disk), 'disk');
    if (m.tape) await this.addFile(fileName(m.tape), await fetchBytes(m.tape), 'tape');
    if (m.prg) await this.addFile(fileName(m.prg), await fetchBytes(m.prg), 'prg');
    for (const c of [].concat(m.carts || m.cart || [])) {
      const spec = typeof c === 'string' ? { url: c } : c;
      await this.addFile(fileName(spec.url), await fetchBytes(spec.url), 'cart', spec.address);
    }
  }

  async addFile(name, bytes, forceType, address) {
    const items = await expand(name, bytes);
    if (!items.length) throw new Error(`Unrecognised file: ${name}`);
    const added = [];
    let carts = null;
    for (const it of items) {
      let type = forceType && forceType !== 'zip' ? forceType : it.type;
      if (type === 'prg' && it.type === 'cart') type = 'cart';
      const id = fingerprint(it.data);
      if (type === 'disk') this.mediaIds.set(this.media.disk = new D64(it.data), id);
      else if (type === 'tape') this.mediaIds.set(this.media.tape = it.data, id);
      else if (type === 'prg') this.mediaIds.set(this.media.prg = toPrg(it.name, it.data), id);
      else if (type === 'cart') {
        if (!carts) carts = [];
        for (const c of parseCartridge(it.name, it.data, address)) {
          this.mediaIds.set(c, id + c.addr.toString(16));
          carts.push(c);
        }
      }
      added.push(type);
    }
    if (carts) this.media.carts = (forceType === 'cart' ? this.media.carts : []).concat(carts);
    this.mediaNames = this.mediaNames || {};
    for (const t of added) this.mediaNames[t] = name;
    return added;
  }

  async loadFile(file, { run = true } = {}) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const items = await expand(file.name, bytes);
    if (!items.length) { this.ui.message(`Unrecognised file: ${file.name}`, 4000); return; }
    const types = new Set(items.map((i) => i.type));
    if (types.has('cart')) this.media.carts = [];
    if (types.has('prg') || types.has('cart') || types.has('disk') || types.has('tape')) {
      if (!types.has('disk')) this.media.disk = null;
      if (!types.has('tape')) this.media.tape = null;
      if (!types.has('prg')) this.media.prg = null;
      if (!types.has('cart')) this.media.carts = [];
    }
    await this.addFile(file.name, bytes);
    if (run) {
      this.ui.message(`Loaded ${file.name}`, 2500);
      this.boot();
    } else {
      this.boot({ autostart: false, typeText: false });
      this.attachWithoutRunning();
      const hint = this.media.disk ? 'type LOAD"*",8,1' : this.media.tape ? 'type LOAD' : this.media.prg ? 'type RUN' : 'cartridges start by themselves';
      this.ui.message(`Attached ${file.name}: ${hint}`, 4000);
    }
    this.start();
  }

  attachWithoutRunning() {
    const m = this.machine;
    if (this.media.prg) {
      const prg = this.media.prg;
      m.onReady(() => m.injectPrg(prg));
    }
    if (this.media.tape) m.datasette.play();
  }

  autoMemory() {
    const m = this.media;
    if (m.prg && m.prg.length > 2) return memoryForLoadAddress(m.prg[0] | (m.prg[1] << 8));
    if (m.disk) {
      const f = m.disk.findFile(new Uint8Array([0x2A]));
      if (f) {
        const data = m.disk.readChain(f.track, f.sector);
        if (data.length > 2) return memoryForLoadAddress(data[0] | (data[1] << 8));
      }
    }
    return MEMORY_PRESETS['35k'].slice();
  }

  boot({ autostart = true, typeText = true } = {}) {
    const o = this.opts;
    const memory = (this.memoryOverride ?? o.memory) === 'auto' ? this.autoMemory() : (this.memoryOverride ?? o.memory);
    const driveMode = this.driveModeOverride || o.drive.mode;
    const driveOn = o.drive.enabled === 'auto' ? !!this.media.disk && driveMode !== 'fast' : !!o.drive.enabled && driveMode !== 'fast';
    const m = new Vic20({
      roms: this.roms, model: this.model, memory,
      sampleRate: this.audio.sampleRate,
      driveEnabled: driveOn, fastDisk: driveMode === 'fast',
    });
    m.setCartridges(this.media.carts);
    m.hardReset();
    if (this.media.disk) m.insertDisk(this.media.disk);
    if (this.media.tape) m.insertTape(this.media.tape);
    this.machine = m;
    this.input.setMachine(m);
    this.renderer.configure({ model: this.model });
    this.audio.clear();
    this.lastTime = 0;
    this.acc = 0;
    if (autostart) this.planAutostart();
    else if (typeText && o.type) m.typeText(o.type);
    this.ui.update();
    this.ui.refreshPanel();
    this.emit('boot', m);
  }

  planAutostart() {
    const o = this.opts, m = this.machine, media = this.media;
    if (o.autostart === false) {
      if (o.type) m.typeText(o.type);
      return;
    }
    if (typeof o.autostart === 'string') {
      if (media.tape) m.datasette.play();
      m.typeText(o.autostart);
    } else if (media.prg) {
      const prg = media.prg;
      m.onReady(() => {
        const r = m.injectPrg(prg);
        if (r.basic) m.typeText('RUN\r');
        else this.ui.message(`Loaded at $${r.addr.toString(16).toUpperCase()}: start it with SYS`, 5000);
      });
    } else if (media.disk) {
      const sa = o.autostartMode === 'basic' ? '' : ',1';
      m.typeText(`LOAD"${o.autostartFile}",8${sa}\rRUN\r`);
    } else if (media.tape) {
      m.datasette.play();
      m.typeText('LOAD\rRUN\r');
    }
    if (o.type) m.typeText(o.type);
  }

  reset() {
    this.boot();
    this.ui.message('Reset', 1200);
  }

  unload() {
    const had = this.media.disk || this.media.tape || this.media.prg || this.media.carts.length;
    this.media = { disk: null, tape: null, prg: null, carts: [] };
    this.mediaNames = {};
    this.boot({ autostart: false, typeText: false });
    this.ui.message(had ? 'Unloaded: starting in BASIC' : 'Nothing loaded', 2000);
  }

  resetToBasic() {
    this.boot({ autostart: false });
  }

  setModel(model) {
    this.model = model === 'ntsc' ? 'ntsc' : 'pal';
    this.boot();
  }

  setMemory(memory) {
    this.memoryOverride = memory;
    this.boot();
  }

  setDriveMode(mode) {
    this.driveModeOverride = mode;
    this.boot();
  }

  setJoystickKeys(on) {
    this.input.setJoyKeysEnabled(!!on);
    this.savePref('joyKeys', !!on);
    this.ui.message(on ? 'Keyboard joystick ON' : 'Keyboard joystick OFF', 1500);
    this.ui.update();
  }

  setJoystickKey(dir, code, slot = 0) {
    const map = {};
    for (const [d, codes] of Object.entries(this.input.joyKeyConfig)) {
      map[d] = [].concat(codes).filter((c) => c !== code);
    }
    const pair = [].concat(this.input.joyKeyConfig[dir] || []).slice(0, 2);
    pair[slot] = code;
    map[dir] = pair.filter((c, i) => c && (c !== code || i === slot));
    this.input.setJoyKeys(map);
    this.savePref('joyKeyMap', map);
  }

  resetJoystickKeys() {
    this.input.setJoyKeys(this.opts.joystick.keys);
    this.savePref('joyKeyMap', undefined);
  }

  setTouchSlide(on) {
    this.touchSlide = !!on;
    this.savePref('touchSlide', this.touchSlide);
    this.ui.message(on ? 'Slide onto buttons ON' : 'Slide onto buttons OFF', 1500);
    this.ui.update();
  }

  setWarp(on) {
    this.warp = !!on;
    this.ui.message(on ? 'Warp ON' : 'Warp OFF', 1200);
    this.ui.update();
  }

  setVideo(opts) {
    this.renderer.configure(opts);
    for (const k of ['palette', 'border', 'aspect', 'integerScale']) if (opts[k] !== undefined) this.savePref(k, opts[k]);
    const changed = (v) => (typeof v === 'object' ? v : { enabled: !!v });
    if (opts.crt !== undefined) this.savePref('crt', { ...(this.prefs.crt || {}), ...changed(opts.crt) });
    if (opts.filter !== undefined) this.savePref('filter', { ...(this.prefs.filter || {}), ...changed(opts.filter) });
    this.ui.update();
  }

  setVolume(v) { this.audio.setVolume(v); this.savePref('volume', this.audio.volume); }
  setMuted(m) { this.audio.setMuted(m); this.savePref('muted', !!m); this.ui.update(); }

  setKeyboardMap(map) { this.input.keyboardMap = map; this.savePref('keyboardMap', map); }

  pause(p = true) { this.paused = p; if (p) this.audio.suspend(); else { this.audio.resume(); this.lastTime = 0; } this.ui.update(); }

  typeText(text) { this.machine.typeText(text); }

  on(ev, fn) { (this.listeners[ev] = this.listeners[ev] || []).push(fn); }
  emit(ev, ...args) { for (const fn of this.listeners[ev] || []) fn(...args); }

  diskImage() { return this.machine.diskImage(); }

  gameId() {
    const m = this.media;
    const ids = [m.disk, m.tape, m.prg, ...m.carts].filter(Boolean).map((x) => this.mediaIds.get(x) || 'x');
    return ids.length ? ids.join('+') : 'basic';
  }

  listStates() { return this.states.list(this.gameId()); }

  async saveState(slot) {
    try {
      const state = this.machine.saveState();
      await this.states.save(this.gameId(), slot, { time: Date.now(), thumb: this.thumbnail() }, state);
      this.quickSlot = slot;
      this.ui.message(`Saved to slot ${slot}`, 1500);
    } catch (e) {
      console.error(e);
      this.ui.message(`Could not save: ${e.message || e}`, 4000);
    }
    this.ui.refreshStates();
  }

  async loadState(slot) {
    try {
      const state = await this.states.load(this.gameId(), slot);
      if (!state) { this.ui.message(`Slot ${slot} is empty`, 1500); return false; }
      this.restoreState(state);
      this.quickSlot = slot;
      this.ui.message(`Loaded slot ${slot}`, 1500);
      return true;
    } catch (e) {
      console.error(e);
      this.ui.message(`Could not load: ${e.message || e}`, 4000);
      return false;
    } finally {
      this.ui.refreshStates();
    }
  }

  async deleteState(slot) {
    try { await this.states.remove(this.gameId(), slot); } catch (e) { console.error(e); }
    this.ui.refreshStates();
  }

  restoreState(state) {
    const m = new Vic20({ roms: this.roms, model: state.model, memory: state.memory, sampleRate: this.audio.sampleRate });
    m.setCartridges(this.media.carts);
    m.loadState(state);
    if (m.disk && this.media.disk) {
      this.mediaIds.set(m.disk, this.mediaIds.get(this.media.disk));
      this.media.disk = m.disk;
    }
    this.model = state.model;
    this.machine = m;
    this.input.setMachine(m);
    this.renderer.configure({ model: this.model });
    this.audio.clear();
    this.lastTime = 0;
    this.acc = 0;
    this.renderer.draw(m.vic.fb, m.vic.lineWidth, m.timing.linesPerFrame, m.vic.screenWindow());
    this.ui.update();
    this.ui.refreshPanel();
    this.emit('boot', m);
  }

  thumbnail() {
    const r = this.renderer, c = r.crop, vic = this.machine.vic;
    const rgb = paletteRgb(r.palette, this.model === 'ntsc');
    const src = document.createElement('canvas');
    src.width = c.w; src.height = c.h;
    const img = src.getContext('2d').createImageData(c.w, c.h);
    let o = 0;
    for (let y = 0; y < c.h; y++) {
      for (let x = 0, i = (c.y + y) * vic.lineWidth + c.x; x < c.w; x++, i++) {
        const p = (vic.fb[i] & 15) * 3;
        img.data[o++] = rgb[p]; img.data[o++] = rgb[p + 1]; img.data[o++] = rgb[p + 2]; img.data[o++] = 255;
      }
    }
    src.getContext('2d').putImageData(img, 0, 0);
    const out = document.createElement('canvas');
    out.height = 96;
    out.width = Math.round(96 * r.displayAspect);
    out.getContext('2d').drawImage(src, 0, 0, out.width, out.height);
    return out.toDataURL('image/png');
  }

  loop(now) {
    requestAnimationFrame(this.loop);
    const m = this.machine;
    if (!m || this.paused || document.hidden) return;
    this.input.pollGamepads();
    if (!this.lastTime) this.lastTime = now;
    const dt = Math.min(now - this.lastTime, 100);
    this.lastTime = now;

    const frameMs = (1000 * m.cyclesPerFrame) / m.clock;
    const autoWarp = this.opts.warp.auto && m.busy;
    let ran = 0;
    if (this.warp || autoWarp) {
      m.sound.enabled = false;
      const t0 = performance.now();
      do { this.input.service(); m.runFrame(); ran++; } while (performance.now() - t0 < 14);
      this.acc = 0;
      this.audio.clear();
      m.sound.take();
    } else {
      m.sound.enabled = this.started && this.audio.ready;
      this.acc += dt;
      while (this.acc >= frameMs && ran < 4) {
        m.sound.setRateTrim(this.audio.trim(this.audio.sampleRate * 0.06));
        this.input.service();
        m.runFrame();
        this.acc -= frameMs;
        ran++;
      }
      if (ran === 4) this.acc = 0;
      const samples = m.sound.take();
      if (m.sound.enabled) this.audio.push(samples);
    }
    if (ran) {
      this.renderer.draw(m.vic.fb, m.vic.lineWidth, m.timing.linesPerFrame, m.vic.screenWindow());
      this.ui.tick(autoWarp || this.warp);
    }
  }
}

export default Viccy;
