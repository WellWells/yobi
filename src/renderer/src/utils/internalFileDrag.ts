/**
 * A conversation row dragged out of the list is a real OS file drag (`webContents.startDrag`),
 * so while the cursor is still over Yobi it looks exactly like a file dragged in from Explorer.
 * Without this flag the drop overlays would spring up under the row the user just picked up.
 *
 * The flag clears when the drag ends inside the window (drop), leaves it — once it has left,
 * coming back is treated like any other file drag — or on the first buttonless mouse move.
 *
 * It also remembers which conversations are being dragged: dropped back on a folder row (or the
 * top level) of the list they came from, they are moved there instead of imported.
 */
let active = false;
let dragged: readonly string[] = [];

export function markInternalFileDrag(paths: readonly string[] = []): void {
  active = true;
  dragged = [...paths];
}

export function isInternalFileDrag(): boolean {
  return active;
}

/** The conversations of the drag in progress; empty when none (or it is not ours). */
export function internalDragPaths(): readonly string[] {
  return active ? dragged : [];
}

export function clearInternalFileDrag(): void {
  active = false;
  dragged = [];
}

/** Chromium reports a drag leaving the window as a `dragleave` at or past the viewport edge. */
export function isLeavingWindow(event: { clientX: number; clientY: number }, width: number, height: number): boolean {
  return event.clientX <= 0 || event.clientY <= 0 || event.clientX >= width || event.clientY >= height;
}
