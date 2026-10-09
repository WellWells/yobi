// Electron's entry point. Node's compile cache only covers modules compiled after
// enableCompileCache() returns, and an entry file is compiled before its own first line runs,
// so the main bundle must be required from here; it cannot enable the cache for itself.
//
// Copied verbatim into out/main by vite.main.config.mts; it is not bundled.
const path = require('node:path');

try {
  const { app } = require('electron');
  require('node:module').enableCompileCache(path.join(app.getPath('userData'), 'compile-cache'));
} catch {
  // A cold start is the worst case, not a failure. Never let the cache stop the app booting.
}

require('./index.js');
