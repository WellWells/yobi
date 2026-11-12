import React from 'react';
import { Box, Group, Loader, Tooltip } from '@mantine/core';
import { TriangleExclamationPoint } from 'lucide-react';
import { fillTemplate } from '../../../../shared/fillTemplate';
import type { FlowDefinition } from '../../../../shared/types';
import { useI18nStore } from '../../store/i18nStore';
import type { FlowAttention } from './flowSidebarRows';

interface FlowAttentionMarkProps extends FlowAttention {
  t: (key: string) => string;
}

/** 「A、B 和 C」, "A, B, and C": the flows' names as the app language lists them. */
function names(flows: readonly FlowDefinition[], t: (key: string) => string, locale: string): string {
  const list = flows.map((flow) => flow.name || t('flow.flowName'));
  try {
    return new Intl.ListFormat(locale, { type: 'conjunction' }).format(list);
  } catch {
    return list.join(', ');
  }
}

/**
 * On a closed folder or section: the flow row's own warning and running marks for the flows it
 * hides, naming them on hover and to a screen reader (a tooltip is mouse-only).
 */
export const FlowAttentionMark: React.FC<FlowAttentionMarkProps> = ({ attention, running, t }) => {
  const locale = useI18nStore((s) => s.locale);
  if (attention.length === 0 && running.length === 0) return null;
  const attentionText = fillTemplate(t('flow.folder.attention'), { names: names(attention, t, locale) });
  const runningText = fillTemplate(t('flow.folder.running'), { names: names(running, t, locale) });
  return (
    <Group gap={6} wrap="nowrap" style={{ flexShrink: 0 }}>
      {running.length > 0 && (
        <Tooltip label={runningText} position="top" maw={280} multiline>
          <Box component="span" role="img" aria-label={runningText} style={{ display: 'inline-flex' }}>
            <Loader size={12} />
          </Box>
        </Tooltip>
      )}
      {attention.length > 0 && (
        <Tooltip label={attentionText} position="top" maw={280} multiline>
          <Box component="span" role="img" aria-label={attentionText} style={{ display: 'inline-flex' }}>
            <TriangleExclamationPoint size={13} color="var(--mantine-color-warning)" />
          </Box>
        </Tooltip>
      )}
    </Group>
  );
};
