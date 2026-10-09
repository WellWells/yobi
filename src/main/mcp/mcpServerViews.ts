import type { McpServerActionResult, McpServerView } from '../../shared/types';
import { getLangCache, localizeUserFacingError } from '../i18n';

/**
 * A connector card shows a server's `error` in place of its description, so every view that
 * leaves the main process has it translated first. The registry keeps the raw text for its log.
 * An error that is already a language key (the Thunderbird "waiting" state) maps to nothing and
 * passes through unchanged, which is what the card compares against.
 */
export function localizeServerViews(servers: McpServerView[]): McpServerView[] {
  const strings = getLangCache();
  return servers.map((server) => (
    server.error ? { ...server, error: localizeUserFacingError(server.error, strings) } : server
  ));
}

export function localizeActionResult(result: McpServerActionResult): McpServerActionResult {
  return {
    ...result,
    servers: localizeServerViews(result.servers),
    ...(result.error ? { error: localizeUserFacingError(result.error, getLangCache()) } : {}),
  };
}
