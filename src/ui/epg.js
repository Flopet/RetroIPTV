// ===========================================================================
// ui/epg.js — parse the XMLTV guide into "what's on now/next" lookups.
// ===========================================================================
// This lives in ui/ (the renderer), NOT node/, on purpose: parsing XML uses the
// browser's built-in DOMParser, which Node doesn't have. preload.js only fetches
// the raw text; this file turns it into a usable guide.
//
// Loaded as a plain <script>, so it exposes one global:
//   buildGuide(xmlText) -> { resolveId(tvgId, name), nowNext(id), size }
// renderer.js calls buildGuide() once at startup and queries it on each tune.

// XMLTV time: "YYYYMMDDHHMMSS +ZZZZ" (offset optional). Returns epoch ms (UTC).
function parseXmltvTime(value) {
  if (!value) return null;
  const v = value.trim();
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(v.slice(0, 14));
  if (!m) return null;
  let ms = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  const tz = /^([+-])(\d{2})(\d{2})$/.exec(v.slice(14).trim());
  if (tz) {
    const sign = tz[1] === '+' ? 1 : -1;
    ms -= sign * ((+tz[2]) * 60 + (+tz[3])) * 60000;
  }
  return ms; // missing/invalid offset → treated as UTC
}

function buildGuide(xmlText) {
  const channels = new Map();  // id -> { name, programmes: [{title,start,stop}] }
  const nameIndex = new Map(); // lowercased display-name -> id

  if (xmlText) {
    const doc = new DOMParser().parseFromString(xmlText, 'text/xml');
    if (!doc.querySelector('parsererror')) {
      for (const ch of doc.querySelectorAll('channel')) {
        const id = (ch.getAttribute('id') || '').trim();
        if (!id) continue;
        const name = (ch.querySelector('display-name')?.textContent || '').trim();
        channels.set(id, { name, programmes: [] });
        if (name) nameIndex.set(name.toLowerCase(), id);
      }
      for (const pr of doc.querySelectorAll('programme')) {
        const id = (pr.getAttribute('channel') || '').trim();
        if (!channels.has(id)) channels.set(id, { name: '', programmes: [] });
        channels.get(id).programmes.push({
          title: (pr.querySelector('title')?.textContent || '').trim(),
          start: parseXmltvTime(pr.getAttribute('start') || ''),
          stop: parseXmltvTime(pr.getAttribute('stop') || ''),
        });
      }
      for (const c of channels.values()) {
        c.programmes.sort((a, b) => (a.start ?? 0) - (b.start ?? 0));
      }
    }
  }

  return {
    // Prefer an exact tvg-id match, then fall back to display-name.
    resolveId(tvgId, name) {
      if (tvgId && channels.has(tvgId)) return tvgId;
      if (name) return nameIndex.get(name.trim().toLowerCase()) || '';
      return '';
    },
    // [current, next]; either may be null.
    nowNext(id, when = Date.now()) {
      const c = channels.get(id);
      if (!c) return [null, null];
      let current = null;
      let next = null;
      for (const p of c.programmes) {
        if (p.start == null) continue;
        const stopOk = p.stop == null || when < p.stop;
        if (p.start <= when && stopOk) current = p;
        else if (p.start > when) { next = p; break; }
      }
      return [current, next];
    },
    size: channels.size,
  };
}
