import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Box, Group, SimpleGrid, Stack, Text } from '@mantine/core';
import { AppTextInput } from '../../../components/AppTextInput';
import { AppNumberInput } from '../../../components/AppNumberInput';
import { AppButton } from '../../../components/AppButton';
import { StatusLine } from '../../../components/StatusLine';
import { Trash, MousePointerClick } from 'lucide-react';
import { scraperApi, ipcEvents } from '../../../api/electronApi';
import { isValidUrlOrVar } from './validation';
import type { FlowVariable } from '../../../../../shared/types';
import type { SkillConfigProps } from './types';
import { fillTemplate } from '../../../../../shared/fillTemplate';

function resolveVars(raw: string, vars: FlowVariable[] | undefined): string {
  return raw.replace(/\{\{\s*var\.([a-zA-Z0-9_]+)\s*\}\}/g, (_m, name: string) =>
    vars?.find((v) => v.key === name)?.value ?? '');
}

/** What the runner takes when the field is blank (`feeds.ts`), on every run, not only the first. */
const SCRAPER_DEFAULT_MAX = '5';

/** Title and link side by side once the card is this wide; the 560px column keeps them stacked. */
const SELECTOR_PAIR_FROM = '640px';

/**
 * What the pick's match count still says: the number it found, or that a selector or the address
 * changed since, so the number no longer describes these selectors.
 */
type PickCount = { count: number } | 'stale' | null;

/** What the checkpoint row shows: one is stored, it was just reset, or there is none (no row). */
type CheckpointRow = 'stored' | 'cleared' | null;

export const ScraperConfig: React.FC<SkillConfigProps> = ({ step, onChange, t, flowVariables }) => {
  const url = step.config.url ?? '';
  const urlError = !isValidUrlOrVar(url);
  const itemSelector = step.config.itemSelector ?? '';
  const titleSelector = step.config.titleSelector ?? '';
  const linkSelector = step.config.linkSelector ?? '';
  const maxItems = step.config.maxItems ?? SCRAPER_DEFAULT_MAX;
  const [checkpoint, setCheckpoint] = useState<CheckpointRow>(null);
  const [picking, setPicking] = useState(false);
  const [pickCount, setPickCount] = useState<PickCount>(null);

  const configRef = useRef(step.config);
  configRef.current = step.config;
  const flowVarsRef = useRef(flowVariables);
  flowVarsRef.current = flowVariables;

  const resolvedUrl = resolveVars(url, flowVariables).trim();
  const canPick = resolvedUrl.length > 0 && !resolvedUrl.includes('{{');

  useEffect(() => {
    const refresh = (): void => {
      void scraperApi.hasCheckpoint(step.id).then((stored) => {
        setCheckpoint((current) => (stored ? 'stored' : current === 'cleared' ? 'cleared' : null));
      });
    };
    refresh();
    return ipcEvents.onFlowExecutionEnded(refresh);
  }, [step.id]);

  const handleClearCheckpoint = useCallback(async () => {
    await scraperApi.clearCheckpoint(step.id);
    setCheckpoint('cleared');
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
      setPickCount({ count: res.count });
    } finally {
      setPicking(false);
    }
  }, [onChange]);

  /** A hand edit of the address or a selector leaves the count describing something else. */
  const edit = (field: 'url' | 'itemSelector' | 'titleSelector' | 'linkSelector', value: string): void => {
    onChange({ ...step.config, [field]: value });
    setPickCount((current) => (current === null ? null : 'stale'));
  };

  return (
    <Stack gap="xs">
      <AppTextInput
        label={t('flow.skill.scraper.url')}
        placeholder={t('flow.skill.scraper.url.placeholder')}
        value={url}
        onChange={(e) => edit('url', e.currentTarget.value)}
        size="sm"
        mono
        error={urlError ? t('flow.skill.scraper.url.error') : undefined}
      />

      {/* Picking on the page fills all three selectors at once: the main way to set this step up. */}
      <Stack gap={4}>
        <Group gap="sm" wrap="wrap" align="center">
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
          {pickCount !== null && (
            <Text fz="xs" c="var(--text-muted)" data-pick-count={pickCount === 'stale' ? 'stale' : 'fresh'} style={{ fontVariantNumeric: 'tabular-nums' }}>
              {pickCount === 'stale'
                ? t('flow.skill.scraper.matchCount.stale')
                : fillTemplate(t('flow.skill.scraper.matchCount'), { count: String(pickCount.count) })}
            </Text>
          )}
        </Group>
        {!canPick && (
          <Text fz="xs" c="var(--text-muted)">{t('flow.skill.scraper.pickNeedsUrl')}</Text>
        )}
      </Stack>

      <Stack gap={4}>
        <AppTextInput
          label={t('flow.skill.scraper.itemSelector')}
          placeholder={t('flow.skill.scraper.itemSelector.placeholder')}
          value={itemSelector}
          onChange={(e) => edit('itemSelector', e.currentTarget.value)}
          size="sm"
          mono
        />
        <Text fz="xs" c="var(--text-muted)">{t('flow.skill.scraper.itemSelector.hint')}</Text>
      </Stack>

      <SimpleGrid type="container" cols={{ base: 1, [SELECTOR_PAIR_FROM]: 2 }} spacing="xs" verticalSpacing="xs">
        <AppTextInput
          label={t('flow.skill.scraper.titleSelector')}
          placeholder={t('flow.skill.scraper.titleSelector.placeholder')}
          value={titleSelector}
          onChange={(e) => edit('titleSelector', e.currentTarget.value)}
          size="sm"
          mono
        />
        <AppTextInput
          label={t('flow.skill.scraper.linkSelector')}
          placeholder={t('flow.skill.scraper.linkSelector.placeholder')}
          value={linkSelector}
          onChange={(e) => edit('linkSelector', e.currentTarget.value)}
          size="sm"
          mono
        />
      </SimpleGrid>

      <AppNumberInput
        label={t('flow.skill.scraper.maxItems')}
        description={t('flow.skill.scraper.hint')}
        placeholder={SCRAPER_DEFAULT_MAX}
        value={maxItems}
        onChange={(v) => onChange({ ...step.config, maxItems: v === '' ? '' : String(v) })}
        size="sm"
        min={1}
        step={1}
        allowDecimal={false}
        allowNegative={false}
      />

      {checkpoint !== null && (
        <Group justify="space-between" gap="xs" wrap="nowrap" align="flex-start" data-scraper-checkpoint={checkpoint}>
          <Box style={{ flex: 1, minWidth: 0 }}>
            {checkpoint === 'stored'
              ? <StatusLine tone="success">{t('flow.skill.scraper.stateActive')}</StatusLine>
              : <Text fz="var(--font-size-sm)" c="var(--text-muted)">{t('flow.skill.scraper.stateCleared')}</Text>}
          </Box>
          {checkpoint === 'stored' && (
            <AppButton
              variant="subtle"
              color="red"
              size="compact-sm"
              leftSection={<Trash size={14} />}
              onClick={() => void handleClearCheckpoint()}
              style={{ flexShrink: 0 }}
            >
              {t('flow.skill.scraper.clearState')}
            </AppButton>
          )}
        </Group>
      )}

      <Text fz="xs" c="var(--text-muted)">
        {fillTemplate(t('flow.skill.scraper.outputHint'), { outputKey: `{{${step.outputKey}}}` })}
      </Text>
    </Stack>
  );
};
