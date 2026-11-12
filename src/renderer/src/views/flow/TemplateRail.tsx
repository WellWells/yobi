import React from 'react';
import { Box, Code, Group, Stack, Text, Tooltip, UnstyledButton } from '@mantine/core';
import { GroupHeader } from '../../components/GroupHeader';
import { ScrollChevron } from '../../components/ScrollChevron';
import { useDragScroll, wheelScrollsSideways } from '../../hooks/useDragScroll';
import { useScrollEnds } from '../../hooks/useScrollEnds';
import { isMac } from '../../utils/keyLabels';
import { comboLabel } from '../../../../shared/shortcuts';
import { fillTemplate } from '../../../../shared/fillTemplate';
import { TemplateIcon } from './TemplateIcon';
import type { FlowTemplate } from './examples';
import classes from './FlowTemplatesModal.module.css';

interface TemplateRailProps {
  label: string;
  /** One line on what the whole category does, so a tile can carry nothing but its name. */
  blurb: string;
  templates: FlowTemplate[];
  t: (key: string) => string;
  onPick: (template: FlowTemplate) => void;
}

/**
 * One category of the gallery: its heading, then a sideways rail of tiles. The rail hides its
 * scrollbar, so while it holds more than fits, a pair of chevrons sits at the end of the heading
 * (beside it rather than over the tiles, so neither the first tile nor the edge tile moves when
 * one turns on), each disabled once its end is in view.
 */
export const TemplateRail: React.FC<TemplateRailProps> = ({ label, blurb, templates, t, onPick }) => {
  const { ref, ends, measure, page } = useScrollEnds<HTMLDivElement>();
  const dragScroll = useDragScroll();
  const overflows = ends.back || ends.forward;

  return (
    <Stack gap={10}>
      <Group justify="space-between" align="flex-end" wrap="nowrap" gap="sm">
        <Stack gap={2} miw={0}>
          <GroupHeader variant="plain" label={label} />
          <Text fz="xs" c="var(--text-muted)" lh={1.4}>
            {blurb}
          </Text>
        </Stack>
        {overflows && (
          <Group gap={2} wrap="nowrap">
            <ScrollChevron direction="back" disabled={!ends.back} onClick={() => page(-1)} />
            <ScrollChevron direction="forward" disabled={!ends.forward} onClick={() => page(1)} />
          </Group>
        )}
      </Group>

      <Box ref={ref} className={classes.rail} onScroll={measure} onWheel={wheelScrollsSideways} {...dragScroll}>
        {templates.map((tpl) => (
          // The description lives in the tooltip to keep tiles short; a tooltip is mouse-only,
          // so it also goes into the accessible name below.
          <Tooltip
            key={tpl.key}
            label={t(tpl.descKey)}
            position="bottom"
            maw={280}
            multiline
            events={{ hover: true, focus: true, touch: false }}
          >
            <UnstyledButton
              className={classes.tile}
              aria-label={`${t(tpl.titleKey)} ${t(tpl.descKey)}`}
              onClick={() => { onPick(tpl); }}
            >
              <TemplateIcon template={tpl} size={28} />

              <Text fz="sm" fw={600} className={classes.title}>
                {t(tpl.titleKey)}
              </Text>

              {/* One fact per tile: how you invoke it, or how much it wants from you. */}
              <Box className={classes.meta}>
                {tpl.command || tpl.hotkey ? (
                  <Code fz={11} fw={600}>
                    {tpl.command ? `/${tpl.command}` : comboLabel(tpl.hotkey ?? '', isMac)}
                  </Code>
                ) : (
                  <Text fz={11} c="var(--text-muted)">
                    {tpl.setupCount > 0
                      ? fillTemplate(t('flow.templates.setup'), { count: String(tpl.setupCount) })
                      : t('flow.templates.ready')}
                  </Text>
                )}
              </Box>
            </UnstyledButton>
          </Tooltip>
        ))}
      </Box>
    </Stack>
  );
};
