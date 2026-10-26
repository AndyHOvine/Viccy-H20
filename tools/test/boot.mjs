import assert from 'node:assert/strict';
import path from 'node:path';
import { makeMachine, runSeconds, screenText, writePng } from './util.mjs';

const outDir = process.argv[2];
const cases = [
  ['pal', 'unexpanded', '3583 BYTES FREE'],
  ['ntsc', 'unexpanded', '3583 BYTES FREE'],
  ['pal', '3k', '6655 BYTES FREE'],
  ['pal', '8k', '11775 BYTES FREE'],
  ['pal', '24k', '28159 BYTES FREE'],
];

for (const [model, memory, expect] of cases) {
  const m = makeMachine({ model, memory });
  const t0 = performance.now();
  runSeconds(m, 3);
  const ms = performance.now() - t0;
  const text = screenText(m);
  if (outDir) writePng(path.join(outDir, `boot-${model}-${memory}.png`), m);
  const speed = (3000 / ms).toFixed(1);
  console.log(`${model} ${memory}: ${speed}x realtime`);
  assert.ok(text.some((l) => l.includes('CBM BASIC V2')), `banner missing:\n${text.join('\n')}`);
  assert.ok(text.some((l) => l.includes(expect)), `expected "${expect}":\n${text.join('\n')}`);
  assert.ok(text.some((l) => l.includes('READY.')), 'READY missing');
}
console.log('boot: ok');
