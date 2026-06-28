// ===========================================================================
// ui/renderer.js — the app logic (runs in the browser / renderer context).
// ===========================================================================
// This is where the TV actually behaves like a TV. It:
//   • reads settings + data through window.retro (provided by preload.js)
//   • tunes channels (mpegts.js for live .ts, native <video> for plain MP4)
//   • draws the static "snow" and drives the on-screen display (OSD)
//   • handles keyboard + on-screen-button controls
//
// Sections below, in order:
//   1. Element handles + state
//   2. CRT look          (applyCrt)
//   3. Snow / static     (drawSnow / startSnow / stopSnow)
//   4. OSD               (banner, "Now:", volume, mute)
//   5. Signal state      (NO SIGNAL + watchdog)
//   6. Tuning / playback (load / tune)
//   7. Numeric entry     (pushDigit / commitEntry)
//   8. Controls          (keyboard, buttons, fullscreen)
//   9. Startup           (init)
// ===========================================================================

// ---- 1. element handles + state -------------------------------------------
const cfg = window.retro.config;     // settings object from preload (config.js)
const $ = (id) => document.getElementById(id);

const video = $('video');
const banner = $('banner');
const bannerTitle = $('banner-title');
const bannerSub = $('banner-sub');
const bannerChannel = $('banner-channel');
const arToggle = $('ar-toggle');
const nosignal = $('nosignal');
const entryEl = $('entry');
const volumeEl = $('volume');
const volLabel = $('vol-label');
const volFill = $('vol-fill');
const muteEl = $('mute');

// Snow is drawn into a small offscreen-sized canvas, then CSS-stretched to fill
// the screen — low resolution keeps it cheap and gives a chunky retro look.
const snow = $('snow');
snow.width = 320;
snow.height = 240;
const sctx = snow.getContext('2d');
const snowImg = sctx.createImageData(snow.width, snow.height);
let snowRAF = null;                  // requestAnimationFrame id while snow runs

let channels = [];                   // [{number,name,url,tvgId,...}] from the M3U
let guide = null;                    // EPG lookup, built from XMLTV in init()
let player = null;                   // active mpegts.js instance, if any
let index = 0;                       // index into `channels` of the current channel
let bannerTimer = null;
let volTimer = null;
let watchdog = null;
let entryBuffer = '';                // digits typed for direct channel entry
let entryTimer = null;

const WATCHDOG_MS = 5000;            // no picture within this long → NO SIGNAL
const ENTRY_TIMEOUT_MS = 2000;      // commit typed channel number after this gap

// ---- 2. CRT look from config ----------------------------------------------
// The look itself lives in style.css; here we just feed it values from config:
// two CSS custom properties and two body classes the stylesheet keys off.
function applyCrt(crt = {}) {
  const root = document.documentElement.style;
  root.setProperty('--scanline-opacity', crt.scanlines ? crt.scanlineOpacity : 0);
  root.setProperty('--vignette', crt.vignette ?? 0.6);
  document.body.classList.toggle('curved', !!crt.curvature);
  document.body.classList.toggle('flicker', !!crt.flicker);
}

// ---- 3. snow / static -----------------------------------------------------
// Fill the canvas with random grey pixels each frame. The RAF loop only runs
// while snow is visible (started/stopped below) so it costs nothing otherwise.
function drawSnow() {
  const d = snowImg.data;
  for (let i = 0; i < d.length; i += 4) {
    const v = Math.random() * 255;
    d[i] = d[i + 1] = d[i + 2] = v;  // r=g=b → greyscale
    d[i + 3] = 255;                  // opaque
  }
  sctx.putImageData(snowImg, 0, 0);
  snowRAF = requestAnimationFrame(drawSnow);
}
function startSnow() {
  snow.classList.add('show');
  if (!snowRAF) drawSnow();
}
function stopSnow() {
  snow.classList.remove('show');
  if (snowRAF) { cancelAnimationFrame(snowRAF); snowRAF = null; }
}

// ---- 4. on-screen display -------------------------------------------------
const pad = (n) => String(n).padStart(2, '0');   // 3 → "03"

// Channel banner (top): a title line and an optional subtitle ("Now: …").
function showBanner(title, subtitle = '') {
  bannerTitle.textContent = title;
  bannerSub.textContent = subtitle;
  banner.classList.add('show');
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => banner.classList.remove('show'), 3000);
}

// Look up the currently-airing programme for a channel via the EPG.
// Returns "Now: <title>" or '' if there's no guide / no match.
function nowText(ch) {
  if (!guide) return '';
  const id = guide.resolveId(ch.tvgId, ch.tvgName || ch.name);
  if (!id) return '';
  const [current] = guide.nowNext(id);
  return current && current.title ? `Now: ${current.title}` : '';
}

// Volume bar (auto-hides). video.volume is 0..1; we show 0..100.
function showVolume() {
  const pct = Math.round(video.volume * 100);
  volLabel.textContent = `VOL ${pct}`;
  volFill.style.width = `${pct}%`;
  volumeEl.classList.add('show');
  clearTimeout(volTimer);
  volTimer = setTimeout(() => volumeEl.classList.remove('show'), 1500);
}
function updateMute() {
  muteEl.classList.toggle('show', video.muted);
}

// ---- 5. signal state ------------------------------------------------------
// Show static + "NO SIGNAL" (on failure or watchdog timeout); clear it once the
// <video> element reports it's actually playing. These listeners cover BOTH
// playback paths because mpegts.js feeds the same <video> element.
function showNoSignal() {
  clearTimeout(watchdog);
  nosignal.classList.add('show');
  startSnow();
}
function onPlaying() {
  clearTimeout(watchdog);
  nosignal.classList.remove('show');
  stopSnow();
}
video.addEventListener('playing', onPlaying);
video.addEventListener('error', showNoSignal);

