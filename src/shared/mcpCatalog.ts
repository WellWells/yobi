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
}

export const MCP_CATEGORIES: readonly McpCatalogCategory[] = ['docs', 'work', 'design', 'dev', 'business'];

export const MCP_CATALOG: readonly McpCatalogEntry[] = [
  { id: 'context7', name: 'Context7', url: 'https://mcp.context7.com/mcp', auth: 'open', category: 'docs' },
  { id: 'deepwiki', name: 'DeepWiki', url: 'https://mcp.deepwiki.com/mcp', auth: 'open', category: 'docs' },
  { id: 'mslearn', name: 'Microsoft Learn', url: 'https://learn.microsoft.com/api/mcp', auth: 'open', category: 'docs' },
  { id: 'cloudflare-docs', name: 'Cloudflare Docs', url: 'https://docs.mcp.cloudflare.com/mcp', auth: 'open', category: 'docs' },
  { id: 'huggingface', name: 'Hugging Face', url: 'https://huggingface.co/mcp', auth: 'open', category: 'docs' },

  { id: 'notion', name: 'Notion', url: 'https://mcp.notion.com/mcp', auth: 'oauth', category: 'work' },
  { id: 'linear', name: 'Linear', url: 'https://mcp.linear.app/mcp', auth: 'oauth', category: 'work' },
  { id: 'asana', name: 'Asana', url: 'https://mcp.asana.com/mcp', auth: 'oauth', category: 'work' },
  { id: 'atlassian', name: 'Atlassian', url: 'https://mcp.atlassian.com/v1/mcp', auth: 'oauth', category: 'work' },
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
