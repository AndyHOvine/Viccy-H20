# Viccy

A VIC-20 emulator in plain JavaScript for the web browser, made for VIC-20 games.
A published game is a folder of static files with no dependencies.

- Cycle-exact 6502, including the undocumented opcodes
- 6561 (PAL) and 6560 (NTSC) VIC chip with VIC sound
- Memory expansions from unexpanded to 35K
- 1541 disk drive (reads and writes D64), datasette (TAP), PRG, T64,
  cartridges (single and multi-part, VICE `.crt`), ZIP files
- CRT emulation and CRT filter (bulge, rounded corners, scanlines, RGB mask, tint)
- Keyboard joystick (switch with F9), gamepads, touch controls on phones
- Contains HEWCO's CRT filter for a nostalgic 1980's experience

---

## 1. Set up

1. Install **Node.js 18 or newer** from https://nodejs.org/ (the LTS version is fine).
   Check it in a terminal:
   ```
   node --version
   ```
2. Open a terminal in this folder (the one with `run.bat` in it).
3. Linux and macOS only, once: make the scripts runnable.
   ```
   chmod +x run.sh build.sh
   ```
4. Put the VIC-20 and 1541 ROMs in `web/roms/` (see below).

Nothing else needs installing.

### ROMs

IMPORTANT: The Commodore ROMs are not included. Viccy won't start without them. 
You will need a copy of these five files in `web/roms/`, renamed as shown:

| File | Size | ROM | Name in VICE |
| --- | --- | --- | --- |
| `basic.rom` | 8 KB | VIC-20 BASIC | `basic-901486-01.bin` |
| `kernal_pal.rom` | 8 KB | VIC-20 KERNAL, PAL | `kernal.901486-07.bin` |
| `kernal_ntsc.rom` | 8 KB | VIC-20 KERNAL, NTSC | `kernal.901486-06.bin` |
| `char.rom` | 4 KB | VIC-20 character set | `chargen-901460-03.bin` |
| `dos1541.rom` | 16 KB | 1541 drive DOS | `dos1541-325302-01+901229-05.bin` |

VICE keeps them in its `VIC20` and `DRIVES` data folders. Older VICE versions use
other names, such as `basic`, `kernal`, `chargen` and `dos1541`.

SHA-1 checksums of the expected files:

```
587d1e90950675ab6b12d91248a3f0d640d02e8d  basic.rom
ce0137ed69f003a299f43538fa9eee27898e621e  kernal_pal.rom
06de7ec017a5e78bd6746d89c2ecebb646efeb19  kernal_ntsc.rom
4fd85ab6647ee2ac7ba40f729323f2472d35b9b4  char.rom
ab16f56989b27d89babe5f89c5a8cb3da71a82f0  dos1541.rom
```

`web/roms/blank.d64` is a blank disk.

---

## 2. Running

| | Windows | Linux / macOS |
| --- | --- | --- |
| Boot into BASIC | `run.bat` | `./run.sh` |
| Load a game | `run.bat C:\games\mygame.d64` | `./run.sh ~/games/mygame.d64` |
| Load with settings | `run.bat mygame.prg memory=8k model=ntsc` | `./run.sh mygame.prg memory=8k model=ntsc` |

The game file can be anywhere on your disk: D64, TAP, PRG, T64, CRT, a cartridge
binary or a ZIP. Its type is worked out automatically. The browser opens on its own;
press **Ctrl+C** in the terminal to stop.

Settings you can add after the file:

| Setting | Example | Meaning |
| --- | --- | --- |
| `memory` | `memory=8k` | `unexpanded`, `3k`, `8k`, `16k`, `24k`, `32k`, `35k` or `auto` |
| `model` | `model=ntsc` | `pal` or `ntsc` |
| `joykeys` | `joykeys=0` | keyboard joystick on (`1`) or off (`0`) at start |
| `crt` / `filter` | `crt=0 filter=0` | CRT emulation / CRT filter on or off |
| `palette` | `palette=colodore` | `mike-pal`, `mike-ntsc`, `vice`, `colodore`, `vice-classic` |
| `drive` | `drive=fast` | `accurate` (emulated 1541) or `fast` (instant LOAD) |
| `autostart` | `autostart=0` | `1`, `0`, or text to type |
| `title` | `title="My Game"` | name on the start screen |
| `minimal` | `minimal=1` | minimal toolbar |

You can also drag a file onto the emulator, or use the folder button in the
toolbar. Hold **Shift** while doing either to attach the file without running it.

To run the tests: `npm test`.

---

## 3. Building

Building makes a folder and a ZIP in `dist/`, ready to upload.

| What | Windows | Linux / macOS |
| --- | --- | --- |
| Package as set up in `web/config.js` | `build.bat` | `./build.sh` |
| Package one game file | `build.bat C:\games\mygame.d64 title="My Game"` | `./build.sh ~/games/mygame.d64 title="My Game"` |
| Choose the package name | `build.bat --name mygame` | `./build.sh --name mygame` |

