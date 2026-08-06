import React from 'react';
import { UnstyledButton } from '@mantine/core';
import { ChevronDown } from 'lucide-react';
import styles from './ComposerPill.module.css';

export type ComposerPillVariant = 'outline' | 'subtle';

interface ComposerPillProps {
  icon: React.ReactNode;
  label: string;
  open: boolean;
  onClick: () => void;
  disabled?: boolean;
  variant?: ComposerPillVariant;
  accent?: boolean;
  ariaLabel?: string;
}

export const ComposerPill = React.forwardRef<HTMLButtonElement, ComposerPillProps>(({
  icon,
  label,
  open,
  onClick,
  disabled = false,
  variant = 'outline',
  accent = false,
  ariaLabel,
}, ref) => {
  const outlined = variant === 'outline';
  const className = [
    styles.pill,
    outlined ? '' : styles.subtle,
    accent ? styles.accent : '',
  ].filter(Boolean).join(' ');

  return (
    <UnstyledButton
      ref={ref}
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel ?? label}
      className={className}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        border: `1px solid ${accent
          ? 'var(--mantine-color-accent)'
          : outlined ? 'var(--mantine-color-default-border)' : 'transparent'}`,
        background: accent
          ? 'var(--mantine-color-accent-dim)'
          : outlined ? 'var(--mantine-color-default)' : 'transparent',
        color: accent ? 'var(--mantine-color-accent)' : 'var(--mantine-color-text)',
        borderRadius: 999,
        padding: '5px 10px',
        fontSize: 'var(--font-size-base)',
        fontWeight: accent ? 600 : 400,
        cursor: disabled ? 'not-allowed' : 'pointer',
        transition: 'background 0.15s ease, border-color 0.15s ease',
      }}
    >
      {icon}
      {label}
      <ChevronDown
        size={12}
        style={{
          color: accent ? 'var(--mantine-color-accent)' : 'var(--mantine-color-dimmed)',
          marginLeft: 1,
          transform: open ? 'rotate(180deg)' : 'none',
        }}
      />
    </UnstyledButton>
  );
});

ComposerPill.displayName = 'ComposerPill';
