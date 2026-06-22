// ===========================================================================
// preload.js — the BRIDGE between Node and the web page.
// ===========================================================================
// This runs in the renderer, but *before* the page's own scripts and with full
// Node.js access. Its job is to gather everything the UI needs from disk/network
// (which the sandboxed page itself cannot reach) and hand it across the
// contextIsolation boundary via `contextBridge`.
//
// The page then sees a single global, `window.retro`, with:
//   • config         — the resolved settings object (see node/config.js)
//   • loadChannels()  → Promise<Channel[]>  (parsed M3U)
//   • loadGuideXml()  → Promise<string>     (raw XMLTV text; parsed in the UI)
//
// Note the split: the M3U is fully parsed here in Node (node/playlist.js), but
// the XMLTV is only *fetched* here and parsed in the renderer — because XML
// parsing uses the browser's built-in DOMParser, which Node doesn't have. See
// ui/epg.js.
// ===========================================================================
const { contextBridge } = require('electron');
const { loadConfig } = require('./node/config');
const { parseM3U } = require('./node/playlist');
const { readText } = require('./node/source');

const config = loadConfig();

contextBridge.exposeInMainWorld('retro', {
  config,

  // Parse the playlist into a channel list. On any failure (bad path, server
  // unreachable) return [] so the UI can show "NO CHANNELS" instead of crashing.
  loadChannels: async () => {
    try {
      return await parseM3U(config.m3u);
    } catch (e) {
      console.log('[playlist] load failed:', e.message);
      return [];
    }
  },

  // Fetch the raw XMLTV guide text (parsed later in ui/epg.js). Return '' if the
  // guide is missing/unreachable; the UI then simply omits "Now:" subtitles.
  loadGuideXml: async () => {
    try {
      return await readText(config.xmltv);
    } catch (e) {
      console.log('[epg] load failed:', e.message);
      return '';
    }
  },
});
