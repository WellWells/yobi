import React from 'react';
import { BookOpen, Briefcase, Code, CreditCard, Palette, Server } from 'lucide-react';
import {
  AirtableIcon, AsanaIcon, AtlassianIcon, CloudflareIcon, DropboxIcon, FigmaIcon, GithubIcon,
  HuggingFaceIcon, IntercomIcon, LinearIcon, NeonIcon, NetlifyIcon, NotionIcon, PayPalIcon,
  SentryIcon, SquareIcon, StripeIcon, SupabaseIcon, VercelIcon, WebflowIcon, WixIcon, ZapierIcon,
} from './brandIcons';
import type { BrandIcon } from './brandIcons';
import { brandTint } from './brandTints';
import type { McpCatalogCategory, McpCatalogEntry } from '../../../shared/mcpCatalog';
import type { Theme } from '../../../shared/themes';

export const BRAND_MARKS: Record<string, BrandIcon> = {
  airtable: AirtableIcon,
  asana: AsanaIcon,
  atlassian: AtlassianIcon,
  cloudflare: CloudflareIcon,
  'cloudflare-docs': CloudflareIcon,
  dropbox: DropboxIcon,
  figma: FigmaIcon,
  github: GithubIcon,
  huggingface: HuggingFaceIcon,
  intercom: IntercomIcon,
  linear: LinearIcon,
  neon: NeonIcon,
  netlify: NetlifyIcon,
  notion: NotionIcon,
  paypal: PayPalIcon,
  sentry: SentryIcon,
  square: SquareIcon,
  stripe: StripeIcon,
  supabase: SupabaseIcon,
  vercel: VercelIcon,
  webflow: WebflowIcon,
  wix: WixIcon,
  zapier: ZapierIcon,
};

const CATEGORY_GLYPHS: Record<McpCatalogCategory, React.FC<{ size?: number }>> = {
  docs: BookOpen,
  work: Briefcase,
  design: Palette,
  dev: Code,
  business: CreditCard,
};

export function renderConnectorIcon(entry: McpCatalogEntry | undefined, size = 18): React.ReactNode {
  if (!entry) return <Server size={size} />;
  const Brand = BRAND_MARKS[entry.id];
  if (Brand) return <Brand size={size} />;
  const Glyph = CATEGORY_GLYPHS[entry.category];
  return <Glyph size={size} />;
}

export function connectorTint(entry: McpCatalogEntry | undefined, theme: Theme): string | undefined {
  if (!entry || !BRAND_MARKS[entry.id]) return undefined;
  return brandTint(entry.id, theme);
}
