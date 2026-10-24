import React, { useEffect, useState } from 'react';
import { Alert, Group, Progress, Stack, Text } from '@mantine/core';
import { Download, Info } from 'lucide-react';
import { AppButton } from '../AppButton';
import { useI18nStore } from '../../store/i18nStore';
import { useYtdlToolsState, useYtdlToolsStore, ytdlToolsUsable } from '../../store/ytdlToolsStore';
import { formatMegabytes } from '../../../../shared/ytdl';
import type { YtdlToolsState } from '../../../../shared/ytdl';
import { fillTemplate } from '../../../../shared/fillTemplate';

interface Props {
  /** Shown as a secondary button (the dialog's "Later"); omitted where there is nothing to close. */
  onLater?: () => void;
  /** Called once the tools have become usable while this was on screen. */
  onReady?: () => void;
}

function progressPercent(state: YtdlToolsState): number {
  const p = state.progress;
  if (!p || p.totalBytes <= 0) return 0;
  return Math.min(100, Math.round((p.receivedBytes / p.totalBytes) * 100));
}

/**
 * What preparing the download tools means — what gets downloaded, how big, where it goes — and
 * the one button that does it. The dialog, the template wizard and Settings all show this, so the
 * three never describe the tools differently.
 */
export const YtdlToolsSetup: React.FC<Props> = ({ onLater, onReady }) => {
  const t = useI18nStore((s) => s.t);
  const state = useYtdlToolsState();
  const install = useYtdlToolsStore((s) => s.install);
  const [starting, setStarting] = useState(false);
  const usable = ytdlToolsUsable(state);

  useEffect(() => {
    if (usable) onReady?.();
  }, [usable, onReady]);

  if (!state) return null;

  if (usable) {
    return (
      <Text fz="sm" c="var(--mantine-color-success)">
        {fillTemplate(t('ytdl.tools.ready'), { version: state.ytdlpVersion ?? '' })}
      </Text>
    );
  }

  if (!state.supported) {
    return (
      <Alert color="var(--mantine-color-warning)" icon={<Info size={14} />} p="xs">
        <Text fz="xs">{t('ytdl.tools.unsupported')}</Text>
      </Alert>
    );
  }

  const installing = state.status === 'installing';
  const progress = state.progress;
  const size = formatMegabytes(state.downloadBytes);

  const start = async (): Promise<void> => {
    setStarting(true);
    try {
      await install();
    } finally {
      setStarting(false);
    }
  };

  return (
    <Stack gap="sm">
      <Text fz="sm">{t('ytdl.tools.desc')}</Text>
      <Stack gap={2}>
        <Text fz="xs" c="var(--text-muted)">{t('ytdl.tools.components')}</Text>
        <Text fz="xs" c="var(--text-muted)" style={{ overflowWrap: 'anywhere' }}>
          {fillTemplate(t('ytdl.tools.location'), { path: state.location })}
        </Text>
      </Stack>
      {state.status === 'broken' && (
        <Alert color="var(--mantine-color-warning)" icon={<Info size={14} />} p="xs">
          <Text fz="xs">{t('ytdl.tools.broken')}</Text>
        </Alert>
      )}
      {state.installError && !installing && (
        <Alert color="var(--mantine-color-error)" icon={<Info size={14} />} p="xs">
          {/* The English detail is in the log; this line says what to do about it. */}
          <Text fz="xs">{t('ytdl.tools.failed')}</Text>
        </Alert>
      )}
      {installing && progress && (
        <Stack gap={4}>
          <Text fz="xs" c="var(--text-muted)">
            {fillTemplate(t(`ytdl.tools.phase.${progress.phase}`), { component: progress.component })}
          </Text>
          <Progress size="xs" value={progressPercent(state)} animated aria-label={t('ytdl.tools.progressLabel')} />
        </Stack>
      )}
      <Group justify="flex-end" gap="xs">
        {onLater && (
          <AppButton variant="default" size="xs" onClick={onLater}>
            {t('ytdl.tools.later')}
          </AppButton>
        )}
        <AppButton
          size="xs"
          leftSection={<Download size={14} />}
          loading={installing || starting}
          onClick={() => void start()}
        >
          {fillTemplate(t(state.status === 'broken' ? 'ytdl.tools.redownload' : 'ytdl.tools.download'), { size })}
        </AppButton>
      </Group>
    </Stack>
  );
};
