import React, { startTransition, useCallback, useEffect, useRef, useState } from 'react';
import { Badge, Flex, Stack, Text } from '@mantine/core';
import type { OutputFile } from '../../../../shared/types';
import { SearchPalette } from '../SearchPalette';
import { useAppStore } from '../../store/appStore';
import { useI18nStore } from '../../store/i18nStore';
import { useFormatTime } from '../../hooks/useFormatTime';
import { fileApi } from '../../api/electronApi';
import sb from '../Sidebar.module.css';

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

  const openFile = useCallback(async (file: OutputFile) => {
    onClose();
    selectFile(file);
    const content = await fileApi.getContent(file.path);
    startTransition(() => setFileContent(content));
  }, [onClose, selectFile, setFileContent]);

  return (
    <SearchPalette
      opened={opened}
      onClose={onClose}
      query={query}
      onQueryChange={setQuery}
      items={visibleFiles}
      getKey={(file) => file.path}
      onSelect={(file) => { void openFile(file); }}
      placeholder={t('sidebar.searchPlaceholder')}
      emptyLabel={query.trim() ? t('sidebar.emptyFiltered') : t('sidebar.empty')}
      renderRow={(file, active) => (
        <Stack gap={3}>
          <Flex align="center" gap={6}>
            {file.provider && (
              <Badge
                variant="outline"
                size="s"
                radius="xl"
                tt="none"
                fw={500} fz="var(--font-size-sm)" lh={1.6} px={6} py={1}
                data-selected={String(active)}
                className={sb.providerBadge}
              >
                {file.provider}
              </Badge>
            )}
            <Text component="span" fz="var(--font-size-xs)" data-selected={String(active)} className={sb.timestamp}>
              {formatTime(file.timestamp)}
            </Text>
            {(file.turns ?? 1) > 1 && (
              <Text component="span" fz="var(--font-size-xs)" data-selected={String(active)} className={sb.timestamp}>
                {turnsLabel.replace('{{count}}', String(file.turns))}
              </Text>
            )}
          </Flex>
          <Text fz="var(--font-size-sm)" fw={500} truncate c="var(--mantine-color-text)" title={file.name}>
            {file.preview || '...'}
          </Text>
        </Stack>
      )}
    />
  );
};
