import { managedToolState, resolveTool } from '../managedTools';

/** A screenshot of a long deck or a recalculated workbook can take a while. */
export const OFFICE_CALL_TIMEOUT_MS = 3 * 60_000;

/**
 * Changes whenever the copy of OfficeCLI Yobi would run changes, so a connector that could not
 * start retries then; null while none is found. Each call also starts a lookup (reused for a
 * minute), which is how a copy installed or downloaded meanwhile is noticed on the registry's
 * retry tick.
 */
export function officeAvailability(): string | null {
  void resolveTool('officecli').catch(() => undefined);
  const active = managedToolState('officecli').active;
  return active ? `${active.path}|${active.version}` : null;
}
