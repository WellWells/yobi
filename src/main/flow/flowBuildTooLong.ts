/**
 * The errors a build or a revision stops with when its first prompt cannot fit any model it can
 * route to. English for the log and the `/agent` observation (the model can act on it);
 * `localizeUserFacingError` reads the number back out for the user. A leaf module on purpose:
 * i18n imports it.
 */
const FLOW_REQUEST_TOO_LONG = 'The flow request is too long for the AI model: shorten it by about';
const TOO_LONG_RE = /^The flow request is too long for the AI model: shorten it by about (\d+) characters$/;

const FLOW_TOO_LONG_TO_REVISE = 'The saved flow is too long for the AI model to revise: it is about';
const TOO_LONG_TO_REVISE_RE = /^The saved flow is too long for the AI model to revise: it is about (\d+) characters over\. A shorter change will not help; the user has to change it in the flow editor or shorten its longest step text$/;

function wholeChars(overChars: number): number {
  return Math.max(1, Math.ceil(overChars));
}

export function flowRequestTooLong(overChars: number): string {
  return `${FLOW_REQUEST_TOO_LONG} ${wholeChars(overChars)} characters`;
}

/** How many characters the request has to lose, or null when `raw` is some other error. */
export function parseFlowRequestTooLong(raw: string): number | null {
  const match = TOO_LONG_RE.exec(raw);
  return match ? Number(match[1]) : null;
}

export function flowTooLongToRevise(overChars: number): string {
  return `${FLOW_TOO_LONG_TO_REVISE} ${wholeChars(overChars)} characters over. A shorter change will not help; the user has to change it in the flow editor or shorten its longest step text`;
}

/** How far over the saved flow is, or null when `raw` is some other error. */
export function parseFlowTooLongToRevise(raw: string): number | null {
  const match = TOO_LONG_TO_REVISE_RE.exec(raw);
  return match ? Number(match[1]) : null;
}

/**
 * A revision prompt carries the whole saved flow plus the change. When cutting the change could
 * make it fit, say how much; otherwise the saved flow itself is what is too long, and telling the
 * caller to shorten a one-line change would only buy a retry that hits the same wall.
 */
export function revisionTooLong(overChars: number, change: string): string {
  return overChars < change.trim().length ? flowRequestTooLong(overChars) : flowTooLongToRevise(overChars);
}
