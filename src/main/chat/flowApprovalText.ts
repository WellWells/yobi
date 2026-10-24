import { t } from '../i18n';
import { withoutUnseen } from '../flow/agent/shellApproval';
import { describeSchedule } from '../../shared/flowScheduleSummary';
import { compactPreview } from '../../shared/textBudget';
import type { AgentFlowRecipient, AgentPendingFlowHold, FlowBuildIssue, FlowDefinition, TriggerConfig } from '../../shared/types';
import type { ShellApprovalText } from '../flow/agent/shellApproval';
import type { FlowSaveRequest } from '../flow/agent/agentBuiltins';

type Strings = Record<string, string>;
const FLOW_NAME_MAX = 80;
const FLOW_LABEL_MAX = 60;
const FLOW_STEPS_SHOWN = 10;
const FLOW_ISSUES_SHOWN = 4;
const FLOW_RECIPIENTS_SHOWN = 8;

/** Why a change switches an enabled flow off, as the question says it. */
const PAUSED_TEXT: Record<AgentPendingFlowHold, string> = {
  sensitive: 'agent.flow.edit.detailPaused',
  issues: 'agent.flow.edit.detailPaused',
  ownerData: 'agent.flow.approve.pausedOwnerData',
  ownerActs: 'agent.flow.approve.pausedOwnerActs',
};

/** A name or label the model wrote, as one plain line a person reads as what it says. */
function plainLine(text: string, max: number): string {
  const line = withoutUnseen(text).replace(/^>+/, '').trim();
  return compactPreview(line, max);
}

function flowWhen(trigger: TriggerConfig, strings: Strings): string {
  if (trigger.type === 'cron') return describeSchedule(trigger, (key) => t(strings, key)) || t(strings, 'flow.trigger.cron');
  return t(strings, `flow.trigger.${trigger.type}`);
}

function recipientNames(recipients: readonly AgentFlowRecipient[], strings: Strings): string {
  const names = recipients.slice(0, FLOW_RECIPIENTS_SHOWN).map((recipient) => {
    if (recipient.kind === 'everyone') return t(strings, 'agent.flow.confirm.recipient.everyone');
    if (recipient.kind === 'sender') return t(strings, 'agent.flow.confirm.recipient.sender');
    return plainLine(recipient.name ?? '', FLOW_LABEL_MAX);
  });
  return names.join(t(strings, 'flow.build.recipient.separator'));
}

function issueLines(issues: readonly FlowBuildIssue[], strings: Strings): string[] {
  return issues.slice(0, FLOW_ISSUES_SHOWN).map((issue) => t(strings, `flow.build.issue.${issue.kind}`, {
    step: String(issue.step),
    skill: t(strings, `flow.skill.${issue.skill}`),
    detail: plainLine(issue.detail, FLOW_LABEL_MAX),
  }));
}

function stepLines(flow: FlowDefinition, strings: Strings): string[] {
  const lines = flow.steps.slice(0, FLOW_STEPS_SHOWN).map((step, index) => {
    const label = plainLine(step.label ?? '', FLOW_LABEL_MAX) || t(strings, `flow.skill.${step.type}`);
    return `${index + 1}. ${label}`;
  });
  const rest = flow.steps.length - FLOW_STEPS_SHOWN;
  return rest > 0 ? [...lines, t(strings, 'agent.flow.approve.moreSteps', { count: String(rest) })] : lines;
}

/**
 * The chat question that stands in for the save dialog on a bot admin's run (2026-10-24, user:
 * 管理員要能透過指令建立流程). Top down: what is saved, when it runs, its steps, who it sends to,
 * what still needs filling in, and whether it switches on. Names and labels are the model's, so each
 * is one plain line (`withoutUnseen`). Every list is capped, so the question always fits one message.
 */
export function flowApprovalText(req: FlowSaveRequest, strings: Strings): ShellApprovalText {
  const { pending } = req;
  const { flow } = pending;
  const name = plainLine(flow.name, FLOW_NAME_MAX);
  const recipients = req.recipients.length > 0
    ? [t(strings, 'agent.flow.confirm.recipients', { names: recipientNames(req.recipients, strings) })]
    : [];
  const issues = issueLines(pending.issues, strings);
  const cancel = t(strings, 'agent.flow.approve.cancel');

  if (pending.mode === 'build') {
    const blocks = [
      t(strings, 'agent.flow.approve.question', { name }),
      [t(strings, 'agent.flow.approve.when', { when: flowWhen(flow.trigger, strings) }), t(strings, 'agent.flow.confirm.steps'), ...stepLines(flow, strings)].join('\n'),
      ...(recipients.length > 0 ? [recipients.join('\n')] : []),
      ...(issues.length > 0 ? [issues.join('\n')] : []),
      pending.off
        ? t(strings, `agent.flow.approve.off.${pending.off}`, { types: req.sensitiveTypes.map((type) => t(strings, `flow.skill.${type}`)).join(t(strings, 'flow.build.recipient.separator')) })
        : t(strings, 'agent.flow.approve.on'),
    ];
    return {
      question: blocks.join('\n\n'),
      choices: [t(strings, pending.off ? 'agent.flow.approve.saveOff' : 'agent.flow.approve.saveOn'), cancel],
    };
  }

  const diff = pending.diff ?? { added: [], removed: [], changed: [], trigger: false };
  const changes = [
    ...diff.added.map((ref) => t(strings, 'agent.flow.edit.added', { label: plainLine(ref.label, FLOW_LABEL_MAX) })),
    ...diff.removed.map((ref) => t(strings, 'agent.flow.edit.removed', { label: plainLine(ref.label, FLOW_LABEL_MAX) })),
    ...diff.changed.map((ref) => t(strings, 'agent.flow.edit.changed', { label: plainLine(ref.label, FLOW_LABEL_MAX) })),
    ...(diff.renamedFrom ? [t(strings, 'agent.flow.edit.renamed', { from: plainLine(diff.renamedFrom, FLOW_NAME_MAX) })] : []),
    ...(diff.trigger ? [t(strings, 'agent.flow.approve.when', { when: flowWhen(flow.trigger, strings) })] : []),
  ];
  const shown = changes.slice(0, FLOW_STEPS_SHOWN);
  const more = changes.length - shown.length;
  const state = pending.paused
    ? t(strings, PAUSED_TEXT[pending.off ?? 'sensitive'])
    : t(strings, flow.enabled ? 'agent.flow.edit.detailEnabled' : 'agent.flow.edit.detail');
  const blocks = [
    t(strings, 'agent.flow.approve.editQuestion', { name }),
    [...shown, ...(more > 0 ? [t(strings, 'agent.flow.approve.moreChanges', { count: String(more) })] : [])].join('\n'),
    ...(recipients.length > 0 ? [recipients.join('\n')] : []),
    ...(issues.length > 0 ? [issues.join('\n')] : []),
    state,
  ];
  return { question: blocks.join('\n\n'), choices: [t(strings, 'agent.flow.edit.save'), cancel] };
}
