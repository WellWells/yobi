import React, { useMemo, useState } from 'react';
import { Badge, Button, Chip, Group, Menu, Pill, Stack, Text, Tooltip } from '@mantine/core';
import type { MenuProps } from '@mantine/core';
import { Plus, Unlink } from 'lucide-react';
import { AppButton } from '../../../components/AppButton';
import { WebDialog } from '../../../components/WebDialog';
import { Z_POPOVER } from '../../../config/zLayers';
import { GRANT_LIMIT_KEYS, addGrant, defaultGrantMenuGroups, grantChips, grantMenuGroups, removeGrant } from './botPermissionsView';
import type { GrantItem, GrantLimit, GrantMenuGroup } from './botPermissionsView';
import type { BotAccessControls } from '../hooks/useBotAccessControls';
import type { BotGrant } from '../../../../../shared/botPermissions';
import { fillTemplate } from '../../../../../shared/fillTemplate';

interface Props {
  access: BotAccessControls;
  userId: string;
  t: (key: string) => string;
}

/**
 * The grant list is taller than a short window: capped to the room on its side of the button, it scrolls
 * inside. Scrolling the settings page instead carries the button out of view, and the menu hides with it.
 * Only the height is set — Mantine's default `size` apply also widens the max width to the whole window.
 */
export const GRANT_MENU_MIDDLEWARES: NonNullable<MenuProps['middlewares']> = {
  flip: true,
  shift: true,
  size: {
    padding: 12,
    apply: ({ availableHeight, elements }) => {
      elements.floating.style.maxHeight = `${Math.max(availableHeight, 160)}px`;
    },
  },
};

export const GRANT_MENU_DROPDOWN_STYLE: React.CSSProperties = { overflowY: 'auto', overscrollBehavior: 'contain' };

const LimitTags: React.FC<{ limits: readonly GrantLimit[]; t: (key: string) => string }> = ({ limits, t }) => (
  <>
    {limits.map((limit) => (
      <Badge key={limit} size="xs" variant="light" color="gray" style={{ flexShrink: 0 }}>
        {t(GRANT_LIMIT_KEYS[limit])}
      </Badge>
    ))}
  </>
);

interface EditorProps {
  grants: BotGrant[];
  chips: GrantItem[];
  groups: GrantMenuGroup[];
  onChange: (next: BotGrant[]) => void;
  /** Shown first in the row, before the chips. */
  leading?: React.ReactNode;
  t: (key: string) => string;
}

/** A removable chip per grant and a "+ Permission" menu of what is left. */
const BotGrantEditor: React.FC<EditorProps> = ({ grants, chips, groups, onChange, leading, t }) => (
  <Group gap={6} wrap="wrap" align="center">
    {leading}

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
          onRemove={() => onChange(removeGrant(grants, chip.grant))}
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

    {groups.length > 0 && (
      <Menu position="bottom-start" withinPortal zIndex={Z_POPOVER} shadow="md" middlewares={GRANT_MENU_MIDDLEWARES}>
        <Menu.Target>
          <Button variant="subtle" size="compact-xs" leftSection={<Plus size={12} />}>
            {t('settings.bot.perm.add')}
          </Button>
        </Menu.Target>
        <Menu.Dropdown maw={340} style={GRANT_MENU_DROPDOWN_STYLE}>
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
                  <Menu.Item key={entry.grant} onClick={() => onChange(addGrant(grants, entry.grant))}>
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
);

/** Top right of a paired account's row in both platforms' lists; the caller confirms before unpairing. */
export const UnpairButton: React.FC<{ label: string; onClick: () => void }> = ({ label, onClick }) => (
  <AppButton
    variant="subtle"
    color="gray"
    size="compact-xs"
    leftSection={<Unlink size={12} />}
    onClick={onClick}
    style={{ flexShrink: 0 }}
  >
    {label}
  </AppButton>
);

/**
 * The owner ("me") mark is a switch, not a grant: outlined "Mark as me" while off and filled with a
 * check once on, so it never reads like the grey removable grant chips beside it.
 */
export function ownerToggleLook(isOwner: boolean): { variant: 'light' | 'outline'; labelKey: string } {
  return isOwner
    ? { variant: 'light', labelKey: 'settings.bot.perm.owner' }
    : { variant: 'outline', labelKey: 'settings.bot.perm.owner.set' };
}

/**
 * One paired account's extra rights, under its row in the Telegram or LINE paired list: the
 * owner ("me") toggle and the grant editor. The only editor of an account's grants; every other
 * page shows them read-only and points here.
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
  const ownerLook = ownerToggleLook(isOwner);

  return (
    <Stack gap={6}>
      <BotGrantEditor
        grants={grants}
        chips={chips}
        groups={groups}
        onChange={(next) => access.setGrants(userId, next)}
        t={t}
        leading={(
          <Chip
            size="xs"
            variant={ownerLook.variant}
            checked={isOwner}
            disabled={!access.ownerKnown}
            onChange={(checked) => {
              if (checked) setConfirmOwner(true);
              else access.setOwner(userId, false);
            }}
          >
            {t(ownerLook.labelKey)}
          </Chip>
        )}
      />

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

/**
 * What a platform's accounts are given the moment they pair with a code, above the paired list.
 * Shell and admin are never offered; accounts already paired keep their own grants.
 */
export const BotDefaultGrants: React.FC<{ access: BotAccessControls; t: (key: string) => string }> = ({ access, t }) => {
  const grants = access.defaultGrants;
  const view = useMemo(
    () => ({ platform: access.platform, isOwner: false, connectors: access.connectors, t }),
    [access.platform, access.connectors, t],
  );
  const chips = useMemo(() => grantChips(grants, view), [grants, view]);
  const groups = useMemo(() => defaultGrantMenuGroups(grants, view), [grants, view]);

  return (
    <Stack gap={6}>
      <Stack gap={2}>
        <Text fz="var(--font-size-sm)" fw={600} c="var(--mantine-color-default-color)">
          {t('settings.bot.perm.defaults.title')}
        </Text>
        <Text fz="var(--font-size-sm)" c="dimmed" lh={1.6}>
          {t('settings.bot.perm.defaults.hint')}
        </Text>
      </Stack>
      <BotGrantEditor grants={grants} chips={chips} groups={groups} onChange={access.setDefaultGrants} t={t} />
      {chips.length === 0 && (
        <Text fz="var(--font-size-sm)" c="dimmed">{t('settings.bot.perm.defaults.none')}</Text>
      )}
    </Stack>
  );
};
