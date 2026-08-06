export const isMac = (
  (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform
  ?? navigator.platform
  ?? ''
).toLowerCase().includes('mac');

export const SHIFT_KEY_LABEL = isMac ? '⇧' : 'Shift';

export const SHIFT_TAB_HINT = isMac ? '⇧ Tab' : 'Shift + Tab';

export const TEMP_CHAT_SHORTCUT_HINT = isMac ? '⌘⇧I' : 'Ctrl+Shift+I';

export const NEW_CHAT_SHORTCUT_HINT = isMac ? '⌘N' : 'Ctrl+N';
