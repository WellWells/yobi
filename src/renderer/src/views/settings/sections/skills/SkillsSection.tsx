import React, { useState } from 'react';
import { ActionIcon, Badge, Box, Group, Menu, Stack, Text, Tooltip } from '@mantine/core';
import {
  Bot, Download, ExternalLink, FileArchive, Folder, FolderOpen, Link, ListChecks, EllipsisVertical, Pencil, Plus, Puzzle, RefreshCw, Trash, Upload,
} from 'lucide-react';
import { ClaudeIcon, OpenAiIcon } from '../../../../config/brandIcons';
import { AppButton } from '../../../../components/AppButton';
import { EmptyState } from '../../../../components/EmptyState';
import { WebDialog } from '../../../../components/WebDialog';
import { SectionCard, SectionTitle, StatusLine, ToggleSwitch } from '../../components';
import { skillsApi, updateApi } from '../../../../api/electronApi';
import { Z_POPOVER } from '../../../../config/zLayers';
import { TAG_SETS } from '../../hooks/useSettingsNav';
import { useAgentSkills } from '../../hooks/useAgentSkills';
import { SkillImportModal } from './SkillImportModal';
import type { SkillImportStart } from './SkillImportModal';
import { SkillEditorModal } from './SkillEditorModal';
import { TrustedCommandsCard } from './TrustedCommandsCard';
import { BundledSkillsCard } from './BundledSkillsCard';
import type { SkillEditTarget } from './SkillEditorModal';
import { runtimeLabels, skillIssueText } from './skillText';
import type { AgentSkillView } from '../../../../../../shared/agentSkills';
import { fillTemplate } from '../../../../../../shared/fillTemplate';

interface Props {
  t: (key: string) => string;
  showSection: (tags: readonly string[], category: 'skills') => boolean;
  sectionGap: number;
}

/** Official skill catalogs: one click opens the import preview of the whole repository. */
const RECOMMENDED_SOURCES = [
  { labelKey: 'settings.skills.import.anthropic', url: 'https://github.com/anthropics/skills', Icon: ClaudeIcon },
  { labelKey: 'settings.skills.import.openai', url: 'https://github.com/openai/skills', Icon: OpenAiIcon },
] as const;
/** A directory of community skills; it opens in the browser, and a skill's GitHub link pastes into "From a link". */
const SKILLS_DIRECTORY_URL = 'https://skills.sh';

const SkillRow: React.FC<{
  skill: AgentSkillView;
  t: (key: string) => string;
  onToggle: () => void;
  onEdit: () => void;
  onTest: () => void;
  onDelete: () => void;
  onUpdate: () => void;
}> = ({ skill, t, onToggle, onEdit, onTest, onDelete, onUpdate }) => {
  const needs = runtimeLabels(skill.needs);
  return (
    <Group
      justify="space-between"
      align="flex-start"
      wrap="nowrap"
      gap={10}
      p="10px 12px"
      style={{ border: '1px solid var(--mantine-color-default-border)', borderRadius: 'var(--radius-sm)', background: 'var(--bg-secondary)' }}
    >
      <Stack gap={3} miw={0} flex={1}>
        <Group gap={6} wrap="wrap">
          <Text fz="var(--font-size-base)" fw={600} c="var(--text-primary)">{skill.name}</Text>
          {needs.length > 0 && <Badge variant="light" size="sm">{needs.join(' · ')}</Badge>}
          {!skill.modelInvocable && <Badge variant="default" size="sm">{t('settings.skills.onlyNamed')}</Badge>}
          {skill.update && <Badge variant="light" size="sm">{t('settings.skills.update.badge')}</Badge>}
          {skill.version && <Badge variant="default" size="sm">{skill.version}</Badge>}
        </Group>
        <Text fz="var(--font-size-sm)" c="var(--text-muted)" lh={1.5} lineClamp={2}>{skill.description}</Text>
        {skill.source && (
          <Text fz="var(--font-size-xs)" c="var(--text-muted)" truncate>
            {fillTemplate(t('settings.skills.source'), { source: skill.source })}
          </Text>
        )}
        {skill.issues.map((issue) => (
          <StatusLine key={`${issue.code}:${issue.detail ?? ''}`} tone="warning">{skillIssueText(issue, t)}</StatusLine>
        ))}
      </Stack>
      <Group gap={4} wrap="nowrap" style={{ flexShrink: 0 }}>
        <ToggleSwitch checked={skill.enabled} onChange={onToggle} aria-label={skill.name} />
        <Menu position="bottom-end" withinPortal zIndex={Z_POPOVER}>
          <Menu.Target>
            <Tooltip label={t('common.moreActions')} position="bottom">
              <ActionIcon variant="subtle" size={30} aria-label={t('common.moreActions')}>
                <EllipsisVertical size={15} />
              </ActionIcon>
            </Tooltip>
          </Menu.Target>
          <Menu.Dropdown>
            {skill.update && (
              <Menu.Item leftSection={<RefreshCw size={14} />} onClick={onUpdate}>{t('settings.skills.update.open')}</Menu.Item>
            )}
            <Menu.Item leftSection={<Pencil size={14} />} onClick={onEdit}>{t('settings.skills.edit')}</Menu.Item>
            <Menu.Item leftSection={<ListChecks size={14} />} onClick={onTest}>{t('settings.skills.test')}</Menu.Item>
            <Menu.Item leftSection={<FolderOpen size={14} />} onClick={() => { void skillsApi.openFolder(skill.name); }}>
              {t('settings.skills.openFolder')}
            </Menu.Item>
            <Menu.Item leftSection={<Upload size={14} />} onClick={() => { void skillsApi.exportZip(skill.name); }}>
              {t('settings.skills.export')}
            </Menu.Item>
            <Menu.Item leftSection={<Trash size={14} />} c="red" onClick={onDelete}>{t('settings.skills.delete')}</Menu.Item>
          </Menu.Dropdown>
        </Menu>
      </Group>
    </Group>
  );
};

