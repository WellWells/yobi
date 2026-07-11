// Platform-aware modifier-key labels. macOS users recognize the ⇧ glyph, but on
// Windows/Linux the spelled-out word "Shift" reads far more clearly to non-power
// users — so the same shortcut is surfaced with the label native to each OS.
export const isMac = (
  (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform
  ?? navigator.platform
  ?? ''
).toLowerCase().includes('mac');

// Standalone Shift key, e.g. inside a <Kbd> chip: "⇧" on macOS, "Shift" elsewhere.
export const SHIFT_KEY_LABEL = isMac ? '⇧' : 'Shift';

// Inline "Shift+Tab" hint for tooltip/sentence text, using each platform's
// conventional joiner ("⇧ Tab" on macOS, "Shift + Tab" on Windows/Linux).
export const SHIFT_TAB_HINT = isMac ? '⇧ Tab' : 'Shift + Tab';

// Temporary-chat-mode toggle shortcut, matching the before-input-event binding
// in the main process ("⌘⇧I" on macOS, "Ctrl+Shift+I" elsewhere).
export const TEMP_CHAT_SHORTCUT_HINT = isMac ? '⌘⇧I' : 'Ctrl+Shift+I';
