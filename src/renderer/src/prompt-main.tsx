import React from 'react';
import ReactDOM from 'react-dom/client';
import { MantineProvider } from '@mantine/core';
import '@mantine/core/styles.css';
import { getMantineTheme, buildCssVariablesResolver, applyRootThemeVars } from './theme';
import { ExportPromptPanel } from './components/exportPrompt/ExportPromptPanel';
import { ShareResultPanel } from './components/exportPrompt/ShareResultPanel';
import type {
  ExportPromptChoice, ExportPromptPayload, ShareResultAction, ShareResultState,
} from '../../shared/types';
import type { Theme } from '../../shared/themes';
import './styles/globals.css';

declare global {
  interface Window {
    renderExportPrompt?: (payload: ExportPromptPayload) => Promise<ExportPromptChoice | null>;
    renderShareResult?: (state: ShareResultState) => Promise<ShareResultAction>;
    nextPanelHeight?: () => Promise<number>;
  }
}

const rootElement = document.getElementById('prompt-root');
if (!rootElement) {
  throw new Error('prompt root element not found');
}
const root = ReactDOM.createRoot(rootElement);

let promptTheme: Theme = 'light';
let promptTitle = '';

function paint(node: React.ReactNode): void {
  const { theme, colorScheme } = getMantineTheme(promptTheme);
  root.render(
    <React.StrictMode>
      <MantineProvider
        theme={theme}
        forceColorScheme={colorScheme}
        cssVariablesResolver={buildCssVariablesResolver(promptTheme)}
      >
        {node}
      </MantineProvider>
    </React.StrictMode>,
  );
}

/*
 * The window has no preload, so main cannot be pushed to — it pulls. `nextPanelHeight()`
 * answers with the current height the moment there is one, and afterwards only when the
 * height actually changes, which is what lets main resize a panel that morphs between
 * stages without polling. Identical heights are dropped so main's own setBounds cannot
 * feed itself a loop.
 */
let pendingHeight: number | null = null;
let deliverHeight: ((height: number) => void) | null = null;
let lastHeight = 0;

function emitHeight(height: number): void {
  if (height <= 0 || height === lastHeight) return;
  lastHeight = height;
  if (deliverHeight) {
    const resolve = deliverHeight;
    deliverHeight = null;
    resolve(height);
    return;
  }
  pendingHeight = height;
}

window.nextPanelHeight = () => new Promise<number>((resolve) => {
  if (pendingHeight !== null) {
    const height = pendingHeight;
    pendingHeight = null;
    resolve(height);
    return;
  }
  deliverHeight = resolve;
});

window.renderExportPrompt = (payload) => new Promise<ExportPromptChoice | null>((resolve) => {
  applyRootThemeVars(payload.theme);
  document.documentElement.setAttribute('data-theme', payload.theme);
  promptTheme = payload.theme;
  promptTitle = payload.strings.title;

  let settled = false;
  const settle = (value: ExportPromptChoice | null): void => {
    if (settled) return;
    settled = true;
    resolve(value);
  };

  paint(
    <ExportPromptPanel
      payload={payload}
      onSubmit={settle}
      onCancel={() => settle(null)}
      onHeight={emitHeight}
    />,
  );
});

window.renderShareResult = (state) => new Promise<ShareResultAction>((resolve) => {
  let settled = false;
  const settle = (action: ShareResultAction): void => {
    if (settled) return;
    settled = true;
    resolve(action);
  };

  paint(
    <ShareResultPanel title={promptTitle} state={state} onAction={settle} onHeight={emitHeight} />,
  );
});
