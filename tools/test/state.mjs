import assert from 'node:assert/strict';
import fs from 'node:fs';
import { makeMachine, runSeconds, screenText } from './util.mjs';
import { D64 } from '../../web/js/emu/d64.js';

function same(a, b, what) {
  assert.equal(a.cycles, b.cycles, `${what}: cycles`);
  assert.deepEqual(a.cpu, b.cpu, `${what}: CPU`);
  assert.ok(Buffer.compare(Buffer.from(a.mem), Buffer.from(b.mem)) === 0, `${what}: memory`);
  assert.ok(Buffer.compare(Buffer.from(a.fb), Buffer.from(b.fb)) === 0, `${what}: screen`);
  assert.deepEqual(a.drive, b.drive, `${what}: drive`);
}

function snapshot(m) {
  const c = m.cpu;
  return {
    cycles: m.cycles,
    cpu: [c.a, c.x, c.y, c.s, c.pc, c.getP(0)],
    mem: m.mem.slice(), fb: m.vic.fb.slice(),
    drive: m.drive && [m.drive.cycles, m.drive.cpu.pc, m.drive.halfTrack, m.drive.headPos, [...m.drive.ram]],
  };
}

function restore(state) {
  const s = structuredClone(state);
  const m = makeMachine({ model: s.model, memory: s.memory });
  m.loadState(s);
  return m;
}

{
  const blank = new Uint8Array(fs.readFileSync(new URL('../../web/roms/blank.d64', import.meta.url)));
  const a = makeMachine({ model: 'pal', memory: '8k', driveEnabled: true });
  a.insertDisk(blank);
  runSeconds(a, 3);
  a.typeText('10 PRINT"SAVED BY STATE"\rSAVE"STATE",8\r');
  runSeconds(a, 4);
  assert.ok(a.drive.motor, 'drive should be busy when the state is taken');
  const state = a.saveState();
  runSeconds(a, 20);
  const b = restore(state);
  runSeconds(b, 20);
  same(snapshot(a), snapshot(b), 'disk');
  const files = new D64(b.diskImage()).directory().map((f) => f.name);
  assert.ok(files.includes('STATE'), 'restored machine did not finish the SAVE');
  console.log('disk save state: ok', files);
}

{
  const rec = makeMachine({ model: 'ntsc', memory: 'unexpanded' });
  runSeconds(rec, 3);
  rec.datasette.record();
  rec.typeText('10 PRINT"TAPE STATE"\rSAVE"T"\r');
  runSeconds(rec, 40);
  const tap = rec.datasette.finishRecording();

  const a = makeMachine({ model: 'ntsc', memory: 'unexpanded' });
  a.insertTape(tap);
  runSeconds(a, 3);
  a.datasette.play();
  a.typeText('LOAD\r');
  runSeconds(a, 15);
  assert.ok(a.datasette.running, 'tape should be playing when the state is taken');
  const state = a.saveState();
  runSeconds(a, 45);
  const b = restore(state);
  runSeconds(b, 45);
  same(snapshot(a), snapshot(b), 'tape');
  b.typeText('LIST\r');
  runSeconds(b, 2);
  assert.ok(screenText(b).some((l) => l.includes('10 PRINT"TAPE STATE"')), 'restored machine did not finish the LOAD');
  console.log('tape save state: ok');
}

assert.throws(() => makeMachine({ model: 'pal' }).loadState(makeMachine({ model: 'ntsc' }).saveState()));
console.log('state: ok');
