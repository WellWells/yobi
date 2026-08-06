function lineStart(text: string, caret: number): number {
  return text.lastIndexOf('\n', caret - 1) + 1;
}

function lineEnd(text: string, caret: number): number {
  const index = text.indexOf('\n', caret);
  return index === -1 ? text.length : index;
}

export function homeTarget(text: string, caret: number): number | null {
  const start = lineStart(text, caret);
  if (caret !== start) return null;
  if (start === 0) return null;
  return lineStart(text, start - 1);
}

export function endTarget(text: string, caret: number): number | null {
  const end = lineEnd(text, caret);
  if (caret !== end) return null;
  if (end === text.length) return null;
  return lineEnd(text, end + 1);
}
