import React, { useEffect, useId, useRef, useState } from 'react';
import { Anchor, Group, Loader, Stack, Text, Tooltip } from '@mantine/core';
import { RefreshCw } from 'lucide-react';
import { AppButton } from '../../components/AppButton';
import { GroupHeader } from '../../components/GroupHeader';
import { StatusLine } from '../../components/StatusLine';
import { clipboardApi, rssApi } from '../../api/electronApi';
import { useI18nStore } from '../../store/i18nStore';
import { formatTimeLabel } from '../../utils/timeLabel';
import { fillTemplate } from '../../../../shared/fillTemplate';
import { isPreviewableFeedUrl } from '../../../../shared/feedPreview';
import type { FeedPreviewItem, FeedPreviewResult } from '../../../../shared/feedPreview';

/** Quiet time after the last keystroke before the feed is read. */
export const FEED_PREVIEW_DEBOUNCE_MS = 600;

type Shown = Exclude<FeedPreviewResult, { status: 'cancelled' }> | { status: 'loading' };

const DATE_STYLE = { flexShrink: 0, fontVariantNumeric: 'tabular-nums' } as const;
const LINK_TOOLTIP_STYLE = { overflowWrap: 'anywhere' } as const;

/** One previewed item: its title linked, its date on the right, and an optional figure before the title (a PTT score). */
export const FeedItemRow: React.FC<{ item: FeedPreviewItem; locale: string; t: (key: string) => string; lead?: string }> = ({ item, locale, t, lead }) => {
  const date = item.date ? formatTimeLabel(item.date, { now: new Date(), locale, t }) : '';
  const title = (
    <Tooltip label={item.link} multiline maw={360} style={LINK_TOOLTIP_STYLE} openDelay={300}>
      <Anchor
        fz="xs"
        truncate="end"
        miw={0}
        href={item.link}
        onClick={(event) => {
          event.preventDefault();
          void clipboardApi.openExternalUrl(item.link);
        }}
      >
        {item.title}
      </Anchor>
    </Tooltip>
  );
  return (
    <Group gap="xs" wrap="nowrap" justify="space-between">
      {lead === undefined ? title : (
        <Group gap={6} wrap="nowrap" miw={0}>
          <Text fz="xs" c="dimmed" style={DATE_STYLE}>{lead}</Text>
          {title}
        </Group>
      )}
      {date && <Text fz="xs" c="dimmed" style={DATE_STYLE}>{date}</Text>}
    </Group>
  );
};

/**
 * The latest items a feed address gives, read in main exactly as the flow's rss step reads it.
 * Every edit drops what was shown; the read waits for typing to pause and a newer one stops it.
 * Once a read settles, "read again" repeats it at once (a feed that failed or changed since).
 */
export const FeedPreview: React.FC<{ url: string; t: (key: string) => string }> = ({ url, t }) => {
  const slot = useId();
  const locale = useI18nStore((s) => s.locale);
  const [shown, setShown] = useState<Shown | null>(null);
  const [attempt, setAttempt] = useState(0);
  const readNow = useRef(false);
  const address = url.trim();
  const previewable = isPreviewableFeedUrl(address);

  useEffect(() => {
    if (!previewable) {
      setShown(null);
      return undefined;
    }
    setShown({ status: 'loading' });
    let current = true;
    let sent = false;
    const delay = readNow.current ? 0 : FEED_PREVIEW_DEBOUNCE_MS;
    readNow.current = false;
    const timer = setTimeout(() => {
      sent = true;
      void rssApi.previewFeed({ url: address, slot }).then((result) => {
        if (current && result.status !== 'cancelled') setShown(result);
      }, (err: unknown) => {
        if (!current) return;
        const error = err instanceof Error ? err.message : String(err);
        setShown({ status: 'error', message: fillTemplate(t('flow.feedPreview.error'), { error }) });
      });
    }, delay);
    return () => {
      current = false;
      clearTimeout(timer);
      if (sent) void rssApi.cancelPreview(slot);
    };
    // `t` is left out on purpose: a language switch must not re-read the feed.
  },[address, previewable, slot, attempt]);

  if (!shown) return null;

  const readAgain = (
    <AppButton
      variant="light"
      size="compact-xs"
      leftSection={<RefreshCw size={12} />}
      onClick={() => {
        readNow.current = true;
        setAttempt((n) => n + 1);
      }}
      style={{ flexShrink: 0, alignSelf: 'flex-start' }}
      data-feed-preview-retry
    >
      {t('flow.feedPreview.retry')}
    </AppButton>
  );

  if (shown.status === 'loading') {
    return (
      <Group gap={6} wrap="nowrap">
        <Loader size={12} />
        <Text fz="xs" c="dimmed">{t('flow.feedPreview.loading')}</Text>
      </Group>
    );
  }
  if (shown.status === 'error') {
    return (
      <Stack gap={4}>
        <StatusLine tone="error">{shown.message}</StatusLine>
        {readAgain}
      </Stack>
    );
  }
  if (shown.status === 'empty') {
    return (
      <Stack gap={4}>
        <StatusLine tone="warning">
          {t(shown.notFeed ? 'flow.feedPreview.notFeed' : 'flow.feedPreview.empty')}
        </StatusLine>
        {readAgain}
      </Stack>
    );
  }
  return (
    <Stack gap={4}>
      <Group gap="xs" wrap="nowrap" justify="space-between">
        <GroupHeader label={t('flow.feedPreview.title')} variant="plain" />
        {readAgain}
      </Group>
      {shown.items.map((item, index) => <FeedItemRow key={`${index}:${item.link}`} item={item} locale={locale} t={t} />)}
      <Text fz="xs" c="dimmed">{t('flow.feedPreview.note')}</Text>
    </Stack>
  );
};
