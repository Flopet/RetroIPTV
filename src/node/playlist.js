// ===========================================================================
// node/playlist.js — parse an extended M3U into a list of channels.
// ===========================================================================
// Input is the text of an .m3u file (local or from a URL). The relevant shape:
//
//   #EXTM3U
//   #EXTINF:-1 tvg-id="C1.." tvg-chno="1" tvg-name="Adult Swim" ...,Adult Swim
//   http://server:8409/iptv/channel/1.ts
//   ...
//
// Each channel is an optional #EXTINF metadata line followed by its stream URL.
// We extract the key="value" attributes from #EXTINF plus the display name
// after the final comma.
//
// Channel numbers: ErsatzTV publishes an explicit number via tvg-chno /
// channel-number — we honour it so direct numeric entry matches the server's
// lineup. If absent, we fall back to sequential numbering (1, 2, 3, …).
//
// Output: [{ number, name, url, tvgId, tvgName, logo, group }]
// ===========================================================================
const { readText } = require('./source');

// Matches key="value" pairs inside an #EXTINF line.
const ATTR_RE = /([A-Za-z0-9_-]+)="([^"]*)"/g;

// Split one #EXTINF line into its attributes and trailing display name.
function parseExtinf(line) {
  // Drop the leading "#EXTINF:"; attributes and the name are separated by the
  // first comma after the attribute block.
  const payload = line.slice('#EXTINF:'.length).trimStart();
  const comma = payload.indexOf(',');
  const attrsPart = comma >= 0 ? payload.slice(0, comma) : payload;
  const name = comma >= 0 ? payload.slice(comma + 1).trim() : '';

  const attrs = {};
  let m;
  while ((m = ATTR_RE.exec(attrsPart))) attrs[m[1].toLowerCase()] = m[2];
  return { attrs, name };
}

// Return an explicit channel number from the attributes, or null.
function explicitNumber(attrs) {
  for (const key of ['tvg-chno', 'channel-number']) {
    const n = parseInt(String(attrs[key] ?? '').trim(), 10);
    if (!isNaN(n)) return n;
  }
  return null;
}

async function parseM3U(source) {
  const text = await readText(source);
  const channels = [];

  // #EXTINF lines set `attrs`/`name`, which are consumed by the next URL line.
  let attrs = {};
  let name = '';

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || /^#EXTM3U/i.test(line)) continue;                 // header/blank
    if (line.startsWith('#EXTINF')) { ({ attrs, name } = parseExtinf(line)); continue; }
    if (line.startsWith('#')) continue;                            // other directives

    // Any non-# line is a stream URL → emit a channel using the pending meta.
    const number = explicitNumber(attrs) ?? channels.length + 1;
    channels.push({
      number,
      name: name || attrs['tvg-name'] || `Channel ${number}`,
      url: line,
      tvgId: attrs['tvg-id'] || '',     // used to match the EPG (see ui/epg.js)
      tvgName: attrs['tvg-name'] || '',
      logo: attrs['tvg-logo'] || '',
      group: attrs['group-title'] || '',
    });
    attrs = {};
    name = '';
  }
  return channels;
}

module.exports = { parseM3U };
