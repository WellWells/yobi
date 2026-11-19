import React from 'react';
import { ActionIcon, Box, Code, Group, Text, Tooltip, UnstyledButton } from '@mantine/core';
import { Bot, Clock, FolderInput, Keyboard, MonitorCog, MousePointerClick, Play, SquareSlash, Square } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { FlowDefinition, TriggerType } from '../../../../shared/types';
import { fillTemplate } from '../../../../shared/fillTemplate';
import { comboLabel } from '../../../../shared/shortcuts';
import { describeSchedule } from '../../../../shared/flowScheduleSummary';
import { isMac } from '../../utils/keyLabels';
import { TemplateIcon } from './TemplateIcon';
import type { FlowTemplate } from './examples';
import type { FlowRowStatus } from './flowRowStatus';
import { runsFromButton, triggerFact } from './flowHomeModel';
import classes from './FlowHome.module.css';

/** How a flow starts, as a glyph on its card (the sidebar row says it in a badge). */
export const TRIGGER_ICON: Record<TriggerType, LucideIcon> = {
  hotkey: Keyboard,
  cron: Clock,
  manual: MousePointerClick,
  bot: Bot,
  chat: SquareSlash,
  system: MonitorCog,
  file: FolderInput,
};

const TONE_COLOR: Record<FlowRowStatus['tone'], string> = {
  error: 'var(--error-text)',
  warning: 'var(--warning-text)',
  dimmed: 'var(--text-muted)',
};

interface FlowCardProps {
  flow: FlowDefinition;
  /** Whether it is working (`flowRowStatus`); none = say how it starts. */
  status: FlowRowStatus | null;
  running: boolean;
  t: (key: string) => string;
  onOpen: () => void;
  onRun: () => void;
  onStop: () => void;
}

/**
 * One of your flows: how it starts, its name, what it does, whether it is working. The card opens
 * it; its ▶ runs it (the sidebar menu's 「執行」), and while it runs the same place stops it. A flow
 * only a bot command can start has no ▶: from here it could only fail.
 */
export const FlowCard: React.FC<FlowCardProps> = ({ flow, status, running, t, onOpen, onRun, onStop }) => {
  const Icon = TRIGGER_ICON[flow.trigger.type] ?? MousePointerClick;
  const name = flow.name || t('flow.flowName');
  const description = flow.description?.trim()
    || fillTemplate(t('flow.home.steps'), { count: String(flow.steps.length) });
  const line = running ? t('flow.home.running') : status?.text ?? triggerFact(flow.trigger, t, isMac);
  const tone = running ? 'dimmed' : status?.tone ?? 'dimmed';
  const runLabel = `${t(running ? 'flow.stopFlow' : 'flow.runFlow')} ${name}`;
  return (
    <Box className={classes.card} data-disabled={!flow.enabled || undefined}>
      {/* Named by its own text (WCAG 2.5.3): a separate aria-label drifted from what is shown. */}
      <UnstyledButton
        className={classes.cardOpen}
        onClick={onOpen}
      >
        <Box className={classes.triggerMark} aria-hidden><Icon size={15} /></Box>
        <Box className={classes.body}>
          <Text fz="sm" fw={600} truncate>{name}</Text>
          <Text fz="xs" c="var(--text-muted)" lineClamp={2} lh={1.45}>{description}</Text>
          <Group gap={6} wrap="nowrap" mt={2}>
            <Text fz="xs" c={TONE_COLOR[tone]} truncate style={{ fontVariantNumeric: 'tabular-nums' }}>
              {line}
            </Text>
            {!flow.enabled && <Text fz="xs" c="var(--text-muted)" style={{ flexShrink: 0 }}>{`· ${t('flow.home.disabled')}`}</Text>}
          </Group>
        </Box>
      </UnstyledButton>
      {(running || runsFromButton(flow)) && (
        <Box className={classes.cardRun} data-running={running || undefined}>
          <Tooltip label={t(running ? 'flow.stopFlow' : 'flow.runFlow')} position="top">
            <ActionIcon variant="subtle" size={28} radius="sm" aria-label={runLabel} onClick={running ? onStop : onRun}>
              {running ? <Square size={13} /> : <Play size={14} />}
            </ActionIcon>
          </Tooltip>
        </Box>
      )}
    </Box>
  );
};

interface TemplateCardProps {
  template: FlowTemplate;
  t: (key: string) => string;
  locale: string;
  onPick: (template: FlowTemplate) => void;
}

/** A featured template for someone with no flows yet: the gallery tile, with its description. */
export const TemplateCard: React.FC<TemplateCardProps> = ({ template, t, locale, onPick }) => {
  const invoked = Boolean(template.command || template.hotkey);
  const trigger = invoked ? null : template.build(t, locale).trigger;
  const schedule = trigger?.type === 'cron' ? describeSchedule(trigger, t) : '';
  return (
    <UnstyledButton
      className={`${classes.card} ${classes.cardOpen}`}
      onClick={() => onPick(template)}
    >
      <TemplateIcon template={template} size={28} />
      <Box className={classes.body}>
        <Text fz="sm" fw={600} truncate>{t(template.titleKey)}</Text>
        <Text fz="xs" c="var(--text-muted)" lineClamp={2} lh={1.45}>{t(template.descKey)}</Text>
        {/* One fact, as on the gallery tile: how you invoke it, when it runs, or what it asks. */}
        <Box mt={2}>
          {invoked ? (
            <Code fz={11} fw={600}>
              {template.command ? `/${template.command}` : comboLabel(template.hotkey ?? '', isMac)}
            </Code>
          ) : schedule ? (
            <Group gap={4} wrap="nowrap" c="var(--text-muted)">
              <Clock size={12} />
              <Text fz="xs" c="var(--text-muted)" truncate>{schedule}</Text>
            </Group>
          ) : (
            <Text fz="xs" c="var(--text-muted)">
              {template.setupCount > 0
                ? fillTemplate(t('flow.templates.setup'), { count: String(template.setupCount) })
                : t('flow.templates.ready')}
            </Text>
          )}
        </Box>
      </Box>
    </UnstyledButton>
  );
};
