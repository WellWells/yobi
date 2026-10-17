import { useEffect } from 'react';
import { activeCombos, digitPrefixOf, isDispatchable, matchesCombo, SHORTCUTS } from '../../../shared/shortcuts';
import type { ShortcutDef, ShortcutOverride } from '../../../shared/shortcuts';
import { NAV_ORDER, useAppStore } from '../store/appStore';
import type { View } from '../store/appStore';
import { useShortcutStore } from '../store/shortcutStore';
import type { ShortcutHandler } from '../store/shortcutStore';
import { isTypingTarget } from '../utils/domUtils';
import { isMac } from '../utils/keyLabels';

const DISPATCHABLE: ShortcutDef[] = SHORTCUTS.filter(isDispatchable);

function modalIsOpen(): boolean {
  return Boolean(document.querySelector('[aria-modal="true"]'));
}

/**
 * A text field inside an open menu (the chat ⋮ menu's search box, a language filter) owns every
 * key typed into it. Shortcuts that deliberately fire while typing (Ctrl+K, Ctrl+F, Ctrl+N, the
 * capture-phase Shift+Tab) were made for the composer and the page's own fields; from a menu's
 * search box they would act on the page behind the menu while it is still open.
 */
export function isMenuTextField(target: EventTarget | null): boolean {
  return isTypingTarget(target) && target instanceof HTMLElement && target.closest('[data-menu-dropdown]') !== null;
}

function digitCombos(def: ShortcutDef): string[] {
  const prefix = digitPrefixOf(def);
  if (!prefix) return [];
  return NAV_ORDER.map((_, index) => `${prefix}+${index + 1}`);
}

function combosFor(def: ShortcutDef, override: ShortcutOverride | undefined): string[] {
  if (def.digitPrefix) return digitCombos(def);
  return activeCombos(def, isMac, override);
}

function inScope(def: ShortcutDef, currentView: View): boolean {
  if (def.scope.kind === 'window') return true;
  if (def.scope.kind === 'view') return def.scope.views.includes(currentView);
  return false;
}

function pickHandler(
  entries: { view: View | 'any'; fn: ShortcutHandler }[] | undefined,
  currentView: View,
): ShortcutHandler | null {
  if (!entries?.length) return null;
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry && entry.view === currentView) return entry.fn;
  }
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry && entry.view === 'any') return entry.fn;
  }
  return null;
}

function dispatch(event: KeyboardEvent, phase: 'bubble' | 'capture'): void {
  if (isMenuTextField(event.target)) return;
  const currentView = useAppStore.getState().currentView;
  const { overrides, handlers } = useShortcutStore.getState();

  for (const def of DISPATCHABLE) {
    if ((def.guards?.phase ?? 'bubble') !== phase) continue;
    if (!inScope(def, currentView)) continue;

    const matchOptions = { ignoreShift: def.guards?.ignoreShift, isMac };
    const matched = combosFor(def, overrides[def.id])
      .find((combo) => matchesCombo(event, combo, [], matchOptions));
    if (!matched) continue;

    if (def.guards?.requireNoModal && modalIsOpen()) continue;
    if (def.guards?.blockWhileTyping && isTypingTarget(event.target)) continue;

    const handler = pickHandler(handlers[def.id], currentView);
    if (!handler) continue;

    event.preventDefault();
    if (def.guards?.stopPropagation) event.stopPropagation();
    handler(event, matched);
    return;
  }
}

export function attachDispatcher(): () => void {
  const onBubble = (event: KeyboardEvent) => dispatch(event, 'bubble');
  const onCapture = (event: KeyboardEvent) => dispatch(event, 'capture');
  window.addEventListener('keydown', onBubble);
  window.addEventListener('keydown', onCapture, true);
  return () => {
    window.removeEventListener('keydown', onBubble);
    window.removeEventListener('keydown', onCapture, true);
  };
}

export function useShortcutDispatcher(): void {
  useEffect(() => attachDispatcher(), []);
}
