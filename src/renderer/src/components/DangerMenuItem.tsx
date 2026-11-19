import { Menu } from '@mantine/core';
import type { MenuItemProps } from '@mantine/core';
import type { ComponentPropsWithoutRef } from 'react';

type DangerMenuItemProps = Omit<MenuItemProps, 'color' | 'c'>
  & Omit<ComponentPropsWithoutRef<'button'>, keyof MenuItemProps | 'color'>;

/**
 * A destructive menu item (delete, remove, revoke, reset). Mantine paints a shade-less
 * `color="red"` item with palette shade 6 regardless of the theme's variantColorResolver; the
 * `data-danger` rule in globals.css uses `--danger-text` instead, red lifted to 4.5:1 on the
 * menu, a hovered row and the keyboard highlight in every theme.
 */
export function DangerMenuItem(props: DangerMenuItemProps) {
  return <Menu.Item {...props} data-danger />;
}
