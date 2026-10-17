import React, { useEffect, useState } from 'react';
import { Group, Stack, Text } from '@mantine/core';
import { FolderClock, FolderCog, MonitorDown, RefreshCw, Trash2, FlaskConical } from 'lucide-react';
import {
  AppTextInput, GroupHeader, SectionCard, SectionTitle, SelectDropdown, SettingField, SettingRow, ToggleSwitch,
} from '../components';
import { AppButton } from '../../../components/AppButton';
import { YtdlToolsSetup } from '../../../components/ytdl/YtdlToolsSetup';
import { ytdlToolsApi } from '../../../api/electronApi';
import { useYtdlToolsState, ytdlToolsUsable } from '../../../store/ytdlToolsStore';
import { useFormatTime } from '../../../hooks/useFormatTime';
import { siteLabel } from '../../../../../shared/linkSites/rows';
import { pausedSites } from '../../../../../shared/linkSites/siteChanged';
import { DOWNLOADS_KEEP_CHOICES, isDownloadsKeep } from '../../../../../shared/downloads';
import type { DownloadsKeep } from '../../../../../shared/downloads';
import { BotAccessCaption } from './BotAccessCaption';
import { anyBotEnabled, whoCanUse, whoCanUseText } from './botPermissionsView';
import type { BotRoster } from './botPermissionsView';

interface Props {
  t: (key: string) => string;
  visible: boolean;
  sectionGap: number;
  /** Who may paste a link to the bots and get it downloaded; shown read-only. */
  roster: BotRoster;
}

/**
 * The Downloader card, the one place to manage its tools (every Downloader site uses them): their
 * state, a line per site whose downloads are paused, the update check, removal, and
 * (advanced) pointing at copies installed some other way. Main broadcasts every change, so nothing
 * here keeps its own copy of the state beyond the two path fields being typed. Also how long the
 * Yobi folder in Downloads keeps files, shown with or without the tools (not every download needs them).
 */
