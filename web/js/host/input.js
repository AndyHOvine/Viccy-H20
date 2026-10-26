import { CHAR_TO_KEYS } from '../emu/keys.js';
import { JOY } from '../emu/vic20.js';

const SPECIAL = {
  Enter: ['RETURN'], NumpadEnter: ['RETURN'],
  Backspace: ['DEL'], Delete: ['DEL'],
  Insert: ['DEL', '+shift'],
  Escape: ['RUNSTOP'],
  Tab: ['CBM'],
  ControlLeft: ['CTRL'], ControlRight: ['CTRL'],
  AltLeft: ['CBM'],
  Home: ['HOME'],
  End: ['HOME', '+shift'],
  Space: ['SPACE'],
  ShiftLeft: ['LSHIFT'], ShiftRight: ['RSHIFT'],
  ArrowDown: ['CRSRDOWN'], ArrowUp: ['CRSRDOWN', '+shift'],
  ArrowRight: ['CRSRRIGHT'], ArrowLeft: ['CRSRRIGHT', '+shift'],
  F1: ['F1'], F2: ['F1', '+shift'], F3: ['F3'], F4: ['F3', '+shift'],
  F5: ['F5'], F6: ['F5', '+shift'], F7: ['F7'], F8: ['F7', '+shift'],
  PageUp: ['RESTORE'], F12: ['RESTORE'],
};

const POSITIONAL = {
  Backquote: ['LEFTARROW'], Minus: ['+'], Equal: ['-'], Backslash: ['POUND'],
  BracketLeft: ['@'], BracketRight: ['*'], Semicolon: [':'], Quote: [';'],
  Comma: [','], Period: ['.'], Slash: ['/'], IntlBackslash: ['='], PageDown: ['UPARROW'],
};

export const DEFAULT_JOY_KEYS = {
  up: ['ArrowUp', 'Numpad8'],
  down: ['ArrowDown', 'Numpad2', 'Numpad5'],
  left: ['ArrowLeft', 'Numpad4'],
  right: ['ArrowRight', 'Numpad6'],
  fire: ['ControlLeft', 'ControlRight', 'Numpad0', 'AltRight'],
  upleft: ['Numpad7'], upright: ['Numpad9'], downleft: ['Numpad1'], downright: ['Numpad3'],
};

const JOY_BITS = {
  up: JOY.UP, down: JOY.DOWN, left: JOY.LEFT, right: JOY.RIGHT, fire: JOY.FIRE,
  upleft: JOY.UP | JOY.LEFT, upright: JOY.UP | JOY.RIGHT,
  downleft: JOY.DOWN | JOY.LEFT, downright: JOY.DOWN | JOY.RIGHT,
};

export function keyLabel(code) {
  const names = {
    ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Space: 'Space',
    ControlLeft: 'Left Ctrl', ControlRight: 'Right Ctrl', ShiftLeft: 'Left Shift', ShiftRight: 'Right Shift',
    AltLeft: 'Left Alt', AltRight: 'Right Alt', Enter: 'Enter', NumpadEnter: 'Num Enter',
    IntlBackslash: '\\', Backslash: '\\ (US)',
  };
  if (names[code]) return names[code];
  let m = /^Key([A-Z])$/.exec(code) || /^Digit([0-9])$/.exec(code);
  if (m) return m[1];
  m = /^Numpad(.+)$/.exec(code);
  if (m) return 'Num ' + m[1];
  return code;
}

export class Input {
  constructor(machine, opts = {}) {
    this.machine = machine;
    this.keyboardMap = opts.keyboardMap || 'symbolic';
    this.joyKeysEnabled = !!opts.joyKeys;
    this.setJoyKeys(opts.joyKeyMap || DEFAULT_JOY_KEYS);
    this.gamepadEnabled = opts.gamepad !== false;
    this.gamepadButtons = opts.gamepadButtons || {};
    this.swapFire = false;
    this.pressed = new Map();
    this.joyKeyBits = 0;
    this.joyPadBits = 0;
    this.joyTouchBits = 0;
    this.padKeys = new Set();
    this.physShift = { L: false, R: false };
    this.applied = { L: false, R: false };
    this.hotkeys = {};
    this.enabled = true;
    this.holdCycles = 0;
    this.gapCycles = 0;
    this.queue = [];
    this.active = [];
    this.nextFree = 0;
    this.joyDelayed = [];
  }

