import React from 'react';
import { Box, List, Text } from '@mantine/core';
import { SHARE_CONSENT_ICONS } from './shareConsentIcons';
import type { ShareConsentKey } from '../../../shared/types';

export interface ShareConsentPoint {
  key: ShareConsentKey;
  text: string;
}

/*
 * The five points, rendered identically wherever consent is asked for: the chat dialog, the
 * quick-export panel and the share skill's config form. The three differ in how they OBTAIN
 * the text — two call t(), the panel receives strings already localised by main — so the text
 * arrives as a prop and only the presentation lives here. SHARE_CONSENT_KEYS still owns order.
 */
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
