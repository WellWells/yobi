export type {
  KeyboardEventLike,
  ElectronInputLike,
  ShortcutDef,
  ShortcutGroup,
  ShortcutGuards,
  ShortcutScope,
  ShortcutStorage,
  ShortcutView,
} from './types';

export type { MatchOptions } from './combo';
export {
  canonicalise,
  comboFromEvent,
  comboOverlaps,
  fromElectronInput,
  isRegisterableAccelerator,
  matchesCombo,
  modifiersFromEvent,
  toAccelerator,
  toTokens,
} from './combo';

export type { ShortcutId, ShortcutOverride } from './registry';
export {
  CHROMIUM_MENU_ACCELERATORS,
  SHORTCUTS,
  activeCombos,
  collisionCombos,
  digitPrefixOf,
  isDispatchable,
  SHORTCUT_VIEWS,
  rebindableShortcuts,
  resolveDefaultCombo,
  shortcutById,
} from './registry';

export type {
  CollisionInput,
  CollisionLevel,
  CollisionReason,
  CollisionResult,
  FlowHotkeyRef,
} from './collision';
export { detectCollision } from './collision';
