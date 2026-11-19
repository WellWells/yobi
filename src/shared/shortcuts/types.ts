export interface KeyboardEventLike {
  key: string;
  code: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

export interface ElectronInputLike {
  key: string;
  code: string;
  control: boolean;
  alt: boolean;
  shift: boolean;
  meta: boolean;
}

export type ShortcutGroup = 'global' | 'nav' | 'chat' | 'flow' | 'files' | 'editor' | 'window';

/**
 * How a row's combos relate when it shows more than one: `or` = any of them runs the one action;
 * `each` = they map in order onto the slash-separated actions the label names (Home / End).
 */
export type ComboRelation = 'or' | 'each';

export type ShortcutView = 'chat' | 'settings' | 'about' | 'logs' | 'flow';

export type ShortcutScope =
  | { kind: 'global-os' }
  | { kind: 'window' }
  | { kind: 'view'; views: readonly ShortcutView[] }
  | { kind: 'widget'; owner: string }
  | { kind: 'reference'; owner: string };

/**
 * A part of the window a shortcut is confined to: the key only fires while focus is on an element
 * marked `data-shortcut-area="<area>"` (or inside one). Anywhere else the key keeps its normal
 * meaning — e.g. Shift+Tab moves focus back (WCAG 2.1.1).
 */
export type ShortcutFocusArea = 'composer';

export const SHORTCUT_AREA_ATTR = 'data-shortcut-area';

export interface ShortcutGuards {
  requireNoModal?: boolean;
  requireFocusIn?: ShortcutFocusArea;
  blockWhileTyping?: boolean;
  ignoreShift?: boolean;
  phase?: 'bubble' | 'capture';
  stopPropagation?: boolean;
}

export type ShortcutStorage =
  | 'config.shortcuts'
  | 'legacy:hotkey'
  | 'legacy:quickExport'
  | 'legacy:regionHotkey'
  | 'none';

export interface ShortcutDef {
  id: string;
  group: ShortcutGroup;
  scope: ShortcutScope;
  defaultCombo: string | ((isMac: boolean) => string);
  rebindable: boolean;
  guards?: ShortcutGuards;
  storage?: ShortcutStorage;
  aliasCombos?: readonly string[];
  digitPrefix?: string;
  hintKey?: string;
  lockReasonKey?: string;
  displayCombos?: readonly string[];
  comboRelation?: ComboRelation;
}
