/**
 * One LineService for the whole app.
 *
 * Key extraction takes up to ~80s and holds an open handle on the encrypted DB, so the MCP
 * connector and the `line_read` flow skill must not each pay for their own. Loads the native
 * driver through LineService, so every importer has to reach it with a dynamic import.
 */
import { LineService } from './lineService';

let shared: LineService | null = null;

export function getSharedLineService(): LineService {
  shared ??= new LineService();
  return shared;
}

/** Releases the DB handle and the cached key — what turning the connector off must do. */
export function resetSharedLineService(): void {
  shared?.reset();
  shared = null;
}
