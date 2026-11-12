import React, { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { ActionIcon, Box, Group, Stack, Text, UnstyledButton } from '@mantine/core';
import { Search, TriangleExclamationPoint, X } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { AppTextInput } from '../../../components/AppTextInput';
import { GroupHeader } from '../../../components/GroupHeader';

import type { ProgressState } from '../../../components/ProgressMark';
import { useScrollEdgeFade } from '../../../hooks/useScrollEdgeFade';
import { deleteStepWithUndo } from '../deleteStep';
import { useFlowOutlineStore } from '../../../store/useFlowOutlineStore';
import { useFlowStore } from '../../../store/useFlowStore';
import { isComposingKey } from '../../../utils/imeKeys';
import { fillTemplate } from '../../../../../shared/fillTemplate';
import type { FlowDefinition, SkillInstance } from '../../../../../shared/types';
import { ATOMIC_STEPS } from '../StepCard';
import { useNamedModels } from '../useNamedModels';
import { locateStep } from './locateStep';
import { hiddenByFold, matchRow, outlineRows, searchRows, selectionAfterDelete, usedBy, type OutlineRow as Row, type RowMatch } from './outlineModel';
import { OutlineRow } from './OutlineRow';
import { rowText, summaryContext } from './rowText';
import { stepDisplayName, stepSearchText } from '../stepSummary';
import { useI18nStore } from '../../../store/i18nStore';
import type { StepIssue } from './stepIssues';

/** Where the editor's own sections are, for the outline's 「流程」 entries. */
export const FLOW_SECTION_IDS = { name: 'flow-section-name', trigger: 'flow-section-trigger', settings: 'flow-section-settings', results: 'flow-section-results' } as const;

/** The last element the user worked in inside the editor, where Escape from the outline returns. */
let lastEditorFocus: HTMLElement | null = null;
let handledFocusRequest = 0;
export function noteEditorFocus(el: HTMLElement | null): void {
  lastEditorFocus = el;
}

function scrollToSection(id: string): void {
  document.getElementById(id)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
}

export interface FlowOutlineProps {
  flow: FlowDefinition;
  t: (key: string) => string;
  issues: ReadonlyMap<string, StepIssue>;
  runStates: ReadonlyMap<string, ProgressState>;
  /** "Failed at step 3" and the like, for the results entry at the bottom; null with no run. */
  runSummary: string | null;
  triggerSummary: string;
  /** In the drawer: a pick closes it. */
  onPicked?: () => void;
}

const MATCH_FIELD_KEY: Record<RowMatch['field'], string> = {
  name: 'flow.outline.match.name',
  type: 'flow.outline.match.type',
  output: 'flow.outline.match.output',
  summary: 'flow.outline.match.summary',
  prompt: 'flow.outline.match.prompt',
  code: 'flow.outline.match.code',
  url: 'flow.outline.match.url',
  message: 'flow.outline.match.message',
  setting: 'flow.outline.match.settings',
};

/**
 * The open flow's steps as a list beside the editor: where each step is, what it does, which have
 * problems and how the last run went; a pick scrolls the editor to that card. It never edits the
 * flow except through the row menus (duplicate, delete), which call the same store actions as the
 * cards, so searching, folding and jumping never make the flow unsaved.
 */
export const FlowOutline: React.FC<FlowOutlineProps> = ({ flow, t, issues, runStates, runSummary, triggerSummary, onPicked }) => {
  const models = useNamedModels();
  const locale = useI18nStore((s) => s.locale);
  const { selected, folded, visible, focusSearch, select, toggleFold, unfold } = useFlowOutlineStore(useShallow((s) => ({
    selected: s.selected[flow.id],
    folded: s.folded[flow.id],
    visible: s.visible,
    focusSearch: s.focusSearch,
    select: s.select,
    toggleFold: s.toggleFold,
    unfold: s.unfold,
  })));
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const [focusId, setFocusId] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const fadeClass = useScrollEdgeFade(listRef);

  // A different flow: a fresh search, focus back to the top of the list.
  useEffect(() => {
    setQuery('');
    setFocusId(null);
  }, [flow.id]);

  useEffect(() => {
    // Once per request: the outline mounting later (opened by its button) does not take the focus.
    if (focusSearch === 0 || focusSearch === handledFocusRequest) return;
    handledFocusRequest = focusSearch;
    searchRef.current?.focus();
    searchRef.current?.select();
  }, [focusSearch]);

  const rows = useMemo(() => outlineRows(flow.steps), [flow.steps]);
  const byId = useMemo(() => new Map(flow.steps.map((step) => [step.id, step])), [flow.steps]);
  const ctx = useMemo(() => summaryContext(flow, t, models, locale), [flow, t, models, locale]);
  const texts = useMemo(() => new Map(rows.map((row) => [row.step.id, rowText(row, ctx)])), [rows, ctx]);
  const foldedSet = useMemo(() => new Set(folded ?? []), [folded]);

  // The checks' issue first; else the step's own (a video step without a video link).
  // "Read by #5, #9" in the tooltip: what a rename or a delete would break.
  const usedByText = useMemo(() => {
    const list = new Intl.ListFormat(locale, { type: 'conjunction' });
    const texts = new Map<string, string>();
    usedBy(flow.steps).forEach((numbers, id) => texts.set(id, fillTemplate(t('flow.outline.usedBy'), { steps: list.format(numbers.map((n) => `#${n}`)) })));
    return texts;
  }, [flow.steps, locale, t]);

  const rowIssues = useMemo(() => {
    const merged = new Map(issues);
    for (const [id, text] of texts) {
      if (merged.has(id) || !text.issue) continue;
      merged.set(id, { text: text.issue, tone: text.state === 'warning' ? 'warning' : 'error' });
    }
    return merged;
  }, [issues, texts]);

  const matches = useMemo(() => {
    const found = new Map<string, RowMatch>();
    if (!deferredQuery.trim()) return found;
    for (const row of rows) {
      const match = matchRow(stepSearchText(row.step, { ...ctx, index: row.index }), deferredQuery);
      if (match) found.set(row.step.id, match);
    }
    return found;
  }, [rows, ctx, deferredQuery]);

  const searching = deferredQuery.trim() !== '';
  const shown = useMemo(() => {
    if (searching) return searchRows(rows, matches);
    const hidden = hiddenByFold(rows, foldedSet);
    return rows.filter((row) => !hidden.has(row.step.id)).map((row) => ({ row, context: false }));
  }, [searching, rows, matches, foldedSet]);

  const inView = useMemo(() => {
    const ids = new Set<string>();
    if (!visible || visible.flowId !== flow.id) return ids;
    const first = rows.findIndex((row) => row.step.id === visible.first);
    const last = rows.findIndex((row) => row.step.id === visible.last);
    if (first < 0 || last < 0) return ids;
    for (let i = first; i <= last; i++) ids.add(rows[i].step.id);
    return ids;
  }, [visible, rows, flow.id]);

  const pickable = useMemo(() => shown.filter((entry) => !entry.context).map((entry) => entry.row.step.id), [shown]);
  const tabbableId = (focusId && pickable.includes(focusId) ? focusId : undefined)
    ?? (selected && pickable.includes(selected) ? selected : undefined)
    ?? pickable[0];

  const pick = useCallback((id: string, focusCard: boolean) => {
    const row = rows.find((r) => r.step.id === id);
    if (!row) return;
    select(flow.id, id);
    unfold(flow.id, row.ancestors);
    locateStep(id, { expand: !ATOMIC_STEPS.includes(row.step.type), focus: focusCard });
    onPicked?.();
  }, [rows, select, unfold, flow.id, onPicked]);

  const focusRow = (id: string | undefined): void => {
    if (!id) return;
    setFocusId(id);
    listRef.current?.querySelector<HTMLElement>(`[data-outline-id="${CSS.escape(id)}"]`)?.focus();
  };

  // Read through a ref: every row gets the same function while the flow is edited (rows are memo).
  const menuState = useRef({ rows, pick, selected, flowId: flow.id, t });
  menuState.current = { rows, pick, selected, flowId: flow.id, t };
  const onMenu = useCallback((action: 'duplicate' | 'delete' | 'owner', id: string) => {
    const { rows: now, pick: go, selected: current, flowId, t: tr } = menuState.current;
    if (action === 'owner') {
      const owner = now.find((r) => r.step.id === id)?.owner;
      if (owner) go(owner, false);
      return;
    }
    if (action === 'duplicate') {
      const copy = useFlowStore.getState().duplicateStep(flowId, id);
      if (copy) {
        select(flowId, copy);
        locateStep(copy);
      }
      return;
    }
    const next = current === id ? selectionAfterDelete(now, id) : current;
    if (deleteStepWithUndo(flowId, id, tr, () => select(flowId, id))) select(flowId, next);
  }, [select]);

  const onListClick = (event: React.MouseEvent): void => {
    const target = event.target as HTMLElement;
    if (target.closest('[data-outline-more]') || target.closest('.mantine-Menu-dropdown')) return;
    const rowEl = target.closest<HTMLElement>('[data-outline-id]');
    const id = rowEl?.dataset.outlineId;
    if (!id || rowEl.dataset.context) return;
    const fold = target.closest<HTMLElement>('[data-outline-fold]');
    if (fold?.dataset.outlineFold && !searching) {
      toggleFold(flow.id, id);
      return;
    }
    setFocusId(id);
    pick(id, false);
  };

  const onListKeyDown = (event: React.KeyboardEvent): void => {
    const rowEl = (event.target as HTMLElement).closest<HTMLElement>('[data-outline-id]');
    const id = rowEl?.dataset.outlineId;
    if (!id || (event.target as HTMLElement) !== rowEl) return;
    const at = pickable.indexOf(id);
    const row = rows.find((r) => r.step.id === id);
    const foldable = row ? (row.childCount !== undefined || (row.sectionCount ?? 0) > 0) && !searching : false;
    switch (event.key) {
      case 'ArrowDown': event.preventDefault(); focusRow(pickable[Math.min(pickable.length - 1, at + 1)]); break;
      case 'ArrowUp': event.preventDefault(); focusRow(pickable[Math.max(0, at - 1)]); break;
      case 'Home': event.preventDefault(); focusRow(pickable[0]); break;
      case 'End': event.preventDefault(); focusRow(pickable[pickable.length - 1]); break;
      case 'ArrowLeft':
        event.preventDefault();
        if (foldable && !foldedSet.has(id)) toggleFold(flow.id, id);
        else focusRow(row?.ancestors[row.ancestors.length - 1]);
        break;
      case 'ArrowRight':
        event.preventDefault();
        if (foldable && foldedSet.has(id)) toggleFold(flow.id, id);
        break;
      case 'Enter': event.preventDefault(); pick(id, true); break;
      case ' ': event.preventDefault(); pick(id, false); break;
      case 'Escape':
        event.preventDefault();
        (lastEditorFocus?.isConnected ? lastEditorFocus : searchRef.current)?.focus();
        break;
      case 'ContextMenu':
      case 'F10':
        if (event.key === 'F10' && !event.shiftKey) return;
        event.preventDefault();
        rowEl.querySelector<HTMLElement>('[data-outline-more]')?.click();
        break;
      default:
    }
  };

  const onSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (isComposingKey(event.nativeEvent)) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      if (pickable[0]) pick(pickable[0], true);
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      focusRow(pickable[0]);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      if (query) setQuery('');
      else lastEditorFocus?.focus();
    }
  };

  const issueIds = useMemo(() => rows.filter((row) => rowIssues.has(row.step.id)).map((row) => row.step.id), [rows, rowIssues]);
  const nextIssue = (): void => {
    if (issueIds.length === 0) return;
    const selIndex = rows.findIndex((row) => row.step.id === selected);
    const next = issueIds.find((id) => rows.findIndex((row) => row.step.id === id) > selIndex) ?? issueIds[0];
    pick(next, false);
  };

  const variableCount = flow.variables?.length ?? 0;
  const missingSetting = (flow.variables ?? []).some((v) => v.required && !(v.value ?? '').trim());

  return (
    <Stack gap={6} h="100%" miw={0} style={{ overflow: 'hidden' }}>
      <Box px={8} pt={8}>
        <AppTextInput
          ref={searchRef}
          size="xs"
          value={query}
          onChange={(e) => setQuery(e.currentTarget.value)}
          onKeyDown={onSearchKeyDown}
          placeholder={t('flow.outline.search')}
          aria-label={t('flow.outline.search')}
          leftSection={<Search size={13} />}
          rightSection={query ? (
            <ActionIcon variant="subtle" size="sm" aria-label={t('flow.outline.search.clear')} onClick={() => { setQuery(''); searchRef.current?.focus(); }}>
              <X size={12} />
            </ActionIcon>
          ) : undefined}
        />
      </Box>
      <Box ref={listRef} className={fadeClass} flex={1} px={4} pb={8} style={{ overflowY: 'auto', minHeight: 0 }}>
        <GroupHeader variant="plain" label={t('flow.outline.flow')} />
        <Stack gap={0} mb={6}>
          <FlowEntry label={t('flow.flowName')} value={flow.name || t('flow.flowName.placeholder')} onClick={() => scrollToSection(FLOW_SECTION_IDS.name)} />
          <FlowEntry label={t('flow.trigger')} value={triggerSummary} onClick={() => scrollToSection(FLOW_SECTION_IDS.trigger)} />
          <FlowEntry
            label={t('flow.variables')}
            value={variableCount ? fillTemplate(t('flow.outline.settingsCount'), { count: String(variableCount) }) : t('flow.outline.settingsNone')}
            error={missingSetting}
            onClick={() => scrollToSection(FLOW_SECTION_IDS.settings)}
          />
        </Stack>
        <Group justify="space-between" wrap="nowrap" pr={4}>
          <GroupHeader variant="plain" label={fillTemplate(t('flow.outline.steps'), { count: String(flow.steps.length) })} />
          {issueIds.length > 0 && (
            <UnstyledButton onClick={nextIssue} aria-label={fillTemplate(t('flow.outline.issues'), { count: String(issueIds.length) })} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <TriangleExclamationPoint size={12} color="var(--mantine-color-error)" />
              <Text fz={12} c="var(--mantine-color-error)">{fillTemplate(t('flow.outline.issues'), { count: String(issueIds.length) })}</Text>
            </UnstyledButton>
          )}
        </Group>
        {searching && matches.size === 0 ? (
          <Text fz={12} c="var(--text-muted)" px={10} py={6}>{fillTemplate(t('flow.outline.noMatch'), { query: deferredQuery.trim() })}</Text>
        ) : (
          <Box ref={undefined} role="tree" aria-label={t('flow.outline.steps.label')} onClick={onListClick} onKeyDown={onListKeyDown}>
            {shown.map(({ row, context }) => (
              <OutlineEntry
                key={row.step.id}
                row={row}
                context={context}
                text={texts.get(row.step.id) ?? { primary: '' }}
                match={matches.get(row.step.id)}
                issue={rowIssues.get(row.step.id)}
                runState={runStates.get(row.step.id)}
                selected={row.step.id === selected}
                inView={inView.has(row.step.id)}
                folded={foldedSet.has(row.step.id)}
                searching={searching}
                tabbable={row.step.id === tabbableId}
                byId={byId}
                usedByText={usedByText.get(row.step.id)}
                t={t}
                onMenu={onMenu}
              />
            ))}
          </Box>
        )}
        {runSummary && (
          <Box mt={6}>
            <FlowEntry label={t('flow.outline.results')} value={runSummary} onClick={() => scrollToSection(FLOW_SECTION_IDS.results)} />
          </Box>
        )}
      </Box>
    </Stack>
  );
};

