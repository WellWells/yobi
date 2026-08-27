import React from 'react';
import { Group, Kbd } from '@mantine/core';
import { toTokens } from '../../../shared/shortcuts';
import { isMac } from '../utils/keyLabels';

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
  muted?: boolean;
}

export const ShortcutHint: React.FC<ShortcutHintProps> = ({ combo, muted }) => {
  const keys = toTokens(combo, isMac);
  if (keys.length === 0) return null;
  const style = muted ? { ...capStyle, opacity: 0.55 } : capStyle;
  return (
    <Group gap={3} wrap="nowrap" component="span">
      {keys.map((key, index) => (
        <Kbd key={`${key}-${index}`} style={style}>
          {key}
        </Kbd>
      ))}
    </Group>
  );
};
