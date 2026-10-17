import React, { useEffect, useRef, useState } from 'react';
import { Box, Center, Loader, NavLink, Stack, Text } from '@mantine/core';
import { FileText, Search } from 'lucide-react';
import { plainNotionTitle } from '../../../../shared/notion/notionDisplay';
import type { NotionSearchHit } from '../../../../shared/notion/notionFetch';
import type { NotionSyncError } from '../../../../shared/notion/notionSyncTypes';
import { notionApi } from '../../api/electronApi';
import { NotionIcon } from '../../config/brandIcons';
import { useAppStore } from '../../store/appStore';
import { AppButton } from '../AppButton';
import { AppModal } from '../AppModal';
import { AppTextInput } from '../AppTextInput';
import { GroupHeader } from '../GroupHeader';

/** Waits this long after the last keystroke before asking Notion. */
const SEARCH_DEBOUNCE_MS = 300;

interface NotionImportDialogProps {
  open: boolean;
  onClose: () => void;
  /** The imported (or already kept) document, to open. */
  onImported: (path: string) => void;
  t: (key: string) => string;
}

type Phase =
  | { kind: 'checking' }
  | { kind: 'notConnected' }
  | { kind: 'ready' };

/** What the picker lists before anything is typed. */
interface Browse {
  favorites: NotionSearchHit[];
  recent: NotionSearchHit[];
  next: string | null;
}

/** `more` added to `recent`, without a page the list already shows. */
function appendRecent(browse: Browse, more: NotionSearchHit[], next: string | null): Browse {
  const shown = new Set([...browse.favorites, ...browse.recent].map((hit) => hit.page));
  return { ...browse, recent: [...browse.recent, ...more.filter((hit) => !shown.has(hit.page))], next };
}

/**
 * Picks a Notion page to keep in Yobi: the user's favorites and recently viewed pages are listed
 * as soon as it opens; words search, a pasted link reads that page. Reads go through the user's own
 * Notion connector; nothing is written to Notion here.
 */
