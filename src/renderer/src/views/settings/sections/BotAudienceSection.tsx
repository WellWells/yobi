import React, { useCallback, useEffect, useState } from 'react';
import { ActionIcon, Badge, Button, Group, Menu, Pill, Stack, Text, Tooltip } from '@mantine/core';
import { Check, Plus, ShieldOff, Trash } from 'lucide-react';
import { botApi } from '../../../api/electronApi';
import { WebDialog } from '../../../components/WebDialog';
import { Z_POPOVER } from '../../../config/zLayers';
import { useFormatTime } from '../../../hooks/useFormatTime';
import { showAppNotice } from '../../../hooks/useUiNotifications';
import { botGroupsNeedApproval } from '../../../../../shared/botPermissions';
import type { BotGroupGrant } from '../../../../../shared/botPermissions';
import type { BotAudienceSnapshot, BotAudienceUser, BotContact, BotPlatform, TelegramChannel } from '../../../../../shared/types';
import type { BotConnectorOption } from './botPermissionsView';
import { GRANT_MENU_DROPDOWN_STYLE, GRANT_MENU_MIDDLEWARES } from './BotUserPermissions';
import {
  addGroupGrant, allowGroupGrants, chatDetail, chatName, groupGrantChips, groupGrantMenu, joinSentences, mergeBotChats,
  removeGroupGrant, requestId, userWhere,
} from './botAudienceView';
import type { BotChatRow } from './botAudienceView';
import { fillTemplate } from '../../../../../shared/fillTemplate';

interface GroupListProps {
  audience: BotAudienceControls;
  connectors: readonly BotConnectorOption[];
  /** Telegram's flow recipients (channels and groups); merged into the group rows by chat id. */
  channels?: readonly TelegramChannel[];
  contacts?: readonly BotContact[];
  onForgetChannel?: (chatId: number) => void;
  /** Shown above the list (Telegram's "allow in group chats" switch). */
  header?: React.ReactNode;
  t: (key: string) => string;
}

const ROW_STYLE = { border: '1px solid var(--mantine-color-default-border)', borderRadius: 'var(--radius-sm)' } as const;

/**
 * The group list's words. LINE PC's groups wait for nobody (`botGroupsNeedApproval`): there the
 * list is the groups Yobi was used in, and what it grants is for everyone, so nobody has to ask.
 */
function groupCopy(platform: BotPlatform): { hint: string; none: string; nothing: string } {
  return botGroupsNeedApproval(platform)
    ? { hint: 'settings.bot.group.hint', none: 'settings.bot.group.none', nothing: 'settings.bot.group.nothing' }
    : { hint: 'settings.lineSelf.group.hint', none: 'settings.lineSelf.group.none', nothing: 'settings.lineSelf.group.nothing' };
}

const GrantChips: React.FC<{
  grants: BotGroupGrant[];
  connectors: readonly BotConnectorOption[];
  onChange: (grants: BotGroupGrant[]) => void;
  nothing: string;
  t: (key: string) => string;
}> = ({ grants, connectors, onChange, nothing, t }) => {
  const chips = groupGrantChips(grants, connectors, t);
  const menu = groupGrantMenu(grants, connectors, t);
  return (
    <Group gap={6} wrap="wrap" align="center">
      {chips.map((chip) => (
        <Tooltip key={chip.grant} label={chip.description} position="top" multiline maw={280}>
          <Pill
            size="sm"
            radius="sm"
            withRemoveButton
            onRemove={() => onChange(removeGroupGrant(grants, chip.grant))}
            removeButtonProps={{
              'aria-label': fillTemplate(t('settings.bot.perm.remove'), { name: chip.label }),
              'aria-hidden': false,
              tabIndex: 0,
            }}
          >
            {chip.label}
          </Pill>
        </Tooltip>
      ))}
      {chips.length === 0 && <Text fz="var(--font-size-sm)" c="dimmed">{nothing}</Text>}
      {menu.length > 0 && (
        <Menu position="bottom-start" withinPortal zIndex={Z_POPOVER} shadow="md" middlewares={GRANT_MENU_MIDDLEWARES}>
          <Menu.Target>
            <Button variant="subtle" size="compact-xs" leftSection={<Plus size={12} />}>{t('settings.bot.perm.add')}</Button>
          </Menu.Target>
          <Menu.Dropdown maw={340} style={GRANT_MENU_DROPDOWN_STYLE}>
            {menu.map((item) => (
              <Menu.Item key={item.grant} onClick={() => onChange(addGroupGrant(grants, item.grant))}>
                <Text fz="var(--font-size-sm)" c="var(--mantine-color-default-color)">{item.label}</Text>
                <Text fz="var(--font-size-xs)" c="var(--text-muted)" lh={1.4}>{item.description}</Text>
              </Menu.Item>
            ))}
          </Menu.Dropdown>
        </Menu>
      )}
    </Group>
  );
};

