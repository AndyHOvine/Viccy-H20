export default {
  ui: { title: 'Mega Quest' },
  memory: 'unexpanded',
  media: {
    carts: [
      'games/megaquest-2000.prg',
      'games/megaquest-a000.prg',
      { url: 'games/extra.bin', address: 0x6000 },
    ],
  },
};
