import React, { useEffect, useState } from 'react';
import { ActionIcon, Group, Loader, Menu, Progress, Stack, Text, Tooltip } from '@mantine/core';
import { Download, EllipsisVertical, ExternalLink, FolderSearch, RefreshCw, Trash } from 'lucide-react';
import { AppButton } from '../AppButton';
import { DangerMenuItem } from '../DangerMenuItem';
import { AppTextInput } from '../AppTextInput';
import { StatusLine } from '../StatusLine';
import { TooltipTarget } from '../TooltipTarget';
import { Z_POPOVER } from '../../config/zLayers';
import { clipboardApi, managedToolsApi } from '../../api/electronApi';
import { useManagedToolState, useManagedToolsStore } from '../../store/managedToolsStore';
import { useFormatTime } from '../../hooks/useFormatTime';
import { fillTemplate } from '../../../../shared/fillTemplate';
import { formatMegabytes } from '../../../../shared/ytdl';
import type { ManagedToolId, ManagedToolState } from '../../../../shared/managedTools';

interface Props {
  id: ManagedToolId;
  t: (key: string) => string;
}

function percent(state: ManagedToolState): number {
  const p = state.progress;
  if (!p || p.totalBytes <= 0) return 0;
  return Math.min(100, Math.round((p.receivedBytes / p.totalBytes) * 100));
}

/**
 * A program Yobi runs but does not ship (`shared/managedTools.ts`), as one line under its feature:
 * which copy is in use (its path and last update check on hover), or the download when there is
 * none. Everything else — the project page, an update check, another location, removing Yobi's
 * copy — waits in the ⋯ menu. Every managed program gets this same line.
 */
export const ManagedToolSetup: React.FC<Props> = ({ id, t }) => {
  const state = useManagedToolState(id);
  const apply = useManagedToolsStore((s) => s.apply);
  const formatTime = useFormatTime();
  const [busy, setBusy] = useState<'install' | 'update' | 'remove' | 'custom' | null>(null);
  const [customOpen, setCustomOpen] = useState(false);
  const [customPath, setCustomPath] = useState('');

  useEffect(() => {
    setCustomPath(state?.customPath ?? '');
    if (state?.customPath) setCustomOpen(true);
  }, [state?.customPath]);

  if (!state) return null;

  const run = async (kind: NonNullable<typeof busy>, work: () => Promise<ManagedToolState[]>): Promise<void> => {
    setBusy(kind);
    try {
      apply(await work());
    } finally {
      setBusy(null);
    }
  };

  const active = state.active;
  const installing = state.installing || busy === 'install';
  const sourceLine = active
    ? fillTemplate(t(`managedTools.source.${active.source}`), { name: state.name, version: active.version })
    : fillTemplate(t('managedTools.missing'), { name: state.name });
  const detail = active
    ? [active.path, active.source === 'managed' && state.lastCheckedAt
      ? fillTemplate(t('managedTools.lastChecked'), { time: formatTime(state.lastCheckedAt) })
      : ''].filter(Boolean).join('\n')
    : '';

  return (
    <Stack gap={6}>
      <Group gap={8} wrap="nowrap" justify="space-between">
        <Tooltip label={detail} disabled={!detail} multiline maw={360} style={{ overflowWrap: 'anywhere', whiteSpace: 'pre-line' }}>
          <Text fz="var(--font-size-sm)" c="var(--text-secondary)" lh={1.5} miw={0} truncate>{sourceLine}</Text>
        </Tooltip>
        <Group gap={4} wrap="nowrap" style={{ flexShrink: 0 }}>
          {!active && state.supported && (
            <AppButton
              size="compact-xs"
              leftSection={<Download size={12} />}
              loading={installing}
              onClick={() => void run('install', () => managedToolsApi.install(id))}
            >
              {fillTemplate(t('managedTools.download'), { size: formatMegabytes(state.downloadBytes) })}
            </AppButton>
          )}
          {(busy === 'update' || busy === 'remove') && <Loader size={14} aria-label={t('managedTools.progressLabel')} />}
          <Menu position="bottom-end" withinPortal zIndex={Z_POPOVER}>
            <Menu.Target>
              <TooltipTarget label={t('common.moreActions')} position="bottom">
                <ActionIcon variant="subtle" size={26} aria-label={t('common.moreActions')}>
                  <EllipsisVertical size={14} />
                </ActionIcon>
              </TooltipTarget>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Item leftSection={<ExternalLink size={14} />} onClick={() => { void clipboardApi.openExternalUrl(state.homepage); }}>
                {t('managedTools.homepage')}
              </Menu.Item>
              {active?.source === 'managed' && (
                <Menu.Item leftSection={<RefreshCw size={14} />} onClick={() => void run('update', () => managedToolsApi.checkUpdate(id))}>
                  {t('managedTools.checkUpdate')}
                </Menu.Item>
              )}
              {!active && (
                <Menu.Item leftSection={<RefreshCw size={14} />} onClick={() => void run('custom', () => managedToolsApi.getAll())}>
                  {t('managedTools.lookAgain')}
                </Menu.Item>
              )}
              <Menu.Item leftSection={<FolderSearch size={14} />} onClick={() => setCustomOpen(true)}>
                {t('managedTools.useOther')}
              </Menu.Item>
              {state.managedVersion && (
                <DangerMenuItem leftSection={<Trash size={14} />} onClick={() => void run('remove', () => managedToolsApi.remove(id))}>
                  {t('managedTools.remove')}
                </DangerMenuItem>
              )}
            </Menu.Dropdown>
          </Menu>
        </Group>
      </Group>

      {!state.supported && !active && <StatusLine tone="warning">{t('managedTools.unsupported')}</StatusLine>}
      {state.installError && !installing && <StatusLine tone="error">{t('managedTools.failed')}</StatusLine>}

      {installing && state.progress && (
        <Stack gap={4}>
          <Text fz="xs" c="var(--text-muted)">{t(`managedTools.phase.${state.progress.phase}`)}</Text>
          <Progress size="xs" value={percent(state)} aria-label={t('managedTools.progressLabel')} />
        </Stack>
      )}

      {customOpen && (
        <Stack gap={6}>
          <Text fz="xs" c="var(--text-muted)">{fillTemplate(t('managedTools.custom.hint'), { name: state.name, version: state.minVersion })}</Text>
          <AppTextInput
            value={customPath}
            mono
            tone="body"
            size="sm"
            aria-label={t('managedTools.custom.label')}
            placeholder={t('managedTools.custom.placeholder')}
            onChange={(e) => setCustomPath(e.currentTarget.value)}
          />
          <Group gap={8}>
            <AppButton
              size="compact-xs"
              variant="default"
              loading={busy === 'custom'}
              disabled={!customPath.trim()}
              onClick={() => void run('custom', () => managedToolsApi.setCustom(id, customPath))}
            >
              {t('managedTools.custom.apply')}
            </AppButton>
            <AppButton
              size="compact-xs"
              variant="subtle"
              disabled={busy === 'custom'}
              onClick={() => {
                if (state.customPath) void run('custom', () => managedToolsApi.setCustom(id, null));
                setCustomOpen(false);
              }}
            >
              {t(state.customPath ? 'managedTools.custom.clear' : 'dialog.cancel')}
            </AppButton>
          </Group>
        </Stack>
      )}
    </Stack>
  );
};