/**
 * One channel or group, listed once: name, kind and @username, then — for a group — its
 * approval and what it grants everyone in it, with every action for that chat on the same row.
 */
const ChatRow: React.FC<{
  row: BotChatRow;
  connectors: readonly BotConnectorOption[];
  /** `null` puts the group back to waiting for approval. */
  onChange: (grants: BotGroupGrant[] | null) => void;
  onForget?: () => void;
  /** Whether a group can be put back to waiting (the platform's groups wait for approval). */
  revocable: boolean;
  nothing: string;
  t: (key: string) => string;
}> = ({ row, connectors, onChange, onForget, revocable, nothing, t }) => {
  const { group } = row;
  const detail = chatDetail(row, t);
  const badge = (label: string, color?: string) => (
    <Badge size="xs" variant="light" color={color} style={{ flexShrink: 0 }}>{label}</Badge>
  );
  return (
    <Stack gap={6} p="6px 8px" bg="var(--mantine-color-bg-tertiary)" style={ROW_STYLE}>
      <Group gap={6} wrap="nowrap" justify="space-between">
        <Stack gap={2} style={{ minWidth: 0 }}>
          <Group gap={6} wrap="nowrap" style={{ minWidth: 0 }}>
            <Text fz="var(--font-size-sm)" c="var(--mantine-color-default-color)" truncate>{chatName(row, t)}</Text>
            {row.kind && badge(t(`settings.telegram.channels.kind.${row.kind}`))}
            {group?.pending && badge(t('settings.bot.group.pending'), 'var(--mantine-color-warning)')}
            {row.unreachable && badge(t(`settings.telegram.reach.${row.unreachable}`), 'var(--mantine-color-warning)')}
          </Group>
          {detail && (
            <Text fz="var(--font-size-sm)" c={row.channel && !row.channel.canPost ? 'var(--warning-text)' : 'dimmed'} truncate>
              {detail}
            </Text>
          )}
        </Stack>
        <Group gap={4} wrap="nowrap" style={{ flexShrink: 0 }}>
          {group?.pending && (
            <Button variant="light" size="compact-xs" leftSection={<Check size={12} />} onClick={() => onChange(allowGroupGrants())}>
              {t('settings.bot.group.allow')}
            </Button>
          )}
          {group && !group.pending && revocable && (
            <Tooltip label={t('settings.bot.group.revoke.tooltip')} position="top">
              <Button variant="subtle" size="compact-xs" leftSection={<ShieldOff size={12} />} onClick={() => onChange(null)}>
                {t('settings.bot.group.revoke')}
              </Button>
            </Tooltip>
          )}
          {onForget && (
            <Tooltip label={t('settings.telegram.channels.forget')} position="top">
              <ActionIcon variant="subtle" size={26} onClick={onForget} aria-label={t('settings.telegram.channels.forget')}>
                <Trash size={13} />
              </ActionIcon>
            </Tooltip>
          )}
        </Group>
      </Group>
      {group?.pending && <Text fz="var(--font-size-sm)" c="var(--text-muted)">{t('settings.bot.group.pending.desc')}</Text>}
      {group && !group.pending && <GrantChips grants={group.grants} connectors={connectors} onChange={onChange} nothing={nothing} t={t} />}
    </Stack>
  );
};

