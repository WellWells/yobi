import React, { useState } from 'react';
import { Box, Stack, Text, UnstyledButton } from '@mantine/core';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useI18nStore } from '../store/i18nStore';
import type { AgentTraceTurn } from '../store/useAgentRunStore';
import { ResearchChecklist } from './ResearchChecklist';
import { ResearchResults } from './ResearchResults';
import {
  LABEL_OFFSET,
  PROGRESS_ROW_STYLE,
  ProgressMark,
  type ProgressState,
} from './ProgressMark';
import { AGENT_HELP_TOOL, IDENTIFIER, namesToolId, stepParam, withoutUnseen } from '../../../shared/agentStepLabel';
import { fillTemplate } from '../../../shared/fillTemplate';
import { helperStepLine, traceToolLabel } from '../utils/agentTrace';

export { traceToolLabel };

const SUBLINE_STYLE = {
  fontSize: 'var(--font-size-xs)',
  color: 'var(--mantine-color-dimmed)',
  whiteSpace: 'nowrap' as const,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

/** The param gives way first: the row's title is what it is there to say. */
const ROW_PARAM_STYLE = { ...SUBLINE_STYLE, minWidth: 0, flexShrink: 100 };

/**
 * The model's reason for the step, or nothing when it reads like a program. Filtered here rather
 * than when it is saved: the thought is also what the model reads back, and a reopened run has to
 * show the same line the live one did.
 */
function readableThought(turn: AgentTraceTurn): string {
  const line = withoutUnseen(turn.thought ?? '').trim();
  return readsLikeProgram(line, turn) ? '' : line;
}

function readsLikeProgram(line: string, turn: AgentTraceTurn): boolean {
  return IDENTIFIER.test(line) || namesToolId(line, turn.tool?.replace(/^mcp:/, '') ?? '');
}

/** JSON as a tool returned it, cut wherever the budget ended. `[1] Title` is not. */
const JSON_TEXT = /^[[{]\s*["{[\]}]/;

/**
 * The start of a step's result when a person can read it. An observation is written for the model:
 * connector JSON, `ERROR:` lines that tell it what to do next, and a look-up's catalog text full of
 * tool ids. The whole of it stays in the copied log, but that button only exists once the run ends,
 * so a failed step keeps its reason: the first sentence, without the instruction that follows it.
 */
function readablePreview(turn: AgentTraceTurn): string {
  const line = withoutUnseen(turn.preview ?? '').trim();
  if (turn.tool === AGENT_HELP_TOOL || JSON_TEXT.test(line)) return '';
  const failure = line.startsWith('ERROR:');
  if (failure && turn.status !== 'error') return '';
  const shown = failure ? line.replace(/^ERROR:\s*/, '').split(/(?<=[.!?])\s/, 1)[0] : line;
  return readsLikeProgram(shown, turn) ? '' : shown;
}

/** The live stage of a step, which stays visible while the step's details are closed. */
export function stageLine(turn: AgentTraceTurn, t: (key: string) => string): string {
  if (!turn.stage) return '';
  return fillTemplate(t(`agent.stage.${turn.stage.label}`), { detail: turn.stage.detail ?? '' });
}

/** What opening a step shows, besides its research checklist. */
export function subLines(turn: AgentTraceTurn, t: (key: string) => string): string[] {
  const lines: string[] = [];
  const thought = readableThought(turn);
  if (thought) lines.push(thought);
  for (const step of turn.helperSteps ?? []) lines.push(helperStepLine(step, t));
  const preview = readablePreview(turn);
  if (preview) lines.push(fillTemplate(t('agent.trace.result'), { preview }));
  return lines;
}

export function AgentTraceRow({ turn }: { turn: AgentTraceTurn }) {
  const t = useI18nStore((state) => state.t);
  const [userOpen, setUserOpen] = useState<boolean | null>(null);
  const mark: ProgressState = turn.status === 'ok' ? 'done' : turn.status === 'error' ? 'failed' : 'active';
  const param = turn.tool ? stepParam(turn.tool, turn.config) : undefined;
  const stage = stageLine(turn, t);
  const lines = subLines(turn, t);
  const hasDetails = lines.length > 0 || Boolean(turn.research);
  // Work that reports as it goes opens by itself once the run is expanded; finished rows stay closed.
  const open = hasDetails && (userOpen ?? (turn.status === 'running' && Boolean(turn.research || turn.helperSteps)));
  const label = turn.doing
    ?? (turn.tool ? traceToolLabel(turn.tool, turn.config, t) : undefined)
    ?? (turn.provider
      ? fillTemplate(t('agent.trace.asking'), { provider: turn.provider })
      : t('agent.trace.thinking'));

  const row = (
    <>
      <ProgressMark state={mark} />
      <Text component="span" truncate title={label} style={{ fontSize: 'var(--font-size-xs)', fontWeight: 500, minWidth: 0 }}>
        {label}
      </Text>
      {param && <Text component="span" title={param} style={ROW_PARAM_STYLE}>{param}</Text>}
      {hasDetails && (open
        ? <ChevronDown size={12} color="var(--mantine-color-dimmed)" style={{ flexShrink: 0 }} />
        : <ChevronRight size={12} color="var(--mantine-color-dimmed)" style={{ flexShrink: 0 }} />)}
    </>
  );

  return (
    <Stack gap={1} style={{ minWidth: 0 }}>
      {hasDetails ? (
        <UnstyledButton aria-expanded={open} onClick={() => setUserOpen(!open)} style={{ ...PROGRESS_ROW_STYLE, maxWidth: '100%' }}>
          {row}
        </UnstyledButton>
      ) : (
        <Box style={PROGRESS_ROW_STYLE}>{row}</Box>
      )}
      {stage && <Text component="span" pl={LABEL_OFFSET} style={SUBLINE_STYLE}>{stage}</Text>}
      {open && lines.map((line, index) => (
        <Text key={`${index}-${line}`} component="span" pl={LABEL_OFFSET} title={line} style={SUBLINE_STYLE}>{line}</Text>
      ))}
      {open && turn.research && (
        <Stack gap={2} pl={LABEL_OFFSET} style={{ minWidth: 0 }}>
          {/* The links-only search step has results and no phases: it read nothing to count. */}
          {turn.research.phases.length > 0 && (
            <ResearchChecklist progress={turn.research} ended={turn.status === 'ok' || turn.status === 'error'} t={t} />
          )}
          {turn.research.searches?.length ? <ResearchResults searches={turn.research.searches} t={t} /> : null}
        </Stack>
      )}
    </Stack>
  );
}

export const AgentTraceRows: React.FC<{ trace: AgentTraceTurn[] }> = ({ trace }) => (
  <Box style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
    {trace.map((turn) => (
      <AgentTraceRow key={turn.turn} turn={turn} />
    ))}
  </Box>
);