  setMachine(m) {
    this.machine = m;
    this.applied = { L: false, R: false };
    this.pressed.clear();
    this.queue = [];
    this.active = [];
    this.joyDelayed = [];
    this.nextFree = 0;
    this.holdCycles = m ? Math.ceil(m.clock / 50) : 0;
    this.gapCycles = this.holdCycles;
  }

  schedule(at, down, entry) {
    const a = { at, down, entry };
    let i = this.queue.length;
    while (i > 0 && this.queue[i - 1].at > at) i--;
    this.queue.splice(i, 0, a);
    this.service();
  }

  service() {
    const now = this.machine.cycles;
    let changed = false;
    while (this.queue.length && this.queue[0].at <= now) {
      const { down, entry } = this.queue.shift();
      for (const k of entry.keys) this.machine.key(k, down);
      if (down) this.active.push(entry);
      else this.active = this.active.filter((e) => e !== entry);
      changed = true;
    }
    if (this.joyDelayed.length && this.joyDelayed.some((d) => d.at <= now)) {
      this.joyDelayed = this.joyDelayed.filter((d) => d.at > now);
      this.updateJoyKeys();
    }
    if (changed) this.updateShift();
  }

  setJoyKeys(map) {
    this.joyKeyConfig = map;
    this.joyKeyMap = new Map();
    for (const [dir, codes] of Object.entries(map)) {
      for (const c of [].concat(codes)) this.joyKeyMap.set(c, JOY_BITS[dir] || 0);
    }
  }

  attach(target = window) {
    this.target = target;
    this.onDown = (e) => this.keyDown(e);
    this.onUp = (e) => this.keyUp(e);
    this.onBlur = () => this.releaseAll();
    target.addEventListener('keydown', this.onDown);
    target.addEventListener('keyup', this.onUp);
    window.addEventListener('blur', this.onBlur);
  }

  keyDown(e) {
    if (!this.enabled) return;
    const hk = (e.shiftKey && this.hotkeys['Shift+' + e.code]) || this.hotkeys[e.code];
    if (hk && !e.repeat) { e.preventDefault(); hk(); return; }
    if (e.metaKey) return;
    if (this.joyKeysEnabled && this.joyKeyMap.has(e.code)) {
      e.preventDefault();
      if (!this.pressed.has(e.code)) {
        this.pressed.set(e.code, { joy: this.joyKeyMap.get(e.code), at: this.machine.cycles });
        this.updateJoyKeys();
      }
      return;
    }
    if (e.ctrlKey && (e.code === 'KeyV' || e.code === 'KeyC')) return;
    if (this.pressed.has(e.code)) { e.preventDefault(); return; }
    const m = this.resolve(e);
    if (!m) return;
    e.preventDefault();
    this.pressed.set(e.code, m);
    if (m.phys) {
      this.physShift[m.phys] = true;
      this.updateShift();
      return;
    }
    const at = Math.max(this.machine.cycles, this.nextFree);
    m.downAt = at;
    this.nextFree = at + this.holdCycles + this.gapCycles;
    this.schedule(at, true, m);
  }

  keyUp(e) {
    const m = this.pressed.get(e.code);
    if (!m) return;
    e.preventDefault();
    this.pressed.delete(e.code);
    const now = this.machine.cycles;
    if (m.joy !== undefined) {
      const until = m.at + this.holdCycles * 2;
      if (now < until) this.joyDelayed.push({ joy: m.joy, at: until });
      this.updateJoyKeys();
      return;
    }
    if (m.phys) {
      this.physShift[m.phys] = false;
      this.updateShift();
      return;
    }
    this.schedule(Math.max(now, m.downAt + this.holdCycles), false, m);
  }

  releaseAll() {
    for (const e of this.active) for (const k of e.keys) this.machine.key(k, false);
    this.active = [];
    this.queue = [];
    this.joyDelayed = [];
    this.pressed.clear();
    this.physShift = { L: false, R: false };
    this.joyKeyBits = 0;
    this.updateShift();
    this.pushJoy();
  }

