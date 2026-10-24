import React, { useEffect, useId, useState } from 'react';
import { Anchor, Group, Loader, Stack, Text } from '@mantine/core';
import { ExternalLink } from 'lucide-react';
import { GroupHeader } from '../../../components/GroupHeader';
import { StatusLine } from '../../../components/StatusLine';
import { clipboardApi, pttBoardApi } from '../../../api/electronApi';
import { useI18nStore } from '../../../store/i18nStore';
import { fillTemplate } from '../../../../../shared/fillTemplate';
import type { PttBoardPreviewResult } from '../../../../../shared/pttBoard';
import { FEED_PREVIEW_DEBOUNCE_MS, FeedItemRow } from '../FeedPreview';

type Shown = Exclude<PttBoardPreviewResult, { status: 'cancelled' }> | { status: 'loading' };

export interface PttBoardPreviewQuery {
  board: string;
  keyword: string;
  scoreMode: string;
  score: string;
}

const OpenOnPtt: React.FC<{ url: string; t: (key: string) => string }> = ({ url, t }) => (
  <Anchor
    fz="xs"
    href={url}
    onClick={(event) => {
      event.preventDefault();
      void clipboardApi.openExternalUrl(url);
    }}
  >
    <Group gap={4} wrap="nowrap">
      <ExternalLink size={12} />
      {t('flow.skill.ptt_board.preview.open')}
    </Group>
  </Anchor>
);

/**
 * The newest articles the step's fields match, read in main through the step's own read. Every
 * edit drops what was shown; the read waits for typing to pause and a newer one stops it.
 * `query` is null while a field is incomplete or holds a variable.
 */
export const PttBoardPreview: React.FC<{ query: PttBoardPreviewQuery | null; t: (key: string) => string }> = ({ query, t }) => {
  const slot = useId();
  const locale = useI18nStore((s) => s.locale);
  const [shown, setShown] = useState<Shown | null>(null);
  const board = query?.board ?? '';
  const keyword = query?.keyword ?? '';
  const scoreMode = query?.scoreMode ?? '';
  const score = query?.score ?? '';
  const ready = query !== null;

  useEffect(() => {
    if (!ready) {
      setShown(null);
      return undefined;
    }
    setShown({ status: 'loading' });
    let current = true;
    let sent = false;
    const timer = setTimeout(() => {
      sent = true;
      void pttBoardApi.preview({ board, keyword, scoreMode, score, slot }).then((result) => {
        if (current && result.status !== 'cancelled') setShown(result);
      }, (err: unknown) => {
        if (!current) return;
        const error = err instanceof Error ? err.message : String(err);
        setShown({ status: 'error', message: fillTemplate(t('flow.skill.ptt_board.preview.error'), { error }) });
      });
    }, FEED_PREVIEW_DEBOUNCE_MS);
    return () => {
      current = false;
      clearTimeout(timer);
      if (sent) void pttBoardApi.cancelPreview(slot);
    };
    // `t` is left out on purpose: a language switch must not re-read the board.
  }, [ready, board, keyword, scoreMode, score, slot]);

  if (!shown) return null;

  if (shown.status === 'loading') {
    return (
      <Group gap={6} wrap="nowrap">
        <Loader size={12} />
        <Text fz="xs" c="dimmed">{t('flow.skill.ptt_board.preview.loading')}</Text>
      </Group>
    );
  }
  if (shown.status === 'error') return <StatusLine tone="error">{shown.message}</StatusLine>;
  if (shown.status === 'empty') {
    return (
      <Stack gap={4}>
        <StatusLine tone="warning">{t('flow.skill.ptt_board.preview.empty')}</StatusLine>
        <OpenOnPtt url={shown.url} t={t} />
      </Stack>
    );
  }
  return (
    <Stack gap={4}>
      <GroupHeader label={t('flow.skill.ptt_board.preview.title')} variant="plain" />
      {shown.items.map((item, index) => (
        <FeedItemRow key={`${index}:${item.link}`} item={item} lead={item.score} locale={locale} t={t} />
      ))}
      <Text fz="xs" c="dimmed">{t('flow.skill.ptt_board.preview.note')}</Text>
      <OpenOnPtt url={shown.url} t={t} />
    </Stack>
  );
};
