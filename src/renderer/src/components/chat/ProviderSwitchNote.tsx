import React from 'react';
import { Group, Text } from '@mantine/core';
import { Route } from 'lucide-react';
import type { TurnMeta } from '../../../../shared/conversationDoc';
import { providerSwitchNotice, readTurnSwitch } from '../../../../shared/providerFallback';

interface Props {
  meta: TurnMeta;
  t: (key: string) => string;
}

/**
 * Says that another AI answered, and why the chosen one could not: the message went to a
 * different service than the one the user picked, so this is never left to the provider name alone.
 */
export const ProviderSwitchNote: React.FC<Props> = ({ meta, t }) => {
  const sw = readTurnSwitch(meta);
  if (!sw || !meta.p) return null;
  return (
    <Group gap={6} mb={6} wrap="nowrap" align="center" data-provider-switch="">
      <Route size={12} color="var(--text-secondary)" style={{ flexShrink: 0 }} />
      <Text fz="var(--font-size-sm)" c="var(--text-secondary)">
        {providerSwitchNotice(sw, meta.p, t)}
      </Text>
    </Group>
  );
};
