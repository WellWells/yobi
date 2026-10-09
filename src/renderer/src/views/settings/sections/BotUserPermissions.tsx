import React, { useMemo, useState } from 'react';
import { Badge, Box, Button, Chip, Group, Menu, Pill, Stack, Text, Tooltip } from '@mantine/core';
import { Plus } from 'lucide-react';
import { WebDialog } from '../../../components/WebDialog';
import { Z_POPOVER } from '../../../config/zLayers';
import { GRANT_LIMIT_KEYS, addGrant, grantChips, grantMenuGroups, removeGrant } from './botPermissionsView';
import type { GrantLimit } from './botPermissionsView';
import type { BotAccessControls } from '../hooks/useBotAccessControls';

interface Props {
  access: BotAccessControls;
  userId: string;
  t: (key: string) => string;
}

const LimitTags: React.FC<{ limits: readonly GrantLimit[]; t: (key: string) => string }> = ({ limits, t }) => (
  <>
    {limits.map((limit) => (
      <Badge key={limit} size="xs" variant="light" color="gray" style={{ flexShrink: 0 }}>
        {t(GRANT_LIMIT_KEYS[limit])}
      </Badge>
    ))}
  </>
);

/**
 * One paired account's extra rights, under its row in the Telegram or LINE paired list: the
 * owner ("me") toggle, a removable chip per grant and a "+ Permission" menu of what is left.
 * The only editor of bot grants; every other page shows them read-only and points here.
 */
export const BotUserPermissions: React.FC<Props> = ({ access, userId, t }) => {
  const [confirmOwner, setConfirmOwner] = useState(false);
  const grants = access.grantsFor(userId);
  const isOwner = access.isOwner(userId);
  const view = useMemo(
    () => ({ platform: access.platform, isOwner, connectors: access.connectors, t }),
    [access.platform, isOwner, access.connectors, t],
  );
  const chips = useMemo(() => grantChips(grants, view), [grants, view]);
  const groups = useMemo(() => grantMenuGroups(grants, view), [grants, view]);

  return (
    <Stack gap={6}>
      <Group gap={6} wrap="wrap" align="center">
        {/* Chip forwards its ref to the hidden checkbox, so the tooltip hangs on a wrapper. */}
        <Tooltip label={t('settings.bot.perm.owner.tooltip')} position="top">
          <Box component="span" style={{ display: 'inline-flex' }}>
            <Chip
              size="xs"
              variant="light"
              checked={isOwner}
              disabled={!access.ownerKnown}
              onChange={(checked) => {
                if (checked) setConfirmOwner(true);
                else access.setOwner(userId, false);
              }}
            >
              {t('settings.bot.perm.owner')}
            </Chip>
          </Box>
        </Tooltip>

        {chips.map((chip) => (
          <Tooltip
            key={chip.grant}
            label={chip.limits.length === 0 ? chip.description : (
              // Text, not tags: a tooltip inverts the colour scheme, and gray tags lose contrast on it.
              <Stack gap={2}>
                <Text inherit>{chip.description}</Text>
                <Text inherit fw={600}>{chip.limits.map((limit) => t(GRANT_LIMIT_KEYS[limit])).join(' · ')}</Text>
              </Stack>
            )}
            position="top"
            multiline
            maw={280}
          >
            <Pill
              size="sm"
              radius="sm"
              withRemoveButton
              onRemove={() => access.setGrants(userId, removeGrant(grants, chip.grant))}
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

        {groups.length > 0 && (
          <Menu position="bottom-start" withinPortal zIndex={Z_POPOVER} shadow="md">
            <Menu.Target>
              <Button variant="subtle" size="compact-xs" leftSection={<Plus size={12} />}>
                {t('settings.bot.perm.add')}
              </Button>
            </Menu.Target>
            <Menu.Dropdown maw={340}>
              {groups.map((group, index) => (
                <React.Fragment key={group.key}>
                  {index > 0 && <Menu.Divider />}
                  <Menu.Label>
                    <Group gap={6} wrap="nowrap">
                      {group.label}
                      <LimitTags limits={group.limits} t={t} />
                    </Group>
                  </Menu.Label>
                  {group.items.map((entry) => {
                    const ownLimits = entry.limits.filter((limit) => !group.limits.includes(limit));
                    return (
                      <Menu.Item
                        key={entry.grant}
                        onClick={() => access.setGrants(userId, addGrant(grants, entry.grant))}
                      >
                        <Group gap={6} wrap="nowrap">
                          <Text fz="var(--font-size-sm)" c="var(--mantine-color-default-color)">{entry.label}</Text>
                          <LimitTags limits={ownLimits} t={t} />
                        </Group>
                        {entry.description && (
                          <Text fz="var(--font-size-xs)" c="var(--text-muted)" lh={1.4}>{entry.description}</Text>
                        )}
                      </Menu.Item>
                    );
                  })}
                </React.Fragment>
              ))}
            </Menu.Dropdown>
          </Menu>
        )}
      </Group>

      {isOwner && (
        <Text fz="var(--font-size-sm)" c="dimmed">{t('settings.bot.perm.owner.summary')}</Text>
      )}
      {!isOwner && chips.length === 0 && (
        <Text fz="var(--font-size-sm)" c="dimmed">{t('settings.bot.perm.none')}</Text>
      )}

      <WebDialog
        open={confirmOwner}
        title={t('settings.bot.perm.owner.confirm.title')}
        description={t('settings.bot.perm.owner.confirm.detail')}
        confirmText={t('settings.bot.perm.owner.confirm.ok')}
        cancelText={t('dialog.cancel')}
        onConfirm={() => {
          setConfirmOwner(false);
          access.setOwner(userId, true);
        }}
        onCancel={() => setConfirmOwner(false)}
      />
    </Stack>
  );
};
