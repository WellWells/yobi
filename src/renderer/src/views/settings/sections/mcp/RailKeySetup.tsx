import React, { useEffect, useState } from 'react';
import { Group, Stack, Text } from '@mantine/core';
import { ExternalLink, KeyRound } from 'lucide-react';
import { AppButton } from '../../../../components/AppButton';
import { AppPasswordInput } from '../../../../components/AppPasswordInput';
import { clipboardApi, dataKeyApi } from '../../../../api/electronApi';
import { DATA_KEY_TDX_ID, DATA_KEY_TDX_SECRET } from '../../../../../../shared/types';

const TDX_REGISTER_URL = 'https://tdx.transportdata.tw/register';

interface Props {
  t: (key: string) => string;
}

// The rail connector works without a key (timetables, fares and one train's position come from the
// operators' own sites); TDX is asked only with the user's own key — never as a visitor — and adds
// delays across a whole plan, THSR seats and notices. One row says whether a key is set; the form opens under it.
export const RailKeySetup: React.FC<Props> = ({ t }) => {
  const [hasKey, setHasKey] = useState(false);
  const [editing, setEditing] = useState(false);
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = async (): Promise<void> => {
    const [id, secret] = await Promise.all([dataKeyApi.getStatus(DATA_KEY_TDX_ID), dataKeyApi.getStatus(DATA_KEY_TDX_SECRET)]);
    setHasKey(id.hasKey && secret.hasKey);
  };

  useEffect(() => { void refresh(); }, []);

  const save = async (id: string, secret: string): Promise<void> => {
    setBusy(true);
    await dataKeyApi.update(DATA_KEY_TDX_ID, id);
    await dataKeyApi.update(DATA_KEY_TDX_SECRET, secret);
    setClientId('');
    setClientSecret('');
    setEditing(false);
    await refresh();
    setBusy(false);
  };

  return (
    <Stack gap={8}>
      <Group gap={8} wrap="wrap">
        <Text fz="var(--font-size-sm)" c="dimmed" lh={1.5}>
          {t(hasKey ? 'settings.mcp.rail.key.set' : 'settings.mcp.rail.key.unset')}
        </Text>
        <AppButton size="compact-xs" variant="default" leftSection={<KeyRound size={12} />} onClick={() => setEditing((open) => !open)}>
          {t('settings.mcp.rail.key.edit')}
        </AppButton>
        <AppButton
          size="compact-xs"
          variant="subtle"
          leftSection={<ExternalLink size={12} />}
          onClick={() => { void clipboardApi.openExternalUrl(TDX_REGISTER_URL); }}
        >
          {t('settings.mcp.rail.key.register')}
        </AppButton>
      </Group>
      {editing && (
        <Stack gap={8}>
          <Text fz="var(--font-size-sm)" c="dimmed" lh={1.5}>{t('settings.mcp.rail.key.hint')}</Text>
          <AppPasswordInput
            label={t('settings.mcp.rail.key.clientId')}
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            size="sm"
            tone="body"
          />
          <AppPasswordInput
            label={t('settings.mcp.rail.key.clientSecret')}
            value={clientSecret}
            onChange={(e) => setClientSecret(e.target.value)}
            size="sm"
            tone="body"
          />
          <Group gap={8}>
            <AppButton
              size="xs"
              loading={busy}
              disabled={!clientId.trim() || !clientSecret.trim()}
              onClick={() => { void save(clientId, clientSecret); }}
            >
              {t('settings.mcp.rail.key.save')}
            </AppButton>
            {hasKey && (
              <AppButton size="xs" variant="subtle" color="red" disabled={busy} onClick={() => { void save('', ''); }}>
                {t('settings.mcp.rail.key.clear')}
              </AppButton>
            )}
          </Group>
        </Stack>
      )}
    </Stack>
  );
};
