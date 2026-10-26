import fs from 'node:fs';
import { Cpu6502 } from '../../web/js/emu/cpu6502.js';

const file = process.argv[2] || process.env.KLAUS_TEST_BIN;
if (!file || !fs.existsSync(file)) {
  console.log('cpu: skipped (pass the path to 6502_functional_test.bin)');
  process.exit(0);
}

const mem = new Uint8Array(fs.readFileSync(file));
let cycles = 0;
const bus = {
  read(a) { cycles++; return mem[a]; },
  write(a, v) { cycles++; mem[a] = v; },
};
const cpu = new Cpu6502(bus);
cpu.pc = 0x0400;

const SUCCESS = 0x3469;
let last = -1;
const t0 = performance.now();
for (;;) {
  const pc = cpu.pc;
  cpu.step();
  if (cpu.pc === pc && pc === last) break;
  last = pc;
}
const secs = (performance.now() - t0) / 1000;
console.log(`stopped at $${cpu.pc.toString(16)} after ${cycles} cycles (${(cycles / secs / 1e6).toFixed(1)} MHz)`);
if (cpu.pc !== SUCCESS) {
  console.error('cpu: FAILED');
  process.exit(1);
}
console.log('cpu: ok');
