import React from 'react';
import { Group, ScrollArea, Stack, Text } from '@mantine/core';
import { Minus, Pencil, Plus } from 'lucide-react';
import type { FlowChangeSummary } from '../../../shared/flowVersions';
import { fillTemplate } from '../../../shared/fillTemplate';

const EDIT_ICON = { added: Plus, removed: Minus, changed: Pencil } as const;

/** The flow-level changes beyond the steps, each with the line that names it. */
const FLAG_KEYS = [
  ['description', 'flow.versions.change.description'],
  ['variables', 'flow.versions.change.variables'],
  ['order', 'flow.versions.change.order'],
] as const;

export interface FlowEditRowsProps {
  edit: FlowChangeSummary;
  t: (key: string) => string;
  /** Taller lists scroll inside this height. */
  maxHeight?: number;
}

/**
 * One line per step a change touches, then the flow-level changes: the agent's confirmation before
 * it saves over a flow, and the flow's version history, read the same.
 */
export const FlowEditRows: React.FC<FlowEditRowsProps> = ({ edit, t, maxHeight = 200 }) => {
  const rows = (['added', 'removed', 'changed'] as const).flatMap((kind) => edit[kind].map((step, index) => ({ kind, step, index })));
  const line = (text: string): React.ReactNode => (
    <Text fz="var(--font-size-sm)" c="var(--text-primary)">{text}</Text>
  );
  return (
    <ScrollArea.Autosize mah={maxHeight}>
      <Stack gap={6}>
        {rows.map(({ kind, step, index }) => {
          const Icon = EDIT_ICON[kind];
          return (
            <Group key={`${kind}-${index}-${step.label}`} gap={8} wrap="nowrap" align="flex-start">
              <Icon size={14} style={{ flexShrink: 0, marginTop: 3 }} color="var(--text-muted)" />
              <Text fz="var(--font-size-sm)" c="var(--text-primary)" style={{ lineHeight: 1.6, wordBreak: 'break-word' }}>
                {fillTemplate(t(`agent.flow.edit.${kind}`), { label: step.label })}
                <Text span fz="var(--font-size-xs)" c="var(--text-muted)">{` · ${t(`flow.skill.${step.type}`)}`}</Text>
              </Text>
            </Group>
          );
        })}
        {edit.renamedFrom && line(fillTemplate(t('agent.flow.edit.renamed'), { from: edit.renamedFrom }))}
        {edit.trigger && line(t('agent.flow.edit.trigger'))}
        {FLAG_KEYS.map(([flag, key]) => (edit[flag] ? <React.Fragment key={flag}>{line(t(key))}</React.Fragment> : null))}
      </Stack>
    </ScrollArea.Autosize>
  );
};
