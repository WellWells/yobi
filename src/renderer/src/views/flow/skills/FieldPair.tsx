import React from 'react';
import { SimpleGrid } from '@mantine/core';

/** Two short fields side by side once the card itself is this wide; one above the other below it. */
export const FIELD_PAIR_FROM = '640px';

/**
 * Two short fields of a step form (To and Subject, Folder and File name) in one row on a wide
 * card. A container query on the card's own width, so today's 560px column keeps them stacked.
 */
export const FieldPair: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <SimpleGrid type="container" cols={{ base: 1, [FIELD_PAIR_FROM]: 2 }} spacing="xs" verticalSpacing="xs">
    {children}
  </SimpleGrid>
);
