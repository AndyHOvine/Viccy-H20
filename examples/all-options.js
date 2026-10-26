export default {
  model: 'pal',

  memory: 'auto',

  media: {},

  autostart: true,
  autostartFile: '*',
  autostartMode: 'absolute',
  type: '',

  drive: {
    enabled: 'auto',
    mode: 'accurate',
  },

  warp: { auto: true },

  joystick: {
    keyboard: true,
    gamepad: true,
    keys: {
      up: ['ArrowUp', 'Numpad8'],
      down: ['ArrowDown', 'Numpad2', 'Numpad5'],
      left: ['ArrowLeft', 'Numpad4'],
      right: ['ArrowRight', 'Numpad6'],
      fire: ['ControlLeft', 'ControlRight', 'Numpad0', 'AltRight'],
      upleft: ['Numpad7'], upright: ['Numpad9'], downleft: ['Numpad1'], downright: ['Numpad3'],
    },
    buttons: {},
  },

  keyboardMap: 'symbolic',

  video: {
    crt: true,
    filter: true,
    palette: 'mike-pal',
    border: 'normal',
    aspect: 'tv',
    integerScale: false,
  },

  audio: { volume: 0.7 },

  ui: {
    title: 'VIC-20',
    minimal: false,
    toolbar: true,
    settings: true,
    clickToStart: true,
    touchControls: 'auto',
    touchKeys: ['F1', 'F3', 'F5', 'F7', 'SPACE', 'RETURN', 'Y', 'N'],
    allowFileDrop: true,
    saveStates: true,
  },

  hotkeys: { joystickToggle: 'F9', warp: 'F10', fullscreen: 'F11', reset: '', saveState: 'Shift+F9', loadState: 'Shift+F10' },

  persist: true,
  persistShared: true,
  urlParams: true,
};
