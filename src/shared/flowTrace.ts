/** Long flow names are cut so the log's `[scope]` column stays readable. */
const MAX_TRACE_NAME_CHARS = 28;

/**
 * The `[scope]` a flow's log lines carry. One copy: the executor writes it, and the statistics
 * page filters the log by it, so a cut name has to be cut the same way on both sides.
 */
export function flowTraceName(name: string | undefined): string {
  const trimmed = (name ?? '').trim() || 'Flow';
  return trimmed.length > MAX_TRACE_NAME_CHARS ? `${trimmed.slice(0, MAX_TRACE_NAME_CHARS)}…` : trimmed;
}