export const YtdlToolsSetting: React.FC<Props> = ({ t, visible, sectionGap, roster }) => {
  const state = useYtdlToolsState();
  const formatTime = useFormatTime();
  const [busy, setBusy] = useState<'update' | 'remove' | 'custom' | null>(null);
  const [ytdlpPath, setYtdlpPath] = useState('');
  const [ffmpegDir, setFfmpegDir] = useState('');
  const [keep, setKeep] = useState<DownloadsKeep | null>(null);

  useEffect(() => {
    setYtdlpPath(state?.customPaths?.ytdlp ?? '');
    setFfmpegDir(state?.customPaths?.ffmpegDir ?? '');
  }, [state?.customPaths?.ytdlp, state?.customPaths?.ffmpegDir]);

  useEffect(() => { void ytdlToolsApi.getDownloadsKeep().then(setKeep); }, []);

  if (!state) return null;
  const usable = ytdlToolsUsable(state);

  const run = async (kind: 'update' | 'remove' | 'custom', work: () => Promise<unknown>): Promise<void> => {
    setBusy(kind);
    try {
      await work();
    } finally {
      setBusy(null);
    }
  };

  // One line per site whose downloads are paused; with none paused, the last failure, if any.
  const paused = pausedSites(state).map(({ label, at }) => t('settings.ytdl.youtubeChanged')
    .replace('{{time}}', formatTime(at))
    .replace('{{site}}', label));
  const lastFailure = state.lastFailure
    ? t('settings.ytdl.lastFailure')
      .replace('{{reason}}', t(`settings.ytdl.failure.${state.lastFailure.category}`)
        .replace('{{site}}', siteLabel(state.lastFailure.site ?? 'youtube')))
      .replace('{{time}}', formatTime(state.lastFailure.at))
    : '';
  const failures = paused.length > 0 ? paused : [lastFailure].filter(Boolean);

  return (
    <SectionCard style={{ marginBottom: sectionGap, display: visible ? 'block' : 'none' }}>
      <SectionTitle icon={<MonitorDown size={15} />} label={t('settings.ytdl.title')} />
      <Stack gap={14}>
        {anyBotEnabled(roster) && <BotAccessCaption text={whoCanUseText(whoCanUse(roster, 'download'), 'downloader', t)} />}
        {!usable && <YtdlToolsSetup />}
        {usable && (
          <>
            <Stack gap={2}>
              <Text fz="sm">
                {t(state.status === 'custom' ? 'settings.ytdl.statusCustom' : 'settings.ytdl.statusReady')
                  .replace('{{ytdlp}}', state.ytdlpVersion ?? '?')
                  .replace('{{ffmpeg}}', state.ffmpegVersion ?? '?')}
              </Text>
              {state.lastCheckedAt && (
                <Text fz="xs" c="var(--text-muted)" style={{ fontVariantNumeric: 'tabular-nums' }}>
                  {t('settings.ytdl.lastChecked').replace('{{time}}', formatTime(state.lastCheckedAt))}
                </Text>
              )}
              {failures.map((line) => <Text key={line} fz="xs" c="var(--mantine-color-warning)">{line}</Text>)}
            </Stack>
            <Group gap="xs">
              {state.status === 'ready' && (
                <AppButton
                  variant="default"
                  size="xs"
                  leftSection={<RefreshCw size={14} />}
                  loading={busy === 'update'}
                  onClick={() => void run('update', ytdlToolsApi.checkUpdate)}
                >
                  {t('settings.ytdl.checkUpdate')}
                </AppButton>
              )}
              {state.status === 'ready' && (
                <AppButton
                  variant="subtle"
                  color="red"
                  size="xs"
                  leftSection={<Trash2 size={14} />}
                  loading={busy === 'remove'}
                  onClick={() => void run('remove', ytdlToolsApi.remove)}
                >
                  {t('settings.ytdl.remove')}
                </AppButton>
              )}
            </Group>
          </>
        )}

        {keep && (
          <SettingRow
            icon={<FolderClock size={13} />}
            label={t('settings.ytdl.keep')}
            hint={t('settings.ytdl.keep.hint')}
            control={(
              <SelectDropdown
                value={keep}
                options={DOWNLOADS_KEEP_CHOICES.map((choice) => ({ value: choice, label: t(`settings.ytdl.keep.${choice}`) }))}
                onChange={(value) => {
                  if (isDownloadsKeep(value)) void ytdlToolsApi.setDownloadsKeep(value).then(setKeep);
                }}
                w={150}
              />
            )}
          />
        )}

        <GroupHeader label={t('settings.ytdl.advanced')} variant="plain" />
        <SettingRow
          icon={<FlaskConical size={13} />}
          label={t('settings.ytdl.nightly')}
          hint={t('settings.ytdl.nightly.hint')}
          control={(
            <ToggleSwitch
              checked={state.nightly}
              disabled={state.status === 'custom'}
              onChange={(e) => { void ytdlToolsApi.setNightly(e.currentTarget.checked); }}
            />
          )}
        />
        <SettingField
          icon={<FolderCog size={13} />}
          label={t('settings.ytdl.custom')}
          hint={t('settings.ytdl.custom.hint')}
        >
          <Stack gap={6}>
            <AppTextInput
              value={ytdlpPath}
              mono
              tone="body"
              placeholder={t('settings.ytdl.custom.ytdlp')}
              onChange={(e) => setYtdlpPath(e.currentTarget.value)}
            />
            <AppTextInput
              value={ffmpegDir}
              mono
              tone="body"
              placeholder={t('settings.ytdl.custom.ffmpegDir')}
              onChange={(e) => setFfmpegDir(e.currentTarget.value)}
            />
            <Group gap="xs">
              <AppButton
                variant="default"
                size="xs"
                loading={busy === 'custom'}
                disabled={!ytdlpPath.trim() || !ffmpegDir.trim()}
                onClick={() => void run('custom', () => ytdlToolsApi.setCustom({ ytdlp: ytdlpPath, ffmpegDir }))}
              >
                {t('settings.ytdl.custom.apply')}
              </AppButton>
              {state.status === 'custom' && (
                <AppButton
                  variant="subtle"
                  size="xs"
                  onClick={() => void run('custom', () => ytdlToolsApi.setCustom(null))}
                >
                  {t('settings.ytdl.custom.clear')}
                </AppButton>
              )}
            </Group>
          </Stack>
        </SettingField>
      </Stack>
    </SectionCard>
  );
};
