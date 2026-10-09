import React, { useMemo } from 'react';
import { Box, Stack, Text } from '@mantine/core';
import { SYSTEM_EVENTS } from '../../../../shared/types';
import type { SystemEvent, TriggerConfig } from '../../../../shared/types';
import { resolveSystemEvent, systemEventSupported } from '../../../../shared/flowSystemEvents';
import { SelectDropdown } from '../../components/SelectDropdown';
import { hostPlatform } from '../../utils/hostPlatform';

interface SystemTriggerFieldsProps {
  value: TriggerConfig;
  patch: (p: Partial<TriggerConfig>) => void;
  t: (k: string) => string;
  cardStyle?: React.CSSProperties;
}

export const SystemTriggerFields: React.FC<SystemTriggerFieldsProps> = ({ value, patch, t, cardStyle }) => {
  const event = resolveSystemEvent(value.systemEvent);
  const supported = systemEventSupported(event, hostPlatform);

  // An event this OS never reports stays listed while it is the saved one, so the warning has a value to explain.
  const options = useMemo(() => SYSTEM_EVENTS
    .filter((e) => e === event || systemEventSupported(e, hostPlatform))
    .map((e) => ({ value: e, label: t(`flow.trigger.system.${e}`) })), [event, t]);

  return (
    <Box p="sm" style={cardStyle}>
      <Stack gap={4}>
        <SelectDropdown
          aria-label={t('flow.trigger.system')}
          options={options}
          value={event}
          onChange={(v) => patch({ systemEvent: v as SystemEvent })}
          size="sm"
          w={240}
        />
        <Text fz="xs" c="dimmed">{t(`flow.trigger.system.${event}.hint`)}</Text>
        {!supported && (
          <Text fz="xs" c="var(--mantine-color-warning)">{t('flow.trigger.system.unsupported')}</Text>
        )}
      </Stack>
    </Box>
  );
};
