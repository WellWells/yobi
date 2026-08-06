import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { OAuthClientInformationFull, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js';

export type McpTool = Tool;

export interface McpToolResult {
  text: string;
  isError: boolean;
}

export interface McpAuthRecord {
  client?: OAuthClientInformationFull;
  tokens?: OAuthTokens;
  manualToken?: string;
}
