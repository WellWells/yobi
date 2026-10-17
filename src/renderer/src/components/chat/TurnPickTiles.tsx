import React, { useState } from 'react';
import { Box, Group, Image, Text, UnstyledButton } from '@mantine/core';
import type { TurnButton } from '../../../../shared/conversationDoc';
import { turnMediaUrl } from '../../../../shared/turnMedia';
import styles from './TurnPickTiles.module.css';

/**
 * A menu's items drawn as their pictures (a person's stories): each picture is its button, with
 * the button's label — number, photo or video and length — over its foot. A picture gone from the cache since leaves the tile with its label alone.
 */
export const TurnPickTiles: React.FC<{ buttons: readonly TurnButton[]; onPress: (commandLine: string) => void }> = ({ buttons, onPress }) => {
  const [missing, setMissing] = useState<ReadonlySet<string>>(() => new Set());
  return (
    <Group gap={8} mt={10} align="flex-start" wrap="wrap">
      {buttons.map((button) => (
        <UnstyledButton key={button.i} className={styles.tile} onClick={() => onPress(button.i)}>
          {button.p && !missing.has(button.p) && (
            <Image
              src={turnMediaUrl(button.p)}
              alt=""
              className={styles.picture}
              onError={() => setMissing((prev) => new Set(prev).add(button.p ?? ''))}
            />
          )}
          <Box className={styles.label}>
            <Text inherit lineClamp={2}>{button.l}</Text>
          </Box>
        </UnstyledButton>
      ))}
    </Group>
  );
};
