/**
 * The date-range vocabulary of the `line_read` step, shared so the picker in the renderer and
 * the resolver in the main process cannot drift apart. The resolution itself (which needs a
 * clock and the host calendar) lives in src/main/flow/skills/lineRange.ts.
 */
export const LINE_RANGE_PRESETS = ['all', 'today', 'yesterday', 'last7d', 'last30d', 'custom'] as const;

export type LineRangePreset = (typeof LINE_RANGE_PRESETS)[number];

export function isLineRangePreset(value: string): value is LineRangePreset {
  return (LINE_RANGE_PRESETS as readonly string[]).includes(value);
}
