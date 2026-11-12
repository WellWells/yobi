import React, { useEffect, useMemo, useState } from 'react';
import { Group, Stack, Text } from '@mantine/core';
import { Settings } from 'lucide-react';
import { AppButton } from './AppButton';
import { LineSelfRecipientPicker } from './LineSelfRecipientPicker';
import { RecipientNotes } from './RecipientNotes';
import { MultiSelectDropdown } from './MultiSelectDropdown';
import { lineApi, socketBotApi, telegramApi } from '../api/electronApi';
import { SOCKET_BOT_PLATFORMS } from '../../../shared/types';
import { fillTemplate } from '../../../shared/fillTemplate';
import { useI18nStore } from '../store/i18nStore';
import { useAppStore } from '../store/appStore';
import { lineAccountLabel, namedTelegramRecipients, telegramAccountChoiceLabel } from '../utils/botAccountLabel';
import {
  recipientTokens, unlistedRecipientCount, withOtherRecipients, withTypedRecipient,
} from '../utils/recipientChoices';
import type { RecipientOptions } from '../utils/recipientChoices';
import type { BotContact, BotPlatform, FlowVariable, LinePairedUser, TelegramChannel, TelegramPairedUser } from '../../../shared/types';

interface RecipientChoice {
  id: string;
  label: string;
}

function telegramChoice(user: TelegramPairedUser, t: (key: string) => string): RecipientChoice {
  return { id: String(user.userId), label: telegramAccountChoiceLabel(user, t) };
}

function lineChoice(user: LinePairedUser, t: (key: string) => string): RecipientChoice {
  return { id: user.userId, label: lineAccountLabel(user, t) };
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
  emptyHint?: string;
  blankHint?: string;
  error?: string;
  /** The bot step also offers the chat that started the flow and the flow's chat settings. */
  offerStepChoices?: boolean;
  variables?: readonly FlowVariable[];
  onBeforeNavigate?: () => void;
}

/**
 * The recipients of a bot step or a template's chat question, as one searchable list of names:
 * paired people, channels, and the "Other" group (`withOtherRecipients`). There is no field to type
 * an id into — nobody knows a chat's id, and every value the step holds is shown by name.
 */
