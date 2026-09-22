import React from 'react';
import { ActionIcon, Box, Group, Stack, Text, Tooltip } from '@mantine/core';
import { RotateCcw } from 'lucide-react';
import { AppButton } from '../AppButton';
import { AppTextInput } from '../AppTextInput';
import { ShortcutHint } from '../ShortcutHint';
import { ToggleSwitch } from '../ToggleSwitch';
import { useComboRecorder } from '../../shortcuts/useComboRecorder';
import type { ShortcutDef } from '../../../../shared/shortcuts';

const CAPSULE_MIN_WIDTH = 132;
const CAPSULE_PAD = 8;
const RESET_WIDTH = 26;
const CONTROL_WIDTH = 38;

export type ShortcutRowLevel = 'warn' | 'refuse';

export interface ShortcutRowProps {
  def: ShortcutDef;
  label: string;
  hint?: string;
  combos: readonly string[];
  enabled: boolean;
  message: { level: ShortcutRowLevel; text: string } | null;
  modified?: boolean;
  t: (key: string, fallback?: string) => string;
  onStartRecording?: () => void;
  onToggle?: (enabled: boolean) => void;
  onCommit?: (combo: string) => void;
  onReset?: () => void;
}

export const ShortcutRow: React.FC<ShortcutRowProps> = ({
  def, label, hint, combos, enabled, message, modified, t,
  onToggle, onCommit, onReset, onStartRecording,
}) => {
  const recorder = useComboRecorder({
    onCommit: (combo) => onCommit?.(combo),
    allowBareKeys: true,
  });

  const [primary, ...aliases] = combos;
  const shown = recorder.rejected
    ? { level: 'refuse' as const, text: t('settings.shortcut.needsModifier') }
    : message;
  const messageOpen = Boolean(shown);
  const resetLabel = t('settings.shortcut.resetRow');

  return (
    <Box>
      <Group gap={8} wrap="nowrap" align="center" py={hint ? 7 : 5}>
        <Stack gap={1} flex={1} style={{ minWidth: 0 }}>
          <Text fz="var(--font-size-sm)" c={enabled ? undefined : 'dimmed'} truncate>
            {label}
          </Text>
          {hint && <Text fz="var(--font-size-xs)" c="dimmed" lh={1.5}>{hint}</Text>}
        </Stack>

        <Box w={RESET_WIDTH} style={{ flexShrink: 0, display: 'flex', justifyContent: 'center' }}>
          {modified && onReset && !recorder.recording && (
            <Tooltip label={resetLabel} position="top" withArrow>
              <ActionIcon variant="subtle" size={22} onClick={onReset} aria-label={resetLabel}>
                <RotateCcw size={12} />
              </ActionIcon>
            </Tooltip>
          )}
        </Box>

        {def.rebindable ? (
          <Box miw={CAPSULE_MIN_WIDTH} style={{ flexShrink: 0 }}>
            {recorder.recording ? (
              <AppTextInput
                readOnly
                autoFocus
                mono
                size="xs"
                tone={recorder.rejected ? 'default' : 'recording'}
                value={recorder.draft}
                placeholder={t('settings.hotkey.recording')}
                onKeyDown={recorder.handleKeyDown}
                onBlur={recorder.stop}
              />
            ) : (
              <AppButton
                variant="subtle"
                size="xs"
                fullWidth
                justify="flex-end"
                disabled={!enabled}
                px={CAPSULE_PAD}
                onClick={() => { onStartRecording?.(); recorder.start(); }}
                aria-label={label}
              >
                {primary ? (
                  <Group gap={6} wrap="nowrap" justify="flex-end">
                    <ShortcutHint combo={primary} muted={!enabled} />
                    {aliases.map((alias) => (
                      <ShortcutHint key={alias} combo={alias} muted />
                    ))}
                  </Group>
                ) : (
                  <Text fz="var(--font-size-xs)" c="dimmed">{t('settings.shortcut.unbound')}</Text>
                )}
              </AppButton>
            )}
          </Box>
        ) : (
          <Tooltip label={t(def.lockReasonKey ?? '')} position="top" withArrow>
            <Group gap={6} wrap="nowrap" miw={CAPSULE_MIN_WIDTH} pr={CAPSULE_PAD} justify="flex-end" style={{ flexShrink: 0 }}>
              {combos.map((combo) => <ShortcutHint key={combo} combo={combo} muted />)}
            </Group>
          </Tooltip>
        )}

        <Box w={CONTROL_WIDTH} style={{ flexShrink: 0, display: 'flex', justifyContent: 'flex-end' }}>
          {def.rebindable && onToggle && (
            <ToggleSwitch
              checked={enabled}
              onChange={(event) => onToggle(event.currentTarget.checked)}
              aria-label={label}
            />
          )}
        </Box>
      </Group>

      <Box
        style={{
          display: 'grid',
          gridTemplateRows: messageOpen ? '1fr' : '0fr',
          transition: 'grid-template-rows 160ms ease',
        }}
      >
        <Box style={{ minHeight: 0, overflow: 'hidden' }}>
          <Text
            fz="var(--font-size-xs)"
            pb={6}
            c={shown?.level === 'refuse' ? 'var(--error)' : 'var(--warning)'}
          >
            {shown?.text ?? ''}
          </Text>
        </Box>
      </Box>
    </Box>
  );
};
