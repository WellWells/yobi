import React from 'react';
import { Group, Stack, Text } from '@mantine/core';
import { FolderOpen } from 'lucide-react';
import { AppButton } from '../../../../components/AppButton';
import { AppTextarea } from '../../../../components/AppTextarea';
import { GroupHeader } from '../../components';
import { skillsApi } from '../../../../api/electronApi';
import { formatByteSize } from '../../../../utils/byteSize';
import { fileOrder } from './skillEditorModel';
import type { SkillOtherFile, SkillTextFiles } from '../../../../../../shared/skillAuthoring';

interface Props {
  files: SkillTextFiles;
  active: string;
  onActive: (rel: string) => void;
  onChange: (rel: string, text: string) => void;
  others: readonly SkillOtherFile[];
  /** The installed skill, for "open folder" beside the files the editor does not hold. */
  installed?: string;
  disabled: boolean;
  t: (key: string) => string;
}

/**
 * The skill's text files, one at a time: the instructions, its JavaScript, its references and its
 * test cases. Anything else in the folder (a Python script, an image) is listed and left alone.
 */
export const SkillFileTabs: React.FC<Props> = ({ files, active, onActive, onChange, others, installed, disabled, t }) => (
  <Stack gap={8}>
    <Group gap={4} wrap="wrap">
      {fileOrder(Object.keys(files)).map((rel) => (
        <AppButton
          key={rel}
          size="compact-xs"
          variant={rel === active ? 'light' : 'subtle'}
          color={rel === active ? 'brand' : 'gray'}
          onClick={() => onActive(rel)}
          ff="var(--font-mono)"
        >
          {rel}
        </AppButton>
      ))}
    </Group>
    <AppTextarea
      mono
      autosize
      minRows={14}
      maxRows={24}
      value={files[active] ?? ''}
      onChange={(event) => onChange(active, event.currentTarget.value)}
      spellCheck={false}
      disabled={disabled}
      aria-label={active}
    />
    {others.length > 0 && (
      <Stack gap={4}>
        <Group justify="space-between" align="center" wrap="nowrap">
          <GroupHeader variant="plain" label={t('settings.skills.others')} />
          {installed && (
            <AppButton variant="subtle" size="compact-xs" leftSection={<FolderOpen size={12} />} onClick={() => { void skillsApi.openFolder(installed); }}>
              {t('settings.skills.openFolder')}
            </AppButton>
          )}
        </Group>
        {others.map((file) => (
          <Text key={file.rel} fz="var(--font-size-xs)" c="var(--text-muted)" truncate>
            <Text span ff="var(--font-mono)" fz="inherit">{file.rel}</Text>
            {` · ${formatByteSize(file.size)}`}
          </Text>
        ))}
      </Stack>
    )}
  </Stack>
);