export const NotionImportDialog: React.FC<NotionImportDialogProps> = ({ open, onClose, onImported, t }) => {
  const [phase, setPhase] = useState<Phase>({ kind: 'checking' });
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<NotionSearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<NotionSyncError | null>(null);
  const [browse, setBrowse] = useState<Browse | null>(null);
  const [browseError, setBrowseError] = useState<NotionSyncError | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [importing, setImporting] = useState<string | null>(null);
  const sequence = useRef(0);
  /** Bumped on every open, so a list asked for by an earlier opening is dropped. */
  const opening = useRef(0);

  useEffect(() => {
    if (!open) return;
    const id = ++opening.current;
    setQuery('');
    setHits([]);
    setError(null);
    setBrowse(null);
    setBrowseError(null);
    setLoadingMore(false);
    setImporting(null);
    setPhase({ kind: 'checking' });
    void notionApi.connected().catch(() => false).then((connected) => {
      if (opening.current !== id) return;
      setPhase({ kind: connected ? 'ready' : 'notConnected' });
      if (!connected) return;
      void notionApi.browse().catch(() => ({ ok: false as const, reason: 'failed' as const })).then((result) => {
        if (opening.current !== id) return;
        if (result.ok) setBrowse({ favorites: result.favorites, recent: result.recent, next: result.next });
        else setBrowseError(result.reason);
      });
    });
  }, [open]);

  useEffect(() => {
    if (!open || phase.kind !== 'ready') return undefined;
    const text = query.trim();
    const id = ++sequence.current;
    if (!text) {
      setHits([]);
      setError(null);
      setSearching(false);
      return undefined;
    }
    setSearching(true);
    const timer = window.setTimeout(() => {
      void notionApi.search(text).catch(() => ({ ok: false as const, reason: 'failed' as const })).then((result) => {
        if (sequence.current !== id) return;
        setSearching(false);
        if (result.ok) {
          setHits(result.hits);
          setError(null);
        } else {
          setHits([]);
          setError(result.reason);
        }
      });
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [open, phase.kind, query]);

  const loadMore = async (): Promise<void> => {
    if (!browse?.next || loadingMore) return;
    const id = opening.current;
    setLoadingMore(true);
    const result = await notionApi.browse(browse.next).catch(() => ({ ok: false as const, reason: 'failed' as const }));
    if (opening.current !== id) return;
    setLoadingMore(false);
    if (result.ok) setBrowse((current) => (current ? appendRecent(current, result.recent, result.next) : current));
    else setBrowseError(result.reason);
  };

  const importPage = async (hit: NotionSearchHit): Promise<void> => {
    if (importing) return;
    setImporting(hit.page);
    const result = await notionApi.importPage(hit.page).catch(() => ({ ok: false as const, reason: 'failed' as const }));
    setImporting(null);
    if (!result.ok) {
      setError(result.reason);
      return;
    }
    onImported(result.path);
    onClose();
  };

  const pageRow = (hit: NotionSearchHit): React.ReactNode => (
    <NavLink
      key={hit.page}
      label={plainNotionTitle(hit.title) || t('notion.import.untitled')}
      leftSection={hit.icon ? <Text component="span" fz="var(--font-size-md)">{hit.icon}</Text> : <FileText size={14} />}
      rightSection={importing === hit.page
        ? <Loader size={12} />
        : hit.kept ? <Text component="span" fz="var(--font-size-xs)" c="var(--text-muted)">{t('notion.import.kept')}</Text> : null}
      disabled={importing !== null && importing !== hit.page}
      onClick={() => { void importPage(hit); }}
    />
  );

  const typed = query.trim() !== '';
  const shownError = typed ? error : error ?? browseError;

  return (
    <AppModal opened={open} onClose={onClose} title={t('notion.import.title')} icon={<NotionIcon size={16} />} size="md">
      {phase.kind === 'checking' && <Loader size="sm" />}

      {phase.kind === 'notConnected' && (
        <Stack gap="sm">
          <Text fz="var(--font-size-md)">{t('notion.import.notConnected')}</Text>
          <AppButton
            variant="light"
            style={{ alignSelf: 'flex-start' }}
            onClick={() => {
              onClose();
              useAppStore.getState().openSettingsCategory('connectors');
            }}
          >
            {t('notion.status.openSettings')}
          </AppButton>
        </Stack>
      )}

      {phase.kind === 'ready' && (
        <Stack gap="sm">
          <Text fz="var(--font-size-sm)" c="var(--text-secondary)">{t('notion.import.explain')}</Text>
          <AppTextInput
            data-autofocus
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder={t('notion.import.placeholder')}
            leftSection={searching ? <Loader size={12} /> : <Search size={14} />}
            aria-label={t('notion.import.placeholder')}
          />
          {shownError && <Text fz="var(--font-size-sm)" c="var(--mantine-color-error)">{t(`notion.error.${shownError}`)}</Text>}
          <Box mah={360} style={{ overflowY: 'auto' }}>
            {typed && hits.map(pageRow)}
            {typed && !searching && hits.length === 0 && !error && (
              <Text fz="var(--font-size-sm)" c="var(--text-muted)">{t('notion.import.empty')}</Text>
            )}

            {!typed && !browse && !browseError && <Center py="sm"><Loader size="sm" /></Center>}
            {!typed && browse && browse.favorites.length > 0 && (
              <Stack gap={2} mb="xs">
                <GroupHeader variant="plain" label={t('notion.import.favorites')} />
                {browse.favorites.map(pageRow)}
              </Stack>
            )}
            {!typed && browse && browse.recent.length > 0 && (
              <Stack gap={2}>
                <GroupHeader variant="plain" label={t('notion.import.recent')} />
                {browse.recent.map(pageRow)}
              </Stack>
            )}
            {!typed && browse?.next && (
              <AppButton variant="subtle" size="xs" mt={4} loading={loadingMore} onClick={() => { void loadMore(); }}>
                {t('notion.import.more')}
              </AppButton>
            )}
          </Box>
        </Stack>
      )}
    </AppModal>
  );
};
