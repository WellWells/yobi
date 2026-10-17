import { findBuiltinConnector } from '../../shared/builtinConnectors';
import type { McpServerActionResult, McpServerView, McpToolInfo } from '../../shared/types';
import { getLangCache, localizeUserFacingError, t } from '../i18n';

type Strings = Record<string, string>;

/**
 * Tools of a connector the app hosts itself carry the app's own name for them, in the user's
 * language, where one exists. Only built-ins: a remote server's tool that happens to share an
 * id keeps the title its server gave it.
 */
function localizeTools(server: McpServerView, strings: Strings): McpToolInfo[] {
  if (!findBuiltinConnector(server.id)) return server.tools;
  return server.tools.map((tool) => {
    // The template stays inside t(): scripts/i18n-check.ts finds dynamic keys only there.
    const title = t(strings, `settings.mcp.tool.${tool.name}`);
    return title === `settings.mcp.tool.${tool.name}` ? tool : { ...tool, title };
  });
}

/**
 * A connector card shows a server's `error` in place of its description, so every view that
 * leaves the main process has it translated first. The registry keeps the raw text for its log.
 * An error that is already a language key (the Thunderbird "waiting" state) maps to nothing and
 * passes through unchanged, which is what the card compares against.
 */
export function localizeServerViews(servers: McpServerView[]): McpServerView[] {
  const strings = getLangCache();
  return servers.map((server) => {
    const tools = localizeTools(server, strings);
    if (!server.error && tools === server.tools) return server;
    return {
      ...server,
      tools,
      ...(server.error ? { error: localizeUserFacingError(server.error, strings) } : {}),
    };
  });
}

export function localizeActionResult(result: McpServerActionResult): McpServerActionResult {
  return {
    ...result,
    servers: localizeServerViews(result.servers),
    ...(result.error ? { error: localizeUserFacingError(result.error, getLangCache()) } : {}),
  };
}