// ---- 6. tuning / playback -------------------------------------------------
// ErsatzTV serves raw MPEG-TS (.ts), which browsers can't play natively — those
// go through mpegts.js. Everything else (the MP4 samples) plays natively.
function isMpegTs(url) {
  return /\.(ts|m2ts)(\?|$)/i.test(url);
}

function load(ch) {
  bannerChannel.textContent = pad(ch.number);
  showBanner(ch.name, nowText(ch));

  // Show static and arm the watchdog until the picture actually arrives.
  nosignal.classList.remove('show');
  startSnow();
  clearTimeout(watchdog);
  watchdog = setTimeout(showNoSignal, WATCHDOG_MS);

  // Tear down the previous source before starting the new one.
  if (player) { player.destroy(); player = null; }
  video.removeAttribute('src');
  video.load();

  if (isMpegTs(ch.url) && window.mpegts && mpegts.isSupported()) {
    // Live MPEG-TS via Media Source Extensions.
    player = mpegts.createPlayer(
      { type: 'mpegts', isLive: true, url: ch.url },
      { liveBufferLatencyChasing: true },   // keep latency low on a live stream
    );
    player.on(mpegts.Events.ERROR, (t, d) => {
      console.log('[mpegts error]', t, d);
      showNoSignal();
    });
    player.attachMediaElement(video);
    player.load();
  } else {
    video.src = ch.url;                     // progressive MP4 / native playback
  }
  video.play().catch(() => {});             // ignore autoplay rejections
}

// Tune by index, wrapping around the ends of the list (last → first).
function tune(i) {
  index = (i + channels.length) % channels.length;
  load(channels[index]);
}

// ---- 7. direct numeric entry ----------------------------------------------
// Typing digits builds up a number shown in the OSD; after a short pause (or
// Enter) we jump to that channel, like punching a number on a remote.
function pushDigit(d) {
  entryBuffer = (entryBuffer + d).slice(-3);   // keep at most 3 digits
  entryEl.textContent = `${entryBuffer}_`;     // trailing cursor
  entryEl.classList.add('show');
  clearTimeout(entryTimer);
  entryTimer = setTimeout(commitEntry, ENTRY_TIMEOUT_MS);
}
function commitEntry() {
  clearTimeout(entryTimer);
  if (!entryBuffer) return;
  const number = parseInt(entryBuffer, 10);
  entryBuffer = '';
  entryEl.classList.remove('show');
  const i = channels.findIndex((c) => c.number === number);
  if (i >= 0) tune(i);
  else { bannerChannel.textContent = pad(number); showBanner('— not found'); }
}

// ---- 8. controls ----------------------------------------------------------
// Keyboard: arrows tune/adjust volume, digits/Enter do direct entry, m mutes,
// f toggles fullscreen.
document.addEventListener('keydown', (e) => {
  if (!channels.length) return;
  if (/^[0-9]$/.test(e.key)) { pushDigit(e.key); return; }
  if (e.key === 'Enter') { commitEntry(); return; }
  switch (e.key) {
    case 'ArrowUp':    tune(index + 1); break;
    case 'ArrowDown':  tune(index - 1); break;
    case 'ArrowRight': video.volume = Math.min(1, video.volume + 0.05); showVolume(); break;
    case 'ArrowLeft':  video.volume = Math.max(0, video.volume - 0.05); showVolume(); break;
    case 'm':          video.muted = !video.muted; updateMute(); showVolume(); break;
    case 'f':
      if (document.fullscreenElement) document.exitFullscreen();
      else document.documentElement.requestFullscreen();
      break;
  }
});

arToggle.addEventListener('click', () => {
  const is43 = document.querySelector('.tv').classList.toggle('ar43');
  arToggle.textContent = is43 ? '4:3' : '16:9';
  arToggle.blur();
});

// On-screen buttons mirror the keyboard. One listener handles all of them via
// each button's data-act attribute (event delegation).
document.querySelector('.controls').addEventListener('click', (e) => {
  const act = e.target.dataset.act;
  if (!act) return;
  e.target.blur(); // return keyboard focus to the document so arrows still work
  switch (act) {
    case 'chup': if (channels.length) tune(index + 1); break;
    case 'chdn': if (channels.length) tune(index - 1); break;
    case 'volup': video.volume = Math.min(1, video.volume + 0.05); showVolume(); break;
    case 'voldn': video.volume = Math.max(0, video.volume - 0.05); showVolume(); break;
    case 'power': window.close(); break;
  }
});

// Drop the bezel/controls (CSS `.fs`) whenever the OS enters/leaves fullscreen.
document.addEventListener('fullscreenchange', () => {
  document.body.classList.toggle('fs', !!document.fullscreenElement);
});

// ---- 9. startup -----------------------------------------------------------
async function init() {
  applyCrt(cfg.crt);
  video.volume = cfg.defaultVolume ?? 0.8;
  startSnow();   // static while we fetch the playlist + guide

  // Fetch channels and guide in parallel (both come from preload.js).
  const [chs, xml] = await Promise.all([
    window.retro.loadChannels(),
    window.retro.loadGuideXml(),
  ]);
  channels = chs;
  guide = buildGuide(xml);   // buildGuide() is defined in epg.js

  if (!channels.length) {
    showBanner('NO CHANNELS — check config.json / .env');
    showNoSignal();
    return;
  }

  // Power on to the configured channel number (fall back to the first channel).
  const start = channels.findIndex((c) => c.number === cfg.startChannel);
  tune(start >= 0 ? start : 0);
}
init();
