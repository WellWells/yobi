import { useSyncExternalStore } from 'react';
import { normalizeSystemTextScale } from '../../../shared/systemTextScale';

let currentPercent = 100;
const listeners = new Set<() => void>();

/** Only the text preference changes the root; Chromium already handles display DPI. */
export function applySystemTextScale(value: unknown): void {
  const percent = normalizeSystemTextScale(value);
  document.documentElement.style.fontSize = `${percent}%`;
  if (currentPercent === percent) return;
  currentPercent = percent;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function getScale(): number { return currentPercent / 100; }

/** Layout breakpoints follow the space needed by larger text, never the screen's DPI. */
export function useSystemTextScale(): number {
  return useSyncExternalStore(subscribe, getScale);
}

export function connectSystemTextScale(api: {
  getSystemTextScale: () => Promise<number>;
  onSystemTextScaleChanged: (listener: (percent: number) => void) => () => void;
}): () => void {
  let active = true;
  let receivedChange = false;
  const unsubscribe = api.onSystemTextScaleChanged((percent) => {
    receivedChange = true;
    if (active) applySystemTextScale(percent);
  });
  void api.getSystemTextScale().then((percent) => {
    if (active && !receivedChange) applySystemTextScale(percent);
  }).catch(() => {});
  return () => {
    active = false;
    unsubscribe();
  };
}
