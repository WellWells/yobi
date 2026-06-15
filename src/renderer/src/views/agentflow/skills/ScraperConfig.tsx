import React, { useCallback, useEffect, useState } from 'react';
import { Badge, Button, Group, Stack, Text } from '@mantine/core';
import { AppTextInput } from '../../../components/AppTextInput';
import { AppNumberInput } from '../../../components/AppNumberInput';
import { Trash2, BookmarkCheck } from 'lucide-react';
import { scraperApi, ipcEvents } from '../../../api/electronApi';
import { isValidUrlOrVar } from './validation';
import type { SkillConfigProps } from './types';

export const ScraperConfig: React.FC<SkillConfigProps> = ({ step, onChange, t }) => {
  const url = step.config.url ?? '';
  const urlError = !isValidUrlOrVar(url);
  const itemSelector = step.config.itemSelector ?? '';
  const titleSelector = step.config.titleSelector ?? '';
  const linkSelector = step.config.linkSelector ?? '';
  const maxItems = step.config.maxItems ?? '5';
  const cacheDays = step.config.cacheDays ?? '3';
  const [hasCheckpoint, setHasCheckpoint] = useState(false);

  useEffect(() => {
    void scraperApi.hasCheckpoint(step.id).then(setHasCheckpoint);
  }, [step.id]);

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

      <AppNumberInput
        label={t('agentflow.skill.scraper.maxItems')}
        value={maxItems}
        onChange={(v) => onChange({ ...step.config, maxItems: v === '' ? '' : String(v) })}
        size="sm"
        min={1}
        step={1}
        allowDecimal={false}
        allowNegative={false}
      />

      <AppNumberInput
        label={t('agentflow.skill.cacheDays')}
        value={cacheDays}
        onChange={(v) => onChange({ ...step.config, cacheDays: v === '' ? '' : String(v) })}
        size="sm"
        min={1}
        step={1}
        allowDecimal={false}
        allowNegative={false}
      />

      <Text fz="xs" c="dimmed">
        {t('agentflow.skill.cacheDays.hint')}
      </Text>

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
