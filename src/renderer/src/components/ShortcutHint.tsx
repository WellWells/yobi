import React from 'react';
import { Group, Kbd } from '@mantine/core';
import { isMac } from '../utils/keyLabels';

const MAC_MODIFIER_GLYPH: Record<string, string> = {
  ctrl: '⌘',
  cmd: '⌘',
  command: '⌘',
  meta: '⌘',
  alt: '⌥',
  option: '⌥',
  shift: '⇧',
};

function displayToken(token: string): string {
  if (!isMac) return token;
  return MAC_MODIFIER_GLYPH[token.toLowerCase()] ?? token;
}

const capStyle: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 'var(--font-size-xs)',
  fontWeight: 500,
  lineHeight: 1.4,
  color: 'var(--text-muted)',
  backgroundColor: 'var(--bg-tertiary)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-sm)',
  padding: '1px 5px',
  boxShadow: 'none',
};

interface ShortcutHintProps {
  combo: string;
}

export const ShortcutHint: React.FC<ShortcutHintProps> = ({ combo }) => {
  const keys = combo.split('+').map((key) => key.trim()).filter(Boolean);
  return (
    <Group gap={3} wrap="nowrap" component="span">
      {keys.map((key, index) => (
        <Kbd key={`${key}-${index}`} style={capStyle}>
          {displayToken(key)}
        </Kbd>
      ))}
    </Group>
  );
};
