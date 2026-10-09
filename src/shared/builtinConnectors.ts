import { BUILTIN_LINE_SERVER_ID, builtinLineServerConfig } from './types';
import { mentionsXPlatform } from './xHandles';
import type { McpServerConfig } from './types';

/** Stable id/command of the opt-in connector that reaches the user's own Thunderbird. */
export const BUILTIN_THUNDERBIRD_SERVER_ID = 'builtin-thunderbird';

/**
 * i18n key the registry stores as the connector's error while Thunderbird is not running. Shared so
 * the card can tell "waiting for Thunderbird" apart from a real failure.
 */
export const THUNDERBIRD_UNAVAILABLE_ERROR = 'settings.mcp.thunderbird.unavailable';

/** Stable id/command of the in-process connector that reads X (Twitter) as the user. */
export const BUILTIN_X_SERVER_ID = 'builtin-x';

/** The config flag that records the user's opt-in for each built-in connector. */
export type BuiltinConnectorFlag = 'lineReaderEnabled' | 'thunderbirdEnabled' | 'xConnectorEnabled';

export interface BuiltinConnector {
  id: string;
  flag: BuiltinConnectorFlag;
  descriptor: () => McpServerConfig;
  /** Words besides the display name that name this connector in a sentence. */
  keywords: readonly string[];
  /** For a name no keyword can carry — X is one letter — a stricter test of the whole message. */
  mentionedIn?: (text: string) => boolean;
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

export function builtinXServerConfig(): McpServerConfig {
  return {
    id: BUILTIN_X_SERVER_ID,
    name: 'X',
    url: 'builtin://x',
    enabled: true,
    agentEnabled: true,
    autoApproveWrites: false,
    createdAt: new Date(0).toISOString(),
    commandName: 'x',
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
  {
    id: BUILTIN_X_SERVER_ID,
    flag: 'xConnectorEnabled',
    descriptor: builtinXServerConfig,
    // The one-letter name never matches on its own (see connectorKeywords), so phrasings of "on X"
    // stand in for it. Bare possessive/locative forms are left out: math and X-ray text use them too.
    keywords: ['Twitter', 'tweet', 'tweets', 'x.com', 'on X', '推特', 'X 上', 'X上', 'X 平台', 'X平台'],
    mentionedIn: mentionsXPlatform,
  },
];

export function findBuiltinConnector(id: string): BuiltinConnector | undefined {
  return BUILTIN_CONNECTORS.find((connector) => connector.id === id);
}

/** The built-in a `builtin://…` URL names; the chat surfaces know a connector by its URL. */
export function findBuiltinConnectorByUrl(url: string): BuiltinConnector | undefined {
  const target = (url ?? '').trim().toLowerCase();
  return BUILTIN_CONNECTORS.find((connector) => connector.descriptor().url === target);
}
