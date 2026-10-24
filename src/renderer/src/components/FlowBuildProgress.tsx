import { Box, Stack, Text } from '@mantine/core';
import { FLOW_BUILD_PHASES } from '../../../shared/types';
import type { FlowBuildPhase, SkillType } from '../../../shared/types';
import { useI18nStore } from '../store/i18nStore';
import type { FlowBuildState } from '../store/useFlowBuildStore';
import { LABEL_OFFSET, PROGRESS_ROW_STYLE, ProgressMark } from './ProgressMark';
import { fillTemplate } from '../../../shared/fillTemplate';

/** The five phases of a build, drawn the same way in the Flow Builder and in a chat turn. */

const SUB_STYLE = {
  fontSize: 'var(--font-size-xs)',
  color: 'var(--mantine-color-dimmed)',
  whiteSpace: 'nowrap' as const,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

const MAX_OUTLINE_ROWS = 6;

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
            <Box style={PROGRESS_ROW_STYLE}>
              <ProgressMark state={status ?? 'pending'} />
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
              // Named because a large prompt may go to a different provider than the one picked.
              <Text component="span" pl={LABEL_OFFSET} style={SUB_STYLE}>
                {fillTemplate(t('flow.build.provider'), { name: state.provider })}
              </Text>
            )}
            {phase === 'discover' && status === 'done' && state.skills.length > 0 && (
              <Text component="span" pl={LABEL_OFFSET} style={SUB_STYLE}>
                {fillTemplate(t('flow.build.tools.found'), { names: toolNames(state.skills, t).join('、') })}
              </Text>
            )}
            {phase === 'discover' && state.blocked.length > 0 && (
              <Text component="span" pl={LABEL_OFFSET} style={{ ...SUB_STYLE, color: 'var(--mantine-color-warning)' }}>
                {fillTemplate(t('flow.build.tools.blocked'), { names: state.blocked.map((entry) => t(`flow.build.need.${entry.need}`)).join('、') })}
              </Text>
            )}
            {phase === 'plan' && outline.length > 0 && outline.map((line, index) => (
              // Keyed by position: an outline may legitimately repeat a line.
              <Text key={`${index}-${line}`} component="span" pl={LABEL_OFFSET} style={SUB_STYLE}>
                {`${index + 1}. ${line}`}
              </Text>
            ))}
          </Stack>
        );
      })}
    </Stack>
  );
}