The result is `dist/<name>/` (the files) and `dist/<name>-itch.zip` (the same files
zipped, with `index.html` at the top of the ZIP).

To try a built package before uploading:

```
node tools/serve.mjs --root dist/mygame --open
```

### Packaging your own config

There are two ways to make a package for a game.

**A. Let the build write the config.** Give the game file and any settings:

```
build.bat C:\games\mygame.d64 title="My Game" memory=8k joykeys=1 --name mygame
```

The game is copied into `dist/mygame/games/`, and `dist/mygame/config.js` is
generated to load it, on top of the defaults in `web/config.js`.

**B. Write the config yourself.**

1. Copy your game files into `web/games/`.
2. Edit `web/config.js` (examples below), for example:
   ```js
   export default {
     ui: { title: 'My Game' },
     memory: '8k',
     media: { disk: 'games/mygame.d64' },
   };
   ```
3. Check it with `run.bat` (or `./run.sh`).
4. Build it:
   ```
   build.bat --name mygame
   ```

Either way you get `dist/mygame-itch.zip` to upload.

**Zipping by hand.** The package is just the contents of the `web/` folder. To zip
it yourself, select everything *inside* `web/` (`index.html`, `config.js`, `css`,
`js`, `roms`, `games`) and zip those, so that `index.html` is at the top of the ZIP,
not inside a folder.

---

## 4. Config examples

Paths in the config are relative to `index.html`, so they all start with `games/`.

### A disk game

```js
export default {
  ui: { title: 'Space Blaster' },
  memory: 'auto',
  media: { disk: 'games/spaceblaster.d64' },
};
```

It loads with `LOAD"*",8,1` and `RUN`. To load a particular file instead, add
`autostartFile: 'BLASTER'`.

### A tape game that needs 16K

```js
export default {
  ui: { title: 'Cave Run' },
  memory: '16k',
  media: { tape: 'games/caverun.tap' },
};
```

Tapes play with PLAY pressed and load at full speed. `memory: 'auto'` gives tapes
+35K, so set `memory` for tape games that need less.

### A PRG

```js
export default {
  ui: { title: 'Maze' },
  media: { prg: 'games/maze.prg' },
};
```

### A cartridge in several parts

```js
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
```

Cartridge addresses come from the file name (`-2000`, `-a000`), the PRG load
address, or `address` for raw binaries.

### An NTSC game with its own keys and a custom start command

```js
export default {
  ui: { title: 'Racer' },
  model: 'ntsc',
  memory: '8k',
  media: { disk: 'games/racer.d64' },
  autostart: 'LOAD"RACER",8,1\rSYS 4621\r',
  joystick: {
    keyboard: true,
    keys: { up: 'KeyW', down: 'KeyS', left: 'KeyA', right: 'KeyD', fire: ['Space', 'KeyJ'] },
  },
};
```

`\r` is RETURN. Key names are browser key codes: `KeyA`–`KeyZ`, `Digit0`–`Digit9`,
`ArrowUp`, `Space`, `ShiftLeft`, `ControlRight` and so on.

### A locked-down page for players

```js
export default {
  ui: { title: 'Space Blaster', minimal: true },
  media: { disk: 'games/spaceblaster.d64' },
};
```

The minimal view keeps pause, the keyboard joystick switch, the CRT button, sound
and fullscreen, and hides reset, warp, load, unload and settings.

### Plain pixels, no CRT

```js
export default {
  media: { prg: 'games/maze.prg' },
  video: { crt: false, filter: false, integerScale: true },
};
```

---

## 5. Publishing on itch.io

1. **Build the package**, for example:
   ```
   build.bat C:\games\mygame.d64 title="My Game" --name mygame
   ```
2. **Check it**:
   ```
   node tools/serve.mjs --root dist/mygame --open
   ```
3. **Create the project** on https://itch.io/game/new:
   - **Kind of project**: **HTML**.
   - **Uploads**: upload `dist/mygame-itch.zip` and tick
     **This file will be played in the browser**.
4. **Embed options**:
   - **Viewport dimensions**: **960 × 776** fits the PAL picture plus the toolbar.
   - Tick **Fullscreen button**.
   - Tick **Mobile friendly** for phone players; touch controls appear on their own.
   - Leave **SharedArrayBuffer support** off.
5. **Save** and use **View page** to try it. Players click *Click to start*, which is
   needed for sound and keyboard focus.

To update the game, build again and replace the ZIP on the same page.

Players' choices (CRT on or off, keyboard joystick, display settings, volume) are
remembered in their browser and shared between all Viccy games on itch.io.
Set `persistShared: false` to keep a game's choices to itself, or `persist: false`
to remember nothing.

---

## Reference

### All config options

