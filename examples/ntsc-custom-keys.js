export default {
  ui: { title: 'Racer' },
  model: 'ntsc',
  memory: '8k',
  media: { disk: 'games/racer.d64' },

  autostart: 'LOAD"RACER",8,1\rSYS 4621\r',

  joystick: {
    keyboard: true,
    keys: {
      up: ['KeyW', 'ArrowUp'], down: ['KeyS', 'ArrowDown'],
      left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'], fire: ['Space', 'KeyJ'],
    },
  },
};
