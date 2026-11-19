import React from 'react';
import { Box, Group, Menu } from '@mantine/core';

/** The indicator column is Mantine's own check; these rows draw their icon there and the check on the right. */
const HIDE_INDICATOR = { itemIndicator: { display: 'none' } } as const;

interface MenuChoiceItemProps {
  /** `radio`: one of a set (a model); `checkbox`: on or off by itself (Agent, the web, a connector). */
  kind: 'radio' | 'checkbox';
  checked: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  /** Top-aligns the icon with the first line, for rows with a description under the name. */
  iconTop?: boolean;
  rightSection?: React.ReactNode;
  style?: React.CSSProperties;
  closeMenuOnClick?: boolean;
  ref?: React.Ref<HTMLButtonElement>;
  children: React.ReactNode;
}

/**
 * A menu row that is a choice, not a command: `menuitemradio` / `menuitemcheckbox` with
 * `aria-checked`, so a screen reader says which one is on (WCAG 4.1.2; `Menu.Item` is always a plain
 * `menuitem` and its check icon is only drawn). Looks like the composer's other rows: icon, label,
 * check on the right. Clicking always calls `onClick`, even on the row already chosen.
 */
export function MenuChoiceItem({
  kind, checked, onClick, icon, iconTop = false, rightSection, style, closeMenuOnClick, ref, children,
}: MenuChoiceItemProps): React.ReactElement {
  const content = (
    <Group gap="var(--mantine-spacing-xs)" wrap="nowrap" align={iconTop ? 'flex-start' : 'center'}>
      <Box display="flex" mt={iconTop ? 2 : 0} style={{ flexShrink: 0 }}>{icon}</Box>
      <Box flex={1} miw={0}>{children}</Box>
    </Group>
  );
  const shared = {
    ref,
    checked,
    onClick,
    rightSection,
    style,
    styles: HIDE_INDICATOR,
    ...(closeMenuOnClick === undefined ? {} : { closeMenuOnClick }),
  };
  return kind === 'radio'
    ? <Menu.RadioItem {...shared} value="">{content}</Menu.RadioItem>
    : <Menu.CheckboxItem {...shared}>{content}</Menu.CheckboxItem>;
}
