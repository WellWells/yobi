// RSS Feed skill config editor.
// Provides: Feed URL input, clear checkpoint button, fetch content toggle.
import React, { useCallback, useEffect, useState } from 'react';
import { Badge, Button, Group, Stack, Text } from '@mantine/core';
import { AppTextInput } from '../../../components/AppTextInput';
import { ToggleSwitch } from '../../../components/ToggleSwitch';
import { SettingRow } from '../../../components/SettingRow';
import { Trash2, FileText, BookmarkCheck } from 'lucide-react';
import { rssApi, ipcEvents } from '../../../api/electronApi';
import type { SkillConfigProps } from './types';

function isValidUrl(url: string): boolean {
  const trimmed = url.trim();
  if (!trimmed) return true;
  if (/^\{\{[^}]+\}\}$/.test(trimmed)) return true;
  return /^https?:\/\//i.test(trimmed);
}

export const RssConfig: React.FC<SkillConfigProps> = ({ step, onChange, t }) => {
  const url = step.config.url ?? '';
  const urlError = !isValidUrl(url);
  const fetchContent = step.config.fetchContent === 'true';
  const [hasCheckpoint, setHasCheckpoint] = useState(false);

  // Check checkpoint status on mount and when step.id changes
  useEffect(() => {
    void rssApi.hasCheckpoint(step.id).then(setHasCheckpoint);
  }, [step.id]);

  // Refresh checkpoint status after any flow execution ends
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

  return (
    <Stack gap="xs">
      <AppTextInput
        label={t('agentflow.skill.rss.url')}
        placeholder={t('agentflow.skill.rss.url.placeholder')}
        value={url}
        onChange={(e) => onChange({ ...step.config, url: e.currentTarget.value })}
        size="sm"
        error={urlError ? t('agentflow.skill.rss.url.error') : undefined}
      />

      <Text fz="xs" c="dimmed">
        {t('agentflow.skill.rss.hint')}
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
            {t('agentflow.skill.rss.stateActive')}
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
        {t('agentflow.skill.rss.clearState')}
      </Button>

      <SettingRow
        icon={<FileText size={13} />}
        label={t('agentflow.skill.rss.fetchContent')}
        hint={t('agentflow.skill.rss.fetchContent.hint')}
        control={
          <ToggleSwitch
            checked={fetchContent}
            onChange={(e) => onChange({ ...step.config, fetchContent: e.currentTarget.checked ? 'true' : 'false' })}
          />
        }
      />

      <Text fz="xs" c="dimmed">
        {t('agentflow.skill.browser.outputHint').replace('{{outputKey}}', `{{${step.outputKey}}}`)}
      </Text>
    </Stack>
  );
};
