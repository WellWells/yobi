import { useI18nStore } from '../store/i18nStore';

export interface MarkdownBlocks {
  title: string | null;
  provider: string | null;
  time: string | null;
  prompt: string | null;
  response: string | null;
  extra: Record<string, string>;
}

type HeadingKind = 'provider' | 'time' | 'prompt' | 'response';
type HeadingAliases = Record<HeadingKind, Set<string>>;

const HEADING_KEY_BY_KIND: Record<HeadingKind, string> = {
  provider: 'md.provider',
  time: 'md.timestamp',
  prompt: 'md.prompt',
  response: 'md.response',
} as const;

function buildHeadingAliasSet(i18nKey: string): Set<string> {
  const aliases = new Set<string>();
  const { localeTranslations, enTranslations } = useI18nStore.getState();
  const addAlias = (value: string | undefined): void => {
    const normalized = value?.trim();
    if (normalized) aliases.add(normalized);
  };

  for (const translations of Object.values(localeTranslations)) {
    addAlias(translations[i18nKey] as string | undefined);
  }
  addAlias(enTranslations[i18nKey] as string | undefined);

  return aliases;
}

function buildHeadingAliases(): HeadingAliases {
  return {
    provider: buildHeadingAliasSet(HEADING_KEY_BY_KIND.provider),
    time: buildHeadingAliasSet(HEADING_KEY_BY_KIND.time),
    prompt: buildHeadingAliasSet(HEADING_KEY_BY_KIND.prompt),
    response: buildHeadingAliasSet(HEADING_KEY_BY_KIND.response),
  };
}

export function getResponseAliases(): Set<string> {
  return buildHeadingAliasSet(HEADING_KEY_BY_KIND.response);
}

function classifyHeading(heading: string, headingAliases: HeadingAliases): HeadingKind | null {
  if (headingAliases.provider.has(heading)) return 'provider';
  if (headingAliases.time.has(heading)) return 'time';
  if (headingAliases.prompt.has(heading)) return 'prompt';
  if (headingAliases.response.has(heading)) return 'response';
  return null;
}

export function parseMarkdownBlocks(raw: string): MarkdownBlocks {
  const lines = raw.split('\n');
  const headingAliases = buildHeadingAliases();

  let title: string | null = null;
  let providerIdx = -1;
  let timeIdx     = -1;
  let promptIdx   = -1;
  let responseIdx = -1;
  const responsePositions: number[] = [];

  const h2Positions: number[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (title === null && /^#\s+/.test(line)) {
      title = line.replace(/^#+\s+/, '').trim();
      continue;
    }

    if (/^##\s+/.test(line)) {
      h2Positions.push(i);
      const heading = line.replace(/^##\s+/, '').trim();
      const kind = classifyHeading(heading, headingAliases);
      if (kind === 'provider' && providerIdx < 0) providerIdx = i;
      if (kind === 'time' && timeIdx < 0)         timeIdx     = i;
      if (kind === 'prompt' && promptIdx < 0)     promptIdx   = i;
      if (kind === 'response') {
        responsePositions.push(i);
        if (responseIdx < 0) responseIdx = i;
      }
    }
  }

  const extractMeta = (headingIdx: number): string | null => {
    if (headingIdx < 0) return null;
    const nextH2 = h2Positions.find((p) => p > headingIdx) ?? lines.length;
    return lines.slice(headingIdx + 1, nextH2).join('\n').trim() || null;
  };

  const extractPrompt = (): string | null => {
    if (promptIdx < 0) return null;
    const nextResponse = responsePositions.find((p) => p > promptIdx) ?? lines.length;
    return lines.slice(promptIdx + 1, nextResponse).join('\n').trim() || null;
  };

  const extractResponse = (): string | null => {
    if (responseIdx < 0) return null;
    return lines.slice(responseIdx + 1).join('\n').trim() || null;
  };

  return {
    title,
    provider: extractMeta(providerIdx),
    time:     extractMeta(timeIdx),
    prompt:   extractPrompt(),
    response: extractResponse(),
    extra:    {},
  };
}

