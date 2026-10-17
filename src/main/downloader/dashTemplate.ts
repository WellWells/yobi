import { StreamFormatError } from './streamTypes';

/*
 * DASH `SegmentTemplate` addressing (ISO/IEC 23009-1 §5.3.9.4): the `$…$` identifiers of a
 * template URL, and the segments a template stands for — numbered by `@duration`, or listed by a
 * `SegmentTimeline` of `<S t d r>` entries.
 */

/** Far more than any real video (a 10-hour stream of 2-second segments is 18,000): a runaway manifest. */
const MAX_SEGMENTS = 100_000;

export interface TemplateVars {
  RepresentationID?: string;
  Bandwidth?: number;
  Number?: number;
  Time?: number;
}

/** `$Number%05d$` → `00042`; `$$` → `$`. An identifier the template has but `vars` lacks is an error. */
export function expandTemplate(template: string, vars: TemplateVars): string {
  return template.replace(/\$(RepresentationID|Number|Bandwidth|Time|)(?:%0(\d+)d)?\$/g, (_all, name: string, width?: string) => {
    if (name === '') return '$';
    const value = vars[name as keyof TemplateVars];
    if (value === undefined) throw new StreamFormatError(`The segment template needs $${name}$`);
    const text = String(value);
    return width ? text.padStart(Number(width), '0') : text;
  });
}

function int(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return value !== undefined && value !== '' && Number.isFinite(n) ? n : fallback;
}

function checkCount(count: number): void {
  if (count > MAX_SEGMENTS) throw new StreamFormatError(`The manifest lists over ${MAX_SEGMENTS} segments`);
}

/**
 * The `$Number$` and `$Time$` of each media segment, in order. `attrs` are the template's (merged
 * with what it inherits); `timeline` its `<S>` entries' attributes; `durationS` the period's length,
 * which bounds `@duration` numbering and an `r="-1"` repeat.
 */
export function templateSegments(
  attrs: Readonly<Record<string, string>>,
  timeline: ReadonlyArray<Readonly<Record<string, string>>> | undefined,
  durationS: number,
): Array<{ Number: number; Time: number }> {
  const timescale = int(attrs.timescale, 1) || 1;
  const startNumber = int(attrs.startNumber, 1);
  const offset = int(attrs.presentationTimeOffset, 0);
  const out: Array<{ Number: number; Time: number }> = [];
  if (timeline && timeline.length > 0) {
    const periodEnd = offset + durationS * timescale;
    let time = offset;
    let number = startNumber;
    for (const [index, s] of timeline.entries()) {
      time = int(s.t, time);
      const d = int(s.d, 0);
      if (d <= 0) throw new StreamFormatError('A SegmentTimeline entry has no duration');
      let repeat = int(s.r, 0);
      if (repeat < 0) {
        const nextStart = timeline[index + 1]?.t;
        const end = nextStart !== undefined ? int(nextStart, periodEnd) : periodEnd;
        if (end <= time) throw new StreamFormatError('An open-ended SegmentTimeline repeat has no end');
        repeat = Math.ceil((end - time) / d) - 1;
      }
      checkCount(out.length + repeat + 1);
      for (let i = 0; i <= repeat; i++) {
        out.push({ Number: number, Time: time });
        number += 1;
        time += d;
      }
    }
    return out;
  }
  const duration = int(attrs.duration, 0);
  if (duration <= 0 || durationS <= 0) throw new StreamFormatError('The segment template has neither a timeline nor a duration');
  // A hair under a whole number of segments is that number, not one more.
  const count = Math.ceil((durationS * timescale) / duration - 1e-6);
  checkCount(count);
  for (let i = 0; i < count; i++) out.push({ Number: startNumber + i, Time: offset + i * duration });
  return out;
}