const UserRow: React.FC<{
  user: BotAudienceUser;
  onBlock: (blocked: boolean) => void;
  onApprove: () => void;
  t: (key: string) => string;
}> = ({ user, onBlock, onApprove, t }) => {
  const formatTime = useFormatTime();
  const when = user.lastUsedAt ? formatTime(user.lastUsedAt) : '';
  return (
    <Group justify="space-between" align="center" gap={8} p="6px 8px" bg="var(--mantine-color-bg-tertiary)" style={ROW_STYLE} wrap="nowrap">
      <Stack gap={2} style={{ minWidth: 0 }}>
        <Group gap={6} wrap="nowrap">
          <Text fz="var(--font-size-sm)" c="var(--mantine-color-default-color)" truncate>{user.name}</Text>
          {user.blocked && <Badge size="xs" variant="light" color="var(--mantine-color-error)">{t('settings.bot.users.blocked')}</Badge>}
          {user.requested && <Badge size="xs" variant="light" color="var(--mantine-color-warning)">{t('settings.bot.users.requested')}</Badge>}
        </Group>
        <Text fz="var(--font-size-sm)" c="dimmed" truncate style={{ fontVariantNumeric: 'tabular-nums' }}>
          {[user.username ? `@${user.username}` : '', requestId(user), userWhere(user, t), when, user.useCount > 0 ? fillTemplate(t('settings.bot.users.count'), { count: String(user.useCount) }) : '']
            .filter(Boolean).join(' · ')}
        </Text>
      </Stack>
      <Group gap={4} wrap="nowrap">
        {/* Anyone listed may be let in from here, asked or not; a request is the one that stands out. */}
        {!user.blocked && (
          <Button variant={user.requested ? 'light' : 'subtle'} size="compact-xs" leftSection={<Check size={12} />} onClick={onApprove}>
            {t('settings.bot.users.approve')}
          </Button>
        )}
        <Button variant="subtle" size="compact-xs" color={user.blocked ? undefined : 'red'} onClick={() => onBlock(!user.blocked)}>
          {t(user.blocked ? 'settings.bot.users.unblock' : 'settings.bot.users.block')}
        </Button>
      </Group>
    </Group>
  );
};

export interface BotAudienceControls {
  platform: BotPlatform;
  audience: BotAudienceSnapshot | null;
  setGroup: (chatId: string, grants: BotGroupGrant[] | null) => Promise<void>;
  setBlocked: (userId: string, blocked: boolean) => Promise<void>;
  approve: (userId: string) => Promise<void>;
}

/**
 * A bot's groups and the unpaired people who addressed it, read from main on open, after every
 * change and whenever the platform's snapshot is re-read (`refreshKey`). One read feeds both
 * lists, which sit in different parts of the card: the people next to the paired accounts, the
 * groups in their own section.
 */
export function useBotAudience(platform: BotPlatform, refreshKey: unknown, t: (key: string) => string): BotAudienceControls {
  const [audience, setAudience] = useState<BotAudienceSnapshot | null>(null);

  const reload = useCallback(async () => {
    setAudience(await botApi.getAudience(platform).catch(() => ({ groups: [], users: [] })));
  }, [platform]);

  useEffect(() => { void reload(); }, [reload, refreshKey]);

  const fail = (): void => {
    showAppNotice({ level: 'error', title: t('settings.bot.perm.saveFailed'), message: t('settings.bot.group.saveFailed') });
  };

  const setGroup = async (chatId: string, grants: BotGroupGrant[] | null): Promise<void> => {
    const result = await botApi.setGroupPermissions({ platform, chatId, grants }).catch(() => null);
    if (!result?.ok) fail();
    await reload();
  };

  const setBlocked = async (userId: string, blocked: boolean): Promise<void> => {
    const result = await botApi.setBlocked({ platform, userId, blocked }).catch(() => null);
    if (!result?.ok) fail();
    await reload();
  };

  const approve = async (userId: string): Promise<void> => {
    const result = await botApi.approvePairingRequest({ platform, userId }).catch(() => null);
    if (!result?.ok) {
      showAppNotice({ level: 'error', title: t('settings.bot.perm.saveFailed'), message: t('settings.bot.users.approveFailed') });
    }
    await reload();
  };

  return { platform, audience, setGroup, setBlocked, approve };
}

