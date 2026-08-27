import React from 'react';
import ReactDOM from 'react-dom/client';
import { MantineProvider } from '@mantine/core';
import '@mantine/core/styles.css';
import { getMantineTheme, buildCssVariablesResolver, applyRootThemeVars } from './theme';
import { ExportPromptPanel } from './components/exportPrompt/ExportPromptPanel';
import { ShareResultPanel } from './components/exportPrompt/ShareResultPanel';
import type {
  ExportPromptChoice, ExportPromptPayload, PanelHeight, ShareResultAction, ShareResultState,
} from '../../shared/types';
import type { Theme } from '../../shared/themes';
import './styles/globals.css';

declare global {
  interface Window {
    renderExportPrompt?: (payload: ExportPromptPayload) => Promise<ExportPromptChoice | null>;
    renderShareResult?: (state: ShareResultState) => Promise<ShareResultAction>;
    nextPanelHeight?: () => Promise<PanelHeight>;
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

let pendingHeight: PanelHeight | null = null;
let deliverHeight: ((height: PanelHeight) => void) | null = null;
let lastHeight: PanelHeight = { panel: 0, total: 0 };

function emitHeight(height: PanelHeight): void {
  if (height.total <= 0) return;
  if (height.panel === lastHeight.panel && height.total === lastHeight.total) return;
  lastHeight = height;
  if (deliverHeight) {
    const resolve = deliverHeight;
    deliverHeight = null;
    resolve(height);
    return;
  }
  pendingHeight = height;
}

window.nextPanelHeight = () => new Promise<PanelHeight>((resolve) => {
  if (pendingHeight !== null) {
    const height = pendingHeight;
    pendingHeight = null;
    resolve(height);
    return;
  }
  deliverHeight = resolve;
});

let promptGeneration = 0;

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

  promptGeneration += 1;
  paint(
    <ExportPromptPanel
      key={`prompt-${promptGeneration}`}
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
