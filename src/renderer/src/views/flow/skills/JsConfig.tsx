import React from 'react';
import { Stack, Text } from '@mantine/core';
import { AppTextarea } from '../../../components/AppTextarea';
import { useFlowStore } from '../../../store/useFlowStore';
import type { SkillConfigProps } from './types';
import { availableVarGroups } from '../variableInsert';
import { stepVarInput } from '../stepVarInput';
import { fillTemplate } from '../../../../../shared/fillTemplate';
import { isInjectableIdentifier } from '../../../../../shared/jsStep';
import { DEFAULT_STEP_TIMEOUT_MS } from '../../../../../shared/flowStepTimeout';
import type { FlowDefinition } from '../../../../../shared/types';

const MAX_LISTED_NAMES = 8;
const TOKEN = /^\{\{(.+)\}\}$/;

export interface JsNames {
  /** Names the code reads as plain variables (`http_1`). */
  bare: string[];
  /** One name that is only reachable as `vars["…"]` (`llm_1.isFailed`), when there is one. */
  dotted?: string;
}

/**
 * The data a JavaScript step at `stepId` can read, by the names its Insert data menu lists (the
 * same scope), split the way the runner injects them: a valid identifier is a `const`, anything
 * else only `vars["…"]`.
 */
export function jsNamesFor(flow: FlowDefinition | undefined, stepId: string): JsNames {
  const index = flow?.steps.findIndex((step) => step.id === stepId) ?? -1;
  if (!flow || index < 0) return { bare: [] };
  const names = availableVarGroups(stepVarInput(flow, index), (key) => key)
    .filter((group) => group.key !== 'general')
    .flatMap((group) => group.tokens.map((token) => TOKEN.exec(token.token)?.[1] ?? ''))
    .filter(Boolean);
  const unique = [...new Set(names)];
  return { bare: unique.filter(isInjectableIdentifier), dotted: unique.find((name) => !isInjectableIdentifier(name)) };
}

export const JsConfig: React.FC<SkillConfigProps> = ({ step, onChange, t }) => {
  // A string, so the card draws again only when the names it lists change.
  const namesKey = useFlowStore((s) => JSON.stringify(jsNamesFor(s.flows.find((flow) => flow.id === s.selectedFlowId), step.id)));
  const names = JSON.parse(namesKey) as JsNames;
  const listed = names.bare.slice(0, MAX_LISTED_NAMES);
  const more = names.bare.length - listed.length;

  return (
    <Stack gap="xs">
      <AppTextarea
        label={t('flow.skill.js.code')}
        placeholder={t('flow.skill.js.code.placeholder')}
        value={step.config.code ?? ''}
        onChange={(e) => onChange({ ...step.config, code: e.currentTarget.value })}
        minRows={6}
        maxRows={24}
        autosize
        mono
        size="sm"
      />
      {listed.length > 0 && (
        <Text fz="xs" c="var(--text-muted)" data-js-names="">
          {fillTemplate(t(more > 0 ? 'flow.skill.js.names.more' : 'flow.skill.js.names'), {
            names: listed.join(t('flow.skill.js.names.separator')),
            count: String(more),
          })}
        </Text>
      )}
      {names.dotted && (
        <Text fz="xs" c="var(--text-muted)">
          {fillTemplate(t('flow.skill.js.dotted'), { example: `vars[${JSON.stringify(names.dotted)}]` })}
        </Text>
      )}
      <Text fz="xs" c="var(--text-muted)">
        {fillTemplate(t('flow.skill.js.outputHint'), {
          output: `{{${step.outputKey}}}`,
          seconds: String(DEFAULT_STEP_TIMEOUT_MS / 1_000),
        })}
      </Text>
      <Text fz="xs" c="var(--text-muted)">{t('flow.skill.js.hint')}</Text>
    </Stack>
  );
};
