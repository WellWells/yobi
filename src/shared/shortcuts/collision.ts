import { canonicalise, comboOverlaps } from './combo';
import { CHROMIUM_MENU_ACCELERATORS, shortcutById } from './registry';
import type { ShortcutId } from './registry';
import type { ShortcutScope } from './types';

export type CollisionLevel = 'ok' | 'warn' | 'refuse';
export type CollisionReason = 'same-scope' | 'cross-scope' | 'flow' | 'chromium-menu';

export interface FlowHotkeyRef {
  flowId: string;
  flowName: string;
  keys: string;
  enabled: boolean;
}

export interface CollisionInput {
  candidateId: ShortcutId;
  candidateCombo: string;
  bindings: Record<string, string[]>;
  flowHotkeys: FlowHotkeyRef[];
  isMac: boolean;
}

export interface CollisionResult {
  level: CollisionLevel;
  reason?: CollisionReason;
  withId?: string;
  withFlowId?: string;
  withFlowName?: string;
}

const OK: CollisionResult = { level: 'ok' };

function scopesOverlap(a: ShortcutScope, b: ShortcutScope): boolean {
  if (a.kind === 'global-os' || b.kind === 'global-os') return false;
  if (a.kind === 'reference' || b.kind === 'reference') return false;

  if (a.kind === 'widget' || b.kind === 'widget') {
    return a.kind === 'widget' && b.kind === 'widget' && a.owner === b.owner;
  }
  if (a.kind === 'window' || b.kind === 'window') return true;
  return a.views.some((view) => b.views.includes(view));
}

function sharesCombo(combos: readonly string[], target: string, isMac: boolean): boolean {
  return combos.some((combo) => combo && comboOverlaps(combo, target, isMac));
}

export function detectCollision(input: CollisionInput): CollisionResult {
  const target = canonicalise(input.candidateCombo);
  if (!target) return OK;

  const candidate = shortcutById(input.candidateId);
  let crossScope: CollisionResult | null = null;

  for (const [id, combos] of Object.entries(input.bindings)) {
    if (id === input.candidateId) continue;
    if (!sharesCombo(combos, target, input.isMac)) continue;

    const other = shortcutById(id as ShortcutId);
    if (scopesOverlap(candidate.scope, other.scope)) {
      return { level: 'refuse', reason: 'same-scope', withId: id };
    }
    crossScope ??= { level: 'warn', reason: 'cross-scope', withId: id };
  }
  if (crossScope) return crossScope;

  for (const flow of input.flowHotkeys) {
    if (!comboOverlaps(flow.keys, target, input.isMac)) continue;
    return { level: 'warn', reason: 'flow', withFlowId: flow.flowId, withFlowName: flow.flowName };
  }

  if (CHROMIUM_MENU_ACCELERATORS.some((accel) => comboOverlaps(accel, target, input.isMac))) {
    return { level: 'warn', reason: 'chromium-menu' };
  }

  return OK;
}
