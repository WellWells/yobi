export function containsActiveElement(container: HTMLElement | null): boolean {
  const active = document.activeElement;
  if (!container || !active) return false;
  return container.contains(active);
}

export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return Boolean(target.closest('input, textarea, select, [contenteditable="true"]'));
}
