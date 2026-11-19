import React, { useState } from 'react';
import { Group, Stack } from '@mantine/core';
import { Check, FolderOpen } from 'lucide-react';
import { AppButton } from '../../../../components/AppButton';
import { AppTextInput } from '../../../../components/AppTextInput';
import { StatusLine } from '../../../../components/StatusLine';
import { knowledgeApi } from '../../../../api/electronApi';
import { KB_NAME_MAX } from '../../../../../../shared/knowledgeBase';
import type { KnowledgeBase } from '../../../../../../shared/knowledgeBase';
import type { KnowledgeSaveError } from '../../../../../../shared/knowledgeStatus';

interface Props {
  /** Absent for a new base. */
  base?: KnowledgeBase;
  onDone: () => void;
  t: (key: string) => string;
}

/** Aliases are typed as one line: commas (half or full width) and the CJK enumeration comma split them. */
function splitAliases(text: string): string[] {
  return text.split(/[,，、]/).map((alias) => alias.trim()).filter(Boolean);
}

/** Add or edit one knowledge base: a name, a folder picked in the system dialog, other names. */
export const KnowledgeBaseForm: React.FC<Props> = ({ base, onDone, t }) => {
  const [name, setName] = useState(base?.name ?? '');
  const [folder, setFolder] = useState(base?.folder ?? '');
  const [aliases, setAliases] = useState(base?.aliases.join(', ') ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<KnowledgeSaveError | null>(null);
  const canSave = name.trim().length > 0 && name.trim().length <= KB_NAME_MAX && folder.length > 0 && !busy;

  const pickFolder = async (): Promise<void> => {
    const picked = await knowledgeApi.pickFolder();
    if (!picked) return;
    setFolder(picked);
    // A new base named after its folder unless the user typed a name first.
    if (!name.trim()) setName(picked.split(/[\\/]/).filter(Boolean).pop()?.slice(0, KB_NAME_MAX) ?? '');
  };

  const save = async (): Promise<void> => {
    if (!canSave) return;
    setBusy(true);
    setError(null);
    const result = await knowledgeApi.save({ ...(base ? { id: base.id } : {}), name: name.trim(), folder, aliases: splitAliases(aliases) });
    setBusy(false);
    if ('error' in result) {
      setError(result.error);
      return;
    }
    onDone();
  };

  const onKeyDown = (event: React.KeyboardEvent): void => {
    // Escape cancels this edit only: taken, the Settings dialog around it stays open.
    if (event.key === 'Escape') {
      event.preventDefault();
      onDone();
    }
    if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void save();
    }
  };

  return (
    <Stack gap={8} mt={6}>
      <AppTextInput
        label={t('settings.knowledge.form.name')}
        value={name}
        maxLength={KB_NAME_MAX}
        autoFocus
        onChange={(event) => setName(event.currentTarget.value)}
        onKeyDown={onKeyDown}
      />
      <Group gap={8} align="flex-end" wrap="nowrap">
        <AppTextInput
          label={t('settings.knowledge.form.folder')}
          value={folder}
          readOnly
          placeholder={t('settings.knowledge.form.folderPlaceholder')}
          style={{ flex: 1, minWidth: 0 }}
          onKeyDown={onKeyDown}
        />
        <AppButton variant="default" size="sm" leftSection={<FolderOpen size={14} />} onClick={() => { void pickFolder(); }}>
          {t('settings.knowledge.form.pick')}
        </AppButton>
      </Group>
      <AppTextInput
        label={t('settings.knowledge.form.aliases')}
        description={t('settings.knowledge.form.aliasesHint')}
        value={aliases}
        onChange={(event) => setAliases(event.currentTarget.value)}
        onKeyDown={onKeyDown}
      />
      {error && <StatusLine tone="warning">{t(`settings.knowledge.error.${error}`)}</StatusLine>}
      <Group justify="flex-end" gap={8}>
        <AppButton variant="default" size="xs" onClick={onDone} disabled={busy}>
          {t('dialog.cancel')}
        </AppButton>
        <AppButton variant="filled" size="xs" leftSection={<Check size={13} />} loading={busy} disabled={!canSave} onClick={() => { void save(); }}>
          {t(base ? 'settings.knowledge.form.save' : 'settings.knowledge.form.add')}
        </AppButton>
      </Group>
    </Stack>
  );
};
