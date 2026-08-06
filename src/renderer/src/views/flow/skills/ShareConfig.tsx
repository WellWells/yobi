import React, { useEffect, useState } from 'react';
import { Group, Stack, Text } from '@mantine/core';
import { AppButton } from '../../../components/AppButton';
import { AppTextInput } from '../../../components/AppTextInput';
import { AppTextarea } from '../../../components/AppTextarea';
import { AppSegmentedControl } from '../../../components/AppSegmentedControl';
import { SelectDropdown } from '../../../components/SelectDropdown';
import { ToggleSwitch } from '../../../components/ToggleSwitch';
import { ShareConsentPoints } from '../../../components/ShareConsentPoints';
import { BackgroundStylePicker } from '../../../components/capture/PalettePicker';
import { shareApi } from '../../../api/electronApi';
import { DEFAULT_CAPTURE_BACKGROUND_STYLE, DEFAULT_CAPTURE_PALETTE } from '../../../../../shared/capturePalettes';
import type { CaptureBackgroundStyle } from '../../../../../shared/capturePalettes';
import {
  SHARE_FORMATS, isShareLinkFormat, parseShareFormat, withoutZipPrefix,
} from '../../../../../shared/shareFormat';
import {
  CAPTURE_WIDTHS,
  DEFAULT_CAPTURE_WIDTH,
  SHARE_CONSENT_KEYS,
  SHARE_EXPIRE_VALUES,
  captureWidthLabelKey,
  snapCaptureWidth,
} from '../../../../../shared/types';
import type { ShareSettings } from '../../../../../shared/types';
import { buildCapturePaletteOptions } from './captureConfig';
import type { SkillConfigProps } from './types';

export const ShareConfig: React.FC<SkillConfigProps> = ({ step, onChange, t }) => {
  const [settings, setSettings] = useState<ShareSettings | null>(null);

  const sharing = isShareLinkFormat(step.config.format);

  useEffect(() => {
    if (!sharing || settings) return;
    void shareApi.getSettings().then(setSettings);
  }, [sharing, settings]);

  /*
   * The stored value may carry a legacy zip token (`zippng`) or a width no longer offered.
   * Both are read through the same normalisers the runtime uses, so the pickers show what
   * will actually happen rather than falling back to nothing selected.
   */
  const parsed = parseShareFormat(step.config.format);
  const zip = parsed.zip || step.config.zip === 'true';
  const width = snapCaptureWidth(Number(step.config.width) || DEFAULT_CAPTURE_WIDTH);

  const acceptConsent = (): void => {
    const consentedAt = new Date().toISOString();
    setSettings((prev) => (prev ? { ...prev, consentedAt } : prev));
    void shareApi.updateSettings({ consentedAt });
  };

  return (
    <Stack gap="xs">
      <AppTextarea
        label={t('flow.skill.share.content')}
        placeholder={t('flow.skill.share.content.placeholder')}
        value={step.config.content ?? ''}
        onChange={(e) => onChange({ ...step.config, content: e.currentTarget.value })}
        minRows={3}
        autosize
        size="sm"
      />

      <Stack gap={6}>
        <Text fz="xs" c="dimmed">{t('flow.skill.share.format')}</Text>
        <AppSegmentedControl
          value={parsed.format}
          options={SHARE_FORMATS.map((value) => ({
            value,
            label: t(`flow.skill.share.format.${value}`),
          }))}
          /* Writing zip separately keeps the legacy token from silently coming back. */
          onChange={(format) => onChange({ ...step.config, format, zip: zip ? 'true' : 'false' })}
          size="sm"
        />
      </Stack>

      {sharing ? (
        <>
          <Group justify="space-between" wrap="nowrap" gap={12}>
            <Text fz="xs" c="dimmed">{t('share.settings.instance')}</Text>
            <Text fz="xs" c="dimmed" ff="var(--font-mono)">
              {(settings?.instanceUrl ?? '').replace(/^https?:\/\//, '')}
            </Text>
          </Group>

          {settings && !settings.consentedAt && (
            <Stack gap={10}>
              <Text fz="xs" c="var(--text-primary)" lh={1.7}>
                {t('share.consent.intro').replace('{{instance}}', settings.instanceUrl)}
              </Text>
              <ShareConsentPoints points={SHARE_CONSENT_KEYS.map((key) => ({ key, text: t(key) }))} />
              <Group justify="flex-end">
                <AppButton size="xs" onClick={acceptConsent}>{t('share.consent.accept')}</AppButton>
              </Group>
            </Stack>
          )}

          <SelectDropdown
            label={t('share.settings.expire')}
            options={SHARE_EXPIRE_VALUES.map((value) => ({ value, label: t(`share.expire.${value}`) }))}
            value={step.config.expire || settings?.expire || '1week'}
            onChange={(expire) => onChange({ ...step.config, expire })}
            size="sm"
          />

          <ToggleSwitch
            label={t('share.settings.burn')}
            size="sm"
            checked={step.config.burnAfterReading === 'true'}
            onChange={(e) => onChange({ ...step.config, burnAfterReading: e.currentTarget.checked ? 'true' : 'false' })}
          />
        </>
      ) : (
        <>
          <AppTextInput
            label={t('flow.skill.share.title')}
            placeholder={t('flow.skill.share.title.placeholder')}
            value={step.config.title ?? ''}
            onChange={(e) => onChange({ ...step.config, title: e.currentTarget.value })}
            size="sm"
          />
          <AppTextInput
            label={t('flow.skill.share.filename')}
            placeholder={t('flow.skill.share.filename.placeholder')}
            value={step.config.filename ?? ''}
            onChange={(e) => onChange({ ...step.config, filename: e.currentTarget.value })}
            size="sm"
            mono
          />

          <Stack gap={6}>
            <Text fz="xs" c="dimmed">{t('capture.size')}</Text>
            <AppSegmentedControl
              value={String(width)}
              options={CAPTURE_WIDTHS.map((value) => ({
                value: String(value),
                label: t(captureWidthLabelKey(value)),
              }))}
              onChange={(value) => onChange({ ...step.config, width: value })}
              size="sm"
            />
          </Stack>

          <SelectDropdown
            label={t('common.background')}
            options={buildCapturePaletteOptions(t)}
            value={step.config.palette || DEFAULT_CAPTURE_PALETTE}
            onChange={(palette) => onChange({ ...step.config, palette })}
            size="sm"
          />
          <BackgroundStylePicker
            value={(step.config.backgroundStyle || DEFAULT_CAPTURE_BACKGROUND_STYLE) as CaptureBackgroundStyle}
            onChange={(backgroundStyle) => onChange({ ...step.config, backgroundStyle })}
            t={t}
          />

          <ToggleSwitch
            label={t('flow.skill.share.zip')}
            size="sm"
            checked={zip}
            onChange={(e) => onChange({
              ...step.config,
              /* Drops a legacy `zippng` token so it cannot outvote the switch — but leaves
               * a {{template}} format alone, which is what the /md command step holds. */
              format: withoutZipPrefix(step.config.format),
              zip: e.currentTarget.checked ? 'true' : 'false',
            })}
          />
        </>
      )}

      <ToggleSwitch
        label={t('flow.skill.share.emitFailFlag')}
        size="sm"
        checked={step.config.emitFailFlag === 'true'}
        onChange={(e) => onChange({ ...step.config, emitFailFlag: e.currentTarget.checked ? 'true' : 'false' })}
      />

      <Text fz="xs" c="dimmed">
        {sharing ? t('flow.skill.share.hint.link') : t('flow.skill.share.hint.file')}
      </Text>
    </Stack>
  );
};
