export type Category = 'general' | 'appearance' | 'export' | 'ai' | 'accounts' | 'connectors' | 'bots' | 'stats' | 'system';

/**
 * Each entry lists the i18n key prefixes whose values make up one card's searchable text —
 * not literal keywords. A card is therefore searchable by every string it actually renders,
 * in whatever language is loaded, and a new key under one of these prefixes needs no upkeep
 * here. `settings.search.alias.*` carries the words a locale calls a feature but never
 * prints (zh-TW labels it 快捷鍵; users type 熱鍵), so synonyms live in the language files
 * where they can be translated rather than hardcoded here.
 */
export const TAG_SETS = {
  hotkey: ['settings.hotkey', 'settings.search.alias.hotkey'],
  language: ['settings.language', 'settings.search.alias.language'],
  notify: ['settings.notifications', 'settings.search.alias.notify'],
  tray: ['settings.tray', 'settings.search.alias.tray'],
  theme: ['settings.theme', 'settings.search.alias.theme'],
  reading: [
    'settings.appearance', 'layout.stacked', 'layout.sideBySide',
    'zoom.in', 'zoom.out', 'zoom.reset', 'settings.search.alias.reading',
  ],
  quickExport: ['settings.quickExport', 'settings.search.alias.quickExport'],
  cardStyle: ['settings.cardStyle', 'capture', 'common.background', 'settings.search.alias.cardStyle'],
  shareLink: ['settings.share', 'settings.search.alias.shareLink'],
  timeout: ['settings.responseTimeout', 'settings.search.alias.timeout'],
  prompt: ['settings.prompt', 'settings.youtube.prompt', 'settings.search.alias.prompt'],
  accounts: ['settings.accounts', 'settings.modelSources', 'settings.search.alias.accounts'],
  byok: ['settings.byok', 'settings.search.alias.byok'],
  mcp: ['settings.mcp', 'settings.search.alias.mcp'],
  bots: [
    'settings.telegram', 'settings.line', 'settings.bot', 'settings.llmDirect',
    'settings.search.alias.bots',
  ],
  stats: ['settings.stats', 'settings.search.alias.stats'],
  config: ['settings.config', 'settings.backup', 'settings.search.alias.config'],
  danger: ['settings.danger', 'settings.reset', 'settings.group.danger', 'settings.search.alias.danger'],
} as const;

export const CATEGORY_TAG_MAP: Record<Category, (keyof typeof TAG_SETS)[]> = {
  general: ['hotkey', 'language', 'tray', 'notify'],
  appearance: ['theme', 'reading'],
  export: ['quickExport', 'cardStyle', 'shareLink'],
  ai: ['timeout', 'prompt'],
  accounts: ['accounts', 'byok'],
  connectors: ['mcp'],
  bots: ['bots'],
  stats: ['stats'],
  system: ['config', 'danger'],
};

export const CATEGORY_IDS = Object.keys(CATEGORY_TAG_MAP) as Category[];

/** Prefix match on key boundaries, so `settings.reset` never swallows `settings.resetSomething`. */
export function ownsKey(prefixes: readonly string[], key: string): boolean {
  return prefixes.some((prefix) => key === prefix || key.startsWith(`${prefix}.`));
}

type Dict = Record<string, string>;

/**
 * One lowercased haystack per card, keyed by the TAG_SETS array itself so a lookup is an
 * identity hit. Rebuilt only when the loaded translations change.
 */
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

  // Searching a nav label ("外觀") should surface everything filed under it.
  for (const category of CATEGORY_IDS) {
    const label = groupLabel(category);
    for (const name of CATEGORY_TAG_MAP[category]) parts.get(TAG_SETS[name])?.push(label);
  }

  return new Map([...parts].map(([tags, values]) => [tags, values.join('\n').toLowerCase()]));
}
