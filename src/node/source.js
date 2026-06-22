// ===========================================================================
// node/source.js — read text from either a local file or an HTTP(S) URL.
// ===========================================================================
// Both the playlist (M3U) and the guide (XMLTV) can be configured as a local
// path OR a remote URL (e.g. an ErsatzTV endpoint). This tiny helper hides that
// difference so callers just get the text. Shared by playlist.js and preload.js.
// ===========================================================================
const fs = require('fs');
const { isUrl } = require('./config');

async function readText(src) {
  if (isUrl(src)) {
    // Node's global fetch (Node 18+) handles the HTTP request.
    const res = await fetch(src, { headers: { 'User-Agent': 'RetroIPTV/1.0' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.text();
  }
  return fs.readFileSync(src, 'utf-8');
}

module.exports = { readText };
