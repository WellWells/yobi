import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { BUILTIN_THUNDERBIRD_SERVER_ID, THUNDERBIRD_UNAVAILABLE_ERROR } from '../../shared/builtinConnectors';
import { BUILTIN_LINE_SERVER_ID } from '../../shared/types';
import { forgetStoredLineKey } from '../line/lineKeyStore';
import { connectionFileFingerprint } from '../thunderbird/bridge';

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
}

// The native LINE driver and Electron are pulled in lazily, keeping the registry importable offline.
export const BUILTIN_RUNTIMES: Readonly<Record<string, BuiltinRuntime>> = {
  [BUILTIN_LINE_SERVER_ID]: {
    connect: async (name, version) => (await import('../line/lineConnection')).connectLineMcp(name, version),
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
};
