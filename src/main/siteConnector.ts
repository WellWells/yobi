/**
 * The main-process half of the sign-in site connectors: what `shared/siteConnectors.ts` cannot hold
 * because it lives only here. Keyed by the same site ids, so a row added there without its server
 * and notes here fails typecheck. `mcp/builtinRuntimes.ts` hosts each server and
 * `flow/agent/contractRegistry.ts` gives the agent its notes, both from this table.
 */
import { SITE_CONNECTOR_ROWS, siteConnectorServerId } from '../shared/siteConnectors';
import type { SiteConnectorSite } from '../shared/siteConnectors';
import { BILIBILI_NOTES } from './flow/agent/connectors/bilibiliContract';
import { FACEBOOK_NOTES } from './flow/agent/connectors/facebookContract';
import { INSTAGRAM_NOTES } from './flow/agent/connectors/instagramContract';
import type { InProcessConnection } from './mcp/inProcessServer';

export interface SiteConnectorRuntime {
  /** Hosts the site's read-only MCP server in-process. Loaded lazily, keeping the registry importable offline. */
  connect: (clientName: string, clientVersion: string) => Promise<InProcessConnection>;
  /** What the tool descriptions cannot say on their own, rendered once with the connector's catalog. */
  notes: string;
}

export const BUILTIN_SITE_CONNECTORS: Readonly<Record<SiteConnectorSite, SiteConnectorRuntime>> = {
  instagram: {
    connect: async (name, version) => (await import('./instagram/instagramConnection')).connectInstagramMcp(name, version),
    notes: INSTAGRAM_NOTES,
  },
  facebook: {
    connect: async (name, version) => (await import('./facebook/facebookConnection')).connectFacebookMcp(name, version),
    notes: FACEBOOK_NOTES,
  },
  bilibili: {
    connect: async (name, version) => (await import('./bilibili/bilibiliConnection')).connectBilibiliMcp(name, version),
    notes: BILIBILI_NOTES,
  },
};

/** One value per site connector, keyed by its connector id (`builtin-<site>`), in row order. */
export function bySiteConnectorId<T>(value: (runtime: SiteConnectorRuntime) => T): Record<string, T> {
  return Object.fromEntries(
    SITE_CONNECTOR_ROWS.map((row) => [siteConnectorServerId(row.site), value(BUILTIN_SITE_CONNECTORS[row.site])]),
  );
}
