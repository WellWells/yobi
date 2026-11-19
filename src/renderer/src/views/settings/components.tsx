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
  /**
   * In a nav with roving focus, whether this is its one Tab stop (the active page, or the first
   * entry while searching; arrows walk the rest). Unset: every entry is a stop (a short list).
   */
  tabbable?: boolean;
  onClick: () => void;
}> = ({ icon, label, active, hasMatch, alert = false, notice = false, tab = false, tabbable = true, onClick }) => (
  // A button, not Mantine's default `<a>` without href, which Tab skips (WCAG 2.1.1).
  <NavLink
    component="button"
    type="button"
    data-nav-item
    tabIndex={tabbable ? 0 : -1}
    aria-current={active ? 'page' : undefined}
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
        // The accent as text, not the raw accent: #0969da on the selected fill was 3.96:1 (WCAG 1.4.3).
        color: active ? 'var(--mantine-color-accent-text)' : 'var(--mantine-color-default-color)',
        background: active ? 'var(--mantine-color-accent-dim)' : undefined,
        boxShadow: alert ? 'inset 0 0 0 1px var(--mantine-color-error)' : undefined,
        ...(tab ? { width: 'auto', flex: '0 0 auto', paddingInline: 12 } : {}),
      },
    }}
  />
);
