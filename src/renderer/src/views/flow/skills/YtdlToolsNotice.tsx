import React from 'react';
import { Alert, Button, Stack, Text } from '@mantine/core';
import { Download, Info } from 'lucide-react';
import { useYtdlToolsState, useYtdlToolsStore, ytdlToolsUsable } from '../../../store/ytdlToolsStore';
import { pausedSites } from '../../../../../shared/linkSites/siteChanged';

interface Props {
  t: (key: string) => string;
}

/** Above a video step while the download tools are missing or a site changed (a line per site), with the way out. */
export const YtdlToolsNotice: React.FC<Props> = ({ t }) => {
  const state = useYtdlToolsState();
  const openDialog = useYtdlToolsStore((s) => s.openDialog);

  if (!state) return null;
  if (ytdlToolsUsable(state)) {
    const paused = pausedSites(state);
    if (paused.length === 0) return null;
    return (
      <Alert color="var(--mantine-color-warning)" icon={<Info size={14} />} p="xs">
        <Stack gap={2}>
          {paused.map(({ site, label }) => (
            <Text key={site} fz="xs" style={{ lineHeight: 1.6 }}>
              {t('ytdl.notice.youtubeChanged').replace('{{site}}', label)}
            </Text>
          ))}
        </Stack>
      </Alert>
    );
  }
  return (
    <Alert color="var(--mantine-color-warning)" icon={<Info size={14} />} p="xs">
      <Stack gap={6}>
        <Text fz="xs" style={{ lineHeight: 1.6 }}>{t('flow.skill.youtube_download.needsTools')}</Text>
        <Button
          variant="light"
          color="var(--mantine-color-warning)"
          size="compact-xs"
          leftSection={<Download size={12} />}
          onClick={openDialog}
          style={{ alignSelf: 'flex-start' }}
        >
          {t('flow.skill.youtube_download.prepareTools')}
        </Button>
      </Stack>
    </Alert>
  );
};
