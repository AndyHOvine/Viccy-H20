import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath, pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
let name = null;
let gameFile = null;
const settings = {};
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--name') name = args[++i];
  else if (/^[a-z]+=/i.test(a)) settings[a.slice(0, a.indexOf('=')).toLowerCase()] = a.slice(a.indexOf('=') + 1);
  else if (gameFile) {
    console.error(`Only one game file can be given (got ${path.basename(gameFile)} and ${a}).`);
    console.error('Put names with spaces in quotes: --name "My Game"');
    process.exit(1);
  } else gameFile = path.resolve(a);
}
if (gameFile && !fs.existsSync(gameFile)) {
  console.error(`File not found: ${gameFile}`);
  process.exit(1);
}
const SETTINGS = ['memory', 'model', 'title', 'joykeys', 'crt', 'filter', 'palette', 'border', 'drive', 'autostart', 'minimal', 'touchkeys'];
const unknown = Object.keys(settings).filter((k) => !SETTINGS.includes(k));
if (unknown.length) {
  console.error(`Unknown setting: ${unknown.join(', ')}. Settings are: ${SETTINGS.join(', ')}.`);
  process.exit(1);
}
if (settings.touchkeys && settings.touchkeys.toLowerCase() !== 'none') {
  const { VIC_KEYS, SHIFTED_KEYS } = await import('../web/js/emu/keys.js');
  const bad = settings.touchkeys.split(',').map((k) => k.trim().toUpperCase())
    .filter((k) => k && VIC_KEYS[k] === undefined && !SHIFTED_KEYS[k] && k !== 'RESTORE');
  if (bad.length) {
    console.error(`Unknown touch key: ${bad.join(', ')}. Use VIC key names such as F1, F2, SPACE, RETURN, Y, N, RUNSTOP, CRSRUP.`);
    process.exit(1);
  }
}
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
if (!name) name = gameFile ? slug(path.basename(gameFile, path.extname(gameFile))) || 'game' : 'viccy-h20';

const bundledName = gameFile ? (slug(name) || 'game') + path.extname(gameFile).toLowerCase() : null;

function gameConfig() {
  const flag = (v) => !['0', 'false', 'no', 'off'].includes(String(v).toLowerCase());
  const game = bundledName ? { media: { file: 'games/' + bundledName } } : {};
  if (settings.memory) game.memory = settings.memory;
  if (settings.model) game.model = settings.model;
  if (settings.title || settings.minimal !== undefined || settings.touchkeys !== undefined) {
    game.ui = {};
    if (settings.title) game.ui.title = settings.title;
    if (settings.minimal !== undefined) game.ui.minimal = flag(settings.minimal);
    if (settings.touchkeys !== undefined) {
      game.ui.touchKeys = settings.touchkeys.toLowerCase() === 'none' ? []
        : settings.touchkeys.split(',').map((k) => k.trim().toUpperCase()).filter(Boolean);
    }
  }
  if (settings.joykeys !== undefined) game.joystick = { keyboard: flag(settings.joykeys) };
  if (settings.crt !== undefined || settings.palette || settings.filter !== undefined || settings.border) {
    game.video = {};
    if (settings.crt !== undefined) game.video.crt = flag(settings.crt);
    if (settings.filter !== undefined) game.video.filter = flag(settings.filter);
    if (settings.palette) game.video.palette = settings.palette;
    if (settings.border) game.video.border = settings.border;
  }
  if (settings.drive) game.drive = { mode: settings.drive };
  if (settings.autostart !== undefined) {
    game.autostart = ['0', '1', 'true', 'false'].includes(settings.autostart)
      ? flag(settings.autostart) : settings.autostart.replace(/\\r/g, '\r');
  }
  return game;
}

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(projectRoot, 'web');
const distRoot = path.join(projectRoot, 'dist');
const outDir = path.join(distRoot, name);
const zipFile = path.join(distRoot, `${name}-itch.zip`);

const EXCLUDE = [/^games[\\/]\.gitkeep$/, /\.map$/];

