// ===========================================================================
// main.js — the Electron MAIN process.
// ===========================================================================
// An Electron app has three execution contexts; this is the first one:
//
//   1. MAIN process   (this file)   — a Node.js process. It owns the app
//                                      lifecycle and creates windows. No DOM.
//   2. PRELOAD script (preload.js)  — a small Node.js bridge that runs just
//                                      before the page loads and hands data to
//                                      the page over a secure channel.
//   3. RENDERER       (ui/)         — the web page itself (Chromium). This is
//                                      the visible UI. No Node access.
//
// main.js does the bare minimum: open one window sized like a TV set and point
// it at the renderer's index.html. Everything the user sees lives in src/ui/,
// and the data it needs is gathered in src/preload.js.
// ===========================================================================
const { app, BrowserWindow } = require('electron');
const path = require('path');

function createWindow() {
  const win = new BrowserWindow({
    width: 960,
    height: 720,
    minWidth: 480, // the UI is responsive, but stop it getting unusably small
    minHeight: 360,
    backgroundColor: '#000000', // avoid a white flash before the page paints
    title: 'RetroIPTV',
    webPreferences: {
      // The preload runs in the renderer but with Node access, bridging the two.
      preload: path.join(__dirname, 'preload.js'),
      // contextIsolation keeps the page's JS and the preload's JS in separate
      // worlds; they communicate only through what we expose (window.retro).
      contextIsolation: true,
      // sandbox:false lets the preload use Node's fs/fetch to read the config,
      // playlist and guide. (With the default sandbox:true a preload can't
      // require('fs') — that bug caused an early black screen; see README.)
      sandbox: false,
    },
  });

  win.loadFile(path.join(__dirname, 'ui', 'index.html'));
}

// `whenReady` resolves once Electron has finished its own startup.
app.whenReady().then(createWindow);

// Quit when every window is closed.
app.on('window-all-closed', () => app.quit());
