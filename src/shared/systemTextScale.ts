/** Windows accessibility text size is independent of the display's DPI. */
export function normalizeSystemTextScale(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 100 && value <= 225
    ? value
    : 100;
}

export function parseWindowsTextScale(output: string): number {
  const value = /\bTextScaleFactor\s+REG_DWORD\s+(0x[0-9a-f]+|\d+)\b/i.exec(output)?.[1];
  return normalizeSystemTextScale(value ? Number(value) : undefined);
}