/**
 * A bot's channels and groups, each listed once — a group pending the owner's approval (the bot
 * does nothing there until allowed) or with what it grants everyone in it (paired or not), a
 * Telegram flow recipient removable from the list.
 */
export const BotGroupList: React.FC<GroupListProps> = ({
  audience: { platform, audience, setGroup }, connectors, channels = [], contacts = [], onForgetChannel, header, t,
}) => {
  // Confirmed like the other permanent removals: forgetting a recipient drops it from the
  // directory, and every flow that sends there stops knowing its name.
  const [forgetting, setForgetting] = useState<BotChatRow | null>(null);
  const rows = mergeBotChats(audience?.groups ?? [], channels, contacts);
  const recipients = onForgetChannel !== undefined;
  const copy = groupCopy(platform);
  return (
    <>
      <Stack gap={10}>
        {header}
        <Text fz="var(--font-size-sm)" c="dimmed" lh={1.6}>
          {joinSentences(t(copy.hint), recipients && rows.length > 0 ? t('settings.telegram.channels.hintShort') : '')}
        </Text>
        {rows.length === 0
          ? <Text fz="var(--font-size-sm)" c="dimmed" lh={1.6}>{t(recipients ? 'settings.telegram.channels.howto' : copy.none)}</Text>
          : rows.map((row) => (
            <ChatRow
              key={row.id}
              row={row}
              connectors={connectors}
              onChange={(grants) => { void setGroup(row.id, grants); }}
              onForget={row.channel && onForgetChannel ? () => setForgetting(row) : undefined}
              revocable={botGroupsNeedApproval(platform)}
              nothing={t(copy.nothing)}
              t={t}
            />
          ))}
      </Stack>

      <WebDialog
        open={forgetting !== null}
        title={t('settings.telegram.channels.forget.title')}
        description={forgetting ? chatName(forgetting, t) : ''}
        confirmText={t('settings.telegram.channels.forget')}
        cancelText={t('dialog.cancel')}
        danger
        onConfirm={() => {
          const target = forgetting?.channel;
          setForgetting(null);
          if (target) onForgetChannel?.(target.chatId);
        }}
        onCancel={() => setForgetting(null)}
      />
    </>
  );
};

/**
 * The unpaired people who addressed the bot, each with a block switch and, when they asked to
 * pair, "approve". It sits right under the paired accounts: after the groups,
 * pairing would be split across the card.
 */
export const BotUserList: React.FC<{ audience: BotAudienceControls; t: (key: string) => string }> = ({
  audience: { audience, setBlocked, approve }, t,
}) => {
  const users = audience?.users ?? [];
  return (
    <Stack gap={6}>
      <Text fz="var(--font-size-sm)" fw={600} c="var(--mantine-color-default-color)">{t('settings.bot.users.title')}</Text>
      <Text fz="var(--font-size-sm)" c="dimmed" lh={1.6}>{t('settings.bot.users.hint')}</Text>
      {users.length === 0
        ? <Text fz="var(--font-size-sm)" c="dimmed">{t('settings.bot.users.none')}</Text>
        : users.map((user) => (
          <UserRow
            key={user.id}
            user={user}
            onBlock={(blocked) => { void setBlocked(user.id, blocked); }}
            onApprove={() => { void approve(user.id); }}
            t={t}
          />
        ))}
    </Stack>
  );
};
