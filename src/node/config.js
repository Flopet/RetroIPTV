// ===========================================================================
// node/config.js — resolve the app's settings. (Runs in Node, via preload.)
// ===========================================================================
// Settings come from several places. Precedence, highest first:
//
//   real environment variable  >  .env file  >  config.json  >  built-in DEFAULTS
//
// Why the layers:
//   • config.json — the everyday, committed, user-editable settings.
//   • .env        — private/per-machine overrides (e.g. a Tailscale ErsatzTV
//                   URL) kept OUT of git. Uses RETROTV_* keys.
//   • real env    — lets you override on the command line for a one-off run.
//
// `loadConfig()` returns a plain object the rest of the app consumes:
//   { m3u, xmltv, startChannel, defaultVolume, crt }
// where m3u/xmltv are absolute paths or URLs, and defaultVolume is 0..1.
// ===========================================================================
const fs = require('fs');
const path = require('path');

// This file lives in src/node/, so the project ROOT (where config.json, .env
// and assets/ live) is two directories up. Relative paths resolve against it.
const ROOT = path.join(__dirname, '..', '..');

const DEFAULTS = {
  m3u: 'assets/sample/channels.m3u',
  xmltv: 'assets/sample/epg.xml',
  startChannel: 1,
  defaultVolume: 0.8,
  crt: { scanlines: true, scanlineOpacity: 0.18, vignette: 0.6, curvature: true, flicker: true },
};

function isUrl(v) {
  return /^https?:\/\//i.test((v || '').trim());
}

// URLs are left as-is; relative file paths resolve against the project root.
function resolve(p) {
  if (isUrl(p) || path.isAbsolute(p)) return p;
  return path.join(ROOT, p);
}

// Accept 0-1 (web style, e.g. 0.8) or 0-100 (legacy .env, e.g. 80); return 0-1.
function normVolume(v) {
  let n = parseFloat(v);
  if (isNaN(n)) return 0.8;
  if (n > 1) n = n / 100;
  return Math.max(0, Math.min(1, n));
}

// Minimal KEY=VALUE .env parser: skips blank/# lines, strips optional quotes,
// no variable interpolation. Good enough for our handful of RETROTV_* keys.
function loadDotenv() {
  const envPath = path.join(ROOT, '.env');
  if (!fs.existsSync(envPath)) return {};
  const out = {};
  for (const raw of fs.readFileSync(envPath, 'utf-8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const i = line.indexOf('=');
    const key = line.slice(0, i).trim();
    if (key) out[key] = line.slice(i + 1).trim().replace(/^["']|["']$/g, '');
  }
  return out;
}

function loadConfig() {
  // Start from config.json (falling back to DEFAULTS if it's missing/broken).
  let data = {};
  try {
    data = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf-8'));
  } catch (e) {
    console.log('[config] using defaults:', e.message);
  }
  const merged = { ...DEFAULTS, ...data };

  // Layer overrides on top. Spreading process.env last means a real shell env
  // var beats the same key from the .env file.
  const env = { ...loadDotenv(), ...process.env };
  if (env.RETROTV_M3U)            merged.m3u = env.RETROTV_M3U;
  if (env.RETROTV_XMLTV)          merged.xmltv = env.RETROTV_XMLTV;
  if (env.RETROTV_START_CHANNEL)  merged.startChannel = parseInt(env.RETROTV_START_CHANNEL, 10) || 1;
  if (env.RETROTV_DEFAULT_VOLUME) merged.defaultVolume = normVolume(env.RETROTV_DEFAULT_VOLUME);

  // Normalise into the shapes the rest of the app expects.
  merged.defaultVolume = normVolume(merged.defaultVolume);
  merged.m3u = resolve(merged.m3u);
  merged.xmltv = resolve(merged.xmltv);
  return merged;
}

// isUrl is shared with source.js (it decides fetch-vs-readFile).
module.exports = { loadConfig, isUrl };
