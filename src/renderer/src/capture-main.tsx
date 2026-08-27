import React from 'react';
import ReactDOM from 'react-dom/client';
import type { MarkdownCaptureRequest } from '../../shared/types';
import { captureMarkdownSources } from '../../shared/captureSources';
import { CapturePage } from './CapturePage';
import './styles/capture.css';
import './styles/captureCard.css';
import 'katex/dist/katex.min.css';
import { loadShiki } from './utils/shikiPlugins';
import { prerenderMermaid, whenMermaidIdle } from './utils/mermaidRuntime';
import { captureDiagramTheme } from './utils/forcedCodeTheme';

declare global {
  interface Window {
    renderCaptureCard?: (request: MarkdownCaptureRequest) => Promise<{ logicalHeight: number }>;
  }
}

const rootElement = document.getElementById('capture-root');
if (!rootElement) {
  throw new Error('capture root element not found');
}
const root = ReactDOM.createRoot(rootElement);

const IDLE_BARRIER_MS = 3_000;

function nextFrame(): Promise<void> {
  return new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

async function waitForRenderedLayout(): Promise<void> {
  if (document.fonts?.ready) {
    await document.fonts.ready;
  }
  for (let i = 0; i < 3; i++) {
    await nextFrame();
  }
  await whenMermaidIdle(IDLE_BARRIER_MS);
  for (let i = 0; i < 3; i++) {
    await nextFrame();
  }
  await new Promise<void>((resolve) => window.setTimeout(resolve, 50));
}

window.renderCaptureCard = async (request) => {
  await loadShiki();
  await prerenderMermaid(captureMarkdownSources(request), captureDiagramTheme(request.options.cardTheme));
  root.render(
    <React.StrictMode>
      <CapturePage request={request} />
    </React.StrictMode>,
  );
  await waitForRenderedLayout();
  const logicalRoot = document.getElementById('capture-logical-root');
  const captureScene = logicalRoot?.querySelector('.capture-scene') as HTMLElement | null;
  const measuredHeight =
    captureScene?.getBoundingClientRect().height ??
    logicalRoot?.scrollHeight ??
    document.documentElement.scrollHeight;
  const logicalHeight = Math.max(1, Math.ceil(measuredHeight));
  return { logicalHeight };
};
