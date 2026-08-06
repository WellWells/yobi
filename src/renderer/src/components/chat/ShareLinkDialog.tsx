import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Box, Group, Stack, Text, Tooltip } from '@mantine/core';
import {
  Check, Clock, Copy, ExternalLink, Flame, Link2, Server, Trash2, TriangleAlert,
} from 'lucide-react';
import { SHARE_CONSENT_KEYS, SHARE_EXPIRE_VALUES } from '../../../../shared/types';
import type { ShareErrorCode, ShareExpire, ShareSettings } from '../../../../shared/types';
import { clipboardApi, shareApi } from '../../api/electronApi';
import { AppButton } from '../AppButton';
import { AppModal } from '../AppModal';
import { AppTextInput } from '../AppTextInput';
import { SelectDropdown } from '../SelectDropdown';
import { SettingRow } from '../SettingRow';
import { ToggleSwitch } from '../ToggleSwitch';
import { ShareConsentPoints } from '../ShareConsentPoints';

type Stage = 'consent' | 'options' | 'result';

interface ShareLinkDialogProps {
  open: boolean;
  onClose: () => void;
  markdown: string;
  t: (key: string) => string;
}

export const ShareLinkDialog: React.FC<ShareLinkDialogProps> = ({ open, onClose, markdown, t }) => {
  const [settings, setSettings] = useState<ShareSettings | null>(null);
  const [stage, setStage] = useState<Stage>('options');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ url: string; deleteUrl: string; burned: boolean } | null>(null);
  const [error, setError] = useState<{ code: ShareErrorCode; detail?: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [revoked, setRevoked] = useState(false);

  useEffect(() => {
    if (!open) return;
    setResult(null);
    setError(null);
    setCopied(false);
    setRevoked(false);
    void shareApi.getSettings().then((loaded) => {
      setSettings(loaded);
      setStage(loaded.consentedAt ? 'options' : 'consent');
    });
  }, [open]);

  const patchSettings = useCallback(async (patch: Partial<ShareSettings>): Promise<void> => {
    setSettings((prev) => (prev ? { ...prev, ...patch } : prev));
    await shareApi.updateSettings(patch);
  }, []);

  const handleAcceptConsent = useCallback((): void => {
    void patchSettings({ consentedAt: new Date().toISOString() }).then(() => setStage('options'));
  }, [patchSettings]);

  const handleCreate = useCallback((): void => {
    if (!settings || busy) return;
    setBusy(true);
    setError(null);
    void shareApi.createLink({
      markdown,
      expire: settings.expire,
      burnAfterReading: settings.burnAfterReading,
    }).then((res) => {
      setBusy(false);
      if (!res.ok || !res.url) {
        setError({ code: res.error ?? 'unknown', detail: res.detail });
        return;
      }
      setResult({ url: res.url, deleteUrl: res.deleteUrl ?? '', burned: settings.burnAfterReading });
      setStage('result');
    });
  }, [settings, busy, markdown]);

  const handleCopy = useCallback((): void => {
    if (!result) return;
    void clipboardApi.copyText(result.url).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_600);
    });
  }, [result]);

  const handleRevoke = useCallback((): void => {
    if (!result?.deleteUrl || busy) return;
    setBusy(true);
    setError(null);
    void shareApi.revokeLink(result.deleteUrl).then((res) => {
      setBusy(false);
      if (!res.ok) {
        setError({ code: res.error ?? 'unknown', detail: res.detail });
        return;
      }
      setRevoked(true);
    });
  }, [result, busy]);

  const expireOptions = SHARE_EXPIRE_VALUES.map((value) => ({
    value,
    label: t(`share.expire.${value}`),
  }));

  return (
    <AppModal
      opened={open}
      onClose={onClose}
      icon={<Link2 size={16} />}
      title={t('share.dialog.title')}
      size="lg"
      zIndex={90}
    >
      <Stack gap={16}>
        {stage === 'consent' && (
          <Stack gap={14}>
            <Text fz="var(--font-size-base)" c="var(--text-primary)" lh={1.7}>
              {t('share.consent.intro').replace('{{instance}}', settings?.instanceUrl ?? '')}
            </Text>

            {
}
            <ShareConsentPoints points={SHARE_CONSENT_KEYS.map((key) => ({ key, text: t(key) }))} />

            <Group justify="flex-end" gap={8}>
              <AppButton variant="subtle" onClick={onClose}>{t('dialog.cancel')}</AppButton>
              <AppButton variant="filled" onClick={handleAcceptConsent}>
                {t('share.consent.accept')}
              </AppButton>
            </Group>
          </Stack>
        )}

        {stage === 'options' && settings && (
          <Stack gap={14}>
            <SettingRow
              icon={<Server size={13} />}
              label={t('share.settings.instance')}
              hint={t('share.settings.instanceHint')}
              control={
                <Text fz="var(--font-size-sm)" c="dimmed" ff="var(--font-mono)">
                  {settings.instanceUrl.replace(/^https?:\/\//, '')}
                </Text>
              }
              alignStart
            />
            <SettingRow
              icon={<Clock size={13} />}
              label={t('share.settings.expire')}
              hint={t('share.settings.expireHint')}
              control={
                <SelectDropdown
                  value={settings.expire}
                  options={expireOptions}
                  onChange={(value) => { void patchSettings({ expire: value as ShareExpire }); }}
                  size="sm"
                  w={150}
                />
              }
              alignStart
            />
            <SettingRow
              icon={<Flame size={13} />}
              label={t('share.settings.burn')}
              hint={t('share.settings.burnHint')}
              control={
                <ToggleSwitch
                  checked={settings.burnAfterReading}
                  onChange={(event) => { void patchSettings({ burnAfterReading: event.currentTarget.checked }); }}
                  aria-label={t('share.settings.burn')}
                />
              }
              alignStart
            />

            {error && <ShareErrorAlert error={error} t={t} />}

            <Group justify="flex-end" gap={8}>
              <AppButton variant="subtle" onClick={onClose} disabled={busy}>
                {t('dialog.cancel')}
              </AppButton>
              <AppButton
                variant="filled"
                leftSection={<Link2 size={14} />}
                loading={busy}
                disabled={!markdown.trim()}
                onClick={handleCreate}
              >
                {busy ? t('share.creating') : t('share.create')}
              </AppButton>
            </Group>
          </Stack>
        )}

        {stage === 'result' && result && (
          <Stack gap={14}>
            {revoked ? (
              <Alert color="gray" icon={<Trash2 size={16} />} variant="light">
                {t('share.revoked')}
              </Alert>
            ) : (
              <>
                <Text fz="var(--font-size-sm)" c="dimmed" lh={1.65}>
                  {t('share.result.hint')}
                </Text>
                <AppTextInput value={result.url} readOnly mono onFocus={(e) => e.currentTarget.select()} />
                {error && <ShareErrorAlert error={error} t={t} />}
              </>
            )}

            <Group justify="space-between" gap={8}>
              {
}
              <AppButton
                variant="subtle"
                color="red"
                leftSection={<Trash2 size={14} />}
                loading={busy}
                disabled={!result.deleteUrl || revoked}
                onClick={handleRevoke}
              >
                {t('share.revoke')}
              </AppButton>
              <Group gap={8}>
                {!revoked && (
                  <>
                    {
}
                    <Tooltip label={t('share.open.burnBlocked')} disabled={!result.burned} position="top" maw={280} multiline>
                      <Box>
                        <AppButton
                          variant="outline"
                          leftSection={<ExternalLink size={14} />}
                          disabled={result.burned}
                          onClick={() => { void clipboardApi.openExternalUrl(result.url); }}
                        >
                          {t('share.open')}
                        </AppButton>
                      </Box>
                    </Tooltip>
                    <AppButton
                      variant="filled"
                      leftSection={copied ? <Check size={14} /> : <Copy size={14} />}
                      onClick={handleCopy}
                    >
                      {copied ? t('share.copied') : t('share.copy')}
                    </AppButton>
                  </>
                )}
                {revoked && (
                  <AppButton variant="filled" onClick={onClose}>{t('share.done')}</AppButton>
                )}
              </Group>
            </Group>
          </Stack>
        )}
      </Stack>
    </AppModal>
  );
};

const ShareErrorAlert: React.FC<{
  error: { code: ShareErrorCode; detail?: string };
  t: (key: string) => string;
}> = ({ error, t }) => (
  <Alert color="red" variant="light" icon={<TriangleAlert size={16} />}>
    <Stack gap={4}>
      <Text fz="var(--font-size-sm)">{t(`share.error.${error.code}`)}</Text>
      {error.detail && (
        <Text fz="var(--font-size-sm)" c="dimmed" ff="var(--font-mono)" style={{ wordBreak: 'break-word' }}>
          {error.detail}
        </Text>
      )}
    </Stack>
  </Alert>
);
