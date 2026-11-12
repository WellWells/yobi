import { fillTemplate } from '../../../shared/fillTemplate';
import type { LinePairedUser, LineSelfTargetOption } from '../../../shared/types';
import { lineAccountLabel } from './botAccountLabel';
import type { RecipientOption, RecipientOptions } from './recipientChoices';

type Translate = (key: string) => string;

export interface LineSelfTargetList {
  ownId: string;
  ownName: string;
  targets: readonly LineSelfTargetOption[];
}

function targetLabel(target: LineSelfTargetOption, t: Translate): string {
  if (target.sendable === 'ready') return target.name;
  return fillTemplate(t('flow.recipient.lineSelf.needsOpen'), { name: target.name });
}

/**
 * The LINE PC recipient choices: the user themself first (their own id sends to the group that has
 * only them), then groups, then people — LINE PC's friends and everyone who asked Yobi — each newest
 * first as the list arrives. What the field holds beyond these is `withOtherRecipients`' to name.
 */
export function lineSelfRecipientOptions(
  list: LineSelfTargetList | null,
  paired: readonly LinePairedUser[],
  t: Translate,
): RecipientOptions {
  const seen = new Set<string>();
  const take = (option: RecipientOption): RecipientOption[] => {
    if (seen.has(option.value)) return [];
    seen.add(option.value);
    return [option];
  };
  const out: RecipientOptions = [];
  if (list?.ownId) {
    const name = list.ownName || t('flow.recipient.lineSelf.meUnnamed');
    out.push(...take({ value: list.ownId, label: fillTemplate(t('flow.recipient.lineSelf.me'), { name }) }));
  }
  const targets = list?.targets ?? [];
  const groups = targets.filter((target) => target.type === 'group').flatMap((target) => take({ value: target.id, label: targetLabel(target, t) }));
  const people = [
    ...targets.filter((target) => target.type === 'personal').flatMap((target) => take({ value: target.id, label: targetLabel(target, t) })),
    ...paired.flatMap((user) => take({ value: user.userId, label: lineAccountLabel(user, t) })),
  ];
  if (groups.length > 0) out.push({ group: t('flow.recipient.lineSelf.groups'), items: groups });
  if (people.length > 0) out.push({ group: t('flow.recipient.lineSelf.people'), items: people });
  return out;
}
