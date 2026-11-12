import { useState } from 'react';
import { Box, Stack, Text, UnstyledButton } from '@mantine/core';
import { Check, ChevronDown, ChevronRight, Search, X } from 'lucide-react';
import { citationHost } from '../../../shared/citations';
import { fillTemplate as fill } from '../../../shared/fillTemplate';
import type { ResearchResult, ResearchSearch } from '../../../shared/researchProgress';
import { clipboardApi } from '../api/electronApi';
import { LABEL_OFFSET, MARK_SLOT, PROGRESS_ROW_STYLE } from './ProgressMark';
import { SiteMonogram } from './SiteMonogram';

type Translate = (key: string) => string;

const LINE_STYLE = {
  fontSize: 'var(--font-size-xs)',
  color: 'var(--mantine-color-dimmed)',
  whiteSpace: 'nowrap' as const,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

const SLOT_STYLE = { flexShrink: 0, display: 'inline-flex', width: MARK_SLOT, justifyContent: 'center' } as const;

/** Used, read, could not be read; a page never opened keeps its slot empty, so titles line up. */
function ResultMark({ result, t }: { result: ResearchResult; t: Translate }) {
  const label = result.state ? t(`agent.research.mark.${result.state}`) : undefined;
  return (
    <Box component="span" style={SLOT_STYLE} aria-label={label} title={label}>
      {result.state === 'used' && <Check size={11} color="var(--mantine-color-success)" />}
      {result.state === 'read' && <Check size={11} color="var(--mantine-color-dimmed)" />}
      {result.state === 'unreadable' && <X size={11} color="var(--mantine-color-error)" />}
    </Box>
  );
}

function ResultRow({ result, t }: { result: ResearchResult; t: Translate }) {
  return (
    <UnstyledButton
      component="a"
      href={result.url}
      target="_blank"
      rel="noopener noreferrer"
      className="research-result-row"
      data-result-state={result.state ?? 'none'}
      title={`${result.title}\n${result.url}`}
      onClick={(event: React.MouseEvent<HTMLAnchorElement>) => {
        event.preventDefault();
        void clipboardApi.openExternalUrl(result.url);
      }}
      style={{ ...PROGRESS_ROW_STYLE, maxWidth: '100%' }}
    >
      <ResultMark result={result} t={t} />
      <SiteMonogram url={result.url} size={12} />
      <Text component="span" style={{ ...LINE_STYLE, color: 'var(--text-primary)', flex: 1 }}>{result.title}</Text>
      <Text component="span" style={{ ...LINE_STYLE, flexShrink: 0, maxWidth: '40%' }}>{citationHost(result.url)}</Text>
    </UnstyledButton>
  );
}

function SearchRow({ search, t }: { search: ResearchSearch; t: Translate }) {
  const [open, setOpen] = useState(false);
  const count = search.refused
    ? <Text component="span" style={{ ...LINE_STYLE, flexShrink: 0, color: 'var(--mantine-color-error)' }}>· {t('agent.research.refused')}</Text>
    : <Text component="span" style={{ ...LINE_STYLE, flexShrink: 0 }}>· {fill(t('agent.research.resultCount'), { count: search.results.length })}</Text>;
  const row = (
    <>
      <Box component="span" style={SLOT_STYLE}><Search size={11} color="var(--mantine-color-dimmed)" /></Box>
      <Text component="span" style={{ ...LINE_STYLE, flexShrink: 0 }}>{t('agent.research.searched')}</Text>
      <Text component="span" title={search.query} style={{ ...LINE_STYLE, color: 'var(--text-primary)', minWidth: 0, flexShrink: 100 }}>{search.query}</Text>
      {count}
    </>
  );
  const openable = !search.refused && search.results.length > 0;
  if (!openable) return <Box data-research-search style={PROGRESS_ROW_STYLE}>{row}</Box>;
  return (
    <Stack gap={1} style={{ minWidth: 0 }}>
      <UnstyledButton
        data-research-search
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        style={{ ...PROGRESS_ROW_STYLE, maxWidth: '100%' }}
      >
        {row}
        {open
          ? <ChevronDown size={12} color="var(--mantine-color-dimmed)" style={{ flexShrink: 0 }} />
          : <ChevronRight size={12} color="var(--mantine-color-dimmed)" style={{ flexShrink: 0 }} />}
      </UnstyledButton>
      {open && (
        <Stack gap={0} pl={LABEL_OFFSET} style={{ minWidth: 0 }}>
          {search.results.map((result) => <ResultRow key={result.url} result={result} t={t} />)}
        </Stack>
      )}
    </Stack>
  );
}

/**
 * Every query a research step sent, closed by default; opening one lists every result it returned,
 * read or not, marked by what became of it.
 */
export function ResearchResults({ searches, t }: { searches: readonly ResearchSearch[]; t: Translate }) {
  return (
    <Stack gap={1} style={{ minWidth: 0 }}>
      {searches.map((search, index) => <SearchRow key={`${index}-${search.query}`} search={search} t={t} />)}
    </Stack>
  );
}
