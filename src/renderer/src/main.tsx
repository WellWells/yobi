// src/renderer/src/main.tsx — React entry point
import React from 'react';
import ReactDOM from 'react-dom/client';
import { MantineProvider } from '@mantine/core';
import { ModalsProvider } from '@mantine/modals';
import { App } from './App';
import { useThemeStore } from './store/themeStore';
import './styles/globals.css';
import '@mantine/core/styles.css';

// React DevTools injects performance.mark()/measure() calls for every component
// render. In a long-running Electron session with frequent IPC updates these
// entries accumulate in the browser performance timeline and eventually exhaust
// V8 heap memory (the OOM crash seen in long-running dev/prod sessions).
// Periodically flushing them keeps the buffer bounded without any observable side effects.
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
