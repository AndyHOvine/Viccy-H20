import assert from 'node:assert/strict';
import { makeMachine, runSeconds, screenText } from './util.mjs';

const m = makeMachine({ model: 'pal', memory: 'unexpanded' });
runSeconds(m, 3);

m.datasette.record();
m.typeText('10 PRINT"TAPE OK"\rSAVE"PROG"\r');
runSeconds(m, 40);
let text = screenText(m);
console.log(text.filter(Boolean).join('\n'));
assert.ok(text.some((l) => l.startsWith('SAVING PROG')), 'save did not start');
const tap = m.datasette.finishRecording();
console.log(`recorded TAP: ${tap.length} bytes`);
assert.ok(tap.length > 10000, 'TAP suspiciously small');

m.datasette.rewind();
m.datasette.play();
m.typeText('NEW\rLOAD\r');
runSeconds(m, 60);
m.typeText('LIST\r');
runSeconds(m, 2);
text = screenText(m);
console.log(text.filter(Boolean).join('\n'));
assert.ok(text.some((l) => l.includes('FOUND PROG')), 'header not found');
assert.ok(text.some((l) => l.includes('10 PRINT"TAPE OK"')), 'program not loaded');
console.log('tape: ok');
