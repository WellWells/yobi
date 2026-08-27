import React from 'react';
import { Box, List, Text } from '@mantine/core';
import { SHARE_CONSENT_ICONS } from './shareConsentIcons';
import type { ShareConsentKey } from '../../../shared/types';

export interface ShareConsentPoint {
  key: ShareConsentKey;
  text: string;
}

export const ShareConsentPoints: React.FC<{ points: readonly ShareConsentPoint[] }> = ({ points }) => (
  <List spacing={8} size="sm" c="var(--text-secondary)" listStyleType="none" style={{ paddingLeft: 0 }}>
    {points.map((point) => {
      const Icon = SHARE_CONSENT_ICONS[point.key];
      return (
        <List.Item
          key={point.key}
          icon={<Box c="dimmed" style={{ display: 'flex' }}><Icon size={14} /></Box>}
        >
          <Text fz="var(--font-size-sm)" lh={1.65}>{point.text}</Text>
        </List.Item>
      );
    })}
  </List>
);
