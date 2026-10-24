import React from 'react';
import { Group, List, Stack, Text } from '@mantine/core';
import { Eraser, ExternalLink, FileUp, KeyRound, Zap } from 'lucide-react';
import { AppButton } from '../../../components/AppButton';
import { AppPasswordInput } from '../../../components/AppPasswordInput';
import { AppTextInput, SectionTitle, SettingField, StatusLine } from '../components';
import { useTelegramLargeUpload } from '../hooks/useTelegramLargeUpload';
import type { TelegramLargeUploadSnapshot } from '../../../../../shared/telegramUpload';
import { fillTemplate } from '../../../../../shared/fillTemplate';

interface Props {
  saved: TelegramLargeUploadSnapshot | undefined;
  reload: () => Promise<void>;
  t: (key: string) => string;
}

const STEP_TEXT = { fz: 'var(--font-size-sm)', c: 'var(--text-muted)', lh: 1.6 } as const;

/**
 * Files over the Bot API's 50 MB go up over MTProto as the same bot, which needs the API id and
 * hash of an app the person creates once at my.telegram.org. The steps say exactly where to click.
 */
export const TelegramLargeUploadSettings: React.FC<Props> = ({ saved, reload, t }) => {
  const upload = useTelegramLargeUpload(saved, reload);
  const current = upload.isSet && saved
    ? fillTemplate(t('settings.telegram.largeUpload.set'), { id: saved.apiId, hash: saved.apiHashPreview })
    : t('settings.telegram.largeUpload.notSet');

  return (
    <Stack gap={12}>
      <SectionTitle icon={<FileUp size={15} />} label={t('settings.telegram.largeUpload.title')} mb={0} />
      <Text {...STEP_TEXT}>{t('settings.telegram.largeUpload.desc')}</Text>

      <List type="ordered" size="sm" spacing={8} c="var(--text-muted)">
        <List.Item>
          <Group gap={8} wrap="wrap">
            <Text {...STEP_TEXT}>{t('settings.telegram.largeUpload.step1')}</Text>
            <AppButton
              size="compact-xs"
              variant="default"
              leftSection={<ExternalLink size={12} />}
              onClick={() => { void upload.openMyTelegram(); }}
            >
              {t('settings.telegram.largeUpload.open')}
            </AppButton>
          </Group>
        </List.Item>
        <List.Item>
          <Text {...STEP_TEXT}>{t('settings.telegram.largeUpload.step2')}</Text>
          <Text {...STEP_TEXT}>{t('settings.telegram.largeUpload.errorTip')}</Text>
        </List.Item>
        <List.Item>
          <Text {...STEP_TEXT}>{t('settings.telegram.largeUpload.step3')}</Text>
        </List.Item>
      </List>

      <SettingField label={t('settings.telegram.largeUpload.apiIdLabel')}>
        <AppTextInput
          tone="body"
          mono
          inputMode="numeric"
          value={upload.apiIdInput}
          onChange={(e) => upload.changeApiId(e.target.value)}
          placeholder={saved?.apiId
            ? t('settings.telegram.largeUpload.keepSaved')
            : t('settings.telegram.largeUpload.apiIdPlaceholder')}
          error={upload.apiIdInvalid ? t('settings.telegram.largeUpload.apiIdInvalid') : undefined}
        />
      </SettingField>
      <SettingField label={t('settings.telegram.largeUpload.apiHashLabel')}>
        <AppPasswordInput
          tone="body"
          mono
          value={upload.apiHashInput}
          onChange={(e) => upload.changeApiHash(e.target.value)}
          placeholder={saved?.hasApiHash
            ? t('settings.telegram.largeUpload.keepSaved')
            : t('settings.telegram.largeUpload.apiHashPlaceholder')}
          error={upload.apiHashInvalid ? t('settings.telegram.largeUpload.apiHashInvalid') : undefined}
        />
      </SettingField>

      <Group justify="space-between" gap={8} wrap="nowrap">
        <AppButton
          variant="default"
          size="xs"
          leftSection={<Zap size={13} />}
          loading={upload.testStatus === 'testing'}
          disabled={!upload.canTest}
          onClick={() => { void upload.test(); }}
        >
          {t('settings.telegram.largeUpload.test')}
        </AppButton>
        <Group gap={8}>
          <AppButton
            variant="default"
            size="xs"
            leftSection={<Eraser size={13} />}
            disabled={upload.busy || !upload.isSet}
            onClick={() => { void upload.clear(); }}
          >
            {t('settings.telegram.largeUpload.clear')}
          </AppButton>
          <AppButton
            variant="filled"
            size="xs"
            leftSection={<KeyRound size={13} />}
            loading={upload.busy}
            disabled={!upload.canSave}
            onClick={() => { void upload.save(); }}
          >
            {t('settings.telegram.largeUpload.save')}
          </AppButton>
        </Group>
      </Group>

      {upload.message && (
        <Text fz="var(--font-size-sm)" c="var(--mantine-color-error)">{upload.message}</Text>
      )}
      {upload.testStatus === 'ok' && (
        <StatusLine tone="success">
          {t('settings.telegram.largeUpload.testOk')}
          {upload.testMessage ? ` — ${upload.testMessage}` : ''}
        </StatusLine>
      )}
      {upload.testStatus === 'error' && (
        <StatusLine tone="error">{upload.testMessage || t('settings.telegram.largeUpload.testFailed')}</StatusLine>
      )}

      <Text fz="var(--font-size-sm)" c="var(--text-muted)">
        {fillTemplate(t('settings.telegram.largeUpload.current'), { value: current })}
      </Text>
    </Stack>
  );
};
