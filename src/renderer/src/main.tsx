import React from 'react';
import ReactDOM from 'react-dom/client';
import { MantineProvider } from '@mantine/core';
import { ModalsProvider } from '@mantine/modals';
import { App } from './App';
import { useThemeStore } from './store/themeStore';
import './styles/globals.css';
import '@mantine/core/styles.css';

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
