/**
 * The raw messages MCP failures carry. They stay English in the log; `localizeUserFacingError`
 * maps them before a connector card, the form or a chat shows them. A leaf module on purpose:
 * i18n imports it, and the registry imports i18n's callers.
 */
export const MCP_UNAVAILABLE = 'MCP is unavailable';
export const MCP_SERVER_NOT_FOUND = 'Server not found';
export const MCP_UNKNOWN_SERVER = 'Unknown MCP server';
export const MCP_UNKNOWN_BUILTIN = 'Unknown built-in connector';
export const MCP_INVALID_URL_PREFIX = 'Invalid MCP server URL: ';
export const MCP_URL_NEEDS_HTTPS = 'MCP server URL must use https';

export const MCP_AUTH_DENIED_PREFIX = 'Authorization failed: ';
export const MCP_AUTH_STATE_MISMATCH = 'OAuth state mismatch — possible CSRF, authorization rejected';
export const MCP_AUTH_MISSING_CODE = 'Authorization response missing the code';
export const MCP_AUTH_TIMED_OUT = 'Timed out waiting for authorization';
export const MCP_AUTH_CANCELLED = 'Authorization cancelled';

/** The page the browser lands on after the provider's sign-in, keyed by what happened. */
export type McpAuthPageKey =
  | 'mcp.auth.success'
  | 'mcp.auth.failed'
  | 'mcp.auth.incomplete'
  | 'mcp.auth.noPending'
  | 'mcp.auth.notFound';

export type McpAuthPageText = (key: McpAuthPageKey, vars?: Record<string, string>) => string;
