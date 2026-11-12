import React from 'react';
import { SimpleGrid, Stack, Text } from '@mantine/core';
import { AppTextInput } from '../../../components/AppTextInput';
import { SelectDropdown } from '../../../components/SelectDropdown';
import { StatusLine } from '../../../components/StatusLine';
import { fillTemplate } from '../../../../../shared/fillTemplate';
import type { SkillConfigProps } from './types';
import { ifFacts, useStepFacts, type IfFacts } from './controlFacts';

const IF_OPERATORS = ['is_true', 'is_false', 'equals', 'not_equals', 'contains', 'is_empty'] as const;
const OPERATORS_WITHOUT_RIGHT = new Set<string>(['is_true', 'is_false', 'is_empty']);
/** `[]` is content to these: the runner only calls "" empty (a stop step calls `[]` empty too). */
const LIST_AWARE_OPERATORS = new Set<string>(['is_true', 'is_false', 'is_empty']);
/** Side by side from this card width; the 560px column of today keeps them stacked. */
const SIDE_BY_SIDE_FROM = '640px';
const NO_FACTS: IfFacts = { from: 0, to: 0, count: -1 };

/** What the form says the condition decides: which steps run when it holds. */
function rangeHint(facts: IfFacts, t: (k: string) => string): string {
  if (facts.count < 0) return t('flow.skill.if.hint');
  if (facts.count === 0) return t('flow.skill.if.range.empty');
  if (facts.count === 1) return fillTemplate(t('flow.skill.if.range.one'), { step: `#${facts.from}` });
  return fillTemplate(t('flow.skill.if.range.many'), { from: `#${facts.from}`, to: `#${facts.to}`, count: String(facts.count) });
}

export const IfConfig: React.FC<SkillConfigProps> = ({ step, onChange, t, flowId }) => {
  const operator = (IF_OPERATORS as readonly string[]).includes(step.config.operator ?? '') ? step.config.operator! : 'is_true';
  const showRight = !OPERATORS_WITHOUT_RIGHT.has(operator);
  const left = step.config.left ?? '';
  const right = step.config.right ?? '';
  const facts = useStepFacts(flowId, step.id, ifFacts, NO_FACTS);

  const rightWarning = showRight && right.trim() === ''
    ? t(`flow.skill.if.right.empty.${operator}`)
    : null;

  return (
    <Stack gap="xs">
      <Stack gap={4}>
        <AppTextInput
          label={t('flow.skill.if.left')}
          placeholder={t('flow.skill.if.left.placeholder')}
          value={left}
          onChange={(e) => onChange({ ...step.config, left: e.currentTarget.value })}
          size="sm"
        />
        {left.trim() === '' && <StatusLine tone="warning">{t('flow.skill.if.left.empty')}</StatusLine>}
      </Stack>
      <SimpleGrid type="container" cols={{ base: 1, [SIDE_BY_SIDE_FROM]: showRight ? 2 : 1 }} spacing="xs" verticalSpacing="xs">
        <SelectDropdown
          label={t('flow.skill.if.operator')}
          description={LIST_AWARE_OPERATORS.has(operator) ? t('flow.skill.if.operator.listHint') : undefined}
          options={IF_OPERATORS.map((op) => ({ value: op, label: t(`flow.skill.if.option.${op}`) }))}
          value={operator}
          onChange={(value) => onChange({ ...step.config, operator: value })}
          size="sm"
        />
        {/* Hidden, the value stays in the config: switching back shows it again. */}
        {showRight && (
          <Stack gap={4}>
            <AppTextInput
              label={t('flow.skill.if.right')}
              description={t('flow.skill.if.right.hint')}
              placeholder={t('flow.skill.if.right.placeholder')}
              value={right}
              onChange={(e) => onChange({ ...step.config, right: e.currentTarget.value })}
              size="sm"
            />
            {rightWarning && <StatusLine tone="warning">{rightWarning}</StatusLine>}
          </Stack>
        )}
      </SimpleGrid>
      <Text fz="xs" c="var(--text-muted)" data-if-range="">{rangeHint(facts, t)}</Text>
    </Stack>
  );
};
