import React, { useCallback, useEffect, useState } from 'react';
import { Stack } from '@mantine/core';
import { SquarePen, Terminal } from 'lucide-react';
import { AppTextInput, SectionCard, SectionTitle, SelectDropdown, SettingField, SettingRow } from '../components';
import { composerEditorApi } from '../../../api/electronApi';
import { useResolvedCombo } from '../../../store/shortcutStore';
import { comboLabel } from '../../../../../shared/shortcuts';
import { isMac } from '../../../utils/keyLabels';
import { hostPlatform } from '../../../utils/hostPlatform';
import type { ExternalEditorSettings } from '../../../../../shared/types';

interface Props {
  t: (key: string) => string;
  visible: boolean;
  sectionGap: number;
}

const SYSTEM_EDITOR_KEY = hostPlatform === 'win32'
  ? 'settings.editor.system.win'
  : hostPlatform === 'darwin' ? 'settings.editor.system.mac' : 'settings.editor.system.linux';

/** The dropdown's rows: automatic, the system editor, editors found on this machine, a command. */
export function editorOptions(
  settings: ExternalEditorSettings,
  t: (key: string) => string,
): { value: string; label: string }[] {
  const systemLabel = t(SYSTEM_EDITOR_KEY);
  return [
    { value: '', label: t('settings.editor.auto').replace('{{editor}}', settings.autoName ?? systemLabel) },
    { value: 'system', label: systemLabel },
    ...settings.editors.map((editor) => ({ value: editor.id, label: editor.label })),
    { value: 'custom', label: t('settings.editor.custom') },
  ];
}

/**
 * Which program Ctrl+G opens the draft in. Read again whenever the list opens: an editor
 * installed while Yobi runs shows up without a restart, and the change applies to the next press.
 */
export const ExternalEditorSetting: React.FC<Props> = ({ t, visible, sectionGap }) => {
  const [settings, setSettings] = useState<ExternalEditorSettings | null>(null);
  const [command, setCommand] = useState('');
  const shortcut = comboLabel(useResolvedCombo('chat.externalEditor'), isMac);

  const load = useCallback(async (): Promise<void> => {
    const next = await composerEditorApi.getSettings();
    setSettings(next);
    setCommand(next.command);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const save = useCallback(async (choice: string, nextCommand: string): Promise<void> => {
    const next = await composerEditorApi.setSettings({ choice, command: nextCommand });
    setSettings(next);
    setCommand(next.command);
  }, []);

  if (!settings) return null;

  return (
    <SectionCard style={{ marginBottom: sectionGap, display: visible ? 'block' : 'none' }}>
      <SectionTitle icon={<SquarePen size={15} />} label={t('settings.editor.title')} />
      <Stack gap={14}>
        <SettingRow
          icon={<SquarePen size={13} />}
          label={t('settings.editor.label')}
          hint={t('settings.editor.hint').replace('{{shortcut}}', shortcut)}
          control={(
            <SelectDropdown
              value={settings.choice}
              options={editorOptions(settings, t)}
              onDropdownOpen={() => { void load(); }}
              onChange={(choice) => { void save(choice, command); }}
            />
          )}
        />
        {settings.choice === 'custom' && (
          <SettingField
            icon={<Terminal size={13} />}
            label={t('settings.editor.command.label')}
            hint={t('settings.editor.command.hint')}
          >
            <AppTextInput
              value={command}
              mono
              tone="body"
              placeholder={t('settings.editor.command.placeholder')}
              onChange={(event) => setCommand(event.target.value)}
              onBlur={() => { if (command.trim() !== settings.command) void save('custom', command); }}
              onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }}
            />
          </SettingField>
        )}
      </Stack>
    </SectionCard>
  );
};
