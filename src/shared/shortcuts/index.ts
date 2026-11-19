export type { ComboRelation, KeyboardEventLike, ShortcutDef, ShortcutFocusArea, ShortcutGroup } from './types';
export { SHORTCUT_AREA_ATTR } from './types';

export {
  canonicalise,
  comboFromEvent,
  comboLabel,
  comboOverlaps,
  fromElectronInput,
  isRegisterableAccelerator,
  joinTokens,
  matchesCombo,
  modifiersFromEvent,
  toAccelerator,
  toTokens,
} from './combo';

export type { ShortcutId, ShortcutOverride } from './registry';
export {
  SHORTCUTS,
  activeCombos,
  collisionCombos,
  comboRelation,
  digitPrefixOf,
  isDispatchable,
  resolveDefaultCombo,
  shortcutById,
} from './registry';

export type { FlowHotkeyRef } from './collision';
export { detectCollision } from './collision';
