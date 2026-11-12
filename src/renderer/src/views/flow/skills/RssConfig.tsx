import React, { useCallback, useState } from 'react';
import { Group, Stack, Text } from '@mantine/core';
import { rssApi } from '../../../api/electronApi';
import { AppButton } from '../../../components/AppButton';
import { StatusLine } from '../../../components/StatusLine';
import { useSeenOnScreen } from '../../../hooks/useSeenOnScreen';
import { FeedUrlField } from '../FeedUrlField';
import { FeedPreview } from '../FeedPreview';
import { SeenRecordRow, useSeenRecord } from './SeenRecordRow';
import type { SkillConfigProps } from './types';
import { fillTemplate } from '../../../../../shared/fillTemplate';
import { isPreviewableFeedUrl } from '../../../../../shared/feedPreview';
import { FLOW_VAR_PREFIX } from '../../../../../shared/flowVariables';
import type { FlowVariable } from '../../../../../shared/types';

const WHOLE_SETTING = new RegExp(`^\\{\\{\\s*${FLOW_VAR_PREFIX}\\.([^}\\s]+)\\s*\\}\\}$`);

/** The flow setting an address that is exactly `{{var.key}}` names, by its label. */
export function feedSettingName(address: string, variables: readonly FlowVariable[] | undefined): string | null {
  const key = WHOLE_SETTING.exec(address.trim())?.[1];
  if (!key) return null;
  return variables?.find((variable) => variable.key === key)?.label.trim() || key;
}

export const RssConfig: React.FC<SkillConfigProps> = ({ step, onChange, t, flowVariables }) => {
  const url = step.config.url ?? '';
  const address = url.trim();
  const [boxRef, onScreen] = useSeenOnScreen();
  const [hasRecord, clearRecord] = useSeenRecord(step.id, rssApi);
  // The address the card opened with: another one starts the record over on the next run.
  const [openedWith] = useState(address);
  const [touched, setTouched] = useState(false);
  const setting = feedSettingName(address, flowVariables);
  const previewable = isPreviewableFeedUrl(address);

  const setUrl = useCallback((value: string) => {
    onChange({ ...step.config, url: value });
  }, [onChange, step.config]);

  const dropFetchContent = (): void => {
    const rest = { ...step.config };
    delete rest.fetchContent;
    onChange(rest);
  };

  return (
    <Stack gap="xs" ref={boxRef}>
      <FeedUrlField
        value={url}
        onChange={setUrl}
        onBlur={() => setTouched(true)}
        label={t('flow.skill.rss.url')}
        error={touched && !address ? t('flow.skill.rss.url.required') : undefined}
        t={t}
      />

      {previewable && onScreen && <FeedPreview url={address} t={t} />}
      {setting !== null && (
        <Text fz="xs" c="var(--text-muted)" data-feed-preview-elsewhere="">
          {fillTemplate(t('flow.skill.rss.previewInSetting'), { name: setting })}
        </Text>
      )}
      {!previewable && <Text fz="xs" c="var(--text-muted)">{t('flow.skill.rss.hint')}</Text>}

      {step.config.fetchContent === 'true' && (
        <Group gap="xs" justify="space-between" wrap="nowrap">
          <StatusLine tone="warning">{t('flow.skill.rss.fetchContent.removed')}</StatusLine>
          <AppButton variant="light" size="compact-xs" onClick={dropFetchContent} style={{ flexShrink: 0 }}>
            {t('flow.skill.rss.fetchContent.drop')}
          </AppButton>
        </Group>
      )}

      <SeenRecordRow
        has={hasRecord}
        onClear={() => void clearRecord()}
        label={t('flow.skill.rss.seen.kept')}
        clearLabel={t('flow.skill.seen.clear')}
        clearHint={t('flow.skill.rss.seen.clearHint')}
        reseedNotice={openedWith && address !== openedWith ? t('flow.skill.rss.seen.reseed') : undefined}
      />

      <Text fz="xs" c="var(--text-muted)">
        {fillTemplate(t('flow.skill.rss.outputHint'), { outputKey: `{{${step.outputKey}}}` })}
      </Text>
    </Stack>
  );
};