/**
 * Agent Skills: folders of instructions (SKILL.md) and scripts that `/agent` loads when a request
 * fits. The same format Claude, Gemini CLI and Codex read, so skills move between them both ways.
 */
export const SkillsSection: React.FC<Props> = ({ t, showSection, sectionGap }) => {
  const { skills, setEnabled, remove } = useAgentSkills();
  const [importStart, setImportStart] = useState<SkillImportStart | null>(null);
  const [editTarget, setEditTarget] = useState<SkillEditTarget | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const visible = showSection(TAG_SETS.skills, 'skills');
  const bundled = skills?.filter((skill) => skill.bundled) ?? [];
  const personal = skills?.filter((skill) => !skill.bundled);

  const pick = async (load: () => Promise<SkillImportStart | null>): Promise<void> => {
    setPicking(true);
    try {
      const start = await load();
      if (start) setImportStart(start);
    } finally {
      setPicking(false);
    }
  };
  const fromPicker = (kind: 'folder' | 'file') => pick(async () => {
    const result = await skillsApi.pickImport(kind);
    return result ? { kind: 'result', result } : null;
  });
  const fromAgents = () => pick(async () => ({ kind: 'result', result: await skillsApi.inspect({ kind: 'agents' }) }));
  // A recommended catalog and a skill's newer version both open the same preview: nothing installs without it.
  const fromUrl = (url: string) => pick(async () => ({ kind: 'result', result: await skillsApi.inspect({ kind: 'url', url }) }));
  const [checking, setChecking] = useState(false);
  const checkUpdates = async (): Promise<void> => {
    setChecking(true);
    try {
      await skillsApi.checkUpdates();
    } finally {
      setChecking(false);
    }
  };
  const fromGithub = skills?.some((skill) => skill.source.startsWith('https://github.com/')) ?? false;

  return (
    <Box display={visible ? 'block' : 'none'}>
      <BundledSkillsCard
        skills={bundled}
        t={t}
        sectionGap={sectionGap}
        onToggle={(skill) => { void setEnabled(skill.name, !skill.enabled); }}
        onEdit={(skill, test) => setEditTarget({ kind: 'edit', name: skill.name, ...(test ? { test: true } : {}) })}
      />
      <SectionCard style={{ marginBottom: sectionGap }}>
        <SectionTitle
          icon={<Puzzle size={15} />}
          label={t('settings.skills.personal')}
          rightSection={(
            <Group gap={8} wrap="nowrap">
              <Menu position="bottom-end" withinPortal zIndex={Z_POPOVER}>
                <Menu.Target>
                  <AppButton variant="default" size="xs" loading={picking} leftSection={<Download size={13} />}>
                    {t('settings.skills.import')}
                  </AppButton>
                </Menu.Target>
                <Menu.Dropdown>
                  <Menu.Item leftSection={<Folder size={14} />} onClick={() => { void fromPicker('folder'); }}>
                    {t('settings.skills.import.folder')}
                  </Menu.Item>
                  <Menu.Item leftSection={<FileArchive size={14} />} onClick={() => { void fromPicker('file'); }}>
                    {t('settings.skills.import.file')}
                  </Menu.Item>
                  <Menu.Item leftSection={<Link size={14} />} onClick={() => setImportStart({ kind: 'url' })}>
                    {t('settings.skills.import.url')}
                  </Menu.Item>
                  <Menu.Item leftSection={<Bot size={14} />} onClick={() => { void fromAgents(); }}>
                    {t('settings.skills.import.agents')}
                  </Menu.Item>
                  <Menu.Divider />
                  <Menu.Label>{t('settings.skills.import.recommended')}</Menu.Label>
                  {RECOMMENDED_SOURCES.map((source) => (
                    <Menu.Item key={source.url} leftSection={<source.Icon size={14} />} onClick={() => { void fromUrl(source.url); }}>
                      {t(source.labelKey)}
                    </Menu.Item>
                  ))}
                  <Menu.Item leftSection={<ExternalLink size={14} />} onClick={() => { void updateApi.openExternal(SKILLS_DIRECTORY_URL); }}>
                    {t('settings.skills.import.directory')}
                  </Menu.Item>
                </Menu.Dropdown>
              </Menu>
              <AppButton variant="default" size="xs" leftSection={<Plus size={13} />} onClick={() => setEditTarget({ kind: 'new' })}>
                {t('settings.skills.new')}
              </AppButton>
            </Group>
          )}
        />
        <Stack gap={10}>
          <Text fz="var(--font-size-sm)" c="var(--text-muted)" lh={1.6}>{t('settings.skills.hint')}</Text>
          {skills === null && <EmptyState icon={Puzzle} label="" busy />}
          {personal?.length === 0 && (
            <Text fz="var(--font-size-sm)" c="dimmed" fs="italic">{t('settings.skills.empty')}</Text>
          )}
          {personal?.map((skill) => (
            <SkillRow
              key={skill.name}
              skill={skill}
              t={t}
              onToggle={() => { void setEnabled(skill.name, !skill.enabled); }}
              onEdit={() => setEditTarget({ kind: 'edit', name: skill.name })}
              onTest={() => setEditTarget({ kind: 'edit', name: skill.name, test: true })}
              onDelete={() => setConfirmDelete(skill.name)}
              onUpdate={() => { if (skill.update) void fromUrl(skill.update); }}
            />
          ))}
          <Group justify="flex-start" gap={4}>
            <AppButton variant="subtle" size="compact-sm" leftSection={<FolderOpen size={13} />} onClick={() => { void skillsApi.openFolder(); }}>
              {t('settings.skills.openRoot')}
            </AppButton>
            {fromGithub && (
              <AppButton variant="subtle" size="compact-sm" loading={checking} leftSection={<RefreshCw size={13} />} onClick={() => { void checkUpdates(); }}>
                {t('settings.skills.update.check')}
              </AppButton>
            )}
          </Group>
        </Stack>
      </SectionCard>
      <TrustedCommandsCard t={t} sectionGap={sectionGap} />

      <SkillImportModal start={importStart} onClose={() => setImportStart(null)} t={t} />
      <SkillEditorModal target={editTarget} onClose={() => setEditTarget(null)} t={t} />
      <WebDialog
        open={confirmDelete !== null}
        title={t('settings.skills.delete.title')}
        description={fillTemplate(t('settings.skills.delete.detail'), { name: confirmDelete ?? '' })}
        confirmText={t('common.delete')}
        cancelText={t('dialog.cancel')}
        danger
        onConfirm={() => {
          const name = confirmDelete;
          setConfirmDelete(null);
          if (name) void remove(name);
        }}
        onCancel={() => setConfirmDelete(null)}
      />
    </Box>
  );
};
