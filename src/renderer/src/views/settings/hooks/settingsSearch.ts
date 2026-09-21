export type Category = 'general' | 'shortcuts' | 'appearance' | 'export' | 'ai' | 'memory' | 'accounts' | 'connectors' | 'bots' | 'stats' | 'system';

export const TAG_SETS = {
  hotkey: ['settings.hotkey', 'settings.search.alias.hotkey'],
  shortcuts: ['settings.shortcut', 'settings.search.alias.shortcuts'],
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
  memory: ['settings.memory', 'settings.search.alias.memory'],
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
  general: ['language', 'tray', 'notify'],
  shortcuts: ['shortcuts', 'hotkey'],
  appearance: ['theme', 'reading'],
  export: ['quickExport', 'cardStyle', 'shareLink'],
  ai: ['timeout', 'prompt'],
  memory: ['memory'],
  accounts: ['accounts', 'byok'],
  connectors: ['mcp'],
  bots: ['bots'],
  stats: ['stats'],
  system: ['config', 'danger'],
};

export const CATEGORY_IDS = Object.keys(CATEGORY_TAG_MAP) as Category[];

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
