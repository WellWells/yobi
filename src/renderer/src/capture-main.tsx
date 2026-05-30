import React from 'react';
import ReactDOM from 'react-dom/client';
import type { MarkdownCaptureRequest } from '../../shared/types';
import { CapturePage } from './CapturePage';
import './styles/capture.css';
import 'katex/dist/katex.min.css';
import { loadShiki } from './utils/shikiPlugins';

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

async function waitForRenderedLayout(): Promise<void> {
  if (document.fonts?.ready) {
    await document.fonts.ready;
  }
  // 3 animation frames to cover the full async cycle:
  //   frame 1 — React initial render, useEffects fire, codeToHtml Promises start
  //   frame 2 — codeToHtml microtasks resolve, React schedules re-renders
  //   frame 3 — React re-renders ShikiCodeBlocks with highlighted HTML
  for (let i = 0; i < 3; i++) {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  }
  await new Promise<void>((resolve) => window.setTimeout(resolve, 50));
}

window.renderCaptureCard = async (request) => {
  // Pre-load shiki before rendering so getShikiPluginsSync() returns the full plugin
  // list on the first render — ensuring code blocks are highlighted in the capture image.
  // The singleton is cached globally, so subsequent calls are near-instant.
  await loadShiki();
  root.render(
    <React.StrictMode>
      <CapturePage request={request} />
    </React.StrictMode>,
  );
  await waitForRenderedLayout();
  const logicalRoot = document.getElementById('capture-logical-root');
  // Use getBoundingClientRect on the scene element for a more accurate fractional height
  // measurement, avoiding the integer scrollHeight over-counting by 1px in edge cases.
  const captureScene = logicalRoot?.querySelector('.capture-scene') as HTMLElement | null;
  const measuredHeight =
    captureScene?.getBoundingClientRect().height ??
    logicalRoot?.scrollHeight ??
    document.documentElement.scrollHeight;
  const logicalHeight = Math.max(1, Math.ceil(measuredHeight));
  return { logicalHeight };
};
