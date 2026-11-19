import React, { useEffect, useState } from 'react';
import { Box, Group, Highlight, Loader, Stack, Text, UnstyledButton } from '@mantine/core';
import { FileText } from 'lucide-react';
import { knowledgeApi } from '../../api/electronApi';
import { fillTemplate } from '../../../../shared/fillTemplate';
import type { KnowledgeSearchResult } from '../../../../shared/knowledgeStatus';
import classes from './KnowledgeContentSearch.module.css';

/** Typing pauses this long before the index is asked. */
export const KB_CONTENT_SEARCH_DEBOUNCE_MS = 250;

interface KnowledgeContentSearchProps {
  kbId: string;
  query: string;
  /** The file whose preview is open, marked in the list. */
  openPath: string | null;
  onOpen: (rel: string) => void;
  t: (key: string) => string;
}

/**
 * The base page's content search results: which documents say it, where, and the words around it —
 * straight from the index, no model asked (the same ranking a question gets). A row opens the
 * file's preview panel.
 */
export const KnowledgeContentSearch: React.FC<KnowledgeContentSearchProps> = ({ kbId, query, openPath, onOpen, t }) => {
  const [result, setResult] = useState<KnowledgeSearchResult | null>(null);
  const [busy, setBusy] = useState(false);
  const words = query.trim();

  useEffect(() => {
    if (!words) {
      setResult(null);
      return undefined;
    }
    let live = true;
    setBusy(true);
    const timer = setTimeout(() => {
      void knowledgeApi.search(kbId, words).then((next) => {
        if (!live) return;
        setResult(next);
        setBusy(false);
      });
    }, KB_CONTENT_SEARCH_DEBOUNCE_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [kbId, words]);

  if (!words) {
    return <Text fz="var(--font-size-sm)" c="var(--text-muted)" py={24} ta="center">{t('kb.search.hint')}</Text>;
  }
  if (busy && !result) return <Loader size="sm" m="md" />;
  if (!result || result.hits.length === 0) {
    return <Text fz="var(--font-size-sm)" c="var(--text-muted)" py={24} ta="center">{t('kb.search.none')}</Text>;
  }
  return (
    <Stack gap={2} flex={1} miw={0} style={{ overflowY: 'auto' }} aria-busy={busy}>
      <Text fz="var(--font-size-sm)" c="var(--text-muted)" pb={4} className="tabular-nums">
        {fillTemplate(t('kb.search.count'), { count: String(result.hits.length) })}
      </Text>
      {result.hits.map((hit) => {
        const name = hit.path.split('/').pop() ?? hit.path;
        const folder = hit.path.includes('/') ? hit.path.slice(0, hit.path.lastIndexOf('/')) : '';
        const open = hit.path === openPath;
        return (
          <UnstyledButton
            key={hit.path}
            onClick={() => onOpen(hit.path)}
            px={10}
            py={8}
            data-open={open || undefined}
            className={classes.row}
          >
            <Group gap={8} wrap="nowrap" miw={0}>
              <FileText size={14} style={{ flexShrink: 0 }} color="var(--text-muted)" />
              <Text fz="var(--font-size-md)" fw={600} truncate="end" miw={0}>{name}</Text>
              {folder && <Text fz="var(--font-size-sm)" c="var(--text-muted)" truncate="start" miw={0}>{folder}</Text>}
              <Box flex={1} />
              {hit.location && <Text fz="var(--font-size-sm)" c="var(--text-muted)" truncate="end" maw="40%" style={{ flexShrink: 0 }}>{hit.location}</Text>}
            </Group>
            <Highlight highlight={result.terms} fz="var(--font-size-sm)" c="var(--text-secondary)" mt={4} lineClamp={2} pl={22}>
              {hit.snippet}
            </Highlight>
            {(hit.summary || hit.matches > 1) && (
              <Text fz="var(--font-size-xs)" c="var(--text-muted)" mt={2} pl={22} className="tabular-nums">
                {[
                  hit.summary ? t('kb.search.fromSummary') : '',
                  hit.matches > 1 ? fillTemplate(t('kb.search.matches'), { count: String(hit.matches) }) : '',
                ].filter(Boolean).join(' · ')}
              </Text>
            )}
          </UnstyledButton>
        );
      })}
    </Stack>
  );
};
