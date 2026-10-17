import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { Copy, Languages, Library, Pencil, Quote, SearchCheck, Sparkles } from 'lucide-react';
import type { ConversationDoc } from '../../../../shared/conversationDoc';
import type { WritingAction } from '../../../../shared/writingTools';
import { parseCitationSources, resolveSelectionCitations } from '../../../../shared/citations';
import { clipboardApi } from '../../api/electronApi';
import { useChatSelection, type ChatSelectionState } from '../../hooks/useChatSelection';
import { usePressOutside } from '../../hooks/usePressOutside';
import { useAnswerEditStore } from '../../store/answerEditStore';
import { useWritingToolsStore } from '../../store/writingToolsStore';
import { splitMarkdownBlocks } from '../../utils/markdownBlocks';
import { selectionLocator } from '../../utils/notionEditorBlocks';
import { useAgentRunStore } from '../../store/useAgentRunStore';
import { snapshotAnswerSelection, type SelectionSnapshot } from '../../utils/selectionSnapshot';
import { SelectionToolbar, type SelectionAction, type SelectionRect } from './SelectionToolbar';
import { WritingToolsPanel } from './WritingToolsPanel';
import { contextAround, markRewriteSource, startRewrite, subscribeRewriteProgress } from './writingToolsActions';
import { translateBusy, turnKey, useTranslateStore } from '../../store/translateStore';
import { useI18nStore } from '../../store/i18nStore';
import { defaultTargetLanguage, type TranslateLanguage } from '../../../../shared/translateLanguages';
import { LanguageMenuItems } from './translate/LanguageMenuItems';
import { SELECTION_TRANSLATE_HEIGHT, SelectionTranslatePanel } from './translate/SelectionTranslatePanel';
import { takeSelectedText, useSelectionTranslate, type SelectedText } from './translate/useSelectionTranslate';

interface SelectionToolsProps {
  /** The chat's scroll area: selections outside it are not the conversation's. */
  contentAreaRef: React.RefObject<HTMLDivElement | null>;
  conversation: ConversationDoc | null;
  /** The conversation file, or the temporary chat's key. */
  path: string;
  /** Answers here can be edited and rewritten in place (a saved conversation with nothing sending). */
  canEdit: boolean;
  /** A Notion document: the page shows its text through the Notion display. */
  notion: boolean;
  /** Quotes the selection into the composer; null where there is none (a Notion document). */
  onQuote: ((text: string) => void) | null;
  /** Hands the selected claim to the agent to check; null when there is no agent to ask. */
  onVerify: ((text: string) => boolean) | null;
  onOpenSource: (url: string) => void;
  t: (key: string) => string;
}

function rectOf(range: Range): SelectionRect | null {
  const rect = range.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return null;
  return { top: rect.top, bottom: rect.bottom, left: rect.left, width: rect.width };
}

/**
 * Everything that happens to a selection in the conversation: the contextual bar (rewrite, edit,
 * copy, quote, sources or verify) and the writing tools it unfolds. The writing tools keep a
 * snapshot of the selection, since typing a request moves focus away and the selection with it.
 */
