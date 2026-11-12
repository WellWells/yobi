import React, { createContext, useContext } from 'react';
import { Group, HoverCard, Stack, Text } from '@mantine/core';
import type { ExtraProps } from 'react-markdown';
import { citationHost, citationSite, parseCitationSources } from '../../../../shared/citations';
import { ExternalLink } from '../../utils/markdownConfig';
import { CITATION_RUN_CLASS } from '../../utils/citationChips';
import { SiteMonogram } from '../SiteMonogram';

/** The answer's own source list, by URL: what a chip's card titles each source with. */
export const CitationTitlesContext = createContext<ReadonlyMap<string, string>>(new Map());

export interface ChipSource {
  url: string;
  title: string;
  site: string;
}

/**
 * A rendered link's address is percent-encoded (`台灣` → `%E5%8F%B0%E7%81%A3`, `[0]` → `%5B0%5D`)
 * while the source list is read as written, so both are looked up decoded.
 */
function sourceKey(url: string): string {
  try {
    return decodeURI(url);
  } catch {
    return url;
  }
}

/** The answer's own source list: title by address. */
export function citationTitles(markdown: string): ReadonlyMap<string, string> {
  return new Map(parseCitationSources(markdown).map((source) => [sourceKey(source.url), source.title]));
}

/** One entry per distinct source of a run, titled from the source list, or by its host. */
export function chipSources(urls: readonly string[], titles: ReadonlyMap<string, string>): ChipSource[] {
  return [...new Set(urls)].map((url) => ({ url, title: titles.get(sourceKey(url))?.trim() || citationHost(url), site: citationSite(url) }));
}

const OPEN_DELAY_MS = 150;
const CLOSE_DELAY_MS = 120;
const CARD_WIDTH = 280;
/** The chip is laid out as text (so a full stop after it stays on its line): CSS cannot cut it short. */
const MAX_LABEL_SITE_CHARS = 20;

function chipLabel(sources: ChipSource[]): string {
  const { site } = sources[0];
  const name = site.length > MAX_LABEL_SITE_CHARS ? `${site.slice(0, MAX_LABEL_SITE_CHARS - 1)}…` : site;
  return sources.length > 1 ? `${name} +${sources.length - 1}` : name;
}

function CitationChip({ sources, text }: { sources: ChipSource[]; text: string }) {
  const [first] = sources;
  const label = chipLabel(sources);
  return (
    <HoverCard openDelay={OPEN_DELAY_MS} closeDelay={CLOSE_DELAY_MS} position="top" width={CARD_WIDTH} shadow="md">
      <HoverCard.Target>
        {/* The visible name is drawn from data-label; the DOM text stays the marker, so a selection
            still reads `[1]` and maps onto the Markdown. */}
        <ExternalLink href={first.url} className="md-cite" data-label={label} aria-label={sources.map((source) => `${source.site}: ${source.title}`).join(' · ')}>
          <Text span inherit className="md-cite-text">{text}</Text>
        </ExternalLink>
      </HoverCard.Target>
      <HoverCard.Dropdown p={4} bg="var(--bg-secondary)" style={{ border: '1px solid var(--border)', boxShadow: 'var(--shadow-md)' }}>
        <Stack gap={0}>
          {sources.map((source) => (
            <ExternalLink key={source.url} href={source.url} className="md-cite-row" title={source.url}>
              <Text fz="var(--font-size-sm)" c="var(--text-primary)" lineClamp={2}>{source.title}</Text>
              <Group gap={6} wrap="nowrap" mt={4}>
                <SiteMonogram url={source.url} />
                <Text fz="var(--font-size-xs)" c="var(--text-muted)" truncate>{source.site}</Text>
              </Group>
            </ExternalLink>
          ))}
        </Stack>
      </HoverCard.Dropdown>
    </HoverCard>
  );
}

function hastString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** `rehypeCitationChips`' element: a chip for its run of citations; any other `cite` stays one. */
export const CitationRun: React.FC<React.ComponentPropsWithoutRef<'cite'> & ExtraProps> = ({ node, children, ...props }) => {
  const titles = useContext(CitationTitlesContext);
  const classes = node?.properties.className;
  const isRun = Array.isArray(classes) && classes.includes(CITATION_RUN_CLASS);
  const urls = hastString(node?.properties.dataHrefs).split('\n').filter(Boolean);
  if (!isRun || urls.length === 0) return <cite {...props}>{children}</cite>;
  return <CitationChip sources={chipSources(urls, titles)} text={hastString(node?.properties.dataText)} />;
};
