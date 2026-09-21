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
 * Whether a connector reaches the user's OWN world — their messages, documents, tickets, repos —
 * as opposed to public reference material anyone could look up.
 *
 * The agent needs the distinction to decide where to look for a person or a file the user speaks
 * of as theirs. Without it a goal like "what does <a name only my contacts know> want" goes to
 * the web, which can only offer a public figure whose name merely resembles it.
 *
 * `docs` connectors are public by definition; every other catalog category is reached through the
 * user's own account. A connector that is not in the catalog stays UNKNOWN rather than guessed
 * at — the marker only ever ADDS a positive signal, so an unmarked server is not a server being
 * claimed to hold nothing of the user's.
 */
export function connectorHoldsUserData(url: string): boolean {
  // `?? ''` although the type requires it: a missing url must come out UNMARKED, never throw inside
  // a live agent run. The type is what keeps a production caller from omitting it.
  const trimmed = (url ?? '').trim().toLowerCase();
  if (trimmed.startsWith('builtin://')) return true;
  const entry = findCatalogEntry(trimmed);
  return entry ? entry.category !== 'docs' : false;
}
