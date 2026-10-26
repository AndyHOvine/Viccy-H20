import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const tests = ['boot.mjs', 'drive.mjs', 'tape.mjs', 'media.mjs', 'cpu.mjs'];
let failed = 0;
for (const t of tests) {
  const file = fileURLToPath(new URL(t, import.meta.url));
  console.log(`\n=== ${t}`);
  const r = spawnSync(process.execPath, [file], { stdio: 'inherit' });
  if (r.status !== 0) failed++;
}
console.log(failed ? `\n${failed} test file(s) failed` : '\nall tests passed');
process.exit(failed ? 1 : 0);