export const SelectionTools: React.FC<SelectionToolsProps> = ({
  contentAreaRef, conversation, path, canEdit, notion, onQuote, onVerify, onOpenSource, t,
}) => {
  const locate = useMemo(() => selectionLocator(notion, t), [notion, t]);
  const { selection: liveSelection, clear: clearSelection } = useChatSelection(contentAreaRef);
  // The selection as it was when the translate button's language menu opened: typing in the
  // menu's search takes the page's selection away, and the bar (and the menu with it) must stay.
  const [held, setHeld] = useState<{ state: ChatSelectionState; taken: SelectedText } | null>(null);
  const selection = liveSelection ?? held?.state ?? null;
  const locale = useI18nStore((s) => s.locale);
  const recentLanguages = useTranslateStore((s) => s.recent);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [panel, setPanel] = useState<SelectionSnapshot | null>(null);
  const [, redraw] = useReducer((count: number) => count + 1, 0);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const setQuote = useWritingToolsStore((s) => s.setQuote);
  const startEdit = useAnswerEditStore((s) => s.start);
  const awaitingRun = useAgentRunStore((s) => s.pendingQuestion?.runId ?? null);
  const translateJobs = useTranslateStore((s) => s.jobs);
  const translation = useSelectionTranslate();
  const closeTranslation = translation.close;
  const openTranslation = translation.open;

  useEffect(() => subscribeRewriteProgress(), []);
  useEffect(() => {
    setQuote(onQuote);
    return () => setQuote(null);
  }, [onQuote, setQuote]);

  /** Closing without starting a rewrite also drops the stand-in highlight; a started one keeps it. */
  const closePanel = useCallback((keepMark = false): void => {
    setPanel(null);
    if (!keepMark && useWritingToolsStore.getState().job === null) markRewriteSource(null);
  }, []);

  useEffect(() => {
    setSourcesOpen(false);
  }, [selection?.text, selection?.turnIndex]);

  useEffect(() => {
    clearSelection();
    setHeld(null);
    setSourcesOpen(false);
    closePanel();
    closeTranslation();
  }, [path, clearSelection, closePanel, closeTranslation]);

  // The open panel follows its passage as the conversation scrolls, and closes on a press elsewhere.
  usePressOutside([toolbarRef], () => closePanel(), panel !== null);
  usePressOutside([toolbarRef], () => closeTranslation(), translation.current !== null);
  const unfolded = panel !== null || translation.current !== null;
  // A press outside the conversation (the header's ⋮, the sidebar) dismisses the bar and the
  // selection with it: a button press keeps the selection, so the bar would stay over the menu
  // that press opened.
  usePressOutside([toolbarRef, contentAreaRef], () => {
    closePanel();
    closeTranslation();
    clearSelection();
    setHeld(null);
    window.getSelection()?.removeAllRanges();
  }, selection !== null || unfolded);
  useEffect(() => {
    if (!unfolded) return undefined;
    const container = contentAreaRef.current;
    const onScroll = (): void => redraw();
    container?.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      container?.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, [unfolded, contentAreaRef]);

  const sources = useMemo(() => {
    if (!selection || selection.turnIndex === null || !conversation) return [];
    const response = conversation.turns[selection.turnIndex]?.response ?? '';
    if (!response) return [];
    return resolveSelectionCitations(selection.text, selection.blockText, parseCitationSources(response));
  }, [selection, conversation]);

  const openPanel = useCallback((): void => {
    if (panel) {
      closePanel();
      return;
    }
    const snapshot = snapshotAnswerSelection();
    if (!snapshot) return;
    setPanel(snapshot);
    markRewriteSource(snapshot.range);
  }, [panel, closePanel]);

  const run = useCallback((action: WritingAction, instruction?: string): void => {
    const snapshot = panel;
    const turn = snapshot ? conversation?.turns[snapshot.turnIndex] : undefined;
    if (!snapshot || !turn) return;
    const range = locate(turn.response, snapshot.text, snapshot.hint);
    // Not traced (a formula, a diagram): the visible text is rewritten, and only "insert below" works,
    // after the block the selection ended in — found by its place among the rendered blocks, which
    // holds as long as the page and the source agree on how many blocks there are.
    let insertAt: number | null = null;
    if (!range) {
      const blocks = splitMarkdownBlocks(turn.response).filter((block) => block.kind !== 'definition');
      const { index, count } = snapshot.anchorBlock;
      if (count === blocks.length && index >= 0) insertAt = blocks[index].end;
    }
    closePanel(true);
    clearSelection();
    window.getSelection()?.removeAllRanges();
    void startRewrite({
      action,
      ...(instruction ? { instruction } : {}),
      text: range ? turn.response.slice(range.start, range.end) : snapshot.text.trim(),
      // The whole answer with the passage marked in place, or (untraced) the whole answer beside
      // it: without it a "concise" rewrite of half a sentence drops whatever tied it to the rest.
      context: range
        ? contextAround(turn.response, range, turn.prompt)
        : { question: turn.prompt, around: turn.response },
      target: {
        kind: 'file',
        path,
        turnIndex: snapshot.turnIndex,
        response: turn.response,
        range,
        insertAt,
      },
      anchor: snapshot.anchor,
    });
  }, [panel, conversation, path, locate, closePanel, clearSelection]);

  const edit = useCallback((): void => {
    const snapshot = panel ?? snapshotAnswerSelection();
    const turn = snapshot ? conversation?.turns[snapshot.turnIndex] : undefined;
    if (!snapshot || !turn) return;
    const range = locate(turn.response, snapshot.text, snapshot.hint);
    startEdit(path, snapshot.turnIndex, turn.response, range?.start);
    closePanel();
    clearSelection();
    window.getSelection()?.removeAllRanges();
  }, [panel, conversation, path, locate, startEdit, closePanel, clearSelection]);

  const translating = translation.current !== null;
  const translateInto = useCallback((to?: TranslateLanguage): void => {
    openTranslation(to, held?.taken);
    setHeld(null);
  }, [openTranslation, held]);
  const languageMenuFor = useCallback((text: string) => ({
    content: (
      <LanguageMenuItems
        defaultTag={defaultTargetLanguage(text, locale, recentLanguages)}
        onPick={(tag) => translateInto(tag)}
        t={t}
      />
    ),
    onOpenChange: (opened: boolean) => {
      const state = liveSelection;
      const taken = opened ? takeSelectedText() : null;      setHeld(opened && state && taken ? { state, taken } : null);
    },
  }), [locale, recentLanguages, translateInto, liveSelection, t]);

  const actions = useMemo<SelectionAction[]>(() => {
    const translate: SelectionAction = {
      id: 'translate',
      label: t('chat.selection.translate'),
      Icon: Languages,
      expands: true,
      active: translating,
      run: translating ? closeTranslation : () => translateInto(),
      ...(translating || !selection ? {} : { hoverMenu: languageMenuFor(selection.text) }),
    };
    if (translating) return [translate];
    if (!selection && !panel) return [];
    const inAnswer = panel !== null || Boolean(selection?.inAnswer);
    const list: SelectionAction[] = [];
    if (inAnswer) {
      list.push({ id: 'rewrite', label: t('chat.selection.rewrite'), Icon: Sparkles, run: openPanel, expands: true, active: panel !== null });
      // Same lock as the answer's own pencil: an answer whose agent waits for a reply, or that is
      // being translated, stays as it is.
      const turnIndex = panel?.turnIndex ?? selection?.turnIndex ?? null;
      const runId = turnIndex === null ? undefined : conversation?.turns[turnIndex]?.meta.r;
      const awaiting = Boolean(runId) && runId === awaitingRun;
      const busy = turnIndex !== null && translateBusy(translateJobs[turnKey(path, turnIndex)]);
      if (canEdit && !awaiting && !busy) list.push({ id: 'edit', label: t('chat.selection.edit'), Icon: Pencil, run: edit });
    }
    if (panel) return list;
    const text = selection?.text ?? '';
    list.push({
      id: 'copy',
      label: t('chat.selection.copy'),
      Icon: Copy,
      run: () => {
        // The whole selection: the bar's copy of it is cut short for the quote and the lookup.
        void clipboardApi.copyText(window.getSelection()?.toString() || text);
        clearSelection();
      },
    });
    if (onQuote) {
      list.push({
        id: 'quote',
        label: t('chat.selection.quote'),
        Icon: Quote,
        run: () => {
          onQuote(text);
          clearSelection();
        },
      });
    }
    list.push(translate);
    if (sources.length > 0) {
      list.push({ id: 'sources', label: t('chat.selection.sources'), Icon: Library, run: () => setSourcesOpen((open) => !open) });
    } else if (onVerify) {
      list.push({
        id: 'verify',
        label: t('chat.selection.verify'),
        Icon: SearchCheck,
        run: () => { if (onVerify(text)) clearSelection(); },
      });
    }
    return list;
  }, [
    selection, panel, canEdit, conversation, awaitingRun, sources, onQuote, onVerify, openPanel, edit, clearSelection, t,
    translating, translateInto, closeTranslation, translateJobs, path, languageMenuFor,
  ]);

  const rect = panel
    ? rectOf(panel.range)
    : translation.current ? rectOf(translation.current.range) : selection?.rect ?? null;
  if (!rect || actions.length === 0) return null;

  const translatePanel = translation.current ? (
    <SelectionTranslatePanel
      state={translation.current}
      onRetarget={translation.retarget}
      {...(onQuote ? {
        onQuote: (text: string) => {
          onQuote(text);
          closeTranslation();
        },
      } : {})}
      t={t}
    />
  ) : undefined;

  return (
    <SelectionToolbar
      ref={toolbarRef}
      rect={rect}
      actions={actions}
      sources={sources}
      sourcesOpen={sourcesOpen}
      sourcesLabel={t('chat.selection.sourcesTitle')}
      onOpenSource={onOpenSource}
      panel={panel ? <WritingToolsPanel onRun={run} onClose={() => closePanel()} t={t} /> : translatePanel}
      {...(translatePanel ? { panelHeight: SELECTION_TRANSLATE_HEIGHT } : {})}
      {...(contentAreaRef.current ? { bounds: contentAreaRef.current.getBoundingClientRect() } : {})}
      t={t}
    />
  );
};
