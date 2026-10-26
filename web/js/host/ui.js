import { PALETTE_NAMES } from './palettes.js';
import { FILTER_RANGES, MASK_SHAPES } from './crtfilter.js';
import { JOY } from '../emu/vic20.js';
import { keyLabel } from './input.js';

const ICONS = {
  reset: '<path d="M12 5V2L7 6l5 4V7a5 5 0 1 1-5 5H5a7 7 0 1 0 7-7z"/>',
  joystick: '<path d="M11 2h2v8.1a3 3 0 1 1-2 0zM5 15h14l2 5H3z"/>',
  warp: '<path d="M3 6l8 6-8 6zm9 0l8 6-8 6z"/>',
  crt: '<path d="M3 5h18v12H3zm2 2v8h14V7zM8 19h8v2H8z"/>',
  sound: '<path d="M4 9h4l5-4v14l-5-4H4zm12.5 3a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4zM14 3.2v2.1a7 7 0 0 1 0 13.4v2.1a9 9 0 0 0 0-17.6z"/>',
  mute: '<path d="M4 9h4l5-4v14l-5-4H4zm12.6.4L18 8l2 2 2-2 1.4 1.4-2 2 2 2L22 15l-2-2-2 2-1.4-1.6 2-2z"/>',
  settings: '<path d="M19.4 13a7.5 7.5 0 0 0 0-2l2.1-1.6-2-3.4-2.5 1a7.4 7.4 0 0 0-1.7-1L15 3h-4l-.4 2.6a7.4 7.4 0 0 0-1.7 1l-2.5-1-2 3.4L6.6 11a7.5 7.5 0 0 0 0 2l-2.1 1.6 2 3.4 2.5-1a7.4 7.4 0 0 0 1.7 1L11 21h4l.4-2.6a7.4 7.4 0 0 0 1.7-1l2.5 1 2-3.4zM13 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z"/>',
  unload: '<path d="M12 4l8 10H4zM4 16h16v3H4z"/>',
  load: '<path d="M3 5h7l2 2h9v12H3zm9 4l-4 4h3v4h2v-4h3z"/>',
  fullscreen: '<path d="M4 4h6v2H6v4H4zm10 0h6v6h-2V6h-4zM4 14h2v4h4v2H4zm14 0h2v6h-6v-2h4z"/>',
  pause: '<path d="M6 4h4v16H6zm8 0h4v16h-4z"/>',
  play: '<path d="M7 4l13 8-13 8z"/>',
};

function icon(name) {
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;
}

function el(tag, attrs = {}, html = '') {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v);
  }
  if (html) e.innerHTML = html;
  return e;
}

const MEMORY_LABELS = [
  ['auto', 'Auto'], ['unexpanded', 'Unexpanded (5K)'], ['3k', '+3K'], ['8k', '+8K'], ['16k', '+16K'],
  ['24k', '+24K'], ['32k', '+32K (blocks 1,2,3,5)'], ['35k', '+35K (all)'],
];

const TOUCH_KEY_LABELS = { RUNSTOP: 'RUN/STOP', RETURN: 'RETURN', SPACE: 'SPACE', CBM: 'C=', CRSRDOWN: '▼', CRSRRIGHT: '▶' };

