import React, { useState } from 'react';
import { ActionIcon, Tooltip } from '@mantine/core';
import { Plus } from 'lucide-react';
import { useFlowStore } from '../../store/useFlowStore';
import type { SkillType } from '../../../../shared/types';
import { AddStepMenu } from './AddStepMenu';
import { locateStep } from './outline/locateStep';
import { runSkillAddHook } from './skillAddHooks';

interface InsertStepBelowProps {
  flowId: string;
  /** Where the new step goes: right under this card (inside a loop or condition for its start). */
  at: number;
  t: (key: string) => string;
}

/**
 * A card's "insert a step below": the add-step menu, mounted on the first click (a long flow
 * would otherwise mount one menu per card), the new step placed under the card and scrolled to.
 */
export const InsertStepBelow: React.FC<InsertStepBelowProps> = ({ flowId, at, t }) => {
  const [armed, setArmed] = useState(false);
  const label = t('flow.step.insertBelow');
  const add = (type: SkillType): void => {
    const id = useFlowStore.getState().addStep(flowId, type, at);
    runSkillAddHook(type);
    if (id) locateStep(id);
  };
  if (armed) {
    return <AddStepMenu iconLabel={label} defaultOpened position="bottom" t={t} onAdd={add} onClose={() => setArmed(false)} />;
  }
  return (
    <Tooltip label={label} position="top">
      <ActionIcon variant="subtle" size="sm" aria-label={label} onClick={() => setArmed(true)} data-insert-below="">
        <Plus size={14} />
      </ActionIcon>
    </Tooltip>
  );
};
