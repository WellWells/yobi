import { findCatalogEntry } from './mcpCatalog';
import type { McpConnectionStatus, McpServerView } from './types';

/** What the registry knows about one server, enough to decide whether a use may connect it. */
export interface ConnectOnUseFacts {
  status: McpConnectionStatus;
  enabled: boolean;
  /** Hosted in-process (LINE, Thunderbird, …), not reached over a URL. */
  builtin: boolean;
  url: string;
  hasTokens: boolean;
  hasManualToken: boolean;
  /** An OAuth client was registered with the server at some point. */
  hasClient: boolean;
}

/**
 * Whether using a server that is not connected would connect it: with no sign-in, no browser and
 * nothing for the user to do. Open servers (Context7, DeepWiki) are not reconnected on boot, so
 * they are connected the first time something uses them. A server that needs a sign-in it does
 * not have is left alone; only the Connect button in Settings starts one.
 */
export function connectsOnUse(facts: ConnectOnUseFacts): boolean {
  if (!facts.enabled) return false;
  if (facts.status === 'connecting') return true;
  if (facts.status === 'connected' || facts.status === 'needs_auth') return false;
  // A built-in that failed is waiting on the app it relays to, and its watcher retries on its own.
  if (facts.builtin) return facts.status === 'disconnected';
  if (facts.hasTokens || facts.hasManualToken) return true;
  const auth = findCatalogEntry(facts.url)?.auth;
  if (auth === 'oauth' || auth === 'token') return false;
  // A client registered without tokens is an OAuth server whose sign-in is gone.
  return !facts.hasClient;
}

/** A connector a send can reach: connected now, or connected by the send itself. */
export function reachableOnSend(server: Pick<McpServerView, 'status' | 'connectOnUse'>): boolean {
  return server.status === 'connected' || server.connectOnUse === true;
}