/** One of the flow's own sections (name, trigger, settings, results): a row that scrolls to it. */
function FlowEntry({ label, value, error, onClick }: { label: string; value: string; error?: boolean; onClick: () => void }) {
  return (
    <UnstyledButton onClick={onClick} px={10} py={3} style={{ borderRadius: 6, display: 'block', minWidth: 0 }}>
      <Text fz={12} c="var(--text-muted)" lineClamp={1}>{label}</Text>
      <Text fz={13} lineClamp={1} c={error ? 'var(--mantine-color-error)' : undefined} style={{ wordBreak: 'break-all' }}>{value}</Text>
    </UnstyledButton>
  );
}

const RUN_LABEL_KEY: Record<ProgressState, string> = {
  done: 'flow.outline.run.done',
  failed: 'flow.outline.run.failed',
  softFailed: 'flow.outline.run.softFailed',
  active: 'flow.outline.run.active',
  skipped: 'flow.outline.run.skipped',
  pending: 'flow.outline.run.pending',
};

interface EntryProps {
  row: Row;
  context: boolean;
  text: { primary: string; secondary?: string; state?: string; issue?: string };
  match?: RowMatch;
  issue?: StepIssue;
  runState?: ProgressState;
  selected: boolean;
  inView: boolean;
  folded: boolean;
  searching: boolean;
  tabbable: boolean;
  byId: ReadonlyMap<string, SkillInstance>;
  usedByText?: string;
  t: (key: string) => string;
  onMenu: (action: 'duplicate' | 'delete' | 'owner', id: string) => void;
}

