import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { BUILTIN_CALENDAR_SERVER_ID, BUILTIN_MAIL_SERVER_ID, BUILTIN_OFFICE_SERVER_ID, BUILTIN_PAGE_SERVER_ID, BUILTIN_PTT_SERVER_ID, BUILTIN_RAIL_SERVER_ID, BUILTIN_THUNDERBIRD_SERVER_ID, BUILTIN_TRANSLATE_SERVER_ID, BUILTIN_TWLAW_SERVER_ID, BUILTIN_X_SERVER_ID, BUILTIN_YOBI_SERVER_ID, THUNDERBIRD_UNAVAILABLE_ERROR, OFFICE_TOOL_MISSING_ERROR } from '../../shared/builtinConnectors';
import { BUILTIN_LINE_SERVER_ID } from '../../shared/types';
import { forgetStoredLineKey } from '../line/lineKeyStore';
import { connectionFileFingerprint } from '../thunderbird/bridge';
import { bySiteConnectorId } from '../siteConnector';
import { OFFICE_CALL_TIMEOUT_MS, officeAvailability } from '../office/officeAvailability';

export interface BuiltinConnection {
  client: Client;
  close: () => Promise<void>;
}

/** How the registry hosts one built-in connector. The descriptor and opt-in flag live in shared/. */
export interface BuiltinRuntime {
  connect: (clientName: string, clientVersion: string) => Promise<BuiltinConnection>;
  /** Runs after the user switches the connector off. */
  onDisabled?: () => void;
  /** Checks, and may rewrite, a tool call before it reaches the connector. A denial is the call's failed result. */
  prepareCall?: (toolName: string, args: Record<string, unknown>) => Promise<{ args: Record<string, unknown> } | { denied: string }>;
  /**
   * For a connector that relays to another app: null while that app is not running, otherwise a
   * value that changes whenever it starts again. A connector that could not connect is retried when
   * this value changes, and not before.
   */
  availability?: () => string | null;
  /** i18n key kept as the connector's error while `availability` reports the app is not running. */
  unavailableError?: string;
  /** For a connector whose calls can outlast the registry's usual limit. */
  callTimeoutMs?: number;
}

/** The largest subtitle file is 200 requests in a row, with a retry or two on the way. */
const TRANSLATE_CALL_TIMEOUT_MS = 10 * 60_000;

/** The first law call waits for ~31 MB of downloads and a ~20 s index build. */
const LAW_CALL_TIMEOUT_MS = 6 * 60_000;

// The native LINE driver and Electron are pulled in lazily, keeping the registry importable offline.
export const BUILTIN_RUNTIMES: Readonly<Record<string, BuiltinRuntime>> = {
  [BUILTIN_LINE_SERVER_ID]: {
    connect: async (name, version) => (await import('../line/lineConnection')).connectLineMcp(name, version),
    // A file line_send sends must be one the /agent read sandbox lets the model read.
    prepareCall: async (toolName, args) =>
      (toolName === 'line_send' ? (await import('./agentAttachmentGuard')).prepareLineSendCall(args) : { args }),
    // Switching the connector off has to drop the stored DB passphrase too, not just the in-memory
    // one — otherwise "off" would still leave a key for LINE's database on disk.
    onDisabled: forgetStoredLineKey,
  },
  [BUILTIN_THUNDERBIRD_SERVER_ID]: {
    connect: async (name, version) =>
      (await import('../thunderbird/thunderbirdConnection')).connectThunderbirdMcp(name, version),
    prepareCall: async (_toolName, args) =>
      (await import('../thunderbird/thunderbirdConnection')).prepareThunderbirdCall(args),
    availability: () => connectionFileFingerprint(),
    unavailableError: THUNDERBIRD_UNAVAILABLE_ERROR,
  },
  [BUILTIN_X_SERVER_ID]: {
    connect: async (name, version) => (await import('../x/xConnection')).connectXMcp(name, version),
  },
  [BUILTIN_RAIL_SERVER_ID]: {
    connect: async (name, version) => (await import('../rail/railConnection')).connectRailMcp(name, version),
  },
  [BUILTIN_PTT_SERVER_ID]: {
    connect: async (name, version) => (await import('../ptt/pttConnection')).connectPttMcp(name, version),
  },
  // Connecting starts the download and index build; a first call waits for it.
  [BUILTIN_TWLAW_SERVER_ID]: {
    connect: async (name, version) => (await import('../twLaw/lawConnection')).connectLawMcp(name, version),
    callTimeoutMs: LAW_CALL_TIMEOUT_MS,
  },
  [BUILTIN_MAIL_SERVER_ID]: {
    connect: async (name, version) => (await import('../mail/mailConnection')).connectMailMcp(name, version),
    prepareCall: async (_toolName, args) => (await import('../mail/mailConnection')).prepareMailCall(args),
    // Off means no IMAP session stays signed in; the account itself stays (the email step uses it).
    onDisabled: () => {
      void import('../mail/mailConnection').then((mail) => mail.closeMailConnection());
    },
  },
  [BUILTIN_CALENDAR_SERVER_ID]: {
    connect: async (name, version) => (await import('../calendar/calendarConnection')).connectCalendarMcp(name, version),
  },
  [BUILTIN_TRANSLATE_SERVER_ID]: {
    connect: async (name, version) => (await import('../translate/translateConnection')).connectTranslateMcp(name, version),
    // A subtitle file goes out to Microsoft, so it must be one the /agent read sandbox lets the model read.
    prepareCall: async (toolName, args) =>
      (toolName === 'translate_subtitle' ? (await import('./agentAttachmentGuard')).prepareReadPathCall(args) : { args }),
    callTimeoutMs: TRANSLATE_CALL_TIMEOUT_MS,
  },
  [BUILTIN_PAGE_SERVER_ID]: {
    connect: async (name, version) => (await import('../pageRead/pageReadConnection')).connectPageReadMcp(name, version),
  },
  // OfficeCLI's own MCP server, behind Yobi's check of every command (`office/officeCommand.ts`).
  // Waits, like Thunderbird, until a copy is found or downloaded (Settings › Connectors › Office).
  [BUILTIN_OFFICE_SERVER_ID]: {
    connect: async (name, version) => (await import('../office/officeConnection')).connectOfficeMcp(name, version),
    availability: officeAvailability,
    unavailableError: OFFICE_TOOL_MISSING_ERROR,
    callTimeoutMs: OFFICE_CALL_TIMEOUT_MS,
  },
  // Yobi's own settings, flows and updates; who reaches it from a bot is the `manage` grant.
  [BUILTIN_YOBI_SERVER_ID]: {
    connect: async (name, version) => (await import('../yobiControl/yobiConnection')).connectYobiMcp(name, version),
  },
  // The sign-in site connectors (Instagram, Facebook, …) come from their table. Switching one off
  // never signs out: flows and pasted links read with the same sign-in.
  ...bySiteConnectorId(({ connect }): BuiltinRuntime => ({ connect })),
};
