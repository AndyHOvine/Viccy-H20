import assert from 'node:assert/strict';
import fs from 'node:fs';
import { makeMachine, runSeconds, screenText } from './util.mjs';
import { D64 } from '../../web/js/emu/d64.js';

const blank = new Uint8Array(fs.readFileSync(new URL('../../web/roms/blank.d64', import.meta.url)));
const m = makeMachine({ model: 'pal', memory: 'unexpanded', driveEnabled: true });
m.insertDisk(blank);
runSeconds(m, 3);

const t0 = performance.now();
m.typeText('10 PRINT"HELLO WORLD"\rSAVE"TEST",8\r');
runSeconds(m, 25);
let text = screenText(m);
console.log(text.filter(Boolean).join('\n'));
assert.ok(!text.some((l) => l.includes('DEVICE NOT PRESENT')), 'drive not answering');

const disk = new D64(m.diskImage());
const files = disk.directory().map((f) => f.name);
console.log('directory:', files);
assert.ok(files.includes('TEST'), 'saved file missing from D64');

m.typeText('NEW\rLOAD"TEST",8\rLIST\r');
runSeconds(m, 25);
text = screenText(m);
console.log(text.filter(Boolean).join('\n'));
assert.ok(text.some((l) => l.includes('10 PRINT"HELLO WORLD"')), 'LIST output missing');
console.log(`drive: ok (${((performance.now() - t0) / 1000).toFixed(1)}s host time for 50s emulated)`);