| Option | Values | Default |
| --- | --- | --- |
| `model` | `'pal'`, `'ntsc'` | `'pal'` |
| `memory` | `'auto'`, `'unexpanded'`, `'3k'`, `'8k'`, `'16k'`, `'24k'`, `'32k'`, `'35k'`, or blocks such as `['ram123', 'blk1', 'blk5']` | `'auto'` |
| `media.disk` | URL of a `.d64` (or `.zip`) | |
| `media.tape` | URL of a `.tap` | |
| `media.prg` | URL of a `.prg`, `.p00` or `.t64` | |
| `media.carts` | list of URLs, or `{ url, address }` for raw images | |
| `media.file` | URL of any supported file; the type is detected | |
| `autostart` | `true`, `false`, or text to type | `true` |
| `autostartFile` | disk file to load | `'*'` |
| `autostartMode` | `'absolute'` (`,8,1`) or `'basic'` (`,8`) | `'absolute'` |
| `type` | extra text typed once BASIC is ready, after autostart | `''` |
| `drive.enabled` | `'auto'` (when a disk is attached), `true`, `false` | `'auto'` |
| `drive.mode` | `'accurate'` or `'fast'` | `'accurate'` |
| `warp.auto` | full speed while the disk drive or tape is busy | `true` |
| `joystick.keyboard` | start with the keyboard joystick on | `true` |
| `joystick.keys` | `{ up, down, left, right, fire }`: one key code or a list per direction | cursor keys and numpad; fire = Right Ctrl, `\`, Right Alt, Numpad 0 |
| `joystick.buttons` | gamepad button to VIC key, e.g. `{ 9: 'F1', 8: 'SPACE' }` | `{}` |
| `keyboardMap` | `'symbolic'` or `'positional'` | `'symbolic'` |
| `video.crt` | `true`, `false`, or CRT emulation settings | `true` |
| `video.filter` | `true`, `false`, or CRT filter settings | `true` |
| `video.palette` | `'mike-pal'`, `'mike-ntsc'`, `'vice'`, `'colodore'`, `'vice-classic'` | `'mike-pal'` |
| `video.border` | `'normal'`, `'full'`, `'tight'` | `'normal'` |
| `video.aspect` | `'tv'` (non-square pixels) or `'square'` | `'tv'` |
| `video.integerScale` | `true`, `false` | `false` |
| `audio.volume` | 0 to 1 | `0.7` |
| `ui.title` | name on the start screen and toolbar | `'VIC-20'` |
| `ui.minimal` | minimal toolbar | `false` |
| `ui.toolbar`, `ui.settings` | show the toolbar / the settings panel | `true` |
| `ui.clickToStart` | show the start screen (needed for sound) | `true` |
| `ui.touchControls` | `'auto'`, `true`, `false` | `'auto'` |
| `ui.touchKeys` | VIC keys shown as touch buttons | F1 F3 F5 F7 SPACE RETURN Y N |
| `ui.allowFileDrop` | let players load their own files | `true` |
| `hotkeys` | `{ joystickToggle: 'F9', warp: 'F10', fullscreen: 'F11', reset: '' }` | |
| `persist` | remember each player's choices in their browser | `true` |
| `persistShared` | share those choices with every Viccy page on the same site | `true` |
| `urlParams` | allow `?disk=` style overrides in the page address | `true` |

**CRT emulation settings** (`video.crt`) and defaults: `blur` 100, `scanlineShade` 800,
`saturation`, `contrast`, `brightness`, `tint` 1000 (neutral), `gamma` 2200,
`oddLinesPhase` and `oddLinesOffset` 1125.

**CRT filter settings** (`video.filter`) and defaults: `scale` 1, `everyNLines` 4,
`linesDarkened` 3, `darkness` 10, `direction` `'rows'` (or `'columns'`), `bulge` 8,
`corners` 17, `cornerDot` 2, `bleed` 12, `glow` 5, `mask` 3, `maskShape` `'dots'`
(or `'stripes'`, `'stripes-gaps'`, `'slots'`), `maskWidth` 3, `tintColor` `'#ffb000'`,
`tint` 6, `roll` -1, `rollingBar` 0. Percentages are 0–100.

**Automatic memory**: with `memory: 'auto'`, the load address of the PRG (or of the
first file on the disk) decides: `$1001` unexpanded, `$0401` +3K. Anything else, and
any tape, cartridge or file it can't look inside, gets +35K.

### Controls

| PC | VIC-20 |
| --- | --- |
| Esc | RUN/STOP |
| Page Up, F12 | RESTORE |
| Tab, Left Alt | C= |
| Ctrl | CTRL |
| Home / End | CLR/HOME / shift+CLR/HOME |
| Backspace, Delete / Insert | DEL / INST |
| Cursor keys | cursor (when the keyboard joystick is off) |
| F1–F8 | F1–F8 |
| F9 | keyboard joystick on or off |
| F10 | warp |
| F11 | fullscreen |

Typing is symbolic: what is printed on your key is what the VIC types. Paste text
(Ctrl+V) to type it into BASIC. Gamepads work automatically. Players can change the
joystick keys in the settings panel.

---

## Licence

Viccy is free software under the GNU General Public License, version 2 or (at your
option) any later version. See `LICENSE`. The Commodore ROMs are not part of Viccy
and are not covered by this licence.
