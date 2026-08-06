import React from 'react';
import { Box } from '@mantine/core';
import { ByokKeysCard } from './ByokKeysCard';
import { ByokGroupsCard } from './ByokGroupsCard';
import { TAG_SETS } from '../hooks/useSettingsNav';
import type { useByokSettings } from '../hooks/useByokSettings';
import type { useByokGroups } from '../hooks/useByokGroups';

type ByokSettings = ReturnType<typeof useByokSettings>;
type ByokGroups = ReturnType<typeof useByokGroups>;

interface Props {
  byok: ByokSettings;
  byokGroups: ByokGroups;
  t: (key: string) => string;
  showSection: (tags: readonly string[], category: 'accounts') => boolean;
  sectionGap: number;
}

export const ByokSection: React.FC<Props> = ({ byok, byokGroups, t, showSection, sectionGap }) => (
  <Box display={showSection(TAG_SETS.byok, 'accounts') ? 'block' : 'none'}>
    <ByokKeysCard byok={byok} t={t} sectionGap={sectionGap} />
    <ByokGroupsCard byokGroups={byokGroups} t={t} sectionGap={sectionGap} />
  </Box>
);
