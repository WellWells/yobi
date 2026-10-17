/**
 * A key pressed while an input method is composing belongs to the input method: Enter confirms a
 * Zhuyin or Cangjie candidate and the arrows walk the candidate list, so a search box that drives
 * a list from the keyboard must not pick or move rows with them. Chromium reports some of those
 * presses only as key code 229.
 */
export function isComposingKey(event: { isComposing: boolean; keyCode: number }): boolean {
  return event.isComposing || event.keyCode === 229;
}
