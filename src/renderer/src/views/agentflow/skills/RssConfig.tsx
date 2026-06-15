import React, { useCallback, useEffect, useState } from 'react';
import { Badge, Button, Group, Stack, Text } from '@mantine/core';
import { AppTextInput } from '../../../components/AppTextInput';
import { AppNumberInput } from '../../../components/AppNumberInput';
import { AppButton } from '../../../components/AppButton';
import { SelectDropdown } from '../../../components/SelectDropdown';
import { ToggleSwitch } from '../../../components/ToggleSwitch';
import { SettingRow } from '../../../components/SettingRow';
import { Trash2, FileText, BookmarkCheck, Search, Image as ImageIcon } from 'lucide-react';
import { rssApi, ipcEvents } from '../../../api/electronApi';
import { isValidUrlOrVar } from './validation';
import type { FeedCandidate } from '../../../../../shared/types';
import type { SkillConfigProps } from './types';

type DiscoverStatus = 'idle' | 'found' | 'notfound' | 'error';

export const RssConfig: React.FC<SkillConfigProps> = ({ step, onChange, t }) => {
  const url = step.config.url ?? '';
  const urlError = !isValidUrlOrVar(url);
  const fetchContent = step.config.fetchContent === 'true';
  const includeImage = step.config.includeImage === 'true';
  const cacheDays = step.config.cacheDays ?? '3';
  const [hasCheckpoint, setHasCheckpoint] = useState(false);

  const [discovering, setDiscovering] = useState(false);
  const [discoverStatus, setDiscoverStatus] = useState<DiscoverStatus>('idle');
  const [candidates, setCandidates] = useState<FeedCandidate[]>([]);
  const [discoverError, setDiscoverError] = useState('');
  const canDiscover = url.trim().length > 0 && !urlError;

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
    setDiscoverStatus('idle');
    setCandidates([]);
  }, [onChange, step.config]);

  const fillUrl = useCallback((value: string) => {
    onChange({ ...step.config, url: value });
    setCandidates([]);
    setDiscoverStatus('found');
  }, [onChange, step.config]);

  const handleDiscover = useCallback(async () => {
    setDiscovering(true);
    setCandidates([]);
    setDiscoverStatus('idle');
    setDiscoverError('');
    try {
      const found = await rssApi.discoverFeed(url);
      if (found.length === 0) {
        setDiscoverStatus('notfound');
      } else if (found.length === 1) {
        fillUrl(found[0].url);
      } else {
        setCandidates(found);
      }
    } catch (err) {
      setDiscoverError(err instanceof Error ? err.message : String(err));
      setDiscoverStatus('error');
    } finally {
      setDiscovering(false);
    }
  }, [url, fillUrl]);

  return (
    <Stack gap="xs">
      <AppTextInput
        label={t('agentflow.skill.rss.url')}
        placeholder={t('agentflow.skill.rss.url.placeholder')}
        value={url}
        onChange={(e) => setUrl(e.currentTarget.value)}
        size="sm"
        error={urlError ? t('agentflow.skill.rss.url.error') : undefined}
      />

      <Stack gap={6}>
        <Group gap="xs">
          <AppButton
            variant="light"
            size="xs"
            leftSection={<Search size={14} />}
            loading={discovering}
            disabled={!canDiscover}
            onClick={() => void handleDiscover()}
          >
            {t('agentflow.skill.rss.discover')}
          </AppButton>
        </Group>

        {candidates.length > 1 && (
          <SelectDropdown
            label={t('agentflow.skill.rss.discover.pick')}
            placeholder={t('agentflow.skill.rss.discover.pick')}
            value={null}
            options={candidates.map((c) => ({
              value: c.url,
              label: c.title ? `${c.title} — ${c.url}` : c.url,
            }))}
            onChange={fillUrl}
            size="sm"
          />
        )}

        {discoverStatus === 'found' && (
          <Text fz="xs" c="teal">{t('agentflow.skill.rss.discover.found')}</Text>
        )}
        {discoverStatus === 'notfound' && (
          <Text fz="xs" c="orange">{t('agentflow.skill.rss.discover.notFound')}</Text>
        )}
        {discoverStatus === 'error' && (
          <Text fz="xs" c="red">
            {t('agentflow.skill.rss.discover.error').replace('{{error}}', discoverError)}
          </Text>
        )}

        <Text fz="xs" c="dimmed">{t('agentflow.skill.rss.discover.hint')}</Text>
      </Stack>

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

      <SettingRow
        icon={<ImageIcon size={13} />}
        label={t('agentflow.skill.includeImage')}
        hint={t('agentflow.skill.includeImage.hint')}
        control={
          <ToggleSwitch
            checked={includeImage}
            onChange={(e) => onChange({ ...step.config, includeImage: e.currentTarget.checked ? 'true' : 'false' })}
          />
        }
      />

      <Text fz="xs" c="dimmed">
        {t('agentflow.skill.browser.outputHint').replace('{{outputKey}}', `{{${step.outputKey}}}`)}
      </Text>
    </Stack>
  );
};
