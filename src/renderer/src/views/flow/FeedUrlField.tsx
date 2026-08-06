import React, { useCallback, useState } from 'react';
import { Group, Stack, Text } from '@mantine/core';
import { Search } from 'lucide-react';
import { AppTextInput } from '../../components/AppTextInput';
import { AppButton } from '../../components/AppButton';
import { SelectDropdown } from '../../components/SelectDropdown';
import { rssApi } from '../../api/electronApi';
import { isValidUrlOrVar } from './skills/validation';
import type { FeedCandidate } from '../../../../shared/types';

type DiscoverStatus = 'idle' | 'found' | 'notfound' | 'error';

export interface FeedUrlFieldProps {
  value: string;
  onChange: (value: string) => void;
  label: string;
  placeholder?: string;
  hint?: string;
  error?: string;
  t: (key: string) => string;
}

export const FeedUrlField: React.FC<FeedUrlFieldProps> = ({
  value, onChange, label, placeholder, hint, error, t,
}) => {
  const urlError = !isValidUrlOrVar(value);
  const [discovering, setDiscovering] = useState(false);
  const [status, setStatus] = useState<DiscoverStatus>('idle');
  const [candidates, setCandidates] = useState<FeedCandidate[]>([]);
  const [discoverError, setDiscoverError] = useState('');
  const canDiscover = value.trim().length > 0 && !urlError;

  const setUrl = useCallback((next: string) => {
    onChange(next);
    setStatus('idle');
    setCandidates([]);
  }, [onChange]);

  const fillUrl = useCallback((next: string) => {
    onChange(next);
    setCandidates([]);
    setStatus('found');
  }, [onChange]);

  const handleDiscover = useCallback(async () => {
    setDiscovering(true);
    setCandidates([]);
    setStatus('idle');
    setDiscoverError('');
    try {
      const found = await rssApi.discoverFeed(value);
      if (found.length === 0) {
        setStatus('notfound');
      } else if (found.length === 1) {
        fillUrl(found[0].url);
      } else {
        setCandidates(found);
      }
    } catch (err) {
      setDiscoverError(err instanceof Error ? err.message : String(err));
      setStatus('error');
    } finally {
      setDiscovering(false);
    }
  }, [value, fillUrl]);

  return (
    <Stack gap={6}>
      <AppTextInput
        label={label}
        placeholder={placeholder ?? t('flow.skill.rss.url.placeholder')}
        value={value}
        onChange={(e) => setUrl(e.currentTarget.value)}
        size="sm"
        error={error ?? (urlError ? t('flow.skill.rss.url.error') : undefined)}
      />

      <Group gap="xs">
        <AppButton
          variant="light"
          size="xs"
          leftSection={<Search size={14} />}
          loading={discovering}
          disabled={!canDiscover}
          onClick={() => void handleDiscover()}
        >
          {t('flow.skill.rss.discover')}
        </AppButton>
      </Group>

      {candidates.length > 1 && (
        <SelectDropdown
          label={t('flow.skill.rss.discover.pick')}
          placeholder={t('flow.skill.rss.discover.pick')}
          value={null}
          options={candidates.map((c) => ({
            value: c.url,
            label: c.title ? `${c.title} — ${c.url}` : c.url,
          }))}
          onChange={fillUrl}
          size="sm"
        />
      )}

      {status === 'found' && (
        <Text fz="xs" c="teal">{t('flow.skill.rss.discover.found')}</Text>
      )}
      {status === 'notfound' && (
        <Text fz="xs" c="orange">{t('flow.skill.rss.discover.notFound')}</Text>
      )}
      {status === 'error' && (
        <Text fz="xs" c="red">
          {t('flow.skill.rss.discover.error').replace('{{error}}', discoverError)}
        </Text>
      )}

      <Text fz="xs" c="dimmed">{t('flow.skill.rss.discover.hint')}</Text>
      {hint && <Text fz="xs" c="dimmed">{hint}</Text>}
    </Stack>
  );
};
