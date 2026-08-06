import React, { useCallback, useEffect, useState } from 'react';
import { Badge, Button, Group, Stack, Text } from '@mantine/core';
import { BookmarkCheck, Trash2 } from 'lucide-react';
import { rssApi, ipcEvents } from '../../../api/electronApi';
import { FeedUrlField } from '../FeedUrlField';
import type { SkillConfigProps } from './types';

export const RssConfig: React.FC<SkillConfigProps> = ({ step, onChange, t }) => {
  const url = step.config.url ?? '';
  const [hasCheckpoint, setHasCheckpoint] = useState(false);

  useEffect(() => {
    void rssApi.hasCheckpoint(step.id).then(setHasCheckpoint);
  }, [step.id]);

  useEffect(() => {
    const unsub = ipcEvents.onFlowExecutionEnded(() => {
      void rssApi.hasCheckpoint(step.id).then(setHasCheckpoint);
    });
    return unsub;
  }, [step.id]);

  const handleClearCheckpoint = useCallback(async () => {
    await rssApi.clearCheckpoint(step.id);
    setHasCheckpoint(false);
  }, [step.id]);

  const setUrl = useCallback((value: string) => {
    onChange({ ...step.config, url: value });
  }, [onChange, step.config]);

  return (
    <Stack gap="xs">
      <FeedUrlField
        value={url}
        onChange={setUrl}
        label={t('flow.skill.rss.url')}
        t={t}
      />

      <Text fz="xs" c="dimmed">
        {t('flow.skill.rss.hint')}
      </Text>

      {hasCheckpoint && (
        <Group gap="xs" align="center">
          <Badge
            variant="light"
            color="teal"
            size="sm"
            leftSection={<BookmarkCheck size={12} />}
            radius="sm"
          >
            {t('flow.skill.rss.stateActive')}
          </Badge>
        </Group>
      )}

      <Button
        variant="light"
        color="red"
        size="xs"
        leftSection={<Trash2 size={14} />}
        onClick={() => void handleClearCheckpoint()}
        disabled={!hasCheckpoint}
      >
        {t('flow.skill.rss.clearState')}
      </Button>

      <Text fz="xs" c="dimmed">
        {t('flow.skill.rss.outputHint').replace('{{outputKey}}', `{{${step.outputKey}}}`)}
      </Text>
    </Stack>
  );
};
