import { BUILTIN_LINE_SERVER_ID, builtinLineServerConfig, builtinServerConfig } from './types';
import { mentionsXPlatform } from './xHandles';
import { SITE_CONNECTOR_ROWS, siteConnectorServerId } from './siteConnectors';
import type { SiteConnectorFlag, SiteConnectorSite } from './siteConnectors';
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

/** Stable id/command of the in-process connector for Taiwan's railways (THSR + TRA timetables and live status). */
export const BUILTIN_RAIL_SERVER_ID = 'builtin-rail';

/** The config flag that records the user's opt-in for each built-in connector. */
export type BuiltinConnectorFlag = 'lineReaderEnabled' | 'thunderbirdEnabled' | 'xConnectorEnabled' | 'taiwanRailEnabled' | SiteConnectorFlag;

export interface BuiltinConnector {
  id: string;
  flag: BuiltinConnectorFlag;
  /** Set for a sign-in connector from `siteConnectors.ts`: the row it was built from. */
  site?: SiteConnectorSite;
  descriptor: () => McpServerConfig;
  /** Words besides the display name that name this connector in a sentence. */
  keywords: readonly string[];
  /** For a name no keyword can carry — X is one letter — a stricter test of the whole message. */
  mentionedIn?: (text: string) => boolean;
  /**
   * Reads only public data — nothing of the user's own (no sign-in, no files, no messages) — so a
   * bot may use it in a group too, still per-account grant. Every other connector stays private
   * chats only: its answers would show the owner's data to the whole group.
   */
  publicData?: true;
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
    descriptor: () => builtinServerConfig('thunderbird', 'Thunderbird'),
    keywords: ['雷鳥', '雷鸟'],
  },
  {
    id: BUILTIN_X_SERVER_ID,
    flag: 'xConnectorEnabled',
    descriptor: () => builtinServerConfig('x', 'X'),
    // The one-letter name never matches on its own (see connectorKeywords), so phrasings of "on X"
    // stand in for it. Bare possessive/locative forms are left out: math and X-ray text use them too.
    keywords: ['Twitter', 'tweet', 'tweets', 'x.com', 'on X', '推特', 'X 上', 'X上', 'X 平台', 'X平台'],
    mentionedIn: mentionsXPlatform,
  },
  {
    id: BUILTIN_RAIL_SERVER_ID,
    flag: 'taiwanRailEnabled',
    descriptor: () => builtinServerConfig('rail', 'Taiwan Rail'),
    // Words a rider uses about these two railways. "Train" is in (in Taiwan it means TRA); "service
    // run" is not — buses and flights have them too, and a match turns the message into an agent run.
    keywords: ['高鐵', '高铁', '台鐵', '臺鐵', '台铁', '火車', '火车', '車次', '自強號', '莒光號', '區間車', '普悠瑪', '太魯閣號', 'THSR'],
    // Public timetables and train status only.
    publicData: true,
  },
  ...SITE_CONNECTOR_ROWS.map((row): BuiltinConnector => ({
    id: siteConnectorServerId(row.site),
    flag: row.flag,
    descriptor: () => builtinServerConfig(row.site, row.label),
    keywords: row.keywords,
    site: row.site,
  })),
];

/** The connectors a bot may use outside a private chat (see `publicData`). */
export const PUBLIC_DATA_CONNECTOR_IDS: readonly string[] = BUILTIN_CONNECTORS.filter((c) => c.publicData).map((c) => c.id);

export function findBuiltinConnector(id: string): BuiltinConnector | undefined {
  return BUILTIN_CONNECTORS.find((connector) => connector.id === id);
}

/** The built-in a `builtin://…` URL names; the chat surfaces know a connector by its URL. */
export function findBuiltinConnectorByUrl(url: string): BuiltinConnector | undefined {
  const target = (url ?? '').trim().toLowerCase();
  return BUILTIN_CONNECTORS.find((connector) => connector.descriptor().url === target);
}
