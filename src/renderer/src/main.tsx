import React from 'react';
import ReactDOM from 'react-dom/client';
import { MantineProvider } from '@mantine/core';
import { ModalsProvider } from '@mantine/modals';
import { Notifications } from '@mantine/notifications';
import '@mantine/core/styles.css';
// Must come after the core styles, per the package's own contract.
import '@mantine/notifications/styles.css';
import { App } from './App';
import { useThemeStore } from './store/themeStore';
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
      <ModalsProvider>
        {/* The window's only notice surface — see hooks/useUiNotifications.
            Top-right, so a notice never covers the composer at the bottom. The offset that
            clears the title bar is in globals.css, not in `styles` here: the provider renders
            a container per position and `styles.root` reaches all six of them, so an offset
            passed here also stretched the bottom three over the whole window. */}
        <Notifications position="top-right" />
        <App />
      </ModalsProvider>
    </MantineProvider>
  );
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
