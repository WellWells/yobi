import { canonicalise } from './combo';
import type { ComboRelation, ShortcutDef, ShortcutView } from './types';

export const CHROMIUM_MENU_ACCELERATORS: readonly string[] = [
  'CommandOrControl+R',        
  'CommandOrControl+Shift+R',  
  'CommandOrControl+Shift+I',  
  'CommandOrControl+0',        
  'CommandOrControl+Plus',     
  'CommandOrControl+Minus',    
  'F11',                       
  'CommandOrControl+W',        
  'CommandOrControl+M',        
  'CommandOrControl+Z',        
  'Control+Y',                 
  'CommandOrControl+X',        
  'CommandOrControl+C',        
  'CommandOrControl+V',        
  'CommandOrControl+A',        
].map((accelerator) => canonicalise(accelerator));

export const SHORTCUTS = [
  {
    id: 'global.ask',
    group: 'global',
    scope: { kind: 'global-os' },
    defaultCombo: (isMac: boolean) => (isMac ? 'Command+Control+G' : 'Alt+G'),
    rebindable: true,
    storage: 'legacy:hotkey',
    hintKey: 'settings.hotkey.ask.hint',
  },
  {
    id: 'global.quickExport',
    group: 'global',
    scope: { kind: 'global-os' },
    defaultCombo: (isMac: boolean) => (isMac ? 'Command+Control+H' : 'Alt+H'),
    rebindable: true,
    storage: 'legacy:quickExport',
    hintKey: 'settings.hotkey.export.hint',
  },
  {
    id: 'global.regionAsk',
    group: 'global',
    scope: { kind: 'global-os' },
    defaultCombo: (isMac: boolean) => (isMac ? 'Command+Control+J' : 'Alt+J'),
    rebindable: true,
    storage: 'legacy:regionHotkey',
    hintKey: 'settings.hotkey.region.hint',
  },

  {
    id: 'nav.switchView',
    group: 'nav',
    scope: { kind: 'window' },
    defaultCombo: '',
    digitPrefix: 'Alt',
    rebindable: false,
    lockReasonKey: 'settings.shortcut.lock.navDigits',
    guards: { requireNoModal: true, blockWhileTyping: true },
  },
  {
    id: 'nav.quickSwitch',
    group: 'nav',
    scope: { kind: 'view', views: ['chat', 'flow'] },
    defaultCombo: 'CommandOrControl+K',
    rebindable: false,
    lockReasonKey: 'settings.shortcut.lock.convention',
    guards: { requireNoModal: true },
  },
  {
    id: 'nav.find',
    group: 'nav',
    scope: { kind: 'view', views: ['chat', 'flow', 'logs', 'settings'] },
    defaultCombo: 'CommandOrControl+F',
    rebindable: false,
    lockReasonKey: 'settings.shortcut.lock.convention',
    guards: { requireNoModal: true },
  },
  {
    id: 'nav.openShortcuts',
    group: 'nav',
    scope: { kind: 'window' },
    defaultCombo: 'CommandOrControl+Comma',
    rebindable: false,
    lockReasonKey: 'settings.shortcut.lock.selfReference',
    guards: { requireNoModal: true, blockWhileTyping: true },
  },

  {
    id: 'app.tempChat',
    group: 'chat',
    scope: { kind: 'window' },
    defaultCombo: 'CommandOrControl+Shift+I',
    rebindable: true,
    storage: 'config.shortcuts',
  },
  {
    id: 'chat.newConversation',
    group: 'chat',
    scope: { kind: 'view', views: ['chat'] },
    defaultCombo: 'CommandOrControl+N',
    rebindable: false,
    lockReasonKey: 'settings.shortcut.lock.convention',
    guards: { requireNoModal: true },
  },
  {
    id: 'chat.focusComposer',
    group: 'chat',
    scope: { kind: 'view', views: ['chat'] },
    defaultCombo: 'Shift+Escape',
    rebindable: true,
    storage: 'config.shortcuts',
    guards: { requireNoModal: true },
  },
  {
    id: 'chat.cycleModel',
    group: 'chat',
    scope: { kind: 'view', views: ['chat'] },
    defaultCombo: 'Shift+Tab',
    rebindable: true,
    storage: 'config.shortcuts',
    guards: { requireNoModal: true, phase: 'capture', stopPropagation: true },
  },

  {
    id: 'flow.save',
    group: 'flow',
    scope: { kind: 'view', views: ['flow'] },
    defaultCombo: 'CommandOrControl+S',
    rebindable: false,
    lockReasonKey: 'settings.shortcut.lock.convention',
    guards: { requireNoModal: true },
  },
  {
    id: 'flow.rename',
    group: 'flow',
    scope: { kind: 'view', views: ['flow'] },
    defaultCombo: 'F2',
    rebindable: false,
    lockReasonKey: 'settings.shortcut.lock.convention',
    guards: { requireNoModal: true, blockWhileTyping: true },
  },
  {
    id: 'flow.duplicate',
    group: 'flow',
    scope: { kind: 'view', views: ['flow'] },
    defaultCombo: 'CommandOrControl+D',
    rebindable: false,
    lockReasonKey: 'settings.shortcut.lock.convention',
    guards: { requireNoModal: true, blockWhileTyping: true },
  },
  {
    id: 'flow.delete',
    group: 'flow',
    scope: { kind: 'view', views: ['flow'] },
    defaultCombo: 'Delete',
    rebindable: false,
    lockReasonKey: 'settings.shortcut.lock.convention',
    guards: { requireNoModal: true, blockWhileTyping: true },
  },

  {
    id: 'files.editTitle',
    group: 'files',
    scope: { kind: 'widget', owner: 'sidebarList' },
    defaultCombo: 'F2',
    rebindable: false,
    lockReasonKey: 'settings.shortcut.lock.convention',
  },
  {
    id: 'files.revealInFolder',
    group: 'files',
    scope: { kind: 'widget', owner: 'sidebarList' },
    defaultCombo: 'Alt+R',
    aliasCombos: ['CommandOrControl+Shift+O'],
    rebindable: true,
    storage: 'config.shortcuts',
  },
  {
    // Alt+letter like reveal (Alt+R): no other app taught a key for "pin", so it is Yobi's own.
    id: 'files.togglePin',
    group: 'files',
    scope: { kind: 'widget', owner: 'sidebarList' },
    defaultCombo: 'Alt+P',
    rebindable: true,
    storage: 'config.shortcuts',
  },
  {
    id: 'files.delete',
    group: 'files',
    scope: { kind: 'view', views: ['chat'] },
    defaultCombo: 'Delete',
    rebindable: false,
    lockReasonKey: 'settings.shortcut.lock.convention',
    guards: { requireNoModal: true, blockWhileTyping: true },
  },

  {
    id: 'editor.format',
    group: 'editor',
    scope: { kind: 'widget', owner: 'codeEditor' },
    defaultCombo: 'Alt+Shift+F',
    rebindable: false,
    lockReasonKey: 'settings.shortcut.lock.convention',
  },

  {
    id: 'view.zoomIn',
    group: 'nav',
    scope: { kind: 'view', views: ['chat'] },
    defaultCombo: 'CommandOrControl+Plus',
    rebindable: false,
    lockReasonKey: 'settings.shortcut.lock.platformIdiom',
    guards: { requireNoModal: true, blockWhileTyping: true, ignoreShift: true },
  },
  {
    id: 'view.zoomOut',
    group: 'nav',
    scope: { kind: 'view', views: ['chat'] },
    defaultCombo: 'CommandOrControl+Minus',
    rebindable: false,
    lockReasonKey: 'settings.shortcut.lock.platformIdiom',
    guards: { requireNoModal: true, blockWhileTyping: true, ignoreShift: true },
  },
  {
    id: 'view.zoomReset',
    group: 'nav',
    scope: { kind: 'view', views: ['chat'] },
    defaultCombo: 'CommandOrControl+0',
    rebindable: false,
    lockReasonKey: 'settings.shortcut.lock.platformIdiom',
    guards: { requireNoModal: true, blockWhileTyping: true, ignoreShift: true },
  },
  {
    id: 'composer.send',
    group: 'chat',
    scope: { kind: 'widget', owner: 'composer' },
    defaultCombo: 'Enter',
    rebindable: false,
    lockReasonKey: 'settings.shortcut.lock.composer',
  },
  {
    id: 'composer.newline',
    group: 'chat',
    scope: { kind: 'widget', owner: 'composer' },
    defaultCombo: 'Shift+Enter',
    rebindable: false,
    lockReasonKey: 'settings.shortcut.lock.composer',
  },
  {
    // Literally Control on every platform, as in Claude Code: Cmd+C on macOS stays copy.
    id: 'chat.clearComposer',
    group: 'chat',
    scope: { kind: 'widget', owner: 'composer' },
    defaultCombo: 'Control+C',
    rebindable: false,
    hintKey: 'settings.shortcut.chat.clearComposer.hint',
    lockReasonKey: 'settings.shortcut.lock.composer',
  },
  {
    // Claude Code's Ctrl+G, literally Control on every platform like its Ctrl+C above.
    id: 'chat.externalEditor',
    group: 'chat',
    scope: { kind: 'widget', owner: 'composer' },
    defaultCombo: 'Control+G',
    rebindable: false,
    hintKey: 'settings.shortcut.chat.externalEditor.hint',
    lockReasonKey: 'settings.shortcut.lock.composer',
  },
  {
    id: 'composer.smartHomeEnd',
    group: 'chat',
    scope: { kind: 'widget', owner: 'composer' },
    defaultCombo: '',
    displayCombos: ['Home', 'End'],
    comboRelation: 'each',
    rebindable: false,
    lockReasonKey: 'settings.shortcut.lock.caretKey',
  },
  {
    id: 'sidebar.listNav',
    group: 'files',
    scope: { kind: 'widget', owner: 'sidebarList' },
    defaultCombo: '',
    displayCombos: ['Up', 'Down'],
    comboRelation: 'each',
    rebindable: false,
    lockReasonKey: 'settings.shortcut.lock.aria',
  },
  {
    id: 'sidebar.activate',
    group: 'files',
    scope: { kind: 'widget', owner: 'sidebarList' },
    defaultCombo: '',
    displayCombos: ['Enter', 'Space'],
    comboRelation: 'or',
    rebindable: false,
    lockReasonKey: 'settings.shortcut.lock.aria',
  },
  {
    id: 'chatFind.next',
    group: 'chat',
    scope: { kind: 'widget', owner: 'chatFind' },
    defaultCombo: 'Enter',
    aliasCombos: ['F3'],
    rebindable: false,
    lockReasonKey: 'settings.shortcut.lock.convention',
  },
  {
    id: 'chatFind.previous',
    group: 'chat',
    scope: { kind: 'widget', owner: 'chatFind' },
    defaultCombo: 'Shift+Enter',
    aliasCombos: ['Shift+F3'],
    rebindable: false,
    lockReasonKey: 'settings.shortcut.lock.convention',
  },
  {
    id: 'chatFind.close',
    group: 'chat',
    scope: { kind: 'widget', owner: 'chatFind' },
    defaultCombo: 'Escape',
    rebindable: false,
    lockReasonKey: 'settings.shortcut.lock.field',
  },
  {
    id: 'answerEditor.save',
    group: 'chat',
    scope: { kind: 'widget', owner: 'answerEditor' },
    defaultCombo: 'CommandOrControl+S',
    aliasCombos: ['CommandOrControl+Enter'],
    rebindable: false,
    lockReasonKey: 'settings.shortcut.lock.convention',
  },
  {
    id: 'answerEditor.cancel',
    group: 'chat',
    scope: { kind: 'widget', owner: 'answerEditor' },
    defaultCombo: 'Escape',
    rebindable: false,
    lockReasonKey: 'settings.shortcut.lock.field',
  },
  {
    id: 'mediaViewer.navigate',
    group: 'chat',
    scope: { kind: 'widget', owner: 'mediaViewer' },
    defaultCombo: '',
    displayCombos: ['Left', 'Right'],
    comboRelation: 'each',
    rebindable: false,
    lockReasonKey: 'settings.shortcut.lock.convention',
  },
  {
    id: 'mediaViewer.playPause',
    group: 'chat',
    scope: { kind: 'widget', owner: 'mediaViewer' },
    defaultCombo: '',
    displayCombos: ['Space', 'K'],
    comboRelation: 'or',
    rebindable: false,
    lockReasonKey: 'settings.shortcut.lock.convention',
  },
  {
    id: 'mediaViewer.seek',
    group: 'chat',
    scope: { kind: 'widget', owner: 'mediaViewer' },
    defaultCombo: '',
    displayCombos: ['J', 'L'],
    comboRelation: 'each',
    rebindable: false,
    lockReasonKey: 'settings.shortcut.lock.convention',
  },
  {
    id: 'writingTools.submitClose',
    group: 'chat',
    scope: { kind: 'widget', owner: 'writingTools' },
    defaultCombo: '',
    displayCombos: ['Enter', 'Escape'],
    comboRelation: 'each',
    rebindable: false,
    lockReasonKey: 'settings.shortcut.lock.field',
  },
  {
    id: 'inlineEdit.commitCancel',
    group: 'files',
    scope: { kind: 'widget', owner: 'inlineEdit' },
    defaultCombo: '',
    displayCombos: ['Enter', 'Escape'],
    comboRelation: 'each',
    rebindable: false,
    lockReasonKey: 'settings.shortcut.lock.field',
  },
  {
    id: 'recorder.abort',
    group: 'global',
    scope: { kind: 'widget', owner: 'hotkeyRecorder' },
    defaultCombo: 'Escape',
    rebindable: false,
    lockReasonKey: 'settings.shortcut.lock.recorder',
  },
  {
    id: 'selectorPicker.cancel',
    group: 'flow',
    scope: { kind: 'reference', owner: 'selectorPicker' },
    defaultCombo: 'Escape',
    rebindable: false,
    lockReasonKey: 'settings.shortcut.lock.foreignPage',
  },
  {
    id: 'quickExportPanel.confirmCancel',
    group: 'global',
    scope: { kind: 'reference', owner: 'quickExportPanel' },
    defaultCombo: '',
    displayCombos: ['Enter', 'Escape'],
    comboRelation: 'each',
    rebindable: false,
    lockReasonKey: 'settings.shortcut.lock.otherWindow',
  },
  {
    id: 'regionOverlay.confirmCancel',
    group: 'global',
    scope: { kind: 'reference', owner: 'regionOverlay' },
    defaultCombo: '',
    displayCombos: ['Enter', 'Escape'],
    comboRelation: 'each',
    rebindable: false,
    lockReasonKey: 'settings.shortcut.lock.regionOverlay',
  },
  {
    id: 'platform.reload',
    group: 'window',
    scope: { kind: 'reference', owner: 'platform' },
    defaultCombo: 'CommandOrControl+R',
    rebindable: false,
    hintKey: 'settings.shortcut.platform.reload.hint',
    lockReasonKey: 'settings.shortcut.lock.platformMenu',
  },
  {
    id: 'platform.closeWindow',
    group: 'window',
    scope: { kind: 'reference', owner: 'platform' },
    defaultCombo: 'CommandOrControl+W',
    rebindable: false,
    hintKey: 'settings.shortcut.platform.closeWindow.hint',
    lockReasonKey: 'settings.shortcut.lock.platformMenu',
  },
] as const satisfies readonly ShortcutDef[];

