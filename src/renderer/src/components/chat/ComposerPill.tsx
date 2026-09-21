import React from 'react';
import { UnstyledButton } from '@mantine/core';
import { ChevronDown } from 'lucide-react';
import styles from './ComposerPill.module.css';

export type ComposerPillVariant = 'outline' | 'subtle';

interface ComposerPillProps extends React.ComponentPropsWithoutRef<typeof UnstyledButton> {
  icon: React.ReactNode;
  label: React.ReactNode;
  open: boolean;
  onClick: () => void;
  disabled?: boolean;
  variant?: ComposerPillVariant;
  accent?: boolean;
  ariaLabel?: string;
  /** Off for a pill that toggles instead of opening a menu. */
  chevron?: boolean;
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
  chevron = true,
  ...rest
}, ref) => {
  const outlined = variant === 'outline';
  const className = [
    styles.pill,
    outlined ? '' : styles.subtle,
    accent ? styles.accent : '',
  ].filter(Boolean).join(' ');

  return (
    <UnstyledButton
      // Mantine's Menu.Target clones aria-haspopup / aria-expanded / id and the `data-expanded`
      // attribute onto its child. Dropping them left the pill unlabelled to a screen reader and
      // made every `[data-expanded]` rule in the CSS module dead.
      {...rest}
      ref={ref}
      onClick={onClick}
      disabled={disabled}
      // What the module's hover rules key on; a disabled pill must not light up under the pointer.
      data-disabled={disabled || undefined}
      aria-label={ariaLabel ?? (typeof label === 'string' ? label : undefined)}
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
        opacity: disabled ? 0.45 : 1,
        transition: 'background 0.15s ease, border-color 0.15s ease',
      }}
    >
      {icon}
      {label}
      {chevron && (
        <ChevronDown
          size={12}
          style={{
            color: accent ? 'var(--mantine-color-accent)' : 'var(--mantine-color-dimmed)',
            marginLeft: 1,
            transform: open ? 'rotate(180deg)' : 'none',
          }}
        />
      )}
    </UnstyledButton>
  );
});

ComposerPill.displayName = 'ComposerPill';
