import React from 'react';
import { NavLink, Box } from '@mantine/core';

export { ToggleSwitch } from '../../components/ToggleSwitch';
export { SectionCard } from '../../components/SectionCard';
export { GroupHeader } from '../../components/GroupHeader';
export { SelectDropdown } from '../../components/SelectDropdown';
export { FitSelectDropdown } from './FitSelectDropdown';
export { SettingRow } from '../../components/SettingRow';
export { AppTextInput } from '../../components/AppTextInput';
export { SettingField } from '../../components/SettingField';
export { SettingDivider } from '../../components/SettingDivider';
export { SectionTitle } from '../../components/SectionTitle';
export { VisibilityToggle } from '../../components/VisibilityToggle';
export { StatusLine } from '../../components/StatusLine';

export { AppSegmentedControl as SegmentedControl } from '../../components/AppSegmentedControl';

export const NavItem: React.FC<{
  icon: React.ReactNode;
  label: string;
  active: boolean;
  hasMatch: boolean;
  /** A secret in this category no longer decrypts and has to be re-entered. */
  alert?: boolean;
  /** Something waits there that is not broken (an update, on About): a warning dot, no ring. */
  notice?: boolean;
  /** A tab in the row of tabs (a narrow dialog, as Claude's): its name alone on one line, as wide as it. */
  tab?: boolean;
  onClick: () => void;
}> = ({ icon, label, active, hasMatch, alert = false, notice = false, tab = false, onClick }) => (
  <NavLink
    label={label}
    leftSection={tab ? undefined : icon}
    noWrap={tab}
    active={active}
    onClick={onClick}
    rightSection={hasMatch || alert || notice
      ? (
        <Box
          w={5}
          h={5}
          bg={alert ? 'var(--mantine-color-error)' : notice && !hasMatch ? 'var(--mantine-color-warning)' : 'var(--mantine-color-accent)'}
          style={{ borderRadius: '50%', flexShrink: 0 }}
        />
      )
      : undefined}
    styles={{
      root: {
        borderRadius: 'var(--radius)',
        fontSize: 'var(--font-size-base)',
        color: active ? 'var(--mantine-color-accent)' : 'var(--mantine-color-default-color)',
        background: active ? 'var(--mantine-color-accent-dim)' : undefined,
        boxShadow: alert ? 'inset 0 0 0 1px var(--mantine-color-error)' : undefined,
        ...(tab ? { width: 'auto', flex: '0 0 auto', paddingInline: 12 } : {}),
      },
    }}
  />
);
