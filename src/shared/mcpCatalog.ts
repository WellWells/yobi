import { isSiteConnectorUrl } from './siteConnectors';

export type McpAuthKind =
  | 'oauth'
  | 'token'
  | 'open';

export type McpCatalogCategory = 'docs' | 'work' | 'design' | 'dev' | 'business';

export interface McpCatalogEntry {
  id: string;
  name: string;
  url: string;
  auth: McpAuthKind;
  category: McpCatalogCategory;
  /**
   * Extra words the composer accepts as naming this connector. Only worth spending where the
   * display name cannot reach it — a sub-service nobody calls by the brand's name (`jira`), or
   * a spelling the name does not produce (`huggingface`). Everything else is matched by the
   * name itself, and a keyword repeating it is dead weight to keep in sync.
   */
  keywords?: readonly string[];
}

export const MCP_CATEGORIES: readonly McpCatalogCategory[] = ['docs', 'work', 'design', 'dev', 'business'];

export const MCP_CATALOG: readonly McpCatalogEntry[] = [
  { id: 'context7', name: 'Context7', url: 'https://mcp.context7.com/mcp', auth: 'open', category: 'docs' },
  { id: 'deepwiki', name: 'DeepWiki', url: 'https://mcp.deepwiki.com/mcp', auth: 'open', category: 'docs' },
  { id: 'mslearn', name: 'Microsoft Learn', url: 'https://learn.microsoft.com/api/mcp', auth: 'open', category: 'docs', keywords: ['msdn', 'learn.microsoft'] },
  { id: 'cloudflare-docs', name: 'Cloudflare Docs', url: 'https://docs.mcp.cloudflare.com/mcp', auth: 'open', category: 'docs' },
  { id: 'huggingface', name: 'Hugging Face', url: 'https://huggingface.co/mcp', auth: 'open', category: 'docs', keywords: ['huggingface'] },

  { id: 'notion', name: 'Notion', url: 'https://mcp.notion.com/mcp', auth: 'oauth', category: 'work' },
  { id: 'linear', name: 'Linear', url: 'https://mcp.linear.app/mcp', auth: 'oauth', category: 'work' },
  { id: 'asana', name: 'Asana', url: 'https://mcp.asana.com/mcp', auth: 'oauth', category: 'work' },
  // Jira and Confluence only: the Atlassian MCP does not serve Bitbucket, so naming it would
  // spend an agent run on a server that cannot answer.
  { id: 'atlassian', name: 'Atlassian', url: 'https://mcp.atlassian.com/v1/mcp', auth: 'oauth', category: 'work', keywords: ['jira', 'confluence'] },
  { id: 'airtable', name: 'Airtable', url: 'https://mcp.airtable.com/mcp', auth: 'oauth', category: 'work' },
  { id: 'dropbox', name: 'Dropbox', url: 'https://mcp.dropbox.com/mcp', auth: 'oauth', category: 'work' },
  { id: 'zapier', name: 'Zapier', url: 'https://mcp.zapier.com/api/mcp/mcp', auth: 'oauth', category: 'work' },

  { id: 'figma', name: 'Figma', url: 'https://mcp.figma.com/mcp', auth: 'oauth', category: 'design' },
  { id: 'webflow', name: 'Webflow', url: 'https://mcp.webflow.com/mcp', auth: 'oauth', category: 'design' },
  { id: 'wix', name: 'Wix', url: 'https://mcp.wix.com/mcp', auth: 'oauth', category: 'design' },

  { id: 'github', name: 'GitHub', url: 'https://api.githubcopilot.com/mcp/', auth: 'token', category: 'dev' },
  { id: 'sentry', name: 'Sentry', url: 'https://mcp.sentry.dev/mcp', auth: 'oauth', category: 'dev' },
  { id: 'vercel', name: 'Vercel', url: 'https://mcp.vercel.com', auth: 'oauth', category: 'dev' },
  { id: 'netlify', name: 'Netlify', url: 'https://netlify-mcp.netlify.app/mcp', auth: 'oauth', category: 'dev' },
  { id: 'supabase', name: 'Supabase', url: 'https://mcp.supabase.com/mcp', auth: 'oauth', category: 'dev' },
  { id: 'neon', name: 'Neon', url: 'https://mcp.neon.tech/mcp', auth: 'oauth', category: 'dev' },
  { id: 'cloudflare', name: 'Cloudflare', url: 'https://observability.mcp.cloudflare.com/mcp', auth: 'oauth', category: 'dev' },

  { id: 'stripe', name: 'Stripe', url: 'https://mcp.stripe.com', auth: 'oauth', category: 'business' },
  { id: 'square', name: 'Square', url: 'https://mcp.squareup.com/mcp', auth: 'oauth', category: 'business' },
  { id: 'paypal', name: 'PayPal', url: 'https://mcp.paypal.com/mcp', auth: 'oauth', category: 'business' },
  { id: 'intercom', name: 'Intercom', url: 'https://mcp.intercom.com/mcp', auth: 'oauth', category: 'business' },
];

export function normalizeMcpUrl(url: string): string {
  try {
    const parsed = new URL(url.trim());
    const path = parsed.pathname.replace(/\/+$/, '');
    return `${parsed.protocol}//${parsed.host.toLowerCase()}${path}${parsed.search}`;
  } catch {
    return url.trim().toLowerCase().replace(/\/+$/, '');
  }
}

export function findCatalogEntry(url: string): McpCatalogEntry | undefined {
  const target = normalizeMcpUrl(url);
  return MCP_CATALOG.find((entry) => normalizeMcpUrl(entry.url) === target);
}

/**
 * Whether a connector reaches the user's own data (messages, documents, tickets, repos) rather
 * than public reference material, so the agent looks there first for a person or file the user
 * calls theirs. `docs` connectors are public; other catalog categories go through the user's
 * account. Servers outside the catalog return false: the flag only adds a positive signal.
 */
export function connectorHoldsUserData(url: string): boolean {
  // `?? ''` although the type requires it: a missing url must come out UNMARKED, never throw inside
  // a live agent run. The type is what keeps a production caller from omitting it.
  const trimmed = (url ?? '').trim().toLowerCase();
  // X and the sign-in site connectors are read as the user but hold public posts, not the user's
  // own data: "look in your own data first" would send a question about the news to a search of
  // strangers' posts.
  if (trimmed === 'builtin://x' || isSiteConnectorUrl(trimmed)) return false;
  if (trimmed.startsWith('builtin://')) return true;
  const entry = findCatalogEntry(trimmed);
  return entry ? entry.category !== 'docs' : false;
}