const PairedRecipientPicker: React.FC<ChatRecipientPickerProps> = ({
  value, onChange, platform = 'auto', label, hint, emptyHint, blankHint, error,
  offerStepChoices, variables, onBeforeNavigate,
}) => {
  const t = useI18nStore((s) => s.t);
  const openSettingsCategory = useAppStore((s) => s.openSettingsCategory);
  const currentView = useAppStore((s) => s.currentView);
  const [telegramUsers, setTelegramUsers] = useState<TelegramPairedUser[]>([]);
  const [telegramChannels, setTelegramChannels] = useState<TelegramChannel[]>([]);
  const [telegramContacts, setTelegramContacts] = useState<BotContact[]>([]);
  /** Paired people on the platforms with string ids (LINE, Discord, Slack). */
  const [stringIdUsers, setStringIdUsers] = useState<Partial<Record<BotPlatform, LinePairedUser[]>>>({});

  /** Every list has answered, so a saved id none of them has is really not found. */
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (currentView !== 'flow') return;
    void Promise.allSettled([
      telegramApi.getSettings().then((s) => {
        setTelegramUsers(s.pairing.pairedUsers);
        setTelegramChannels(s.channels);
        setTelegramContacts(s.contacts);
      }),
      lineApi.getSettings().then((s) => setStringIdUsers((prev) => ({ ...prev, line: s.pairing.pairedUsers }))),
      ...SOCKET_BOT_PLATFORMS.map((socketPlatform) => socketBotApi.getSettings(socketPlatform).then((s) => {
        if (s) setStringIdUsers((prev) => ({ ...prev, [socketPlatform]: s.pairing.pairedUsers }));
      })),
    ]).then(() => setLoaded(true));
  }, [currentView]);

  const goToSettings = (): void => {
    onBeforeNavigate?.();
    openSettingsCategory('bots');
  };

  // `auto` answers on the bot that triggered the flow and otherwise Telegram, so it offers Telegram's chats.
  const isTelegram = platform === 'telegram' || platform === 'auto';
  const pairedUsers: RecipientChoice[] = useMemo(() => (
    isTelegram
      ? telegramUsers.map((user) => telegramChoice(user, t))
      : (stringIdUsers[platform] ?? []).map((user) => lineChoice(user, t))
  ), [isTelegram, platform, stringIdUsers, telegramUsers, t]);
  const channels = useMemo(() => (isTelegram ? telegramChannels : []), [isTelegram, telegramChannels]);

  const tokens = useMemo(() => recipientTokens(value), [value]);
  /** Saved Telegram ids the lists do not offer, named once the startup backfill has asked Telegram. */
  const names = useMemo(() => {
    if (!isTelegram) return undefined;
    return new Map(namedTelegramRecipients(tokens, { contacts: telegramContacts }, t).map((entry) => [entry.id, entry.label]));
  }, [isTelegram, tokens, telegramContacts, t]);
  const hasChoices = pairedUsers.length > 0 || channels.length > 0;
  const lostChannelPicked = channels.some((channel) => !channel.canPost && tokens.includes(String(channel.chatId)));

  const source = useMemo(() => {
    const base: RecipientOptions = [];
    if (pairedUsers.length > 0) {
      base.push({ group: t('flow.recipient.users'), items: pairedUsers.map((user) => ({ value: user.id, label: user.label })) });
    }
    if (channels.length > 0) {
      base.push({
        group: t('flow.recipient.channels'),
        items: channels.map((channel) => {
          const choice = channelChoice(channel);
          if (channel.canPost) return { value: choice.id, label: choice.label };
          // A channel the bot lost stays removable once picked, and cannot be picked anew.
          return {
            value: choice.id,
            label: fillTemplate(t('flow.recipient.channelLostLabel'), { name: choice.label }),
            disabled: !tokens.includes(choice.id),
          };
        }),
      });
    }
    return { base, ctx: { platform, t, offerStepChoices, variables, names, loading: !loaded } };
  }, [pairedUsers, channels, tokens, platform, t, offerStepChoices, variables, names, loaded]);
  const options = useMemo(() => withOtherRecipients(source.base, tokens, source.ctx), [source, tokens]);
  const unlisted = useMemo(() => unlistedRecipientCount(source.base, tokens, source.ctx), [source, tokens]);
  const [search, setSearch] = useState('');

  return (
    <Stack gap={4}>
      <MultiSelectDropdown
        label={label}
        options={withTypedRecipient(options, search, t)}
        value={tokens}
        onChange={(next) => onChange(next.join(','))}
        searchable
        searchValue={search}
        onSearchChange={setSearch}
        nothingFoundMessage={t('flow.recipient.noMatch')}
        placeholder={t('flow.recipient.pick')}
        error={error || undefined}
        size="sm"
      />
      {!hasChoices && loaded && (
        <Group gap="xs" align="center" wrap="nowrap">
          {emptyHint && <Text fz="xs" c="dimmed" fs="italic" style={{ flex: 1 }}>{emptyHint}</Text>}
          <AppButton
            variant="light"
            size="compact-xs"
            leftSection={<Settings size={12} />}
            onClick={goToSettings}
            style={{ flexShrink: 0 }}
          >
            {t('flow.setup.openSettings')}
          </AppButton>
        </Group>
      )}
      {lostChannelPicked && <Text fz="xs" c="var(--mantine-color-warning)">{t('flow.recipient.channelLost')}</Text>}
      <RecipientNotes tokens={tokens} unlisted={unlisted} blankHint={blankHint} hint={hint} />
    </Stack>
  );
};

/**
 * LINE PC sends from the user's own account, so its recipients are any group or friend LINE PC has,
 * not only the paired people: it has its own picker. Two components, so switching the platform
 * remounts rather than changing which hooks run.
 */
export const ChatRecipientPicker: React.FC<ChatRecipientPickerProps> = (props) => (
  props.platform === 'lineSelf'
    ? <LineSelfRecipientPicker {...props} />
    : <PairedRecipientPicker {...props} />
);
