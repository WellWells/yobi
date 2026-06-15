import React from 'react';
import { NavLink, Box } from '@mantine/core';

export { ToggleSwitch } from '../../components/ToggleSwitch';
export { SectionCard } from '../../components/SectionCard';
export { GroupHeader } from '../../components/GroupHeader';
export { SelectDropdown } from '../../components/SelectDropdown';
export { SettingRow } from '../../components/SettingRow';
export { SettingField } from '../../components/SettingField';
export { SettingDivider } from '../../components/SettingDivider';
export { SectionTitle } from '../../components/SectionTitle';

export { AppSegmentedControl as SegmentedControl } from '../../components/AppSegmentedControl';

export const NavItem: React.FC<{
  icon: React.ReactNode;
  label: string;
  active: boolean;
  hasMatch: boolean;
  onClick: () => void;
}> = ({ icon, label, active, hasMatch, onClick }) => (
  <NavLink
    label={label}
    leftSection={icon}
    active={active}
    onClick={onClick}
    rightSection={hasMatch ? <Box w={5} h={5} bg="var(--mantine-color-accent)" style={{ borderRadius: '50%', flexShrink: 0 }} /> : undefined}
    styles={{
      root: {
        borderRadius: 'var(--radius)',
        fontSize: 'var(--font-size-base)',
        color: active ? 'var(--mantine-color-accent)' : 'var(--mantine-color-default-color)',
        background: active ? 'var(--mantine-color-accent-dim)' : undefined,
      },
    }}
  />
);
