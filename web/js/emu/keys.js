const LAYOUT = [
  ['1', 0, 0], ['3', 0, 1], ['5', 0, 2], ['7', 0, 3], ['9', 0, 4], ['+', 0, 5], ['POUND', 0, 6], ['DEL', 0, 7],
  ['LEFTARROW', 1, 0], ['W', 1, 1], ['R', 1, 2], ['Y', 1, 3], ['I', 1, 4], ['P', 1, 5], ['*', 1, 6], ['RETURN', 1, 7],
  ['CTRL', 2, 0], ['A', 2, 1], ['D', 2, 2], ['G', 2, 3], ['J', 2, 4], ['L', 2, 5], [';', 2, 6], ['CRSRRIGHT', 2, 7],
  ['RUNSTOP', 3, 0], ['LSHIFT', 3, 1], ['X', 3, 2], ['V', 3, 3], ['N', 3, 4], [',', 3, 5], ['/', 3, 6], ['CRSRDOWN', 3, 7],
  ['SPACE', 4, 0], ['Z', 4, 1], ['C', 4, 2], ['B', 4, 3], ['M', 4, 4], ['.', 4, 5], ['RSHIFT', 4, 6], ['F1', 4, 7],
  ['CBM', 5, 0], ['S', 5, 1], ['F', 5, 2], ['H', 5, 3], ['K', 5, 4], [':', 5, 5], ['=', 5, 6], ['F3', 5, 7],
  ['Q', 6, 0], ['E', 6, 1], ['T', 6, 2], ['U', 6, 3], ['O', 6, 4], ['@', 6, 5], ['UPARROW', 6, 6], ['F5', 6, 7],
  ['2', 7, 0], ['4', 7, 1], ['6', 7, 2], ['8', 7, 3], ['0', 7, 4], ['-', 7, 5], ['HOME', 7, 6], ['F7', 7, 7],
];

export const VIC_KEYS = {};
for (const [name, col, row] of LAYOUT) VIC_KEYS[name] = col * 8 + row;

export const RESTORE = 'RESTORE';

export const CHAR_TO_KEYS = (() => {
  const m = {};
  for (const c of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
    m[c.toLowerCase()] = [c, false];
    m[c] = [c, true];
  }
  for (const c of '0123456789') m[c] = [c, false];
  Object.assign(m, {
    ' ': ['SPACE', false], '+': ['+', false], '-': ['-', false], '*': ['*', false],
    '/': ['/', false], '=': ['=', false], ':': [':', false], ';': [';', false],
    ',': [',', false], '.': ['.', false], '@': ['@', false],
    '!': ['1', true], '"': ['2', true], '#': ['3', true], '$': ['4', true], '%': ['5', true],
    '&': ['6', true], "'": ['7', true], '(': ['8', true], ')': ['9', true],
    '<': [',', true], '>': ['.', true], '?': ['/', true], '[': [':', true], ']': [';', true],
    '£': ['POUND', false], '\\': ['POUND', false], '^': ['UPARROW', false], '`': ['LEFTARROW', false],
    '_': ['LEFTARROW', false], '~': ['UPARROW', true],
  });
  return m;
})();
