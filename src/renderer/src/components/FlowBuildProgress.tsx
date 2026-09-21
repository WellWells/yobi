import { Box, Loader, Stack, Text } from '@mantine/core';
import { Check, Circle, X } from 'lucide-react';
import { FLOW_BUILD_PHASES } from '../../../shared/types';
import type { FlowBuildPhase, SkillType } from '../../../shared/types';
import { useI18nStore } from '../store/i18nStore';
import type { FlowBuildState, PhaseStatus } from '../store/useFlowBuildStore';

/**
 * The five phases of a build, drawn the same way in the Flow Builder and in a chat turn. One
 * component because it is one lifecycle: a second drawing of it would be a second thing to keep
 * truthful, and the whole point is that these ticks mean something.
 */

const ROW_STYLE = { display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 } as const;

const SUB_STYLE = {
  fontSize: 'var(--font-size-xs)',
  color: 'var(--mantine-color-dimmed)',
  whiteSpace: 'nowrap' as const,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

const MAX_OUTLINE_ROWS = 6;

function PhaseIcon({ status }: { status: PhaseStatus | undefined }) {
  if (status === 'done') return <Check size={11} color="var(--mantine-color-teal-6)" />;
  if (status === 'failed') return <X size={11} color="var(--mantine-color-red-6)" />;
  if (status === 'active') return <Loader size={10} />;
  return <Circle size={9} color="var(--mantine-color-dimmed)" />;
}

/** The skills the request resolved to, named the way the step list names them. */
export function toolNames(skills: readonly SkillType[], t: (key: string) => string): string[] {
  return skills.map((skill) => t(`flow.skill.${skill}`));
}

export function FlowBuildProgressView({ state }: { state: FlowBuildState }) {
  const t = useI18nStore((store) => store.t);
  const outline = state.outline.slice(0, MAX_OUTLINE_ROWS);

  return (
    <Stack gap={3} style={{ minWidth: 0 }}>
      {FLOW_BUILD_PHASES.map((phase: FlowBuildPhase) => {
        const status = state.phases[phase];
        const detail = status === 'active' && state.detail
          ? t(`flow.build.detail.${state.detail}`)
          : '';
        return (
          <Stack key={phase} gap={1} style={{ minWidth: 0 }}>
            <Box style={ROW_STYLE}>
              <Box component="span" style={{ flexShrink: 0, display: 'inline-flex', width: 12, justifyContent: 'center' }}>
                <PhaseIcon status={status} />
              </Box>
              <Text
                component="span"
                style={{
                  fontSize: 'var(--font-size-xs)',
                  fontWeight: status === 'active' ? 600 : 500,
                  color: status ? undefined : 'var(--mantine-color-dimmed)',
                  flexShrink: 0,
                }}
              >
                {t(`flow.build.phase.${phase}`)}
              </Text>
              {detail && <Text component="span" style={SUB_STYLE}>{detail}</Text>}
            </Box>

            {phase === 'understand' && state.provider && (
              // Named because it is not always the model that was picked: a prompt this size does
              // not fit every provider, and a silent substitution is what made the last one look
              // like a bug.
              <Text component="span" pl={18} style={SUB_STYLE}>
                {t('flow.build.provider').replace('{{name}}', state.provider)}
              </Text>
            )}
            {phase === 'discover' && status === 'done' && state.skills.length > 0 && (
              <Text component="span" pl={18} style={SUB_STYLE}>
                {t('flow.build.tools.found').replace('{{names}}', toolNames(state.skills, t).join('、'))}
              </Text>
            )}
            {phase === 'discover' && state.blocked.length > 0 && (
              <Text component="span" pl={18} style={{ ...SUB_STYLE, color: 'var(--mantine-color-yellow-6)' }}>
                {t('flow.build.tools.blocked').replace(
                  '{{names}}',
                  state.blocked.map((entry) => t(`flow.build.need.${entry.need}`)).join('、'),
                )}
              </Text>
            )}
            {phase === 'plan' && outline.length > 0 && outline.map((line, index) => (
              // Keyed by position: an outline may legitimately repeat a line.
              <Text key={`${index}-${line}`} component="span" pl={18} style={SUB_STYLE}>
                {`${index + 1}. ${line}`}
              </Text>
            ))}
          </Stack>
        );
      })}
    </Stack>
  );
}
