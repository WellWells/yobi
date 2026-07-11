import React, { useEffect, useMemo, useState } from 'react';
import { Button, Chip, Group, Stack, Text } from '@mantine/core';
import { Settings } from 'lucide-react';
import { AppTextInput } from './AppTextInput';
import { lineApi, telegramApi } from '../api/electronApi';
import { useI18nStore } from '../store/i18nStore';
import { useAppStore } from '../store/appStore';
import type { BotPlatform, LinePairedUser, TelegramPairedUser } from '../../../shared/types';

// The one place that turns "who should this message go to?" into a control the
// user can answer without knowing what a chat ID is: the bot's already-paired
// contacts are offered as chips, and clicking one fills the field. Shared by the
// bot step's editor and the flow-variable field of type 'chat' so the two can
// never drift into different pickers.

interface RecipientChoice {
  id: string;
  label: string;
}

function telegramChoice(user: TelegramPairedUser): RecipientChoice {
  const fullName = [user.firstName, user.lastName].filter(Boolean).join(' ');
  if (fullName) {
    return { id: String(user.userId), label: user.username ? `${fullName} (@${user.username})` : fullName };
  }
  return { id: String(user.userId), label: user.username ? `@${user.username}` : String(user.userId) };
}

function lineChoice(user: LinePairedUser): RecipientChoice {
  return { id: user.userId, label: user.displayName || user.userId };
}

export interface ChatRecipientPickerProps {
  /** Comma-separated chat IDs. */
  value: string;
  onChange: (value: string) => void;
  /** Which bot's roster to offer. 'auto' resolves to Telegram (see the bot skill). */
  platform?: BotPlatform | 'auto';
  label?: string;
  hint?: string;
  placeholder?: string;
  /** Shown when the bot has no paired contacts yet. */
  emptyHint?: string;
  /** Shown when the field is left blank and paired contacts exist. */
  blankHint?: string;
  error?: string;
  multiple?: boolean;
  /** Run before navigating to settings — a modal host passes its onClose so the
   *  portaled modal doesn't strand over the Settings view. */
  onBeforeNavigate?: () => void;
}

export const ChatRecipientPicker: React.FC<ChatRecipientPickerProps> = ({
  value, onChange, platform = 'auto', label, hint, placeholder, emptyHint, blankHint, error,
  multiple = true, onBeforeNavigate,
}) => {
  const t = useI18nStore((s) => s.t);
  const setView = useAppStore((s) => s.setView);
  const currentView = useAppStore((s) => s.currentView);
  const [telegramUsers, setTelegramUsers] = useState<TelegramPairedUser[]>([]);
  const [lineUsers, setLineUsers] = useState<LinePairedUser[]>([]);

  // Re-read the roster every time the flow view becomes active, not just on
  // mount: the "Open settings" guidance sends the user off to pair a chat, and
  // the picker stays mounted (views are display-toggled) — without this refresh
  // the newly paired chat would never appear on their return.
  useEffect(() => {
    if (currentView !== 'agentflow') return;
    void telegramApi.getSettings().then((s) => setTelegramUsers(s.pairing.pairedUsers));
    void lineApi.getSettings().then((s) => setLineUsers(s.pairing.pairedUsers));
  }, [currentView]);

  const goToSettings = (): void => {
    onBeforeNavigate?.();
    setView('settings');
  };

  // 'auto' resolves to Telegram whenever the run was not bot-triggered, so the
  // Telegram roster is what an author picking recipients by hand needs to see.
  const pairedUsers: RecipientChoice[] = useMemo(() => (
    platform === 'line' ? lineUsers.map(lineChoice) : telegramUsers.map(telegramChoice)
  ), [platform, lineUsers, telegramUsers]);

  const raw = value.trim();
  const pairedIdSet = useMemo(() => new Set(pairedUsers.map((u) => u.id)), [pairedUsers]);
  const parsedIds = useMemo(
    () => (raw ? raw.split(',').map((s) => s.trim()).filter(Boolean) : []),
    [raw],
  );
  // IDs typed by hand stay in the field even though no chip represents them —
  // dropping them on the next chip click would silently discard the user's input.
  const selectedIds = useMemo(() => parsedIds.filter((id) => pairedIdSet.has(id)), [parsedIds, pairedIdSet]);
  const unpairedIds = useMemo(() => parsedIds.filter((id) => !pairedIdSet.has(id)), [parsedIds, pairedIdSet]);

  const handleMultiple = (next: string[]) => {
    onChange([...new Set([...next, ...unpairedIds])].join(','));
  };

  return (
    <Stack gap={4}>
      {label && <Text fz="sm" fw={500}>{label}</Text>}
      {hint && <Text fz="xs" c="dimmed">{hint}</Text>}
      <AppTextInput
        value={value}
        onChange={(e) => onChange(e.currentTarget.value)}
        placeholder={placeholder}
        error={error || undefined}
        tone="body"
        mono
      />
      {pairedUsers.length === 0 ? (
        // No bot paired a chat yet — the chips would be empty with no way
        // forward, so point the user straight at the settings that fix it.
        <Group gap="xs" align="center" wrap="nowrap">
          {emptyHint && <Text fz="xs" c="dimmed" fs="italic" style={{ flex: 1 }}>{emptyHint}</Text>}
          <Button
            variant="light"
            size="compact-xs"
            leftSection={<Settings size={12} />}
            onClick={goToSettings}
            style={{ flexShrink: 0 }}
          >
            {t('agentflow.setup.openSettings')}
          </Button>
        </Group>
      ) : multiple ? (
        <Chip.Group multiple value={selectedIds} onChange={handleMultiple}>
          <Group gap={4} wrap="wrap">
            {pairedUsers.map((u) => (
              <Chip key={u.id} value={u.id} size="xs" variant="light">{u.label}</Chip>
            ))}
          </Group>
        </Chip.Group>
      ) : (
        <Chip.Group value={raw} onChange={(next) => onChange(typeof next === 'string' ? next : '')}>
          <Group gap={4} wrap="wrap">
            {pairedUsers.map((u) => (
              <Chip key={u.id} value={u.id} size="xs" variant="light">{u.label}</Chip>
            ))}
          </Group>
        </Chip.Group>
      )}
      {raw.length === 0 && pairedUsers.length > 0 && blankHint && (
        <Text fz="xs" c="dimmed" fs="italic">{blankHint}</Text>
      )}
    </Stack>
  );
};
