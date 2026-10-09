/**
 * A conversation row dragged out of the list is a real OS file drag (`webContents.startDrag`),
 * so while the cursor is still over Yobi it looks exactly like a file dragged in from Explorer.
 * Without this flag the drop overlays would spring up under the row the user just picked up.
 *
 * The flag clears when the drag ends inside the window (drop), leaves it — once it has left,
 * coming back is treated like any other file drag — or on the first buttonless mouse move.
 */
let active = false;

export function markInternalFileDrag(): void {
  active = true;
}

export function isInternalFileDrag(): boolean {
  return active;
}

export function clearInternalFileDrag(): void {
  active = false;
}

/** Chromium reports a drag leaving the window as a `dragleave` at or past the viewport edge. */
export function isLeavingWindow(event: { clientX: number; clientY: number }, width: number, height: number): boolean {
  return event.clientX <= 0 || event.clientY <= 0 || event.clientX >= width || event.clientY >= height;
}
