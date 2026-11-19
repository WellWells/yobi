import { create } from 'zustand';
import { applyRootThemeVars } from '../theme';
import { isTheme, themeDef } from '../../../shared/themes';
import type { Theme, ThemePreference } from '../../../shared/themes';

export type { Theme, ThemePreference };

const THEME_STORAGE_KEY = 'yobi-theme';
const MOTION_STORAGE_KEY = 'yobi-backdrop-motion';

/*
 * A theme lives on <html> (`applyRootThemeVars`), not in React: the Mantine provider never sees it
 * change. Only the few components that draw in theme-specific colours of their own (code blocks,
 * diagrams, connector tints) subscribe to `theme`.
 */
interface ThemeState {
  preference: ThemePreference;
  theme: Theme;
  /** Whether a moving backdrop moves: the switch that stops it. */
  motion: boolean;
  setTheme: (preference: ThemePreference) => void;
  previewTheme: (preference: ThemePreference | null) => void;
  setMotion: (motion: boolean) => void;
}

export function resolveThemePreference(raw: string | null | undefined): ThemePreference {
  return isTheme(raw) ? raw : 'auto';
}

function systemTheme(): Theme {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** How the window stands: in use, on screen behind another window's focus, or not shown at all. */
export type WindowPresence = 'focused' | 'visible' | 'hidden';

/**
 * What `data-backdrop-motion` says: absent (still), `on`, `idle` (flowing at a lower frame rate,
 * the window is on screen but another has the focus) or `paused` (minimised or hidden).
 */
export function backdropMotionState(theme: Theme, motion: boolean, presence: WindowPresence): 'on' | 'idle' | 'paused' | null {
  if (!motion || themeDef(theme).backdrop === undefined) return null;
  if (presence === 'hidden') return 'paused';
  return presence === 'focused' ? 'on' : 'idle';
}

/**
 * A window on screen keeps flowing when another window has the focus: it is often watched from
 * the window being typed in. It only paints less often. Hidden or minimised, it stops: Chromium's own background throttling is
 * switched off for this app (worker windows must keep running), so nothing else would stop it.
 *
 * The system's reduced-motion setting is not what stops it: Windows reports "reduce" whenever
 * Animation effects is off, which is common for speed alone, and the theme would then never do
 * the one thing it was picked for. Picking the theme is the request; the switch is the way out.
 */
function applyBackdropMotion(theme: Theme, motion: boolean): void {
  const presence: WindowPresence = document.visibilityState !== 'visible' ? 'hidden' : document.hasFocus() ? 'focused' : 'visible';
  const state = backdropMotionState(theme, motion, presence);
  const root = document.documentElement;
  if (state) root.setAttribute('data-backdrop-motion', state);
  else root.removeAttribute('data-backdrop-motion');
}

function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStored(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
  }
}

let currentMotion = readStored(MOTION_STORAGE_KEY) !== 'off';

function applyTheme(preference: ThemePreference): Pick<ThemeState, 'preference' | 'theme'> {
  const theme = preference === 'auto' ? systemTheme() : preference;
  applyRootThemeVars(theme);
  applyBackdropMotion(theme, currentMotion);
  return { preference, theme };
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  ...applyTheme(resolveThemePreference(readStored(THEME_STORAGE_KEY))),
  motion: currentMotion,

  setTheme: (preference: ThemePreference) => {
    writeStored(THEME_STORAGE_KEY, preference);
    set(applyTheme(preference));
    window.electronAPI.updateTheme(preference).catch(() => {});
  },

  previewTheme: (preference: ThemePreference | null) => {
    const committed = get().preference;
    set({ ...applyTheme(preference ?? committed), preference: committed });
  },

  setMotion: (motion: boolean) => {
    adoptMotion(motion);
    window.electronAPI.updateBackdropMotion(motion).catch(() => {});
  },
}));

function adoptMotion(motion: boolean): void {
  currentMotion = motion;
  writeStored(MOTION_STORAGE_KEY, motion ? 'on' : 'off');
  applyBackdropMotion(useThemeStore.getState().theme, motion);
  if (useThemeStore.getState().motion !== motion) useThemeStore.setState({ motion });
}

function refreshBackdropMotion(): void {
  applyBackdropMotion(useThemeStore.getState().theme, currentMotion);
}

window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (useThemeStore.getState().preference !== 'auto') return;
  useThemeStore.setState(applyTheme('auto'));
});
window.addEventListener('focus', refreshBackdropMotion);
window.addEventListener('blur', refreshBackdropMotion);
document.addEventListener('visibilitychange', refreshBackdropMotion);

export function initThemeFromConfig(): void {
  window.electronAPI.getTheme().then((raw) => {
    const preference = resolveThemePreference(raw);
    writeStored(THEME_STORAGE_KEY, preference);
    if (preference === useThemeStore.getState().preference) return;
    useThemeStore.setState(applyTheme(preference));
  }).catch(() => { });
  window.electronAPI.getBackdropMotion().then((moves) => adoptMotion(moves !== false)).catch(() => { });
}
