export type Category =
  | 'accounts' | 'ai' | 'memory' | 'connectors' | 'bots' | 'general' | 'appearance'
  | 'notifications' | 'links' | 'export' | 'shortcuts' | 'stats' | 'system';

const BOT_ACCOUNT_KEYS = [
  'settings.bot.account', 'settings.bot.defaultModel', 'settings.bot.askTtl',
  'settings.bot.perm.add', 'settings.bot.perm.none', 'settings.bot.perm.owner',
  'settings.bot.perm.pairedHint', 'settings.bot.perm.defaults', 'settings.bot.perm.remove', 'settings.bot.perm.group',
  'settings.bot.perm.limit', 'settings.bot.perm.grant.agent', 'settings.bot.perm.grant.web',
  'settings.bot.perm.grant.download', 'settings.bot.perm.grant.local', 'settings.bot.perm.grant.shell',
  'settings.bot.perm.grant.allConnectors', 'settings.bot.perm.grant.connector',
] as const;

export const TAG_SETS = {
  hotkey: ['settings.hotkey', 'settings.search.alias.hotkey'],
  shortcuts: ['settings.shortcut', 'settings.search.alias.shortcuts'],
  language: ['settings.language', 'settings.search.alias.language'],
  notify: ['settings.notifications', 'settings.search.alias.notify'],
  tray: ['settings.tray', 'settings.search.alias.tray'],
  editor: ['settings.editor', 'settings.search.alias.editor'],
  links: ['settings.linkRecognition', 'settings.search.alias.links'],
  ytdl: ['settings.ytdl', 'ytdl.tools', 'settings.bot.perm.who.downloader', 'settings.search.alias.ytdl'],
  calendars: ['settings.calendars', 'settings.search.alias.calendars'],
  theme: ['settings.theme', 'settings.search.alias.theme'],
  reading: [
    'settings.appearance', 'layout.stacked', 'layout.sideBySide',
    'zoom.in', 'zoom.out', 'zoom.reset', 'reading', 'settings.search.alias.reading',
  ],
  quickExport: ['settings.quickExport', 'settings.search.alias.quickExport'],
  cardStyle: ['settings.cardStyle', 'capture', 'common.background', 'settings.search.alias.cardStyle'],
  shareLink: ['settings.share', 'settings.search.alias.shareLink'],
  timeout: ['settings.responseTimeout', 'settings.search.alias.timeout'],
  prompt: ['settings.prompt', 'settings.search.alias.prompt'],
  youtube: ['settings.youtube.prompt', 'settings.search.alias.youtube'],
  memory: ['settings.memory', 'settings.search.alias.memory'],
  accounts: ['settings.accounts', 'settings.modelSources', 'settings.search.alias.accounts'],
  byok: ['settings.byok', 'settings.search.alias.byok'],
  mcp: ['settings.mcp', 'settings.search.alias.mcp'],
  // The shared commands card, and each platform card on its own: one platform's name must not
  // pull in the other platform's card. The per-account permission editor renders inside each
  // platform's paired list, so both carry its strings; the admin grant is Telegram-only.
  bots: ['settings.bot.commands', 'settings.bot.builtin', 'settings.bot.perm.who.command', 'settings.search.alias.bots'],
  telegram: ['settings.telegram', ...BOT_ACCOUNT_KEYS, 'settings.bot.perm.grant.admin', 'settings.search.alias.telegram'],
  line: ['settings.line', ...BOT_ACCOUNT_KEYS, 'settings.search.alias.line'],
  discord: ['settings.discord', ...BOT_ACCOUNT_KEYS, 'settings.search.alias.discord'],
  slack: ['settings.slack', ...BOT_ACCOUNT_KEYS, 'settings.search.alias.slack'],
  stats: ['settings.stats', 'settings.search.alias.stats'],
  config: ['settings.config', 'settings.backup', 'settings.search.alias.config'],
  danger: ['settings.danger', 'settings.reset', 'settings.group.danger', 'settings.search.alias.danger'],
} as const;

// Key order is the nav order (what a first-time user needs first) and the stacking order of
// search results; SettingsView renders its category blocks in the same order.
export const CATEGORY_TAG_MAP: Record<Category, (keyof typeof TAG_SETS)[]> = {
  accounts: ['accounts', 'byok'],
  ai: ['timeout', 'prompt', 'youtube'],
  memory: ['memory'],
  connectors: ['mcp', 'calendars'],
  bots: ['telegram', 'line', 'discord', 'slack', 'bots'],
  general: ['language', 'tray', 'editor'],
  appearance: ['theme', 'reading'],
  notifications: ['notify'],
  links: ['links', 'ytdl'],
  export: ['quickExport', 'cardStyle', 'shareLink'],
  shortcuts: ['shortcuts', 'hotkey'],
  stats: ['stats'],
  system: ['config', 'danger'],
};

export const CATEGORY_IDS = Object.keys(CATEGORY_TAG_MAP) as Category[];

/** The page Settings opens on until the user picks another (the view stays mounted after that). */
export const DEFAULT_SETTINGS_CATEGORY: Category = 'accounts';

export function ownsKey(prefixes: readonly string[], key: string): boolean {
  return prefixes.some((prefix) => key === prefix || key.startsWith(`${prefix}.`));
}

type Dict = Record<string, string>;

export function buildHaystacks(dicts: Dict[], groupLabel: (category: Category) => string): Map<readonly string[], string> {
  const parts = new Map<readonly string[], string[]>();
  for (const tags of Object.values(TAG_SETS)) parts.set(tags, []);

  for (const dict of dicts) {
    for (const [key, value] of Object.entries(dict)) {
      if (typeof value !== 'string') continue;
      for (const [tags, values] of parts) {
        if (ownsKey(tags, key)) values.push(value);
      }
    }
  }

  for (const category of CATEGORY_IDS) {
    const label = groupLabel(category);
    for (const name of CATEGORY_TAG_MAP[category]) parts.get(TAG_SETS[name])?.push(label);
  }

  return new Map([...parts].map(([tags, values]) => [tags, values.join('\n').toLowerCase()]));
}
