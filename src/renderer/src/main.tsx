import React from 'react';
import ReactDOM from 'react-dom/client';
import { MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import '@mantine/core/styles.css';
// Must come after the core styles, per the package's own contract.
import '@mantine/notifications/styles.css';
import { App } from './App';
import { LiveAnnouncer } from './components/LiveAnnouncer';
import { useThemeStore } from './store/themeStore';
import { APP_MANTINE_THEME, rootColorSchemeManager } from './theme';
// Evaluated for its side effect before the first render: the reading font and size from the
// localStorage mirror, so the first paint is already in the chosen face.
import './store/readingStore';
import './styles/globals.css';
import { markHostPlatform } from './utils/hostPlatform';
import { startConversationMoveSync } from './store/conversationMoves';
import { connectSystemTextScale } from './styles/systemTextScale';

// Before anything renders: a move re-keys every store that holds a conversation by its path.
startConversationMoveSync();
markHostPlatform();
const disconnectTextScale = connectSystemTextScale(window.electronAPI);
window.addEventListener('pagehide', disconnectTextScale, { once: true });
if (import.meta.hot) import.meta.hot.dispose(disconnectTextScale);

const PERF_FLUSH_INTERVAL_MS = 30_000;
const perfFlushTimer = window.setInterval(() => {
  performance.clearMarks();
  performance.clearMeasures();
  performance.clearResourceTimings();
}, PERF_FLUSH_INTERVAL_MS);
// `pagehide`, not `unload`: Chromium is deprecating unload handlers.
window.addEventListener('pagehide', () => window.clearInterval(perfFlushTimer));

// The theme store's first read paints <html> with the saved theme before anything renders.
useThemeStore.getState();

// One theme and no colour scheme prop for the life of the window: switching the Yobi theme only
// rewrites variables on <html> (theme/liveTheme.ts), so it never re-renders this tree.
function Root() {
  return (
    <MantineProvider theme={APP_MANTINE_THEME} colorSchemeManager={rootColorSchemeManager}>
      {/* The window's only notice surface (hooks/useUiNotifications). Top-right so it never covers the
          composer. The title-bar offset lives in globals.css: `styles.root` here reaches all six
          position containers and would stretch the bottom ones over the window. */}
      <Notifications position="top-right" />
      {/* Screen-reader announcements: one live region for the whole window. */}
      <LiveAnnouncer />
      <App />
    </MantineProvider>
  );
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
