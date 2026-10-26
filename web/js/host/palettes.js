// VIC colour model derived from VICE src/vic20/vic-color.c, written by John Selck
// (YUV research by Philip Timmermann and John Selck), Copyright (C) The VICE Team.
// Ported to JavaScript and modified for Viccy, 2026. GPL v2 or later, see LICENSE.

const RGB = {
  'mike-pal': [
    0x000000, 0xFFFFFF, 0xB61F21, 0x4DF0FF, 0xB43FFF, 0x44E237, 0x1A34FF, 0xDCD71B,
    0xCA5400, 0xE9B072, 0xE79293, 0x9AF7FD, 0xE09FFF, 0x8FE493, 0x8290FF, 0xE5DE85,
  ],
  'mike-ntsc': [
    0x000000, 0xFFFFFF, 0xF91137, 0x35F9F6, 0xFF3CC6, 0x3CEDA9, 0x0F57F7, 0xFEE963,
    0xFB6244, 0xFBBFDE, 0xF3ACE5, 0xA8EADD, 0xE6B8F7, 0xABDDA4, 0x6AB3E7, 0xF7DAA5,
  ],
  colodore: [
    0x000000, 0xFFFFFF, 0x6D2327, 0xA0FEF8, 0x8E3C97, 0x7EDA75, 0x252390, 0xFFFF86,
    0xA4643B, 0xFFC8A1, 0xF2A7AB, 0xDBFFFF, 0xFFB4FF, 0xD7FFCE, 0x9D9AFF, 0xFFFFC9,
  ],
  'vice-classic': [
    0x000000, 0xFFFFFF, 0xF00000, 0x00F0F0, 0x600060, 0x00A000, 0x0000F0, 0xD0D000,
    0xC0A000, 0xFFA000, 0xF08080, 0x00FFFF, 0xFF00FF, 0x00FF00, 0x00A0FF, 0xFFFF00,
  ],
};

const VIC_SATURATION = 63.0;
const VIC_PHASE = -9.5;
const A_RED = 112.5, A_GRN = -135.0, A_BLU = 0.0, A_ORN = -45.0;

const VIC_COLORS_PAL = [
  [0, A_ORN, 0], [256, A_ORN, 0], [51, A_RED, 1], [157, A_RED, -1],
  [75, A_GRN, -1], [132, A_GRN, 1], [47, A_BLU, 1], [183, A_BLU, -1],
  [85, A_ORN, -1], [161, A_ORN, -1], [144, A_RED, 1], [208, A_RED, -1],
  [158, A_GRN, -1], [191, A_GRN, 1], [129, A_BLU, 1], [234, A_BLU, -1],
];

const VIC_COLORS_NTSC = [
  [0, A_ORN, 0], [256, A_ORN, 0], [51, A_RED, 1], [157, A_RED, -1],
  [75, A_GRN + 35, -1], [132, A_GRN + 45, 1], [47, A_BLU, 1], [183, A_BLU, -1],
  [85, A_ORN, -1], [161, A_ORN - 30, -1], [144, A_RED - 30, 1], [208, A_RED, -1],
  [158, A_GRN, -1], [191, A_GRN + 30, 1], [129, A_BLU, 1], [234, A_BLU, -1],
];

export const PALETTE_NAMES = [...Object.keys(RGB), 'vice'];

const DEG = Math.PI / 180;

function rgbToYcbcr(r, g, b) {
  return [
    0.2989 * r + 0.5866 * g + 0.1145 * b,
    -0.168736 * r - 0.331264 * g + 0.5 * b,
    0.5 * r - 0.418688 * g - 0.081312 * b,
  ];
}

export function ycbcrToRgb(y, cb, cr) {
  const c = (v) => Math.max(0, Math.min(255, v));
  return [c(y + 1.402 * cr), c(y - 0.344136 * cb - 0.714136 * cr), c(y + 1.772 * cb)];
}

function cbmToYcbcr([lum, angle, dir], ntsc) {
  const sat = VIC_SATURATION / 1.75;
  if (dir === 0) return [lum, 0, 0];
  if (!ntsc) {
    const u = sat * Math.cos((angle + VIC_PHASE) * DEG);
    const v = sat * Math.sin((angle + VIC_PHASE) * DEG);
    return [lum, (dir * u) / 0.493111, (dir * v) / 0.877283];
  }
  const i = dir * sat * Math.sin((angle + VIC_PHASE - 100 / 3) * DEG);
  const q = dir * sat * Math.cos((angle + VIC_PHASE - 100 / 3) * DEG);
  const r = lum + 1.630 * i + 0.317 * q;
  const g = lum - 0.378 * i - 0.466 * q;
  const b = lum - 1.089 * i + 1.677 * q;
  return rgbToYcbcr(r, g, b);
}

export function paletteYcbcr(name, ntsc) {
  if (name === 'vice' || !RGB[name]) {
    return (ntsc ? VIC_COLORS_NTSC : VIC_COLORS_PAL).map((c) => cbmToYcbcr(c, ntsc));
  }
  return RGB[name].map((v) => rgbToYcbcr(v >> 16, (v >> 8) & 255, v & 255));
}

export function paletteRgb(name, ntsc) {
  if (RGB[name]) {
    return Uint8Array.from(RGB[name].flatMap((v) => [v >> 16, (v >> 8) & 255, v & 255]));
  }
  return Uint8Array.from(paletteYcbcr(name, ntsc).flatMap(([y, cb, cr]) => ycbcrToRgb(y, cb, cr).map(Math.round)));
}