/** Turns a row's model into the primitives the memoised row compares. */
function OutlineEntry({ row, context, text, match, issue, runState, selected, inView, folded, searching, tabbable, byId, usedByText, t, onMenu }: EntryProps) {
  const { step } = row;
  const typeName = t(`flow.skill.${step.type}`);
  const end = step.type === 'end_loop' || step.type === 'end_if';
  const foldable = !searching && (row.childCount !== undefined ? row.childCount > 0 : (row.sectionCount ?? 0) > 0);
  const tooltip = [
    typeName,
    step.outputKey && !end ? `{{${step.outputKey}}}` : '',
    text.primary,
    text.secondary ?? '',
    issue?.text ?? '',
    usedByText ?? '',
  ].filter(Boolean).join(' · ');
  const owner = row.owner ? byId.get(row.owner) : undefined;
  return (
    <OutlineRow
      id={step.id}
      index={row.index}
      type={step.type}
      depth={row.depth}
      primary={text.primary}
      secondary={text.secondary ?? (folded && row.childCount ? fillTemplate(t('flow.outline.foldedCount'), { count: String(row.childCount) }) : undefined)}
      match={match && match.field !== 'name' && match.field !== 'summary' ? match : undefined}
      matchLabel={match ? t(MATCH_FIELD_KEY[match.field]) : undefined}
      issue={issue?.text}
      issueTone={issue?.tone}
      runState={runState}
      runLabel={runState ? t(RUN_LABEL_KEY[runState]) : undefined}
      selected={selected}
      inView={inView}
      context={context}
      end={end}
      foldable={foldable}
      folded={folded}
      tabbable={tabbable}
      typeName={typeName}
      tooltip={owner ? `${tooltip} · ${stepDisplayName(owner, t)}` : tooltip}
      levelLabel={row.depth > 3 ? `L${row.depth + 1}` : undefined}
      t={t}
      onMenu={onMenu}
      canDuplicate={!end}
      canDelete
      ownerTarget={Boolean(row.owner)}
    />
  );
}
