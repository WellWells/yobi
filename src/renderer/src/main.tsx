import React from 'react';
import ReactDOM from 'react-dom/client';
import { MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import '@mantine/core/styles.css';
// Must come after the core styles, per the package's own contract.
import '@mantine/notifications/styles.css';
import { App } from './App';
import { useThemeStore } from './store/themeStore';
// Evaluated for its side effect before the first render: the reading font and size from the
// localStorage mirror, so the first paint is already in the chosen face.
import './store/readingStore';
import './styles/globals.css';

const PERF_FLUSH_INTERVAL_MS = 30_000;
const perfFlushTimer = window.setInterval(() => {
  performance.clearMarks();
  performance.clearMeasures();
  performance.clearResourceTimings();
}, PERF_FLUSH_INTERVAL_MS);
window.addEventListener('unload', () => window.clearInterval(perfFlushTimer));

function Root() {
  const { mantineTheme, colorScheme, cssVariablesResolver } = useThemeStore();

  return (
    <MantineProvider
      theme={mantineTheme}
      forceColorScheme={colorScheme}
      cssVariablesResolver={cssVariablesResolver}
    >
      {/* The window's only notice surface (hooks/useUiNotifications). Top-right so it never covers the
          composer. The title-bar offset lives in globals.css: `styles.root` here reaches all six
          position containers and would stretch the bottom ones over the window. */}
      <Notifications position="top-right" />
      <App />
    </MantineProvider>
  );
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
