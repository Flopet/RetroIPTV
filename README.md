# RetroIPTV

A lightweight desktop "CRT television" that plays IPTV channels (e.g. from an
[ErsatzTV](https://ersatztv.org) server) with retro styling — scanlines, a
vignette, channel static, an on-screen display, and a programme guide.

Built with **Electron** + **[mpegts.js](https://github.com/xqq/mpegts.js)** and plain HTML/CSS/JS.
One runtime dependency, no build step.

---

## Quick start

```bash
npm install          # first time only (downloads Electron + mpegts.js)
npm start            # launch the app
```

> Run it with **`npm start`**

Out of the box it plays a few public MP4 sample channels so you can see it work
without any server. To watch your own channels, see **Configuration** below.

### Controls

| Key / Button | Action |
|---|---|
| `↑` / `↓` · CH ▲/▼ | Previous / next channel (wraps around) |
| `←` / `→` · VOL −/+ | Volume down / up |
| `0`–`9`, then pause or `Enter` | Jump directly to a channel number |
| `m` | Mute |
| `f` (or `Esc`) | Toggle fullscreen |
| ⏻ | Quit |

---

## How it's organised

Electron runs code in **three separate contexts**. The folders match them, so
where a file lives tells you what it can do:

```
RetroIPTV/
├── config.json          ← edit me: which playlist/guide to use + the look
├── .env.example         ← copy to .env for private/per-machine overrides
├── assets/              ← playlists (.m3u) and guide (.xml)
│   ├── sample/          ← public demo data (used by default)
│   └── channels.m3u     ← your private lineup (git-ignored)
└── src/
    ├── main.js          ← MAIN process (Node): creates the window
    ├── preload.js       ← BRIDGE (Node): loads data → exposes window.retro
    ├── node/            ← Node-only helpers used by preload
    │   ├── config.js    ← merge config.json + .env + env vars
    │   ├── playlist.js  ← parse the M3U into channels
    │   └── source.js    ← read text from a file or URL
    └── ui/              ← RENDERER (browser): the visible app
        ├── index.html   ← the TV's markup + the CSP
        ├── style.css    ← the entire look (bezel, CRT, OSD) — tweak freely
        ├── renderer.js  ← app logic: tuning, playback, OSD, controls
        └── epg.js       ← parse the XMLTV guide (needs the browser's DOMParser)
```

### Data flow

```
config.json ─┐
.env ────────┤→ node/config.js ─┐
                                 ├→ preload.js ──(window.retro)──→ ui/renderer.js → screen
assets/*.m3u → node/playlist.js ─┘                                      ↑
assets/*.xml ───────(raw text via source.js)───────────────→ ui/epg.js ┘
```

`preload.js` does all the file/network reading (the page can't) and hands the
results to `ui/renderer.js` through the single `window.retro` object.

---

## Configuration

### `config.json` (everyday settings)

```json
{
  "m3u": "assets/sample/channels.m3u",   // playlist: local path OR http(s) URL
  "xmltv": "assets/sample/epg.xml",      // guide:    local path OR http(s) URL
  "startChannel": 1,                      // channel number to power on to
  "defaultVolume": 0.8,                   // 0.0–1.0
  "crt": {                                // the retro look (all optional)
    "scanlines": true,
    "scanlineOpacity": 0.18,              // 0 = off … 1 = solid black lines
    "vignette": 0.6,                      // darkening at the screen corners
    "curvature": true,                    // subtle barrel-curve illusion
    "flicker": true                       // faint brightness flicker
  }
}
```

### `.env` (private overrides — git-ignored)

For values you don't want committed (like a Tailscale ErsatzTV URL), copy
`.env.example` to `.env`. These override `config.json`:

```ini
RETROTV_M3U=http://your-server:8409/iptv/channels.m3u
RETROTV_XMLTV=http://your-server:8409/iptv/xmltv.xml
RETROTV_START_CHANNEL=1
RETROTV_DEFAULT_VOLUME=80          # accepts 0–100 or 0.0–1.0
```

Precedence (highest first): **real env var → `.env` → `config.json` → defaults.**

---

## Customising the look

All visuals are in **`src/ui/style.css`** — no rebuild, just edit and relaunch.
Good starting points:

- The colour variables at the top (`--bezel-light`, `--bezel-dark`, `--amber`).
- The `.crt` rule (scanlines + vignette) and `.snow` (static).
- The CRT intensity knobs in `config.json` map to CSS variables/classes that
  `applyCrt()` in `renderer.js` sets.

---

## How playback works

ErsatzTV serves **raw MPEG-TS** (`.../channel/1.ts`), which browsers can't play
directly. So `renderer.js` picks a player by URL:

- **`.ts` / `.m2ts`** → **mpegts.js** (Media Source Extensions, live mode)
- **everything else** (e.g. the sample `.mp4`s) → the native `<video>` element

If a stream doesn't produce a picture within 5 seconds (or errors), the screen
shows static + **NO SIGNAL**.

---

## Gotchas (things that bit us, so they don't bite you)

- **`sandbox: false`** is set in `main.js` on purpose. With Electron's default
  sandbox, `preload.js` can't `require('fs')`, so the config never loads and you
  get a black screen.
- **ErsatzTV is MPEG-TS, not HLS.** That's why we use mpegts.js, not an HLS
  player. Don't reach for hls.js — it won't play these streams.
- **Run with `npm start`**, not by executing a file directly.
- To debug the renderer, open Electron's DevTools (View menu, or
  `Cmd/Ctrl+Option/Shift+I`); page errors and our `[mpegts error]` logs show
  there.

---

## License

Personal project — no license specified.
