import React from 'react';
import { Group, Kbd } from '@mantine/core';
import { toTokens } from '../../../shared/shortcuts';
import { isMac } from '../utils/keyLabels';
import { KBD_SECONDARY } from '../theme/mantineTheme';

interface ShortcutHintProps {
  combo: string;
  muted?: boolean;
}

export const ShortcutHint: React.FC<ShortcutHintProps> = ({ combo, muted }) => {
  const keys = toTokens(combo, isMac);
  if (keys.length === 0) return null;
  return (
    <Group gap={3} wrap="nowrap" component="span">
      {keys.map((key, index) => (
        <Kbd key={`${key}-${index}`} variant={muted ? KBD_SECONDARY : undefined}>
          {key}
        </Kbd>
      ))}
    </Group>
  );
};