export function createUi(app, container) {
  const o = app.opts.ui;
  container.classList.add('viccy');
  container.innerHTML = '';

  const screen = el('div', { class: 'viccy-screen' });
  const canvas = el('canvas', { class: 'viccy-canvas', tabindex: '0', 'aria-label': 'VIC-20 screen' });
  screen.append(canvas);

  const status = el('div', { class: 'viccy-status' });
  const led = el('span', { class: 'viccy-led', title: 'Disk drive' });
  const tape = el('span', { class: 'viccy-tag viccy-tape', title: 'Datasette' }, 'TAPE');
  const warp = el('span', { class: 'viccy-tag viccy-warp' }, 'WARP');
  const joyTag = el('span', { class: 'viccy-tag viccy-joytag', title: 'Keyboard joystick (F9)' }, 'JOY');
  status.append(joyTag, warp, tape, led);
  screen.append(status);

  const toast = el('div', { class: 'viccy-toast', role: 'status' });
  screen.append(toast);

  const start = el('div', { class: 'viccy-start' },
    `<div class="viccy-start-box"><div class="viccy-start-title"></div>
     <button class="viccy-start-btn" type="button">${icon('play')}<span>Click to start</span></button>
     <div class="viccy-start-hint"></div></div>`);
  start.querySelector('.viccy-start-title').textContent = o.title || 'VIC-20';
  start.hidden = true;
  screen.append(start);

  const drop = el('div', { class: 'viccy-drop' }, '<div>Drop a VIC-20 file (D64, TAP, PRG, CRT, ZIP)<br><small>Hold Shift to attach it without running</small></div>');
  drop.hidden = true;
  screen.append(drop);

  container.append(screen);

  const fileInput = el('input', { type: 'file', accept: '.d64,.tap,.prg,.p00,.t64,.crt,.bin,.rom,.a0,.zip', hidden: '' });
  const btn = (name, title, onclick) => {
    const b = el('button', { class: 'viccy-btn', type: 'button', title, 'aria-label': title, onclick }, icon(name));
    return b;
  };
  const toolbar = el('div', { class: 'viccy-toolbar' });
  const bReset = btn('reset', 'Reset', () => app.reset());
  const bPause = btn('pause', 'Pause', () => app.pause(!app.paused));
  const bJoy = btn('joystick', 'Keyboard joystick (F9)', () => app.setJoystickKeys(!app.input.joyKeysEnabled));
  const bWarp = btn('warp', 'Warp speed (F10)', () => app.setWarp(!app.warp));
  const bCrt = btn('crt', 'CRT effects', () => {
    const on = !(app.renderer.crt.enabled || app.renderer.filter.enabled);
    app.setVideo({ crt: { enabled: on }, filter: { enabled: on } });
  });
  const bMute = btn('sound', 'Sound', () => { app.start(); app.setMuted(!app.audio.muted); });
  let loadAndRun = true;
  const pickFile = (e) => { loadAndRun = !(e && e.shiftKey); fileInput.click(); };
  const bLoad = btn('load', 'Load file (Shift+click: attach without running)', pickFile);
  const bUnload = btn('unload', 'Unload (start in BASIC)', () => app.unload());
  const bSettings = btn('settings', 'Settings', () => toggleSettings());
  const bFull = btn('fullscreen', 'Fullscreen (F11)', () => toggleFullscreen());
  const left = el('div', { class: 'viccy-toolbar-group' });
  const right = el('div', { class: 'viccy-toolbar-group' });
  const full = !o.minimal;
  const canLoad = full && o.allowFileDrop;
  if (full) left.append(bReset);
  left.append(bPause, bJoy);
  if (full) left.append(bWarp);
  right.append(bCrt);
  right.append(bMute);
  if (canLoad) right.append(bLoad);
  if (full) right.append(bUnload);
  if (full && o.settings) right.append(bSettings);
  right.append(bFull);
  toolbar.append(left, el('div', { class: 'viccy-title' }), right, fileInput);
  toolbar.querySelector('.viccy-title').textContent = o.title || '';
  if (o.toolbar) container.append(toolbar);
  else container.classList.add('viccy-notoolbar');

  const panel = el('div', { class: 'viccy-panel', hidden: '' });
  container.append(panel);

  function select(label, options, value, onchange) {
    const row = el('label', { class: 'viccy-row' }, `<span></span>`);
    row.firstChild.textContent = label;
    const s = el('select');
    for (const [v, t] of options) {
      const opt = el('option', { value: v });
      opt.textContent = t;
      if (String(v) === String(value)) opt.selected = true;
      s.append(opt);
    }
    s.addEventListener('change', () => onchange(s.value));
    row.append(s);
    return row;
  }

  function check(label, value, onchange) {
    const row = el('label', { class: 'viccy-row viccy-check' }, '<span></span>');
    row.firstChild.textContent = label;
    const c = el('input', { type: 'checkbox' });
    c.checked = !!value;
    c.addEventListener('change', () => onchange(c.checked));
    row.append(c);
    return row;
  }

  function slider(label, key, min, max) {
    const row = el('label', { class: 'viccy-row viccy-slider' }, '<span></span>');
    row.firstChild.textContent = label;
    const s = el('input', { type: 'range', min, max, step: 25 });
    s.value = app.renderer.crt[key];
    const out = el('output');
    out.textContent = s.value;
    s.addEventListener('input', () => {
      out.textContent = s.value;
      app.setVideo({ crt: { [key]: Number(s.value) } });
    });
    row.append(s, out);
    return row;
  }

  function filterSlider(label, key) {
    const [min, max] = FILTER_RANGES[key];
    const row = el('label', { class: 'viccy-row viccy-slider' }, '<span></span>');
    row.firstChild.textContent = label;
    const s = el('input', { type: 'range', min, max, step: 1 });
    s.value = app.renderer.filter[key];
    const out = el('output');
    out.textContent = s.value;
    s.addEventListener('input', () => {
      out.textContent = s.value;
      app.setVideo({ filter: { [key]: Number(s.value) } });
    });
    row.append(s, out);
    return row;
  }

  function colour(label, value, onchange) {
    const row = el('label', { class: 'viccy-row' }, '<span></span>');
    row.firstChild.textContent = label;
    const c = el('input', { type: 'color', value });
    c.addEventListener('input', () => onchange(c.value));
    row.append(c);
    return row;
  }

  function joyKeyRow(dir) {
    const row = el('div', { class: 'viccy-row' }, '<span></span>');
    row.firstChild.textContent = 'Joystick ' + (dir === 'fire' ? 'fire' : dir);
    const codes = [].concat(app.input.joyKeyConfig[dir] || []);
    const b = el('button', { class: 'viccy-action viccy-keybind', type: 'button', title: 'Click, then press a key' });
    b.textContent = codes.length ? codes.map(keyLabel).join(' / ') : 'none';
    b.addEventListener('click', () => {
      b.textContent = 'Press a key… (Esc cancels)';
      const capture = (e) => {
        e.preventDefault();
        e.stopImmediatePropagation();
        window.removeEventListener('keydown', capture, true);
        if (e.code === 'Escape') { buildPanel(); return; }
        if (Object.values(app.opts.hotkeys).includes(e.code)) {
          ui.message(`${keyLabel(e.code)} is already a hotkey`, 2000);
          buildPanel();
          return;
        }
        app.setJoystickKey(dir, e.code);
        buildPanel();
      };
      window.addEventListener('keydown', capture, true);
    });
    row.append(b);
    return row;
  }

  function section(title, ...rows) {
    const sec = el('section', { class: 'viccy-section' }, '<h3></h3>');
    sec.firstChild.textContent = title;
    sec.append(...rows);
    return sec;
  }

  function action(label, fn) {
    return el('button', { class: 'viccy-action', type: 'button', onclick: fn }, label);
  }

  function buildPanel() {
    panel.innerHTML = '';
    const head = el('div', { class: 'viccy-panel-head' }, '<h2>Settings</h2>');
    head.append(el('button', { class: 'viccy-btn viccy-close', type: 'button', 'aria-label': 'Close', onclick: () => toggleSettings(false) }, '✕'));
    panel.append(head);
    const r = app.renderer;
    const memValue = app.memoryOverride ?? app.opts.memory;
    const m = app.machine;
    panel.append(
      section('Machine',
        select('TV standard', [['pal', 'PAL (6561)'], ['ntsc', 'NTSC (6560)']], app.model, (v) => app.setModel(v)),
        select('Memory', MEMORY_LABELS, Array.isArray(memValue) ? 'auto' : memValue, (v) => app.setMemory(v)),
        select('Disk drive', [['accurate', '1541 (accurate)'], ['fast', 'Fast LOAD (KERNAL trap)']],
          app.driveModeOverride || app.opts.drive.mode, (v) => app.setDriveMode(v)),
        check('Auto warp while loading', app.opts.warp.auto, (v) => { app.opts.warp.auto = v; }),
        el('div', { class: 'viccy-actions' }),
      ),
      section('Display',
        check('CRT emulation', r.crt.enabled, (v) => app.setVideo({ crt: { enabled: v } })),
        select('Palette', PALETTE_NAMES.map((n) => [n, n === 'vice' ? 'VICE (internal)' : n]), r.palette, (v) => app.setVideo({ palette: v })),
        select('Borders', [['normal', 'Normal'], ['full', 'Full'], ['tight', 'Small']], r.border, (v) => app.setVideo({ border: v })),
        select('Aspect ratio', [['tv', 'TV (non-square pixels)'], ['square', 'Square pixels']], r.aspect, (v) => app.setVideo({ aspect: v })),
        check('Integer scaling', r.integerScale, (v) => app.setVideo({ integerScale: v })),
        slider('Blur', 'blur', 0, 1000),
        slider('Scanline shade', 'scanlineShade', 0, 1000),
        slider('Saturation', 'saturation', 0, 2000),
        slider('Contrast', 'contrast', 0, 2000),
        slider('Brightness', 'brightness', 0, 2000),
        slider('Gamma', 'gamma', 0, 4000),
        slider('Tint', 'tint', 0, 2000),
        slider('PAL odd line phase', 'oddLinesPhase', 0, 2000),
        slider('PAL odd line offset', 'oddLinesOffset', 0, 2000),
      ),
      section('CRT filter',
        check('Draw the CRT filter', r.filter.enabled, (v) => app.setVideo({ filter: { enabled: v } })),
        filterSlider('Pattern scale', 'scale'),
        filterSlider('Scan lines: every n lines', 'everyNLines'),
        filterSlider('Lines darkened', 'linesDarkened'),
        filterSlider('Darkness (%)', 'darkness'),
        select('Direction', [['rows', 'Rows'], ['columns', 'Columns']], r.filter.direction, (v) => app.setVideo({ filter: { direction: v } })),
        filterSlider('Bulge (%)', 'bulge'),
        filterSlider('Rounded corners (%)', 'corners'),
        filterSlider('Corner dot', 'cornerDot'),
        filterSlider('Bleed (%)', 'bleed'),
        filterSlider('Glow (%)', 'glow'),
        filterSlider('Mask (%)', 'mask'),
        select('Mask shape', MASK_SHAPES.map((m) => [m, { stripes: 'Stripes', 'stripes-gaps': 'Stripes with gaps', slots: 'Slots', dots: 'Dots' }[m]]),
          r.filter.maskShape, (v) => app.setVideo({ filter: { maskShape: v } })),
        filterSlider('Stripe width', 'maskWidth'),
        colour('Tint colour', r.filter.tintColor, (v) => app.setVideo({ filter: { tintColor: v } })),
        filterSlider('Tint (%)', 'tint'),
        filterSlider('Roll per frame', 'roll'),
        filterSlider('Rolling bar (%)', 'rollingBar'),
      ),
      section('Input',
        check('Keyboard joystick (F9)', app.input.joyKeysEnabled, (v) => app.setJoystickKeys(v)),
        ...['up', 'down', 'left', 'right', 'fire'].map((dir) => joyKeyRow(dir)),
        el('div', { class: 'viccy-actions viccy-joyreset' }),
        select('Keyboard mapping', [['symbolic', 'Symbolic (type what you see)'], ['positional', 'Positional']],
          app.input.keyboardMap, (v) => app.setKeyboardMap(v)),
        el('p', { class: 'viccy-help' },
          'VIC keys: Esc = RUN/STOP, Page Up or F12 = RESTORE, Tab = C=, Home = CLR/HOME, F1–F8 as on the VIC. ' +
          'Gamepads work automatically. Paste text to type it into BASIC.'),
      ),
      section('Media', el('div', { class: 'viccy-actions viccy-media' })),
    );
    panel.querySelector('.viccy-joyreset').append(action('Default joystick keys', () => { app.resetJoystickKeys(); buildPanel(); }));
    const acts = panel.querySelector('.viccy-actions');
    acts.append(action('Restart program', () => app.reset()), action('Reset to BASIC', () => app.resetToBasic()));
    const media = panel.querySelector('.viccy-media');
    if (m.datasette.data || m.datasette.recording) {
      media.append(
        action('Tape: Play', () => m.datasette.play()),
        action('Tape: Stop', () => m.datasette.stop()),
        action('Tape: Rewind', () => m.datasette.rewind()),
      );
    }
    media.append(action('Tape: Record new', () => { m.datasette.record(); app.ui.message('Recording: press RETURN after SAVE', 2500); }));
    if (m.datasette.recording) {
      media.append(action('Tape: Save recording', () => download(m.datasette.finishRecording(), 'recording.tap')));
    }
    if (m.disk) {
      media.append(action('Download disk image', () => download(app.diskImage(), (app.mediaNames && app.mediaNames.disk) || 'disk.d64')));
    }
    if (o.allowFileDrop) media.append(action('Load file…', pickFile));
    media.append(action('Unload (start in BASIC)', () => app.unload()));
  }

  function download(bytes, name) {
    if (!bytes) return;
    const a = el('a', { href: URL.createObjectURL(new Blob([bytes])), download: name });
    document.body.append(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  function toggleSettings(show) {
    const vis = show ?? panel.hidden;
    if (vis) buildPanel();
    panel.hidden = !vis;
    app.input.enabled = !vis;
    if (vis) app.input.releaseAll();
  }

  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen();
    else if (container.requestFullscreen) container.requestFullscreen().catch(() => {});
    else if (container.webkitRequestFullscreen) container.webkitRequestFullscreen();
  }

  const touchWanted = o.touchControls === true ||
    (o.touchControls === 'auto' && window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
  let touch = null;
  if (touchWanted) {
    touch = el('div', { class: 'viccy-touch' });
    const stick = el('div', { class: 'viccy-stick' }, '<div class="viccy-knob"></div>');
    const fire = el('div', { class: 'viccy-fire' }, 'FIRE');
    const keys = el('div', { class: 'viccy-touch-keys' });
    for (const k of o.touchKeys || []) {
      const b = el('button', { type: 'button', class: 'viccy-key' });
      b.textContent = TOUCH_KEY_LABELS[k] || k;
      const down = (e) => { e.preventDefault(); app.start(); app.machine.key(k, true); };
      const up = (e) => { e.preventDefault(); app.machine.key(k, false); };
      b.addEventListener('pointerdown', down);
      b.addEventListener('pointerup', up);
      b.addEventListener('pointercancel', up);
      b.addEventListener('pointerleave', up);
      keys.append(b);
    }
    touch.append(keys, stick, fire);
    container.append(touch);

    let stickBits = 0, fireBits = 0, stickId = null;
    const knob = stick.firstChild;
    const updateStick = (e) => {
      const r = stick.getBoundingClientRect();
      const dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
      const max = r.width / 2;
      const len = Math.min(1, Math.hypot(dx, dy) / max);
      const ang = Math.atan2(dy, dx);
      knob.style.transform = `translate(${Math.cos(ang) * len * max * 0.6}px, ${Math.sin(ang) * len * max * 0.6}px)`;
      stickBits = 0;
      if (len > 0.3) {
        const oct = Math.round(ang / (Math.PI / 4)) & 7;
        stickBits = [JOY.RIGHT, JOY.RIGHT | JOY.DOWN, JOY.DOWN, JOY.DOWN | JOY.LEFT,
          JOY.LEFT, JOY.LEFT | JOY.UP, JOY.UP, JOY.UP | JOY.RIGHT][oct];
      }
      app.input.setTouchJoy(stickBits | fireBits);
    };
    stick.addEventListener('pointerdown', (e) => { e.preventDefault(); app.start(); stickId = e.pointerId; stick.setPointerCapture(e.pointerId); updateStick(e); });
    stick.addEventListener('pointermove', (e) => { if (e.pointerId === stickId) updateStick(e); });
    const stickUp = (e) => {
      if (e.pointerId !== stickId) return;
      stickId = null; stickBits = 0; knob.style.transform = '';
      app.input.setTouchJoy(fireBits);
    };
    stick.addEventListener('pointerup', stickUp);
    stick.addEventListener('pointercancel', stickUp);
    const fireDown = (e) => { e.preventDefault(); app.start(); fireBits = JOY.FIRE; fire.classList.add('on'); app.input.setTouchJoy(stickBits | fireBits); };
    const fireUp = (e) => { e.preventDefault(); fireBits = 0; fire.classList.remove('on'); app.input.setTouchJoy(stickBits); };
    fire.addEventListener('pointerdown', fireDown);
    fire.addEventListener('pointerup', fireUp);
    fire.addEventListener('pointercancel', fireUp);
  }

  let toastTimer = 0;
  const ui = {
    canvas,
    message(text, ms = 2000) {
      toast.textContent = text;
      toast.classList.add('show');
      clearTimeout(toastTimer);
      if (ms) toastTimer = setTimeout(() => toast.classList.remove('show'), ms);
    },
    showStart() {
      start.hidden = false;
      const hint = start.querySelector('.viccy-start-hint');
      hint.textContent = app.input.joyKeysEnabled
        ? `Joystick: cursor keys, fire = ${[].concat(app.input.joyKeyConfig.fire || []).map(keyLabel)[0] || 'none'}. F9 toggles keyboard joystick.`
        : 'F9 switches the cursor keys to joystick.';
    },
    hideStart() { start.hidden = true; toast.classList.remove('show'); canvas.focus({ preventScroll: true }); },
    toggleFullscreen,
    resize() {
      const r = screen.getBoundingClientRect();
      app.renderer.alignTop = touchWanted && r.height > r.width;
      app.renderer.resize(r.width, r.height, window.devicePixelRatio || 1);
    },
    update() {
      bJoy.classList.toggle('on', app.input.joyKeysEnabled);
      joyTag.classList.toggle('on', app.input.joyKeysEnabled);
      bWarp.classList.toggle('on', app.warp);
      bCrt.classList.toggle('on', app.renderer.crt.enabled || app.renderer.filter.enabled);
      bMute.innerHTML = icon(app.audio.muted ? 'mute' : 'sound');
      bPause.innerHTML = icon(app.paused ? 'play' : 'pause');
      bPause.title = app.paused ? 'Resume' : 'Pause';
    },
    refreshPanel() {
      if (!panel.hidden) buildPanel();
    },
    tick(warping) {
      const m = app.machine;
      led.classList.toggle('on', !!(m.drive && m.drive.led));
      led.hidden = !m.drive;
      tape.hidden = !(m.datasette.data || m.datasette.recording);
      tape.classList.toggle('on', m.datasette.running || (m.datasette.recording && m.datasette.motor));
      warp.classList.toggle('on', !!warping);
    },
    attachInput() {
      const begin = () => app.start();
      start.addEventListener('click', begin);
      window.addEventListener('keydown', () => { if (!app.started && !start.hidden) begin(); });
      screen.addEventListener('pointerdown', () => { app.start(); canvas.focus({ preventScroll: true }); });
      window.addEventListener('paste', (e) => {
        if (!panel.hidden) return;
        const text = (e.clipboardData || window.clipboardData).getData('text');
        if (text) { e.preventDefault(); app.typeText(text.replace(/\r\n?/g, '\r').replace(/\n/g, '\r')); }
      });
      fileInput.addEventListener('change', () => {
        if (fileInput.files[0]) app.loadFile(fileInput.files[0], { run: loadAndRun }).catch((e) => ui.message(String(e.message || e), 5000));
        fileInput.value = '';
      });
      if (canLoad) {
        let depth = 0;
        container.addEventListener('dragenter', (e) => { e.preventDefault(); depth++; drop.hidden = false; });
        container.addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; drop.hidden = true; } });
        container.addEventListener('dragover', (e) => e.preventDefault());
        container.addEventListener('drop', (e) => {
          e.preventDefault();
          depth = 0;
          drop.hidden = true;
          const f = e.dataTransfer.files[0];
          if (f) app.loadFile(f, { run: !e.shiftKey }).catch((err) => ui.message(String(err.message || err), 5000));
        });
      }
      if (window.ResizeObserver) new ResizeObserver(() => ui.resize()).observe(screen);
      window.addEventListener('resize', () => ui.resize());
      document.addEventListener('fullscreenchange', () => ui.resize());
    },
  };
  return ui;
}
