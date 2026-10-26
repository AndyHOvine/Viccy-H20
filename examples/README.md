# Example configs

Ready-made `config.js` files for common kinds of game. Pick the one closest to
yours, copy it into place, change the file name and title, and build.

| File | For |
| --- | --- |
| `disk-game.js` | a disk image (`.d64`) |
| `tape-game.js` | a tape image (`.tap`) that needs a memory expansion |
| `prg-game.js` | a single program file (`.prg`, `.p00`, `.t64`) |
| `cartridge.js` | a cartridge in one or more parts |
| `ntsc-custom-keys.js` | an NTSC game with its own joystick keys and start command |
| `itch-minimal.js` | a locked-down page for players, with the minimal toolbar |
| `no-crt.js` | sharp pixels, no CRT effects |
| `all-options.js` | every option with its default value, to start from scratch |

## Using one

1. **Put your game file in `web/games/`**, for example `web/games/mygame.d64`.

2. **Copy the example over `web/config.js`.** This replaces the config that is
   there, so copy `web/config.js` somewhere first if you have changed it.

   Windows:
   ```
   copy examples\disk-game.js web\config.js
   ```
   Linux / macOS:
   ```
   cp examples/disk-game.js web/config.js
   ```

3. **Edit `web/config.js`**: change the file name after `games/` to your game's
   file name, and the title to your game's name. For example:
   ```js
   ui: { title: 'My Game' },
   media: { disk: 'games/mygame.d64' },
   ```
   Paths are relative to `index.html`, so they always start with `games/`.

4. **Try it** in the browser:

   | Windows | Linux / macOS |
   | --- | --- |
   | `run.bat` | `./run.sh` |

5. **Build the package** for itch.io:

   | Windows | Linux / macOS |
   | --- | --- |
   | `build.bat --name mygame` | `./build.sh --name mygame` |

   You get `dist/mygame/` and `dist/mygame-itch.zip`. If the build warns that
   `web/config.js` does not load a file in `web/games/`, the name in `media`
   doesn't match the file: check step 3.

Don't give the game file to `build.bat` when you use a config like this. That
is the quick route, which makes its own config from the command line (see
*Building* in the main README); here the config comes from `web/config.js`.

Every option is described in the main [README](../README.md), under
*Reference: All config options*.
