// src/renderer/src/views/settings/components.tsx
// Re-exports global shared components + settings-specific NavItem.
import React from 'react';
import { NavLink, Box } from '@mantine/core';
import { AppSegmentedControl } from '../../components/AppSegmentedControl';

// ── Global shared components ─────────────────────────────────────────────
export { ToggleSwitch } from '../../components/ToggleSwitch';
export { SectionCard } from '../../components/SectionCard';
export { GroupHeader } from '../../components/GroupHeader';
export { SelectDropdown } from '../../components/SelectDropdown';
export { SettingRow } from '../../components/SettingRow';
export { SectionTitle } from '../../components/SectionTitle';

// ── SegmentedControl ─────────────────────────────────────────────────────
export { AppSegmentedControl as SegmentedControl } from '../../components/AppSegmentedControl';

// ── NavItem ──────────────────────────────────────────────────────────────
// Settings-specific navigation item; kept here as it belongs to the settings nav rail.
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
