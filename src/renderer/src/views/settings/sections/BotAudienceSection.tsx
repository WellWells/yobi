import React, { useCallback, useEffect, useState } from 'react';
import { Badge, Button, Group, Menu, Pill, Stack, Text, Tooltip } from '@mantine/core';
import { Check, Plus, RotateCcw } from 'lucide-react';
import { botApi } from '../../../api/electronApi';
import { Z_POPOVER } from '../../../config/zLayers';
import { useFormatTime } from '../../../hooks/useFormatTime';
import { showAppNotice } from '../../../hooks/useUiNotifications';
import type { BotGroupGrant } from '../../../../../shared/botPermissions';
import type { BotAudienceGroup, BotAudienceSnapshot, BotAudienceUser, BotPlatform } from '../../../../../shared/types';
import type { BotConnectorOption } from './botPermissionsView';
import { addGroupGrant, allowGroupGrants, groupGrantChips, groupGrantMenu, removeGroupGrant, userWhere } from './botAudienceView';

interface Props {
  platform: BotPlatform;
  connectors: readonly BotConnectorOption[];
  /** Changes whenever the platform's snapshot is re-read, so the lists follow it. */
  refreshKey: unknown;
  t: (key: string) => string;
}

const ROW_STYLE = { border: '1px solid var(--mantine-color-default-border)', borderRadius: 'var(--radius-sm)' } as const;

const GroupRow: React.FC<{
  group: BotAudienceGroup;
  connectors: readonly BotConnectorOption[];
  onChange: (grants: BotGroupGrant[] | null) => void;
  t: (key: string) => string;
}> = ({ group, connectors, onChange, t }) => {
  const chips = groupGrantChips(group.grants, connectors, t);
  const menu = groupGrantMenu(group.grants, connectors, t);
  const header = (
    <Group gap={6} wrap="nowrap" justify="space-between">
      <Group gap={6} wrap="nowrap" style={{ minWidth: 0 }}>
        <Text fz="var(--font-size-sm)" c="var(--mantine-color-default-color)" truncate>
          {group.title || `ID ${group.id}`}
        </Text>
        {group.pending && <Badge size="xs" variant="light" color="var(--mantine-color-warning)">{t('settings.bot.group.pending')}</Badge>}
      </Group>
      {group.pending ? (
        <Button variant="light" size="compact-xs" leftSection={<Check size={12} />} onClick={() => onChange(allowGroupGrants())}>
          {t('settings.bot.group.allow')}
        </Button>
      ) : (
        <Tooltip label={t('settings.bot.group.revoke.tooltip')} position="top">
          <Button variant="subtle" size="compact-xs" leftSection={<RotateCcw size={12} />} onClick={() => onChange(null)}>
            {t('settings.bot.group.revoke')}
          </Button>
        </Tooltip>
      )}
    </Group>
  );
  if (group.pending) {
    return (
      <Stack gap={6} p="6px 8px" bg="var(--mantine-color-bg-tertiary)" style={ROW_STYLE}>
        {header}
        <Text fz="var(--font-size-sm)" c="var(--text-muted)">{t('settings.bot.group.pending.desc')}</Text>
      </Stack>
    );
  }
  return (
    <Stack gap={6} p="6px 8px" bg="var(--mantine-color-bg-tertiary)" style={ROW_STYLE}>
      {header}
      <Group gap={6} wrap="wrap" align="center">
        {chips.map((chip) => (
          <Tooltip key={chip.grant} label={chip.description} position="top" multiline maw={280}>
            <Pill
              size="sm"
              radius="sm"
              withRemoveButton
              onRemove={() => onChange(removeGroupGrant(group.grants, chip.grant))}
              removeButtonProps={{
                'aria-label': t('settings.bot.perm.remove').replace('{{name}}', chip.label),
                'aria-hidden': false,
                tabIndex: 0,
              }}
            >
              {chip.label}
            </Pill>
          </Tooltip>
        ))}
        {chips.length === 0 && <Text fz="var(--font-size-sm)" c="dimmed">{t('settings.bot.group.nothing')}</Text>}
        {menu.length > 0 && (
          <Menu position="bottom-start" withinPortal zIndex={Z_POPOVER} shadow="md">
            <Menu.Target>
              <Button variant="subtle" size="compact-xs" leftSection={<Plus size={12} />}>{t('settings.bot.perm.add')}</Button>
            </Menu.Target>
            <Menu.Dropdown maw={340}>
              {menu.map((item) => (
                <Menu.Item key={item.grant} onClick={() => onChange(addGroupGrant(group.grants, item.grant))}>
                  <Text fz="var(--font-size-sm)" c="var(--mantine-color-default-color)">{item.label}</Text>
                  <Text fz="var(--font-size-xs)" c="var(--text-muted)" lh={1.4}>{item.description}</Text>
                </Menu.Item>
              ))}
            </Menu.Dropdown>
          </Menu>
        )}
      </Group>
    </Stack>
  );
};