  resolve(e) {
    const code = e.code;
    if (code === 'ShiftLeft') return { keys: [], phys: 'L', shift: null };
    if (code === 'ShiftRight') return { keys: [], phys: 'R', shift: null };
    const sp = SPECIAL[code];
    if (sp) {
      const keys = sp.filter((k) => k !== '+shift');
      return { keys, shift: sp.includes('+shift') ? true : null };
    }
    if (/^Key[A-Z]$/.test(code)) return { keys: [code.slice(3)], shift: null };
    if (/^Digit[0-9]$/.test(code) && !e.shiftKey) return { keys: [code.slice(5)], shift: null };
    if (/^Numpad[0-9]$/.test(code)) return { keys: [code.slice(6)], shift: false };
    const np = { NumpadAdd: '+', NumpadSubtract: '-', NumpadMultiply: '*', NumpadDivide: '/', NumpadDecimal: '.' }[code];
    if (np) return { keys: [np], shift: false };
    if (this.keyboardMap === 'positional') {
      if (/^Digit[0-9]$/.test(code)) return { keys: [code.slice(5)], shift: null };
      const p = POSITIONAL[code];
      if (p) return { keys: p, shift: null };
    }
    if (e.key && e.key.length === 1) {
      const c = CHAR_TO_KEYS[e.key];
      if (c) return { keys: [c[0]], shift: c[1] };
    }
    return null;
  }

  updateShift() {
    let want = null;
    for (const e of this.active) if (e.shift !== null && e.shift !== undefined) want = e.shift;
    let L = this.physShift.L, R = this.physShift.R;
    if (want === true) { if (!L && !R) L = true; }
    else if (want === false) { L = false; R = false; }
    if (L !== this.applied.L) { this.machine.key('LSHIFT', L); this.applied.L = L; }
    if (R !== this.applied.R) { this.machine.key('RSHIFT', R); this.applied.R = R; }
  }

  updateJoyKeys() {
    let bits = 0;
    for (const [, m] of this.pressed) if (m.joy !== undefined) bits |= m.joy;
    for (const d of this.joyDelayed) bits |= d.joy;
    this.joyKeyBits = bits;
    this.pushJoy();
  }

  setJoyKeysEnabled(on) {
    if (on === this.joyKeysEnabled) return;
    this.releaseAll();
    this.joyKeysEnabled = on;
  }

  setTouchJoy(bits) {
    this.joyTouchBits = bits;
    this.pushJoy();
  }

  pushJoy() {
    let bits = this.joyKeyBits | this.joyPadBits | this.joyTouchBits;
    if ((bits & (JOY.UP | JOY.DOWN)) === (JOY.UP | JOY.DOWN)) bits &= ~(JOY.UP | JOY.DOWN);
    if ((bits & (JOY.LEFT | JOY.RIGHT)) === (JOY.LEFT | JOY.RIGHT)) bits &= ~(JOY.LEFT | JOY.RIGHT);
    this.machine.setJoystick(bits);
  }

  pollGamepads() {
    if (!this.gamepadEnabled || !navigator.getGamepads) return;
    let bits = 0;
    const keysDown = new Set();
    for (const gp of navigator.getGamepads()) {
      if (!gp || !gp.connected) continue;
      const ax = gp.axes[0] || 0, ay = gp.axes[1] || 0;
      const b = (i) => gp.buttons[i] && gp.buttons[i].pressed;
      if (ax < -0.4 || b(14)) bits |= JOY.LEFT;
      if (ax > 0.4 || b(15)) bits |= JOY.RIGHT;
      if (ay < -0.4 || b(12)) bits |= JOY.UP;
      if (ay > 0.4 || b(13)) bits |= JOY.DOWN;
      for (const [btn, key] of Object.entries(this.gamepadButtons)) {
        if (b(Number(btn))) keysDown.add(key);
      }
      for (const i of [0, 1, 2, 3, 4, 5, 6, 7]) {
        if (b(i) && !(String(i) in this.gamepadButtons)) bits |= JOY.FIRE;
      }
    }
    if (bits !== this.joyPadBits) { this.joyPadBits = bits; this.pushJoy(); }
    for (const k of keysDown) if (!this.padKeys.has(k)) this.machine.key(k, true);
    for (const k of this.padKeys) if (!keysDown.has(k)) this.machine.key(k, false);
    this.padKeys = keysDown;
  }
}
