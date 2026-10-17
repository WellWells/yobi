function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/** The local calendar day, `2026-10-16`: the date on the user's wall, not the UTC one. */
export function toIsoDate(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/**
 * The host's UTC offset at that instant, as `+08:00`. Read per-instant rather than from a
 * constant so a DST transition shifts the rendered time with the calendar instead of against it.
 */
function localOffsetLabel(at: Date): string {
  const minutes = -at.getTimezoneOffset();
  const sign = minutes < 0 ? '-' : '+';
  const abs = Math.abs(minutes);
  return `${sign}${pad2(Math.floor(abs / 60))}:${pad2(abs % 60)}`;
}

/** `2026-10-03T22:09:05+08:00`: the host's wall time, with its offset said out loud. */
export function localIsoString(at: Date): string {
  const time = `${pad2(at.getHours())}:${pad2(at.getMinutes())}:${pad2(at.getSeconds())}`;
  return `${toIsoDate(at)}T${time}${localOffsetLabel(at)}`;
}
