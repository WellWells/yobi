import { BUILTIN_LINE_SERVER_ID, builtinLineServerConfig } from './types';
import type { McpServerConfig } from './types';

/** Stable id/command of the opt-in connector that reaches the user's own Thunderbird. */
export const BUILTIN_THUNDERBIRD_SERVER_ID = 'builtin-thunderbird';

/**
 * i18n key the registry stores as the connector's error while Thunderbird is not running. Shared so
 * the card can tell "waiting for Thunderbird" apart from a real failure.
 */
export const THUNDERBIRD_UNAVAILABLE_ERROR = 'settings.mcp.thunderbird.unavailable';

/** The config flag that records the user's opt-in for each built-in connector. */
export type BuiltinConnectorFlag = 'lineReaderEnabled' | 'thunderbirdEnabled';

export interface BuiltinConnector {
  id: string;
  flag: BuiltinConnectorFlag;
  descriptor: () => McpServerConfig;
  /** Words besides the display name that name this connector in a sentence. */
  keywords: readonly string[];
}

export function builtinThunderbirdServerConfig(): McpServerConfig {
  return {
    id: BUILTIN_THUNDERBIRD_SERVER_ID,
    name: 'Thunderbird',
    url: 'builtin://thunderbird',
    enabled: true,
    agentEnabled: true,
    autoApproveWrites: false,
    createdAt: new Date(0).toISOString(),
    commandName: 'thunderbird',
  };
}

/**
 * Built-in connectors are hosted by the app rather than added by URL, so none of them is in
 * `config.mcpServers`. Anything that resolves a connector id against config has to consult this
 * table as well — a built-in missing from one of those places is on in Settings and unknown there.
 */
export const BUILTIN_CONNECTORS: readonly BuiltinConnector[] = [
  { id: BUILTIN_LINE_SERVER_ID, flag: 'lineReaderEnabled', descriptor: builtinLineServerConfig, keywords: [] },
  {
    id: BUILTIN_THUNDERBIRD_SERVER_ID,
    flag: 'thunderbirdEnabled',
    descriptor: builtinThunderbirdServerConfig,
    keywords: ['雷鳥', '雷鸟'],
  },
];

export function findBuiltinConnector(id: string): BuiltinConnector | undefined {
  return BUILTIN_CONNECTORS.find((connector) => connector.id === id);
}
