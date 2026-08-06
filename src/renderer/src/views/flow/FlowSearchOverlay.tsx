import React, { useCallback, useMemo, useState } from 'react';
import { Badge, Group, Stack, Text } from '@mantine/core';
import { useShallow } from 'zustand/react/shallow';
import type { FlowDefinition } from '../../../../shared/types';
import { SearchPalette } from '../../components/SearchPalette';
import { useFlowStore } from '../../store/useFlowStore';
import { useI18nStore } from '../../store/i18nStore';

interface FlowSearchOverlayProps {
  opened: boolean;
  onClose: () => void;
}

export const FlowSearchOverlay: React.FC<FlowSearchOverlayProps> = ({ opened, onClose }) => {
  const { t } = useI18nStore();
  const { flows, selectFlow } = useFlowStore(
    useShallow((s) => ({ flows: s.flows, selectFlow: s.selectFlow })),
  );
  const [query, setQuery] = useState('');

  const visibleFlows = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return flows;
    return flows.filter((flow) =>
      flow.name.toLowerCase().includes(q)
      || (flow.description ?? '').toLowerCase().includes(q)
      || [flow.trigger, ...(flow.extraTriggers ?? [])].some((tr) => (tr?.type ?? '').toLowerCase().includes(q))
      || flow.steps.some((step) => (step.type ?? '').toLowerCase().includes(q) || (step.label ?? '').toLowerCase().includes(q)));
  }, [flows, query]);

  const openFlow = useCallback((flow: FlowDefinition) => {
    onClose();
    selectFlow(flow.id);
  }, [onClose, selectFlow]);

  return (
    <SearchPalette
      opened={opened}
      onClose={onClose}
      query={query}
      onQueryChange={setQuery}
      items={visibleFlows}
      getKey={(flow) => flow.id}
      onSelect={openFlow}
      placeholder={t('flow.search.placeholder')}
      emptyLabel={t('flow.search.empty')}
      renderRow={(flow) => (
        <Stack gap={2}>
          <Text fz="var(--font-size-xs)" fw={500} lineClamp={1} c="var(--mantine-color-text)">
            {flow.name || t('flow.flowName')}
          </Text>
          <Group gap={4}>
            <Badge size="xs" variant="light">{t(`flow.trigger.${flow.trigger.type}`)}</Badge>
            {flow.extraTriggers && flow.extraTriggers.length > 0 && (
              <Badge size="xs" variant="light" color="gray">{`+${flow.extraTriggers.length}`}</Badge>
            )}
            <Text fz="xs" c="dimmed">
              {flow.steps.length} {t('flow.steps').toLowerCase()}
            </Text>
          </Group>
        </Stack>
      )}
    />
  );
};
