import React from 'react';
import {
  BookOpen, Briefcase, Code, CreditCard, FolderGit2, GraduationCap, LibraryBig, Mail, MessagesSquare, Palette, Server, TrainFront,
} from 'lucide-react';
import {
  AirtableIcon, AsanaIcon, AtlassianIcon, BilibiliIcon, CloudflareIcon, DropboxIcon, FacebookIcon, FigmaIcon, GithubIcon,
  HuggingFaceIcon, InstagramIcon, IntercomIcon, LinearIcon, LineIcon, NeonIcon, NetlifyIcon, NotionIcon, PayPalIcon,
  SentryIcon, SquareIcon, StripeIcon, SupabaseIcon, ThunderbirdIcon, VercelIcon, WebflowIcon, WixIcon,
  XIcon, ZapierIcon,
} from './brandIcons';
import type { BrandIcon } from './brandIcons';
import { brandTint, readableTint, tileBackground } from './brandTints';
import { findCatalogEntry } from '../../../shared/mcpCatalog';
import type { McpCatalogCategory, McpCatalogEntry } from '../../../shared/mcpCatalog';
import {
  BUILTIN_MAIL_SERVER_ID, BUILTIN_PTT_SERVER_ID, BUILTIN_RAIL_SERVER_ID, BUILTIN_THUNDERBIRD_SERVER_ID, BUILTIN_X_SERVER_ID,
  findBuiltinConnectorByUrl,
} from '../../../shared/builtinConnectors';
import { SITE_CONNECTOR_ROWS, siteConnectorServerId } from '../../../shared/siteConnectors';
import type { SiteConnectorSite } from '../../../shared/siteConnectors';
import { BUILTIN_LINE_SERVER_ID } from '../../../shared/types';
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

/**
 * Catalog entries with no brand mark of their own. Without these the three docs services all
 * fell back to the same docs book and could not be told apart in the gallery.
 */
export const ENTRY_GLYPHS: Record<string, React.FC<{ size?: number }>> = {
  context7: LibraryBig,
  deepwiki: FolderGit2,
  mslearn: GraduationCap,
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
  const Glyph = ENTRY_GLYPHS[entry.id] ?? CATEGORY_GLYPHS[entry.category];
  return <Glyph size={size} />;
}

export function connectorTint(entry: McpCatalogEntry | undefined, theme: Theme): string | undefined {
  if (!entry || !BRAND_MARKS[entry.id]) return undefined;
  return brandTint(entry.id, theme);
}

interface BuiltinMark {
  icon: BrandIcon;
  hex: string;
}

/** Each sign-in site connector's mark; its brand colour is in its row (`shared/siteConnectors.ts`). */
export const SITE_CONNECTOR_ICONS: Record<SiteConnectorSite, BrandIcon> = {
  instagram: InstagramIcon,
  facebook: FacebookIcon,
  bilibili: BilibiliIcon,
};

/** The built-in connectors have no catalog entry, so their marks live here. */
export const BUILTIN_MARKS: Record<string, BuiltinMark> = {
  // LINE's green since its 2020 rebrand; simple-icons still ships the older #00C300.
  [BUILTIN_LINE_SERVER_ID]: { icon: LineIcon, hex: '#06C755' },
  [BUILTIN_THUNDERBIRD_SERVER_ID]: { icon: ThunderbirdIcon, hex: '#0A84FF' },
  [BUILTIN_X_SERVER_ID]: { icon: XIcon, hex: '#000000' },
  // Two railways, no one brand: a plain train in THSR's orange.
  [BUILTIN_RAIL_SERVER_ID]: { icon: TrainFront, hex: '#E3651D' },
  // PTT has no mark of its own anyone would know: a forum's speech bubbles in a terminal blue.
  [BUILTIN_PTT_SERVER_ID]: { icon: MessagesSquare, hex: '#2563EB' },
  // Any IMAP mailbox, not only Gmail: a plain envelope in a mail red.
  [BUILTIN_MAIL_SERVER_ID]: { icon: Mail, hex: '#D44638' },
  ...Object.fromEntries(SITE_CONNECTOR_ROWS.map((row) => [
    siteConnectorServerId(row.site), { icon: SITE_CONNECTOR_ICONS[row.site], hex: row.hex },
  ])),
};

function builtinMark(url: string): BuiltinMark | undefined {
  const builtin = findBuiltinConnectorByUrl(url);
  return builtin ? BUILTIN_MARKS[builtin.id] : undefined;
}

/** A connector's icon wherever it is shown, by its URL: a built-in's mark, the catalog brand, or the category glyph. */
export function renderServerIcon(url: string | undefined, size = 18): React.ReactNode {
  const mark = url ? builtinMark(url) : undefined;
  if (mark) {
    const Icon = mark.icon;
    return <Icon size={size} />;
  }
  return renderConnectorIcon(url ? findCatalogEntry(url) : undefined, size);
}

/** The brand colour for that icon on this theme's tiles; undefined means inherit the text colour. */
export function serverTint(url: string, theme: Theme): string | undefined {
  const mark = builtinMark(url);
  if (mark) return readableTint(mark.hex, tileBackground(theme));
  return connectorTint(findCatalogEntry(url), theme);
}
