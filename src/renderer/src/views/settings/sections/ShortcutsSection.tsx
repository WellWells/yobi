import React from 'react';
import { Box, Group, Stack, Text } from '@mantine/core';
import { ExternalLink, Keyboard, RotateCcw } from 'lucide-react';
import { SectionCard, SectionTitle, SettingDivider } from '../components';
import { AppButton } from '../../../components/AppButton';
import { ShortcutHint } from '../../../components/ShortcutHint';
import { ShortcutRow } from '../../../components/settings/ShortcutRow';
import type { ShortcutRowProps } from '../../../components/settings/ShortcutRow';
import { TAG_SETS } from '../hooks/useSettingsNav';
import { useShortcutSettings } from '../hooks/useShortcutSettings';
import type { ShortcutId } from '../../../../../shared/shortcuts';
import type { useHotkeyRecorder } from '../hooks/useHotkeyRecorder';
import type { useQuickExportRecorder } from '../hooks/useQuickExportRecorder';

type HotkeyRecorder = ReturnType<typeof useHotkeyRecorder>;
type QuickExportRecorder = ReturnType<typeof useQuickExportRecorder>;
type RowWiring =
  Pick<ShortcutRowProps, 'combos' | 'enabled' | 'message'>
  & Partial<Pick<ShortcutRowProps, 'hint' | 'modified' | 'onToggle' | 'onCommit' | 'onReset'>>;

type LegacySlot = Pick<HotkeyRecorder, 'currentHotkey' | 'status' | 'defaultValue' | 'commitCombo' | 'handleClearHotkey' | 'enabled' | 'setEnabled'>;

interface Props {
  hotkey: HotkeyRecorder;
  quickExport: QuickExportRecorder;
  t: (key: string, fallback?: string) => string;
  showSection: (tags: readonly string[], category: 'shortcuts') => boolean;
  sectionGap: number;
  onOpenFlow: (flowId: string) => void;
}

export const ShortcutsSection: React.FC<Props> = ({
  hotkey, quickExport, t, showSection, sectionGap, onOpenFlow,
}) => {
  const legacyCombos = React.useMemo(() => ({
    'global.ask': hotkey.currentHotkey,
    'global.quickExport': quickExport.currentHotkey,
  }), [hotkey.currentHotkey, quickExport.currentHotkey]);
  const shortcuts = useShortcutSettings(legacyCombos);
  const visible = showSection(TAG_SETS.shortcuts, 'shortcuts') || showSection(TAG_SETS.hotkey, 'shortcuts');

  const legacySlots: Partial<Record<string, LegacySlot>> = {
    'global.ask': hotkey,
    'global.quickExport': quickExport,
  };
  const legacyModified = hotkey.currentHotkey !== hotkey.defaultValue
    || quickExport.currentHotkey !== quickExport.defaultValue;

  const resetEverything = (): void => {
    shortcuts.resetAll();
    void hotkey.handleClearHotkey();
    void quickExport.handleClearHotkey();
  };
  const legacyMessage = (slot: LegacySlot): ShortcutRowProps['message'] => {
    if (slot.status === 'conflict') return { level: 'refuse', text: t('settings.hotkey.conflict') };
    if (slot.status === 'taken') return { level: 'warn', text: t('settings.hotkey.taken') };
    return null;
  };

  const rowProps = (id: ShortcutId, rebindable: boolean): RowWiring => {
    if (!rebindable) {
      return { combos: shortcuts.combosFor(id), enabled: true, message: null };
    }
    const slot = legacySlots[id];
    if (!slot) {
      return {
        combos: shortcuts.combosFor(id),
        enabled: shortcuts.isEnabled(id),
        message: shortcuts.messages[id] ?? null,
        modified: shortcuts.isModified(id),
        onToggle: (next) => shortcuts.toggle(id, next),
        onCommit: (combo) => shortcuts.commit(id, combo),
        onReset: () => shortcuts.resetOne(id),
      };
    }
    return {
      combos: slot.currentHotkey ? [slot.currentHotkey] : [],
      enabled: slot.enabled,
      message: legacyMessage(slot),
      modified: slot.currentHotkey !== slot.defaultValue,
      onToggle: (next) => { void slot.setEnabled(next); },
      onCommit: (combo) => { void slot.commitCombo(combo); },
      onReset: () => { void slot.handleClearHotkey(); },
    };
  };

  return (
    <Box display={visible ? 'block' : 'none'}>
      <Text fz="var(--font-size-sm)" c="dimmed" mb={sectionGap}>
        {t('settings.shortcut.recordHint')}
      </Text>

      {shortcuts.groups.map(([group, defs]) => (
        <SectionCard key={group} style={{ marginBottom: sectionGap }}>
          <SectionTitle icon={<Keyboard size={15} />} label={t(`settings.shortcut.group.${group}`)} />
          <Stack gap={0}>
            {defs.map((def, index) => (
              <React.Fragment key={def.id}>
                {}
                {defs[index - 1]?.rebindable && !def.rebindable && <SettingDivider my={8} />}
                <ShortcutRow
                  def={def}
                  label={t(`settings.shortcut.${def.id}`)}
                  hint={def.hintKey ? t(def.hintKey) : undefined}
                  t={t}
                  onStartRecording={() => shortcuts.clearMessage(def.id as ShortcutId)}
                  {...rowProps(def.id as ShortcutId, def.rebindable)}
                />
              </React.Fragment>
            ))}
          </Stack>
        </SectionCard>
      ))}

      {
}
      <SectionCard style={{ marginBottom: sectionGap }}>
        <SectionTitle icon={<Keyboard size={15} />} label={t('settings.shortcut.group.flowTriggers')} />
        {shortcuts.flowHotkeys.length === 0 ? (
          <Text fz="var(--font-size-sm)" c="dimmed">{t('settings.shortcut.flowTriggers.empty')}</Text>
        ) : (
          <Stack gap={0}>
            {shortcuts.flowHotkeys.map((flow) => (
              <Group key={`${flow.flowId}-${flow.keys}`} gap={8} wrap="nowrap" align="center" py={6}>
                <Text flex={1} fz="var(--font-size-sm)" c={flow.enabled ? undefined : 'dimmed'} truncate>
                  {flow.flowName}
                  {!flow.enabled && (
                    <Text component="span" fz="var(--font-size-xs)" c="dimmed" ml={8}>
                      {t('settings.shortcut.flowTriggers.notRegistered')}
                    </Text>
                  )}
                </Text>
                <ShortcutHint combo={flow.keys} muted />
                <AppButton
                  variant="subtle"
                  size="xs"
                  leftSection={<ExternalLink size={12} />}
                  onClick={() => onOpenFlow(flow.flowId)}
                >
                  {t('settings.shortcut.flowTriggers.open')}
                </AppButton>
              </Group>
            ))}
          </Stack>
        )}
        <Text fz="var(--font-size-sm)" mt={12} c="dimmed">{t('settings.shortcut.flowTriggers.hint')}</Text>
      </SectionCard>

      <Group justify="flex-end" mb={sectionGap}>
        <AppButton
          variant="subtle"
          size="xs"
          leftSection={<RotateCcw size={12} />}
          disabled={!shortcuts.hasChanges && !legacyModified}
          onClick={resetEverything}
        >
          {t('settings.shortcut.resetAll')}
        </AppButton>
      </Group>
    </Box>
  );
};
