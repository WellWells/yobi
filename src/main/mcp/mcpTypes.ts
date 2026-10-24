import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { OAuthClientInformationFull, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js';

export type McpTool = Tool;

/**
 * Where an in-process tool lists the pictures it saved for the answer (absolute paths in the chat
 * media folder). Read only from built-in connectors: a remote server's `_meta` names no local file.
 */
export const PICTURES_META_KEY = 'yobi/pictures';

export interface McpToolResult {
  text: string;
  isError: boolean;
  /** Pictures a built-in connector saved for the answer (the metro map), absolute paths; never from a remote server. */
  pictures?: string[];
}

export interface McpAuthRecord {
  client?: OAuthClientInformationFull;
  tokens?: OAuthTokens;
  manualToken?: string;
}
