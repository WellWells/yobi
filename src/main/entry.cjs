// Electron's entry point, and deliberately the smallest file in the app.
//
// Node's compile cache only covers modules compiled AFTER enableCompileCache() returns, and an
// entry file is compiled before its own first line runs. So the 6.5 MB main bundle cannot turn
// the cache on for itself — it has to be required by something already inside the cache's reach.
// Measured on Electron 44 with a comparable module: 74 ms of V8 compile on every cold start,
// 9 ms once cached. Enabling it from inside the bundle instead saved nothing.
//
// This file is copied verbatim into out/main by vite.main.config.mts; it is not bundled.
const path = require('node:path');

try {
  const { app } = require('electron');
  require('node:module').enableCompileCache(path.join(app.getPath('userData'), 'compile-cache'));
} catch {
  // A cold start is the worst case, not a failure. Never let the cache stop the app booting.
}

require('./index.js');
