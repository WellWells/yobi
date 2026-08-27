import { useCallback, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import {
  activeCombos, comboOverlaps, detectCollision,
  resolveDefaultCombo, shortcutById, SHORTCUTS,
} from '../../../../../shared/shortcuts';
import type { FlowHotkeyRef, ShortcutDef, ShortcutId } from '../../../../../shared/shortcuts';
import { allResolvedBindings, useShortcutStore } from '../../../store/shortcutStore';
import { useFlowStore } from '../../../store/useFlowStore';
import { useI18nStore } from '../../../store/i18nStore';
import { settingsApi } from '../../../api/electronApi';
import { isMac } from '../../../utils/keyLabels';
import type { ShortcutRowLevel } from '../../../components/settings/ShortcutRow';

function mapValues(combos: Record<string, string>): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [id, combo] of Object.entries(combos)) out[id] = combo ? [combo] : [];
  return out;
}

export interface ShortcutRowMessage {
  level: ShortcutRowLevel;
  text: string;
}

export function useShortcutSettings(legacyCombos: Record<string, string> = {}) {
  const { overrides, setOverrides } = useShortcutStore(
    useShallow((s) => ({ overrides: s.overrides, setOverrides: s.setOverrides })),
  );
  const flows = useFlowStore((s) => s.flows);
  const t = useI18nStore((s) => s.t);
  const [messages, setMessages] = useState<Record<string, ShortcutRowMessage | null>>({});

  const flowHotkeys = useMemo<FlowHotkeyRef[]>(() => {
    const refs: FlowHotkeyRef[] = [];
    for (const flow of flows) {
      const triggers = [flow.trigger, ...(flow.extraTriggers ?? [])];
      for (const trigger of triggers) {
        if (trigger.type !== 'hotkey' || !trigger.keys) continue;
        refs.push({ flowId: flow.id, flowName: flow.name, keys: trigger.keys, enabled: flow.enabled !== false });
      }
    }
    return refs;
  }, [flows]);

  const persist = useCallback((next: Record<string, { combo?: string; off?: true }>) => {
    setOverrides(next);
    void settingsApi.updateShortcuts(next).then(setOverrides);
  }, [setOverrides]);

  const describe = useCallback((id: ShortcutId, combo: string): ShortcutRowMessage | null => {
    const result = detectCollision({
      candidateId: id,
      candidateCombo: combo,
      bindings: { ...allResolvedBindings(), ...mapValues(legacyCombos) },
      flowHotkeys,
      isMac,
    });
    if (result.level === 'ok') return null;

    const level: ShortcutRowLevel = result.level === 'refuse' ? 'refuse' : 'warn';
    if (result.reason === 'flow') {
      return { level, text: t('settings.shortcut.collision.flow').replace('{{name}}', result.withFlowName ?? '') };
    }
    if (result.reason === 'chromium-menu') {
      return { level, text: t('settings.shortcut.collision.browser') };
    }
    const otherLabel = result.withId ? t(`settings.shortcut.${result.withId}`) : '';
    const key = result.reason === 'same-scope'
      ? 'settings.shortcut.collision.sameScope'
      : 'settings.shortcut.collision.crossScope';
    return { level, text: t(key).replace('{{name}}', otherLabel) };
  }, [flowHotkeys, legacyCombos, t]);

  const commit = useCallback((id: ShortcutId, rawCombo: string) => {
    const def = shortcutById(id);
    const message = describe(id, rawCombo);
    setMessages((prev) => ({ ...prev, [id]: message }));
    if (message?.level === 'refuse') return;

    const next = { ...overrides };
    const isDefault = comboOverlaps(rawCombo, resolveDefaultCombo(def, isMac), isMac);
    if (isDefault && !next[id]?.off) delete next[id];
    else next[id] = { ...next[id], combo: rawCombo };
    persist(next);
  }, [describe, overrides, persist]);

  const toggle = useCallback((id: ShortcutId, enabled: boolean) => {
    const next = { ...overrides };
    if (enabled) {
      const rest = { ...next[id] };
      delete rest.off;
      if (rest.combo === undefined) delete next[id];
      else next[id] = rest;
    } else {
      next[id] = { ...next[id], off: true };
    }
    persist(next);
    setMessages((prev) => ({ ...prev, [id]: null }));
  }, [overrides, persist]);

  const resetAll = useCallback(() => {
    persist({});
    setMessages({});
  }, [persist]);

  const combosFor = useCallback(
    (id: ShortcutId) => activeCombos(shortcutById(id), isMac, overrides[id]),
    [overrides],
  );

  const clearMessage = useCallback((id: ShortcutId) => {
    setMessages((prev) => (prev[id] ? { ...prev, [id]: null } : prev));
  }, []);

  const isModified = useCallback((id: ShortcutId) => Boolean(overrides[id]), [overrides]);

  const resetOne = useCallback((id: ShortcutId) => {
    const next = { ...overrides };
    delete next[id];
    persist(next);
    setMessages((prev) => ({ ...prev, [id]: null }));
  }, [overrides, persist]);

  const isEnabled = useCallback((id: ShortcutId) => overrides[id]?.off !== true, [overrides]);

  const hasChanges = Object.keys(overrides).length > 0;

  const groups = useMemo(() => {
    const byGroup = new Map<string, ShortcutDef[]>();
    for (const def of SHORTCUTS as readonly ShortcutDef[]) {
      const list = byGroup.get(def.group);
      if (list) list.push(def);
      else byGroup.set(def.group, [def]);
    }
    for (const defs of byGroup.values()) {
      defs.sort((a, b) => Number(b.rebindable) - Number(a.rebindable));
    }
    return [...byGroup.entries()].filter(([, defs]) => defs.length > 0);
  }, []);

  return {
    groups, flowHotkeys, messages, hasChanges,
    combosFor, isEnabled, isModified, commit, toggle, resetAll, resetOne, clearMessage,
  };
}
