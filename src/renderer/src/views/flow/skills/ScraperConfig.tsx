import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Badge, Button, Group, Stack, Text } from '@mantine/core';
import { AppTextInput } from '../../../components/AppTextInput';
import { AppNumberInput } from '../../../components/AppNumberInput';
import { AppButton } from '../../../components/AppButton';
import { Trash2, BookmarkCheck, MousePointerClick } from 'lucide-react';
import { scraperApi, ipcEvents } from '../../../api/electronApi';
import { isValidUrlOrVar } from './validation';
import type { FlowVariable } from '../../../../../shared/types';
import type { SkillConfigProps } from './types';

function resolveVars(raw: string, vars: FlowVariable[] | undefined): string {
  return raw.replace(/\{\{\s*var\.([a-zA-Z0-9_]+)\s*\}\}/g, (_m, name: string) =>
    vars?.find((v) => v.key === name)?.value ?? '');
}

export const ScraperConfig: React.FC<SkillConfigProps> = ({ step, onChange, t, flowVariables }) => {
  const url = step.config.url ?? '';
  const urlError = !isValidUrlOrVar(url);
  const itemSelector = step.config.itemSelector ?? '';
  const titleSelector = step.config.titleSelector ?? '';
  const linkSelector = step.config.linkSelector ?? '';
  const maxItems = step.config.maxItems ?? '5';
  const [hasCheckpoint, setHasCheckpoint] = useState(false);
  const [picking, setPicking] = useState(false);
  const [pickCount, setPickCount] = useState<number | null>(null);

  const configRef = useRef(step.config);
  configRef.current = step.config;
  const flowVarsRef = useRef(flowVariables);
  flowVarsRef.current = flowVariables;

  const resolvedUrl = resolveVars(url, flowVariables).trim();
  const canPick = resolvedUrl.length > 0 && !resolvedUrl.includes('{{');

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

  const handlePick = useCallback(async () => {
    const pickUrl = resolveVars(configRef.current.url ?? '', flowVarsRef.current).trim();
    if (!pickUrl || pickUrl.includes('{{')) return;
    setPicking(true);
    try {
      const res = await scraperApi.pickSelector({ url: pickUrl, target: 'list' });
      if (!res) return;
      onChange({
        ...configRef.current,
        itemSelector: res.itemSelector,
        titleSelector: res.titleSelector,
        linkSelector: res.linkSelector,
      });
      setPickCount(res.count);
    } finally {
      setPicking(false);
    }
  }, [onChange]);

  const matchCount = (count: number): string =>
    t('flow.skill.scraper.matchCount').replace('{{count}}', String(count));

  return (
    <Stack gap="xs">
      <AppTextInput
        label={t('flow.skill.scraper.url')}
        placeholder={t('flow.skill.scraper.url.placeholder')}
        value={url}
        onChange={(e) => onChange({ ...step.config, url: e.currentTarget.value })}
        size="sm"
        error={urlError ? t('flow.skill.scraper.url.error') : undefined}
      />

      {!canPick && (
        <Text fz="xs" c="dimmed">{t('flow.skill.scraper.pickNeedsUrl')}</Text>
      )}

      <Stack gap={4}>
        <Group gap="xs" wrap="nowrap" align="flex-end">
          <AppTextInput
            label={t('flow.skill.scraper.itemSelector')}
            placeholder={t('flow.skill.scraper.itemSelector.placeholder')}
            value={itemSelector}
            onChange={(e) => { onChange({ ...step.config, itemSelector: e.currentTarget.value }); setPickCount(null); }}
            size="sm"
            style={{ flex: 1 }}
          />
          <AppButton
            variant="default"
            size="sm"
            leftSection={<MousePointerClick size={14} />}
            loading={picking}
            disabled={!canPick || picking}
            onClick={() => void handlePick()}
          >
            {t('flow.skill.scraper.pickList')}
          </AppButton>
        </Group>
        {pickCount !== null && <Text fz="xs" c="dimmed">{matchCount(pickCount)}</Text>}
        <Text fz="xs" c="dimmed">{t('flow.skill.scraper.itemSelector.hint')}</Text>
      </Stack>

      <AppTextInput
        label={t('flow.skill.scraper.titleSelector')}
        placeholder={t('flow.skill.scraper.titleSelector.placeholder')}
        value={titleSelector}
        onChange={(e) => onChange({ ...step.config, titleSelector: e.currentTarget.value })}
        size="sm"
      />

      <AppTextInput
        label={t('flow.skill.scraper.linkSelector')}
        placeholder={t('flow.skill.scraper.linkSelector.placeholder')}
        value={linkSelector}
        onChange={(e) => onChange({ ...step.config, linkSelector: e.currentTarget.value })}
        size="sm"
      />

      <AppNumberInput
        label={t('flow.skill.scraper.maxItems')}
        value={maxItems}
        onChange={(v) => onChange({ ...step.config, maxItems: v === '' ? '' : String(v) })}
        size="sm"
        min={1}
        step={1}
        allowDecimal={false}
        allowNegative={false}
      />

      <Text fz="xs" c="dimmed">
        {t('flow.skill.scraper.hint')}
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
            {t('flow.skill.scraper.stateActive')}
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
        {t('flow.skill.scraper.clearState')}
      </Button>

      <Text fz="xs" c="dimmed">
        {t('flow.skill.browser.outputHint').replace('{{outputKey}}', `{{${step.outputKey}}}`)}
      </Text>
    </Stack>
  );
};
