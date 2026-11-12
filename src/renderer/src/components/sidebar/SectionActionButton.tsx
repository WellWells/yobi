import React from 'react';
import { ActionIcon, Tooltip } from '@mantine/core';
import type { LucideIcon } from 'lucide-react';

interface SectionActionButtonProps {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  /** Something is set through it (a filter is on): drawn in the accent tint until it is cleared. */
  active?: boolean;
}

/**
 * A button on a section heading (the folders' 「＋」, the conversations' filter): unframed and
 * small, so the heading keeps its height. Forwards its ref and props so it can be a `Menu.Target`.
 * Its keys and presses stay its own — the list's keys and the row's drag never see them.
 */
export const SectionActionButton = React.forwardRef<
  HTMLButtonElement,
  SectionActionButtonProps & Omit<React.ComponentPropsWithoutRef<'button'>, keyof SectionActionButtonProps | 'color' | 'style'>
>(({ icon: Icon, label, onClick, active = false, ...rest }, ref) => (
  <Tooltip label={label} position="bottom">
    <ActionIcon
      ref={ref}
      {...rest}
      variant={active ? 'light' : 'subtle'}
      size={24}
      radius="sm"
      c={active ? undefined : 'var(--text-muted)'}
      aria-label={label}
      draggable={false}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ' || e.key.startsWith('Arrow')) e.stopPropagation();
      }}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      <Icon size={14} />
    </ActionIcon>
  </Tooltip>
));

SectionActionButton.displayName = 'SectionActionButton';
