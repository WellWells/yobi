import React from 'react';
import { ActionIcon, Group, Text, Tooltip } from '@mantine/core';
import { ChevronDown, Search, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { AppButton } from './AppButton';
import { AppTextInput } from './AppTextInput';

export interface PanelToolbarProps {
  children: React.ReactNode;
  px?: string | number;
  py?: string | number;
  gap?: number;
  withBottomBorder?: boolean;
  justify?: React.ComponentProps<typeof Group>['justify'];
}

export const PanelToolbar: React.FC<PanelToolbarProps> = ({
  children,
  px = 10,
  py = 8,
  gap = 8,
  withBottomBorder = true,
  justify = 'space-between',
}) => (
  <Group
    wrap="nowrap"
    gap={gap}
    px={px}
    py={py}
    justify={justify}
    style={{
      borderBottom: withBottomBorder ? '1px solid var(--mantine-color-default-border)' : undefined,
      flexShrink: 0,
    }}
  >
    {children}
  </Group>
);

export interface ToolbarButtonProps extends React.ComponentProps<typeof AppButton> {
  icon: LucideIcon;
  label: string;
  withChevron?: boolean;
}

export const ToolbarButton = React.forwardRef<HTMLButtonElement, ToolbarButtonProps>(({
  icon: Icon, label, withChevron = false, ...props
}, ref) => (
  <AppButton
    ref={ref}
    variant="default"
    size="xs"
    radius="sm"
    flex={1}
    justify="flex-start"
    pl={10}
    leftSection={<Icon size={14} />}
    {...props}
  >
    <Group gap={5} wrap="nowrap" component="span" align="center">
      <Text component="span" fz="var(--font-size-base)">{label}</Text>
      {withChevron && <ChevronDown size={13} />}
    </Group>
  </AppButton>
));

ToolbarButton.displayName = 'ToolbarButton';

export interface ToolbarIconButtonProps {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}

export const ToolbarIconButton: React.FC<ToolbarIconButtonProps> = ({
  icon: Icon, label, onClick, disabled,
}) => (
  <Tooltip label={label} position="bottom">
    <ActionIcon
      variant="subtle"
      size={30}
      radius="sm"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
    >
      <Icon size={15} />
    </ActionIcon>
  </Tooltip>
);

export interface ToolbarSearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  clearLabel: string;
  flex?: React.CSSProperties['flex'];
  miw?: number;
}

export const ToolbarSearchInput = React.forwardRef<HTMLInputElement, ToolbarSearchInputProps>(({
  value, onChange, placeholder, clearLabel, flex = 1, miw,
}, ref) => (
  <AppTextInput
    ref={ref}
    flex={flex}
    miw={miw}
    value={value}
    onChange={(event) => onChange(event.currentTarget.value)}
    placeholder={placeholder}
    tone="tertiary"
    size="xs"
    radius="sm"
    leftSection={<Search size={13} />}
    rightSection={value ? (
      <ActionIcon variant="subtle" size={20} onClick={() => onChange('')} aria-label={clearLabel}>
        <X size={12} />
      </ActionIcon>
    ) : null}
  />
));

ToolbarSearchInput.displayName = 'ToolbarSearchInput';
