import React, { startTransition, useCallback, useEffect, useRef, useState } from 'react';
import { Flex, Stack, Text } from '@mantine/core';
import { Pin } from 'lucide-react';
import type { OutputFile } from '../../../../shared/types';
import { ProviderTag } from '../ProviderTag';
import { SearchPalette } from '../SearchPalette';
import { useAppStore } from '../../store/appStore';
import { useI18nStore } from '../../store/i18nStore';
import { noteConversationOpened } from '../../store/recapStore';
import { useConversationFindStore } from '../../store/conversationFindStore';
import { useFormatTime } from '../../hooks/useFormatTime';
import { fileApi } from '../../api/electronApi';
import { folderLabel } from '../sidebar/folderActions';
import sb from '../Sidebar.module.css';
import { fillTemplate } from '../../../../shared/fillTemplate';

function conversationKey(file: OutputFile): string {
  return file.path;
}

interface ConversationSearchOverlayProps {
  opened: boolean;
  onClose: () => void;
}

export const ConversationSearchOverlay: React.FC<ConversationSearchOverlayProps> = ({ opened, onClose }) => {
  const { t } = useI18nStore();
  const files = useAppStore((s) => s.files);
  const selectFile = useAppStore((s) => s.selectFile);
  const setFileContent = useAppStore((s) => s.setFileContent);
  const formatTime = useFormatTime();
  const turnsLabel = t('chat.turns');
  const pinnedLabel = t('sidebar.group.pinned');

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<OutputFile[] | null>(null);
  const searchSeqRef = useRef(0);

  const visibleFiles = results ?? files;

  useEffect(() => {
    const keyword = query.trim();
    if (!keyword) {
      searchSeqRef.current += 1;
      setResults(null);
      return;
    }
    const seq = ++searchSeqRef.current;
    const timer = setTimeout(async () => {
      const result = await fileApi.search(keyword);
      if (seq === searchSeqRef.current) setResults(result);
    }, 80);
    return () => clearTimeout(timer);
  }, [query]);

  // Opened from a search: find the same words in it, so the match is on screen rather than
  // "somewhere". Handed over once the palette has closed, or its focus return would pull focus
  // out of the find field.
  const findOnCloseRef = useRef('');
  const handleClosed = useCallback((): void => {
    const keyword = findOnCloseRef.current;
    findOnCloseRef.current = '';
    if (keyword) useConversationFindStore.getState().show(keyword);
  }, []);

  const openFile = useCallback(async (file: OutputFile) => {
    findOnCloseRef.current = query.trim();
    onClose();
    noteConversationOpened(file.path);
    selectFile(file);
    const content = await fileApi.getContent(file.path);
    startTransition(() => setFileContent(content));
  }, [onClose, query, selectFile, setFileContent]);

  const selectFileRow = useCallback((file: OutputFile) => { void openFile(file); }, [openFile]);

  // Stable between renders, so the palette's memoised rows re-render only when their highlight changes.
  const renderRow = useCallback((file: OutputFile, active: boolean) => (
    <Stack gap={3}>
      <Flex align="center" gap={6}>
        {file.provider && <ProviderTag provider={file.provider} selected={active} />}
        <Text component="span" fz="var(--font-size-xs)" data-selected={String(active)} className={sb.timestamp}>
          {formatTime(file.timestamp)}
        </Text>
        {(file.turns ?? 1) > 1 && (
          <Text component="span" fz="var(--font-size-xs)" data-selected={String(active)} className={sb.timestamp}>
            {fillTemplate(turnsLabel, { count: String(file.turns) })}
          </Text>
        )}
        {/* Results keep their own order; a pinned one only says so. */}
        {file.pinned && (
          <Pin size={11} role="img" aria-label={pinnedLabel} color="var(--mantine-color-dimmed)" style={{ flexShrink: 0 }} />
        )}
        {/* Which folder it is in, small and dimmed like the time. */}
        {file.folder && (
          <Text component="span" fz="var(--font-size-xs)" data-selected={String(active)} className={sb.timestamp} truncate>
            {folderLabel(file.folder, t)}
          </Text>
        )}
      </Flex>
      <Text fz="var(--font-size-sm)" fw={500} truncate c="var(--mantine-color-text)" title={file.name}>
        {file.preview || '...'}
      </Text>
    </Stack>
  ), [formatTime, turnsLabel, pinnedLabel, t]);

  return (
    <SearchPalette
      opened={opened}
      onClose={onClose}
      query={query}
      onQueryChange={setQuery}
      items={visibleFiles}
      getKey={conversationKey}
      onSelect={selectFileRow}
      onClosed={handleClosed}
      placeholder={t('sidebar.searchPlaceholder')}
      emptyLabel={query.trim() ? t('sidebar.emptyFiltered') : t('sidebar.empty')}
      renderRow={renderRow}
    />
  );
};