export type ShortcutId = (typeof SHORTCUTS)[number]['id'];

const BY_ID = new Map<string, ShortcutDef>(SHORTCUTS.map((s) => [s.id, s]));

export function shortcutById(id: ShortcutId): ShortcutDef {
  const found = BY_ID.get(id);
  if (!found) throw new Error(`Unknown shortcut id: ${id}`);
  return found;
}

export function resolveDefaultCombo(def: ShortcutDef, isMac: boolean): string {
  return typeof def.defaultCombo === 'function' ? def.defaultCombo(isMac) : def.defaultCombo;
}

/** Aliases always run the same action, so only a display-only set can map onto several actions. */
export function comboRelation(def: ShortcutDef): ComboRelation {
  return def.comboRelation ?? 'or';
}

export function isDispatchable(def: ShortcutDef): boolean {
  return def.scope.kind === 'window' || def.scope.kind === 'view';
}

/** `combo: ''` is the only way a shortcut is switched off; there is no separate on/off flag. */
export interface ShortcutOverride {
  combo?: string;
}

export function digitPrefixOf(def: ShortcutDef): string {
  return def.digitPrefix ?? '';
}

export function activeCombos(
  def: ShortcutDef,
  isMac: boolean,
  override: ShortcutOverride | undefined,
): string[] {
  if (def.digitPrefix) {
    const prefix = digitPrefixOf(def);
    return prefix ? [canonicalise(`${prefix}+1`)] : [];
  }
  const primary = resolveDefaultCombo(def, isMac);
  const shipped = primary ? [primary, ...(def.aliasCombos ?? [])] : [...(def.displayCombos ?? [])];

  if (!def.rebindable) return shipped;

  if (override?.combo !== undefined) return override.combo ? [override.combo] : [];
  return shipped;
}

export const SHORTCUT_VIEWS: readonly ShortcutView[] = ['chat', 'flow', 'logs', 'settings', 'about'];

export function collisionCombos(
  def: ShortcutDef,
  isMac: boolean,
  override: ShortcutOverride | undefined,
): string[] {
  if (!def.digitPrefix) return activeCombos(def, isMac, override);
  const prefix = digitPrefixOf(def);
  if (!prefix) return [];
  return SHORTCUT_VIEWS.map((_, index) => canonicalise(`${prefix}+${index + 1}`));
}