function walk(dir, base = dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full, base));
    else {
      const rel = path.relative(base, full);
      if (!EXCLUDE.some((re) => re.test(rel))) out.push(rel);
    }
  }
  return out;
}

fs.rmSync(outDir, { recursive: true, force: true });
for (const rel of walk(src)) {
  const to = path.join(outDir, rel);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(path.join(src, rel), to);
}

if (gameFile) {
  fs.mkdirSync(path.join(outDir, 'games'), { recursive: true });
  fs.copyFileSync(gameFile, path.join(outDir, 'games', bundledName));
  if (path.relative(path.join(src, 'games'), path.dirname(gameFile)) === '' && path.basename(gameFile) !== bundledName) {
    fs.rmSync(path.join(outDir, 'games', path.basename(gameFile)));
  }
} else {
  const base = (await import(pathToFileURL(path.join(src, 'config.js')).href)).default;
  const m = base.media || {};
  const used = [m.disk, m.tape, m.prg, m.file, ...(m.carts || [])].filter(Boolean)
    .map((c) => path.basename(typeof c === 'string' ? c : c.url || ''));
  const unused = fs.readdirSync(path.join(src, 'games')).filter((f) => !f.startsWith('.') && !used.includes(f));
  if (unused.length) {
    console.warn(`Warning: web/config.js does not load ${unused.map((f) => 'games/' + f).join(', ')}.`);
    console.warn(`  Set media in web/config.js, or give the file: build.bat web\\games\\${unused[0]} title="..."`);
  }
}

if (gameFile || Object.keys(settings).length) {
  fs.renameSync(path.join(outDir, 'config.js'), path.join(outDir, 'config.base.js'));
  fs.writeFileSync(path.join(outDir, 'config.js'),
    `import base from './config.base.js';\n\n` +
    `const game = ${JSON.stringify(gameConfig(), null, 2)};\n\n` +
    `const merged = { ...base, ...game };\n` +
    `for (const k of ['ui', 'joystick', 'video', 'drive']) {\n` +
    `  if (game[k]) merged[k] = { ...(base[k] || {}), ...game[k] };\n` +
    `}\n\n` +
    `export default merged;\n`);
}

const files = walk(outDir).sort();

const CRC = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 255] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

const now = new Date();
const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();

const locals = [];
const centrals = [];
let offset = 0;
for (const rel of files) {
  const data = fs.readFileSync(path.join(outDir, rel));
  const zname = Buffer.from(rel.split(path.sep).join('/'));
  const deflated = zlib.deflateRawSync(data, { level: 9 });
  const store = deflated.length >= data.length;
  const body = store ? data : deflated;
  const crc = crc32(data);

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034B50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0x0800, 6);
  local.writeUInt16LE(store ? 0 : 8, 8);
  local.writeUInt16LE(dosTime, 10);
  local.writeUInt16LE(dosDate, 12);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(body.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(zname.length, 26);
  locals.push(local, zname, body);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014B50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0x0800, 8);
  central.writeUInt16LE(store ? 0 : 8, 10);
  central.writeUInt16LE(dosTime, 12);
  central.writeUInt16LE(dosDate, 14);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(body.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(zname.length, 28);
  central.writeUInt32LE(offset, 42);
  centrals.push(central, zname);

  offset += 30 + zname.length + body.length;
}
const centralBuf = Buffer.concat(centrals);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054B50, 0);
end.writeUInt16LE(files.length, 8);
end.writeUInt16LE(files.length, 10);
end.writeUInt32LE(centralBuf.length, 12);
end.writeUInt32LE(offset, 16);
fs.mkdirSync(distRoot, { recursive: true });
fs.writeFileSync(zipFile, Buffer.concat([...locals, centralBuf, end]));

const kb = (fs.statSync(zipFile).size / 1024).toFixed(0);
console.log(`Built ${path.relative(projectRoot, outDir)}/ (${files.length} files)`);
console.log(`itch.io package: ${path.relative(projectRoot, zipFile)} (${kb} KB)`);
