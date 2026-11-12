import React, { useState } from 'react';
import { ActionIcon, Badge, Group, Menu, Stack, Text, Tooltip } from '@mantine/core';
import { EllipsisVertical, ListChecks, Pencil, Puzzle, RefreshCw, RotateCcwClock } from 'lucide-react';
import type { AgentSkillView, BundledSkillChange } from '../../../../../../shared/agentSkills';
import { fillTemplate } from '../../../../../../shared/fillTemplate';
import { skillsApi } from '../../../../api/electronApi';
import { AppButton } from '../../../../components/AppButton';
import { WebDialog } from '../../../../components/WebDialog';
import { Z_POPOVER } from '../../../../config/zLayers';
import { SectionCard, SectionTitle, SettingRow, StatusLine, ToggleSwitch } from '../../components';

interface Props {
  skills: AgentSkillView[];
  t: (key: string) => string;
  sectionGap: number;
  onToggle: (skill: AgentSkillView) => void;
  onEdit: (skill: AgentSkillView, test?: boolean) => void;
}

/** Product-specific GUI copy stays translated; only the agent reads the English skill instructions. */
export function bundledSkillName(skill: AgentSkillView, t: Props['t']): string {
  return skill.bundled ? t(`settings.skills.bundled.${skill.bundled.interfaceId}.name`) : skill.name;
}

export const BundledSkillsCard: React.FC<Props> = ({ skills, t, sectionGap, onToggle, onEdit }) => {
  const [busy, setBusy] = useState<string | null>(null);
  const [pending, setPending] = useState<{ change: BundledSkillChange; title: string; version: string } | null>(null);
  const [error, setError] = useState('');

  const apply = async (change: BundledSkillChange): Promise<void> => {
    setBusy(change.name);
    setError('');
    try {
      const result = await skillsApi.restoreBundled(change);
      if (!result.ok) setError(t('settings.skills.bundled.failed'));
    } catch {
      setError(t('settings.skills.bundled.failed'));
    } finally {
      setBusy(null);
    }
  };

  const request = (skill: AgentSkillView, revision?: string): void => {
    const bundle = skill.bundled;
    if (!bundle) return;
    const change = { name: skill.name, ...(revision ? { revision } : {}) };
    if (!bundle.installed) {
      void apply(change);
      return;
    }
    const version = revision ? bundle.revisions.find((entry) => entry.id === revision)?.version : bundle.availableVersion;
    setPending({ change, title: bundledSkillName(skill, t), version: version || t('settings.skills.bundled.unversioned') });
  };

  if (skills.length === 0) return null;
  return (
    <SectionCard style={{ marginBottom: sectionGap }}>
      <SectionTitle icon={<Puzzle size={15} />} label={t('settings.skills.bundled.title')} />
      <Stack gap={14}>
        <Text fz="var(--font-size-sm)" c="var(--text-muted)" lh={1.6}>{t('settings.skills.bundled.hint')}</Text>
        {skills.map((skill) => {
          const bundle = skill.bundled!;
          const title = bundledSkillName(skill, t);
          return (
            <Stack key={skill.name} gap={6}>
              <SettingRow
                label={title}
                hint={t(`settings.skills.bundled.${bundle.interfaceId}.description`)}
                alignStart
                control={(
                  <Group gap={4} wrap="nowrap">
                    <ToggleSwitch checked={skill.enabled && bundle.installed} disabled={!bundle.installed || busy !== null} onChange={() => onToggle(skill)} aria-label={title} />
                    <Menu position="bottom-end" withinPortal zIndex={Z_POPOVER}>
                      <Menu.Target>
                        <Tooltip label={t('common.moreActions')}>
                          <ActionIcon variant="subtle" size={30} aria-label={`${title} · ${t('common.moreActions')}`} disabled={busy !== null}>
                            <EllipsisVertical size={15} />
                          </ActionIcon>
                        </Tooltip>
                      </Menu.Target>
                      <Menu.Dropdown>
                        <Menu.Item leftSection={<Pencil size={14} />} disabled={!bundle.installed} onClick={() => onEdit(skill)}>{t('settings.skills.edit')}</Menu.Item>
                        <Menu.Item leftSection={<ListChecks size={14} />} disabled={!bundle.installed} onClick={() => onEdit(skill, true)}>{t('settings.skills.test')}</Menu.Item>
                        <Menu.Item leftSection={<RefreshCw size={14} />} onClick={() => request(skill)}>{t('settings.skills.bundled.restore')}</Menu.Item>
                        {bundle.revisions.length > 0 && <Menu.Divider />}
                        {bundle.revisions.length > 0 && <Menu.Label>{t('settings.skills.bundled.history')}</Menu.Label>}
                        {bundle.revisions.map((revision) => (
                          <Menu.Item key={revision.id} leftSection={<RotateCcwClock size={14} />} onClick={() => request(skill, revision.id)}>
                            {fillTemplate(t('settings.skills.bundled.previous'), {
                              version: revision.version || t('settings.skills.bundled.unversioned'),
                              date: new Date(revision.createdAt).toLocaleString(),
                            })}
                          </Menu.Item>
                        ))}
                      </Menu.Dropdown>
                    </Menu>
                  </Group>
                )}
              />
              <Text fz="var(--font-size-sm)" c="var(--text-muted)" lh={1.6}>{t(`settings.skills.bundled.${bundle.interfaceId}.usage`)}</Text>
              <Group gap={6} wrap="wrap">
                <Badge variant="default" size="sm">{fillTemplate(t('settings.skills.bundled.version'), { version: bundle.currentVersion || t('settings.skills.bundled.unversioned') })}</Badge>
                {bundle.updateAvailable && <Badge variant="light" size="sm">{fillTemplate(t('settings.skills.bundled.available'), { version: bundle.availableVersion })}</Badge>}
                {!bundle.installed && (
                  <AppButton variant="default" size="xs" loading={busy === skill.name} disabled={busy !== null && busy !== skill.name} onClick={() => request(skill)}>{t('settings.skills.bundled.restore')}</AppButton>
                )}
                {bundle.installed && bundle.updateAvailable && (
                  <AppButton variant="default" size="xs" loading={busy === skill.name} disabled={busy !== null && busy !== skill.name} onClick={() => request(skill)}>{t('settings.skills.bundled.update')}</AppButton>
                )}
              </Group>
              {!bundle.installed && <StatusLine tone="warning">{t('settings.skills.bundled.missing')}</StatusLine>}
              {bundle.modified && <StatusLine tone="warning">{t('settings.skills.bundled.modified')}</StatusLine>}
            </Stack>
          );
        })}
        {error && <StatusLine tone="error">{error}</StatusLine>}
      </Stack>
      <WebDialog
        open={pending !== null}
        title={t('settings.skills.bundled.confirmTitle')}
        description={fillTemplate(t('settings.skills.bundled.confirmDetail'), { name: pending?.title ?? '', version: pending?.version ?? '' })}
        confirmText={t('settings.skills.bundled.confirm')}
        cancelText={t('dialog.cancel')}
        onConfirm={() => {
          const change = pending?.change;
          setPending(null);
          if (change) void apply(change);
        }}
        onCancel={() => setPending(null)}
      />
    </SectionCard>
  );
};