const UserRow: React.FC<{ user: BotAudienceUser; onBlock: (blocked: boolean) => void; t: (key: string) => string }> = ({ user, onBlock, t }) => {
  const formatTime = useFormatTime();
  const when = user.lastUsedAt ? formatTime(user.lastUsedAt) : '';
  return (
    <Group justify="space-between" align="center" gap={8} p="6px 8px" bg="var(--mantine-color-bg-tertiary)" style={ROW_STYLE} wrap="nowrap">
      <Stack gap={2} style={{ minWidth: 0 }}>
        <Group gap={6} wrap="nowrap">
          <Text fz="var(--font-size-sm)" c="var(--mantine-color-default-color)" truncate>{user.name}</Text>
          {user.blocked && <Badge size="xs" variant="light" color="var(--mantine-color-error)">{t('settings.bot.users.blocked')}</Badge>}
        </Group>
        <Text fz="var(--font-size-sm)" c="dimmed" truncate style={{ fontVariantNumeric: 'tabular-nums' }}>
          {[user.username ? `@${user.username}` : '', userWhere(user, t), when, user.useCount > 0 ? t('settings.bot.users.count').replace('{{count}}', String(user.useCount)) : '']
            .filter(Boolean).join(' · ')}
        </Text>
      </Stack>
      <Button variant="subtle" size="compact-xs" color={user.blocked ? undefined : 'red'} onClick={() => onBlock(!user.blocked)}>
        {t(user.blocked ? 'settings.bot.users.unblock' : 'settings.bot.users.block')}
      </Button>
    </Group>
  );
};

/**
 * A bot's groups — each pending the owner's approval (the bot does nothing there until allowed),
 * or with what it grants everyone in it (paired or not) — and the unpaired
 * people who addressed the bot, with a block switch each. Read from main on open, after every
 * change and whenever the platform's snapshot is re-read.
 */
export const BotAudienceSection: React.FC<Props> = ({ platform, connectors, refreshKey, t }) => {
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

  const groups = audience?.groups ?? [];
  const users = audience?.users ?? [];
  return (
    <Stack gap={10}>
      <Text fz="var(--font-size-sm)" c="dimmed" lh={1.6}>{t('settings.bot.group.hint')}</Text>
      {groups.length === 0
        ? <Text fz="var(--font-size-sm)" c="dimmed">{t('settings.bot.group.none')}</Text>
        : groups.map((group) => (
          <GroupRow key={group.id} group={group} connectors={connectors} onChange={(grants) => { void setGroup(group.id, grants); }} t={t} />
        ))}

      <Text fz="var(--font-size-sm)" fw={600} c="var(--mantine-color-default-color)" mt={6}>{t('settings.bot.users.title')}</Text>
      <Text fz="var(--font-size-sm)" c="dimmed" lh={1.6}>{t('settings.bot.users.hint')}</Text>
      {users.length === 0
        ? <Text fz="var(--font-size-sm)" c="dimmed">{t('settings.bot.users.none')}</Text>
        : users.map((user) => (
          <UserRow key={user.id} user={user} onBlock={(blocked) => { void setBlocked(user.id, blocked); }} t={t} />
        ))}
    </Stack>
  );
};
