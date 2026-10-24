import React from 'react';
import { Box, Group, Stack, Text } from '@mantine/core';
import { ExternalLink, RotateCcw } from 'lucide-react';
import { SectionCard, SectionTitle, SettingDivider } from '../components';
import { AppButton } from '../../../components/AppButton';
import { ShortcutHint } from '../../../components/ShortcutHint';
import { ShortcutRow } from '../../../components/settings/ShortcutRow';
import type { ShortcutRowProps } from '../../../components/settings/ShortcutRow';
import { TAG_SETS } from '../hooks/useSettingsNav';
import { useShortcutSettings } from '../hooks/useShortcutSettings';
import { comboOverlaps } from '../../../../../shared/shortcuts';
import type { ShortcutGroup, ShortcutId } from '../../../../../shared/shortcuts';
import { FLOW_TRIGGERS_ICON, SHORTCUT_GROUP_ICON } from './shortcutGroupIcons';
import { IS_MAC } from '../hooks/useHotkeyRecorder';
import type { HotkeyRecorder } from '../hooks/useHotkeyRecorder';

type RowWiring =
  Pick<ShortcutRowProps, 'combos' | 'message'>
  & Partial<Pick<ShortcutRowProps, 'modified' | 'onCommit' | 'onReset' | 'onStartRecording'>>;

/** Puts each changed OS hotkey back to its default, first clearing any that holds another's default. */
export async function restoreOsHotkeyDefaults(slots: readonly LegacySlot[]): Promise<void> {
  const changed = slots.filter((slot) => slot.modified);
  for (const slot of changed) {
    const blocks = changed.some((other) => other !== slot && comboOverlaps(slot.currentHotkey, other.defaultValue, IS_MAC));
    if (blocks) await slot.commitCombo('');
  }
  for (const slot of changed) await slot.restoreDefault();
}

type LegacySlot = Pick<HotkeyRecorder, 'currentHotkey' | 'defaultValue' | 'modified' | 'message' | 'commitCombo' | 'restoreDefault' | 'clearStatus'>;

interface Props {
  hotkey: HotkeyRecorder;
  quickExport: HotkeyRecorder;
  region: HotkeyRecorder;
  t: (key: string, fallback?: string) => string;
  showSection: (tags: readonly string[], category: 'shortcuts') => boolean;
  sectionGap: number;
  onOpenFlow: (flowId: string) => void;
}

export const ShortcutsSection: React.FC<Props> = ({
  hotkey, quickExport, region, t, showSection, sectionGap, onOpenFlow,
}) => {
  const legacyCombos = React.useMemo(() => ({
    'global.ask': hotkey.currentHotkey,
    'global.quickExport': quickExport.currentHotkey,
    'global.regionAsk': region.currentHotkey,
  }), [hotkey.currentHotkey, quickExport.currentHotkey, region.currentHotkey]);
  const shortcuts = useShortcutSettings(legacyCombos);
  const visible = showSection(TAG_SETS.shortcuts, 'shortcuts') || showSection(TAG_SETS.hotkey, 'shortcuts');

  const legacySlots: Partial<Record<string, LegacySlot>> = {
    'global.ask': hotkey,
    'global.quickExport': quickExport,
    'global.regionAsk': region,
  };
  // "Restore defaults" puts every default back, the OS hotkeys included — which also turns back on
  // any of them that was cleared. Main checks each against the others' current combos, so a slot
  // holding another slot's default is cleared first; otherwise a swapped pair would stay put.
  const resetEverything = async (): Promise<void> => {
    shortcuts.resetAll();
    await restoreOsHotkeyDefaults([hotkey, quickExport, region]);
  };

  const rowProps = (id: ShortcutId, rebindable: boolean): RowWiring => {
    if (!rebindable) {
      return { combos: shortcuts.combosFor(id), message: null };
    }
    const slot = legacySlots[id];
    if (!slot) {
      return {
        combos: shortcuts.combosFor(id),
        message: shortcuts.messages[id] ?? null,
        modified: shortcuts.isModified(id),
        onCommit: (combo) => shortcuts.commit(id, combo),
        onReset: () => shortcuts.resetOne(id),
        onStartRecording: () => shortcuts.clearMessage(id),
      };
    }
    return {
      combos: slot.currentHotkey ? [slot.currentHotkey] : [],
      message: slot.message,
      modified: slot.modified,
      onCommit: (combo) => { void slot.commitCombo(combo); },
      onReset: () => { void slot.restoreDefault(); },
      onStartRecording: slot.clearStatus,
    };
  };

  return (
    <Box display={visible ? 'block' : 'none'}>
      <Text fz="var(--font-size-sm)" c="dimmed" mb={sectionGap}>
        {t('settings.shortcut.recordHint')}
      </Text>

      {shortcuts.groups.map(([group, defs]) => (
        <SectionCard key={group} style={{ marginBottom: sectionGap }}>
          <SectionTitle icon={React.createElement(SHORTCUT_GROUP_ICON[group as ShortcutGroup], { size: 15 })} label={t(`settings.shortcut.group.${group}`)} />
          <Stack gap={0}>
            {defs.map((def, index) => (
              <React.Fragment key={def.id}>
                {defs[index - 1]?.rebindable && !def.rebindable && <SettingDivider my={8} />}
                <ShortcutRow
                  def={def}
                  label={t(`settings.shortcut.${def.id}`)}
                  hint={def.hintKey ? t(def.hintKey) : undefined}
                  t={t}
                  {...rowProps(def.id as ShortcutId, def.rebindable)}
                />
              </React.Fragment>
            ))}
          </Stack>
        </SectionCard>
      ))}

      <SectionCard style={{ marginBottom: sectionGap }}>
        <SectionTitle icon={<FLOW_TRIGGERS_ICON size={15} />} label={t('settings.shortcut.group.flowTriggers')} />
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
            <Text fz="var(--font-size-sm)" mt={12} c="dimmed">{t('settings.shortcut.flowTriggers.hint')}</Text>
          </Stack>
        )}
      </SectionCard>

      <Group justify="flex-end" mb={sectionGap}>
        <AppButton
          variant="subtle"
          size="xs"
          leftSection={<RotateCcw size={12} />}
          disabled={!shortcuts.hasChanges && !hotkey.modified && !quickExport.modified && !region.modified}
          onClick={() => { void resetEverything(); }}
        >
          {t('settings.shortcut.resetAll')}
        </AppButton>
      </Group>
    </Box>
  );
};
