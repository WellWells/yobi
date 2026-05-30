// Web Scraper / Tracker skill config editor.
// Provides: Target URL input, CSS selector inputs, max items input, clear checkpoint button.
import React, { useCallback, useEffect, useState } from 'react';
import { Badge, Button, Group, Stack, Text } from '@mantine/core';
import { AppTextInput } from '../../../components/AppTextInput';
import { Trash2, BookmarkCheck } from 'lucide-react';
import { scraperApi, ipcEvents } from '../../../api/electronApi';
import type { SkillConfigProps } from './types';

function isValidUrl(url: string): boolean {
  const trimmed = url.trim();
  if (!trimmed) return true;
  if (/^\{\{[^}]+\}\}$/.test(trimmed)) return true;
  return /^https?:\/\//i.test(trimmed);
}

export const ScraperConfig: React.FC<SkillConfigProps> = ({ step, onChange, t }) => {
  const url = step.config.url ?? '';
  const urlError = !isValidUrl(url);
  const itemSelector = step.config.itemSelector ?? '';
  const titleSelector = step.config.titleSelector ?? '';
  const linkSelector = step.config.linkSelector ?? '';
  const maxItems = step.config.maxItems ?? '5';
  const [hasCheckpoint, setHasCheckpoint] = useState(false);

  // Check checkpoint status on mount and when step.id changes
  useEffect(() => {
    void scraperApi.hasCheckpoint(step.id).then(setHasCheckpoint);
  }, [step.id]);

  // Refresh checkpoint status after any flow execution ends
  useEffect(() => {
    const unsub = ipcEvents.onFlowExecutionEnded(() => {
      void scraperApi.hasCheckpoint(step.id).then(setHasCheckpoint);
    });
    return unsub;
  }, [step.id]);

  const handleClearCheckpoint = useCallback(async () => {
    await scraperApi.clearCheckpoint(step.id);
    setHasCheckpoint(false);
  }, [step.id]);

  return (
    <Stack gap="xs">
      <AppTextInput
        label={t('agentflow.skill.scraper.url')}
        placeholder={t('agentflow.skill.scraper.url.placeholder')}
        value={url}
        onChange={(e) => onChange({ ...step.config, url: e.currentTarget.value })}
        size="sm"
        error={urlError ? t('agentflow.skill.scraper.url.error') : undefined}
      />

      <AppTextInput
        label={t('agentflow.skill.scraper.itemSelector')}
        placeholder={t('agentflow.skill.scraper.itemSelector.placeholder')}
        value={itemSelector}
        onChange={(e) => onChange({ ...step.config, itemSelector: e.currentTarget.value })}
        size="sm"
      />

      <AppTextInput
        label={t('agentflow.skill.scraper.titleSelector')}
        placeholder={t('agentflow.skill.scraper.titleSelector.placeholder')}
        value={titleSelector}
        onChange={(e) => onChange({ ...step.config, titleSelector: e.currentTarget.value })}
        size="sm"
      />

      <AppTextInput
        label={t('agentflow.skill.scraper.linkSelector')}
        placeholder={t('agentflow.skill.scraper.linkSelector.placeholder')}
        value={linkSelector}
        onChange={(e) => onChange({ ...step.config, linkSelector: e.currentTarget.value })}
        size="sm"
      />

      <AppTextInput
        label={t('agentflow.skill.scraper.maxItems')}
        value={maxItems}
        onChange={(e) => onChange({ ...step.config, maxItems: e.currentTarget.value })}
        size="sm"
        type="number"
        min={1}
      />

      <Text fz="xs" c="dimmed">
        {t('agentflow.skill.scraper.hint')}
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
            {t('agentflow.skill.scraper.stateActive')}
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
        {t('agentflow.skill.scraper.clearState')}
      </Button>

      <Text fz="xs" c="dimmed">
        {t('agentflow.skill.browser.outputHint').replace('{{outputKey}}', `{{${step.outputKey}}}`)}
      </Text>
    </Stack>
  );
};
