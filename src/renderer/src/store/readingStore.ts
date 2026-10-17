import { create } from 'zustand';
import {
  DEFAULT_READING_PREFS,
  mergeReadingPrefs,
  normalizeReadingPrefs,
  type ReadingFont,
  type ReadingPrefs,
} from '../../../shared/readingPrefs';

export type { ReadingFont, ReadingPrefs };

export const READING_STORAGE_KEY = 'yobi-reading';

interface ReadingState {
  prefs: ReadingPrefs;
  /** A font shown while a menu row is hovered; `null` shows the saved one. */
  previewFont: ReadingFont | null;
  setReadingPrefs: (patch: Partial<ReadingPrefs>) => void;
}

export function parseStoredReadingPrefs(raw: string | null): ReadingPrefs {
  if (!raw) return DEFAULT_READING_PREFS;
  try {
    return normalizeReadingPrefs(JSON.parse(raw));
  } catch {
    return DEFAULT_READING_PREFS;
  }
}

function readStored(): ReadingPrefs {
  try {
    return parseStoredReadingPrefs(localStorage.getItem(READING_STORAGE_KEY));
  } catch {
    return DEFAULT_READING_PREFS;
  }
}

function writeStored(prefs: ReadingPrefs): void {
  try {
    localStorage.setItem(READING_STORAGE_KEY, JSON.stringify(prefs));
  } catch {
  }
}

/** The root attribute globals.css keys the reading face on. Width is read by the views. */
export function applyReadingAttributes(prefs: ReadingPrefs, previewFont: ReadingFont | null = null): void {
  const root = document.documentElement;
  const font = previewFont ?? prefs.font;
  if (font === 'default') root.removeAttribute('data-reading-font');
  else root.setAttribute('data-reading-font', font);
}

const initial = readStored();
// Applied at module evaluation, which main.tsx runs before the first render: no flash of the UI face.
applyReadingAttributes(initial);

/** Bumped per change, so only the reply to the latest one is adopted (an older reply lacks the newer patch). */
let updateSeq = 0;

export const useReadingStore = create<ReadingState>((set, get) => ({
  prefs: initial,
  previewFont: null,

  setReadingPrefs: (patch) => {
    const next = mergeReadingPrefs(get().prefs, patch);
    writeStored(next);
    applyReadingAttributes(next, get().previewFont);
    set({ prefs: next });
    const seq = ++updateSeq;
    window.electronAPI.updateReadingPrefs(patch).then((saved) => {
      // Main answers with the whole object it saved: adopting it heals any drift from config.json.
      if (seq === updateSeq) adoptReadingPrefs(saved);
    }).catch(() => {});
  },
}));

/** Takes config.json's preferences as the truth: mirror, root attributes and store. */
function adoptReadingPrefs(raw: unknown): void {
  const prefs = normalizeReadingPrefs(raw);
  writeStored(prefs);
  const { prefs: current, previewFont } = useReadingStore.getState();
  if (prefs.font === current.font && prefs.fullWidth === current.fullWidth) return;
  applyReadingAttributes(prefs, previewFont);
  useReadingStore.setState({ prefs });
}

/** Hover preview from the font menu; `null` restores the saved font. Nothing is stored. */
export function previewReadingFont(font: ReadingFont | null): void {
  const { prefs, previewFont } = useReadingStore.getState();
  if (previewFont === font) return;
  applyReadingAttributes(prefs, font);
  useReadingStore.setState({ previewFont: font });
}

/**
 * Reconciliation with config.json, the source of truth (the mirror only paints early): at startup,
 * and after a backup restore brought back another config.
 */
export function initReadingFromConfig(): void {
  const seq = updateSeq;
  window.electronAPI.getReadingPrefs().then((raw) => {
    // A change made while this read was in flight is newer than what it returns.
    if (seq === updateSeq) adoptReadingPrefs(raw);
  }).catch(() => {});
}

/** The reading column's maximum width: `undefined` (no cap) when full width is on. */
export function readingMaxWidth(fullWidth: boolean, normal: number): number | undefined {
  return fullWidth ? undefined : normal;
}
