import type { StructureIssue } from '../../../../shared/flowBlockStructure';
import type { ReferenceIssue } from '../../../../shared/flowReferenceCheck';
import { fillTemplate } from '../../../../shared/fillTemplate';

type T = (key: string) => string;

const OPENER_OF = { end_if: 'if', end_loop: 'loop' } as const;
const CLOSER_OF = { if: 'end_if', loop: 'end_loop' } as const;

/** A step type by the name the add-step menu gives it. */
function skillName(type: string, t: T): string {
  return t(`flow.skill.${type}`);
}

/**
 * One sentence about a structure issue, said on the step it belongs to (so it names no step
 * number of its own; the outline and the card already show it).
 */
export function describeStructureIssue(issue: StructureIssue, t: T): string {
  switch (issue.kind) {
    case 'crossed':
      return fillTemplate(t('flow.issue.block.crossed'), { closer: skillName(issue.closer, t), open: skillName(issue.open, t) });
    case 'unmatched':
      return fillTemplate(t('flow.issue.block.unmatched'), { open: skillName(OPENER_OF[issue.closer], t) });
    case 'outsideLoop':
      return t('flow.issue.block.outsideLoop');
    case 'unclosed':
      return fillTemplate(t('flow.issue.block.unclosed'), { closer: skillName(CLOSER_OF[issue.open], t) });
    case 'continueLast':
      return t('flow.issue.block.continueLast');
    case 'unconditional':
      return t(issue.type === 'break' ? 'flow.issue.block.breakUnconditional' : 'flow.issue.block.continueUnconditional');
    case 'onChangeInLoop':
      return t('flow.issue.block.onChangeInLoop');
    case 'shadowedLoopVar':
      return fillTemplate(t('flow.issue.block.shadowedLoopVar'), { token: `{{${issue.name}}}` });
  }
}

/** One sentence about a reference that will not resolve, with the `{{…}}` as written. */
export function describeReferenceIssue(issue: ReferenceIssue, t: T): string {
  const vars = { token: `{{${issue.ref}}}`, step: issue.source === undefined ? '' : String(issue.source + 1) };
  switch (issue.reason) {
    case 'unknown': return fillTemplate(t('flow.issue.ref.unknown'), vars);
    case 'unknownField': return fillTemplate(t('flow.issue.ref.unknownField'), vars);
    case 'later': return fillTemplate(t('flow.issue.ref.later'), vars);
    case 'outOfScope': return fillTemplate(t('flow.issue.ref.outOfScope'), vars);
    case 'loopVarOutside': return fillTemplate(t('flow.issue.ref.loopVarOutside'), vars);
    case 'hotkeyOnly': return fillTemplate(t('flow.issue.ref.hotkeyOnly'), vars);
    case 'fileMissing': return fillTemplate(t('flow.issue.ref.fileMissing'), vars);
    case 'fileTriggerOnly': return fillTemplate(t('flow.issue.ref.fileTriggerOnly'), vars);
    case 'botTriggerMissing': return fillTemplate(t('flow.issue.ref.botTriggerMissing'), vars);
    case 'botUnknownField': return fillTemplate(t('flow.issue.ref.botUnknownField'), vars);
  }
}
