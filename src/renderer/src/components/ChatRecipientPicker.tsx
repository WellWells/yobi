import React, { useEffect, useMemo, useState } from 'react';
import { Button, Chip, Group, Stack, Text, Tooltip } from '@mantine/core';
import { Settings } from 'lucide-react';
import { AppTextInput } from './AppTextInput';
import { lineApi, telegramApi } from '../api/electronApi';
import { useI18nStore } from '../store/i18nStore';
import { useAppStore } from '../store/appStore';
import type { BotPlatform, LinePairedUser, TelegramChannel, TelegramKnownUser, TelegramPairedUser } from '../../../shared/types';

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

function channelChoice(channel: TelegramChannel): RecipientChoice {
  const name = channel.title || (channel.username ? `@${channel.username}` : String(channel.chatId));
  return { id: String(channel.chatId), label: name };
}

export interface ChatRecipientPickerProps {
  value: string;
  onChange: (value: string) => void;
  platform?: BotPlatform | 'auto';
  label?: string;
  hint?: string;
  placeholder?: string;
  emptyHint?: string;
  blankHint?: string;
  error?: string;
  multiple?: boolean;
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
  const [telegramChannels, setTelegramChannels] = useState<TelegramChannel[]>([]);
  const [telegramKnownUsers, setTelegramKnownUsers] = useState<TelegramKnownUser[]>([]);
  const [lineUsers, setLineUsers] = useState<LinePairedUser[]>([]);

  useEffect(() => {
    if (currentView !== 'flow') return;
    void telegramApi.getSettings().then((s) => {
      setTelegramUsers(s.pairing.pairedUsers);
      setTelegramChannels(s.channels);
      setTelegramKnownUsers(s.knownUsers);
    });
    void lineApi.getSettings().then((s) => setLineUsers(s.pairing.pairedUsers));
  }, [currentView]);

  const goToSettings = (): void => {
    onBeforeNavigate?.();
    setView('settings');
  };

  const isLine = platform === 'line';
  const pairedUsers: RecipientChoice[] = useMemo(() => (
    isLine ? lineUsers.map(lineChoice) : telegramUsers.map(telegramChoice)
  ), [isLine, lineUsers, telegramUsers]);
  const channels = useMemo(() => (isLine ? [] : telegramChannels), [isLine, telegramChannels]);

  const raw = value.trim();
  const knownIdSet = useMemo(
    () => new Set([...pairedUsers.map((u) => u.id), ...channels.map((c) => String(c.chatId))]),
    [pairedUsers, channels],
  );
  const parsedIds = useMemo(
    () => (raw ? raw.split(',').map((s) => s.trim()).filter(Boolean) : []),
    [raw],
  );
  const selectedIds = useMemo(() => parsedIds.filter((id) => knownIdSet.has(id)), [parsedIds, knownIdSet]);
  const unknownIds = useMemo(() => parsedIds.filter((id) => !knownIdSet.has(id)), [parsedIds, knownIdSet]);
  /**
   * A recipient the picker cannot offer as a chip still has a name once the startup backfill has
   * asked Telegram about it — showing it beats leaving the operator staring at a raw id.
   */
  const namedUnknowns = useMemo(() => {
    if (isLine) return [];
    return unknownIds.flatMap((id) => {
      const numeric = Number(id);
      const user = telegramKnownUsers.find((item) => item.userId === numeric);
      if (user) {
        const fullName = [user.firstName, user.lastName].filter(Boolean).join(' ');
        const label = fullName || (user.username ? `@${user.username}` : '');
        return label ? [{ id, label: user.username && fullName ? `${label} (@${user.username})` : label }] : [];
      }
      return [];
    });
  }, [isLine, unknownIds, telegramKnownUsers]);
  const hasChoices = pairedUsers.length > 0 || channels.length > 0;

  const handleMultiple = (next: string[]) => {
    onChange([...new Set([...next, ...unknownIds])].join(','));
  };

  const renderChannelChip = (channel: TelegramChannel) => {
    const choice = channelChoice(channel);
    const isSelected = selectedIds.includes(choice.id);
    const chip = (
      <Chip
        key={choice.id}
        value={choice.id}
        size="xs"
        variant="light"
        color={channel.canPost ? undefined : 'gray'}
        disabled={!channel.canPost && !isSelected}
      >
        {choice.label}
      </Chip>
    );
    if (channel.canPost) return chip;
    return (
      <Tooltip key={choice.id} label={t('flow.recipient.channelLost')} position="top">
        <Group gap={0}>{chip}</Group>
      </Tooltip>
    );
  };

  const chips = (
    <Stack gap={6}>
      {pairedUsers.length > 0 && (
        <Stack gap={4}>
          {channels.length > 0 && <Text fz="xs" c="dimmed">{t('flow.recipient.users')}</Text>}
          <Group gap={4} wrap="wrap">
            {pairedUsers.map((u) => (
              <Chip key={u.id} value={u.id} size="xs" variant="light">{u.label}</Chip>
            ))}
          </Group>
        </Stack>
      )}
      {channels.length > 0 && (
        <Stack gap={4}>
          <Text fz="xs" c="dimmed">{t('flow.recipient.channels')}</Text>
          <Group gap={4} wrap="wrap">
            {channels.map(renderChannelChip)}
          </Group>
        </Stack>
      )}
    </Stack>
  );

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
      {!hasChoices ? (
        <Group gap="xs" align="center" wrap="nowrap">
          {emptyHint && <Text fz="xs" c="dimmed" fs="italic" style={{ flex: 1 }}>{emptyHint}</Text>}
          <Button
            variant="light"
            size="compact-xs"
            leftSection={<Settings size={12} />}
            onClick={goToSettings}
            style={{ flexShrink: 0 }}
          >
            {t('flow.setup.openSettings')}
          </Button>
        </Group>
      ) : multiple ? (
        <Chip.Group multiple value={selectedIds} onChange={handleMultiple}>
          {chips}
        </Chip.Group>
      ) : (
        <Chip.Group value={raw} onChange={(next) => onChange(typeof next === 'string' ? next : '')}>
          {chips}
        </Chip.Group>
      )}
      {namedUnknowns.length > 0 && (
        <Stack gap={2}>
          {namedUnknowns.map((entry) => (
            <Text key={entry.id} fz="xs" c="dimmed">
              {`${entry.id} — ${entry.label}`}
            </Text>
          ))}
        </Stack>
      )}
      {raw.length === 0 && hasChoices && blankHint && (
        <Text fz="xs" c="dimmed" fs="italic">{blankHint}</Text>
      )}
    </Stack>
  );
};
