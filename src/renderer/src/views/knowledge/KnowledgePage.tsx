import React, { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Flex, Group, Loader, Stack, Text } from '@mantine/core';
import { FilePlus, FolderOpen, Library, MessageSquareText, Plus, ScanSearch, Sparkles, Trash, X } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { knowledgeApi } from '../../api/electronApi';
import { AiModelMenu } from '../../components/AiModelMenu';
import { AppButton } from '../../components/AppButton';
import { ChatHeaderRow } from '../../components/chat/ChatHeaderRow';
import { ToolbarIconButton, ToolbarSearchInput } from '../../components/PanelToolbar';
import { WebDialog } from '../../components/WebDialog';
import { showAppNotice } from '../../hooks/useUiNotifications';
import { useAppStore } from '../../store/appStore';
import { useI18nStore } from '../../store/i18nStore';
import { useKnowledgeStore } from '../../store/useKnowledgeStore';
import { fillTemplate } from '../../../../shared/fillTemplate';
import { KnowledgeContentSearch } from './KnowledgeContentSearch';
import { KnowledgeFileDetailPanel } from './KnowledgeFileDetail';
import { KnowledgeFileTable } from './KnowledgeFileTable';
import { KnowledgeFileMenu } from './KnowledgeFileMenu';
import type { KnowledgeFileMenuState } from './KnowledgeFileMenu';
import { loadListLayout, nextSort, saveListLayout, sortKnowledgeFiles } from './knowledgeColumns';
import type { KbColumn, KbListLayout } from './knowledgeColumns';
import { deleteNames, filterKnowledgeFiles, knowledgeSummaryStatus, pruneSelection, selectionActions } from './knowledgeFileRows';
import { clickSelect, contextSelect, EMPTY_SELECTION, listMoveOf, moveSelect, selectedInOrder } from './knowledgeSelection';
import type { KbSelection, SelectMods } from './knowledgeSelection';
import { matchesShortcut } from '../../store/shortcutStore';
import { isMac } from '../../utils/keyLabels';
import { importPathsIntoKnowledgeBase } from './knowledgeImport';
import { useKnowledgeFiles } from './useKnowledgeFiles';

/**
 * A knowledge base's page header, in the chat's header row (the window's title bar): its name, its
 * folder, indexing progress, and the folder in the file manager.
 */
export const KnowledgeHeader: React.FC<{ kbId: string }> = ({ kbId }) => {
  const t = useI18nStore((s) => s.t);
  const { base, status } = useKnowledgeStore(useShallow((s) => ({ base: s.bases.find((kb) => kb.id === kbId), status: s.statuses[kbId] })));
  const indexing = status?.state === 'indexing' && status.total > 0;
  return (
    <ChatHeaderRow>
      <Library size={16} style={{ flexShrink: 0 }} />
      <Text fw={600} fz="var(--font-size-md)" truncate="end">{base?.name ?? ''}</Text>
      <Text fz="var(--font-size-sm)" c="var(--text-muted)" truncate="start" miw={0} title={base?.folder}>{base?.folder}</Text>
      <Group gap={6} wrap="nowrap" ml="auto" style={{ flexShrink: 0 }}>
        {indexing && (
          <Group gap={6} wrap="nowrap">
            <Loader size={12} color="var(--text-muted)" />
            <Text fz="var(--font-size-sm)" c="var(--text-muted)" className="tabular-nums">
              {fillTemplate(t('kb.page.indexing'), { done: String(status.done), total: String(status.total) })}
            </Text>
          </Group>
        )}
        <ToolbarIconButton icon={FolderOpen} label={t('kb.page.showFolder')} onClick={() => { void knowledgeApi.openFolder(kbId); }} />
      </Group>
    </ChatHeaderRow>
  );
};

/**
 * Where F6 lands in the main region while a knowledge base is open: the file table's one Tab stop
 * (the keyboard's row), else — no rows, content search, still loading — the "Add files" button;
 * never the header's "show in folder" (WCAG 2.4.3).
 */
export const KB_REGION_FOCUS = '[data-kb-files] tbody tr[tabindex="0"] || [data-kb-add]';

interface KnowledgePageProps {
  kbId: string;
}

/**
 * A knowledge base's page, in a new chat's content area (its sidebar row opens it; the composer
 * below asks it): its files with how each one's text was extracted and its summary, adding (picked
 * here, or dropped anywhere on the page — copied into the folder, read by the watcher, OCR for
 * scans), removing (to the Recycle Bin), a content analysis for the files the user ticks with the
 * model they pick (queued, one at a time), and a file's source guide in a side panel.
 */
export const KnowledgePage: React.FC<KnowledgePageProps> = ({ kbId }) => {
  const t = useI18nStore((s) => s.t);
  const locale = useI18nStore((s) => s.locale);
  const base = useKnowledgeStore((s) => s.bases.find((kb) => kb.id === kbId));
  const openKnowledge = useAppStore((s) => s.openKnowledge);
  const askKnowledgeFiles = useAppStore((s) => s.askKnowledgeFiles);
  const { files, loaded, analysis, reload } = useKnowledgeFiles(kbId);
  const [selection, setSelection] = useState<KbSelection>(EMPTY_SELECTION);
  const { selected } = selection;
  // Bumped by a keyboard move only: the table then focuses the keyboard's row.
  const [focusTick, setFocusTick] = useState(0);
  const [detailPath, setDetailPath] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  // Off: the box filters file names; on: it searches what the documents say (the index, no model).
  const [contentSearch, setContentSearch] = useState(false);
  const [contentQuery, setContentQuery] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<string[] | null>(null);
  const [importing, setImporting] = useState(false);
  const [menu, setMenu] = useState<KnowledgeFileMenuState | null>(null);

  // The base was removed (sidebar, Settings): its page goes with it.
  useEffect(() => {
    if (!base && useKnowledgeStore.getState().bases.length > 0) openKnowledge(null);
  }, [base, openKnowledge]);

  // Files gone from the folder leave the panel.
  useEffect(() => {
    if (detailPath && !files.some((file) => file.path === detailPath)) setDetailPath(null);
  }, [files, detailPath]);

  // The order and the widths are the user's, remembered for every base (`knowledgeColumns`).
  const [layout, setLayout] = useState<KbListLayout>(loadListLayout);
  const updateLayout = useCallback((change: (current: KbListLayout) => KbListLayout, save: boolean) => {
    setLayout((current) => {
      const next = change(current);
      if (save) saveListLayout(next);
      return next;
    });
  }, []);
  const sortBy = useCallback((column: KbColumn) => updateLayout((current) => ({ ...current, sort: nextSort(current.sort, column) }), true), [updateLayout]);
  const resizeColumn = useCallback((column: KbColumn, width: number, done: boolean) => {
    updateLayout((current) => ({ ...current, widths: { ...current.widths, [column]: width } }), done);
  }, [updateLayout]);
  const resizePanel = useCallback((width: number, done: boolean) => updateLayout((current) => ({ ...current, panel: width }), done), [updateLayout]);

  // Filtered on a deferred copy: the field takes each keystroke at once, and the list (a filter and a
  // collated sort over every file, then the table) follows when the field is quiet.
  const listFilter = useDeferredValue(filter);
  const shown = useMemo(
    () => sortKnowledgeFiles(filterKnowledgeFiles(files, listFilter), layout.sort, (file) => knowledgeSummaryStatus(file, analysis[file.path]), locale),
    [files, listFilter, layout.sort, analysis, locale],
  );
  // The selection is only ever rows on screen: files gone from the folder and files the filter hides
  // leave it, so Delete never acts on a row the user cannot see (a ticked file,
  // filtered away, must not be the one "Delete" removes).
  useEffect(() => {
    setSelection((current) => {
      const next = pruneSelection(current.selected, shown);
      return next.size === current.selected.size ? current : { ...current, selected: next };
    });
  }, [shown]);
  const order = useMemo(() => shown.map((file) => file.path), [shown]);
  const { withAi, inQueue } = selectionActions(selected, files, analysis);
  const detailFile = detailPath ? files.find((file) => file.path === detailPath) : undefined;
  const picked = selectedInOrder(selected, order);
  const selectAll = useCallback((all: boolean) => {
    setSelection((current) => ({ ...current, selected: new Set(all ? order : []) }));
  }, [order]);
  const clearSelection = useCallback(() => setSelection((current) => ({ ...current, selected: new Set() })), []);
  const openFile = useCallback((rel: string) => { void knowledgeApi.openFile(kbId, rel); }, [kbId]);

  // The checkbox: Ctrl/⌘+click by another name.
  const toggle = useCallback((rel: string) => {
    setSelection((current) => clickSelect(current, rel, { toggle: true, range: false }, order));
  }, [order]);

  // A click selects as a file manager does; a plain one also shows the row in the preview panel,
  // and with the panel open it follows whichever row was clicked.
  const rowClick = useCallback((rel: string, mods: SelectMods) => {
    setSelection((current) => clickSelect(current, rel, mods, order));
    const plain = !mods.toggle && !mods.range;
    setDetailPath((current) => (plain || current !== null ? rel : current));
  }, [order]);

  // Read through refs so the rows' handlers stay the same while the selection changes (rows are memoised).
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  const detailRef = useRef(detailPath);
  detailRef.current = detailPath;

  const listKey = useCallback((rel: string, event: React.KeyboardEvent, page: number) => {
    if (event.nativeEvent.isComposing) return;
    const mods = { toggle: isMac ? event.metaKey : event.ctrlKey, range: event.shiftKey };
    const state = selectionRef.current;
    const { selected: now } = state;
    const current = { ...state, focus: state.focus ?? rel };
    const handled = (next: KbSelection | null, moveFocus: boolean): void => {
      event.preventDefault();
      // The page's keys stop here: the chat view's own shortcuts (Delete deletes conversations) must not see them.
      event.stopPropagation();
      if (!next) return;
      setSelection(next);
      if (detailRef.current !== null && next.focus !== null) setDetailPath(next.focus);
      if (moveFocus) setFocusTick((tick) => tick + 1);
    };
    const move = listMoveOf(event.key);
    if (move) return handled(moveSelect(current, move, mods, order, page), true);
    const focus = current.focus;
    if (event.key === ' ') {
      // Space selects the row and shows it, as a click does; Ctrl/⌘+Space adds or removes it.
      handled(clickSelect(current, focus, { toggle: mods.toggle, range: false }, order), false);
      if (!mods.toggle) setDetailPath(focus);
      return;
    }
    if (event.key === 'Enter') {
      handled(null, false);
      openFile(focus);
      return;
    }
    if (mods.toggle && !mods.range && event.key.toLowerCase() === 'a') return handled({ ...current, selected: new Set(order) }, false);
    if (event.key === 'Escape' && now.size > 0) return handled({ ...current, selected: new Set() }, false);
    if (matchesShortcut(event.nativeEvent, 'files.delete') && now.size > 0) {
      handled(null, false);
      setConfirmDelete(selectedInOrder(now, order));
    }
  }, [order, openFile]);

  // A right-click on a row outside the selection selects that row first; inside, it acts on all of it.
  const openMenu = useCallback((rel: string, at: { x: number; y: number }) => {
    const next = contextSelect(selectionRef.current, rel);
    setSelection(next);
    setMenu({ ...at, rels: selectedInOrder(next.selected, order) });
  }, [order]);
  const closeMenu = useCallback(() => setMenu(null), []);
  const refocusList = useCallback(() => setFocusTick((tick) => tick + 1), []);
  const menuActions = menu ? selectionActions(new Set(menu.rels), files, analysis) : { withAi: [], inQueue: [] };

  const pickFiles = useCallback(() => {
    void knowledgeApi.pickFiles().then(async (paths) => {
      if (paths.length === 0) return;
      setImporting(true);
      try {
        if (await importPathsIntoKnowledgeBase(kbId, paths, t)) reload();
      } finally {
        setImporting(false);
      }
    });
  }, [kbId, reload, t]);

  const analyze = useCallback((rels: string[], model: string) => {
    if (rels.length > 0) void knowledgeApi.analyze(kbId, rels, model);
  }, [kbId]);

  const clearSummary = useCallback((rels: string[]) => {
    void knowledgeApi.clearAi(kbId, rels).then(reload);
  }, [kbId, reload]);

  const deleteFiles = useCallback((rels: string[]) => {
    setConfirmDelete(null);
    void knowledgeApi.deleteFiles(kbId, rels).then((removed) => {
      reload();
      if (removed < rels.length) {
        showAppNotice({ level: 'warning', message: fillTemplate(t('kb.page.deleteFailed'), { count: String(rels.length - removed) }) });
      }
    });
  }, [kbId, reload, t]);

  return (
    <Flex h="100%" miw={0} style={{ overflow: 'hidden' }}>
      <Stack gap={8} flex={1} miw={0} px={20} pt={4} pb={8} style={{ overflow: 'hidden' }}>
        <Group gap={6} wrap="nowrap">
          <AppButton data-kb-add size="compact-sm" variant="subtle" leftSection={<Plus size={14} />} loading={importing} onClick={pickFiles}>
            {t('kb.page.add')}
          </AppButton>
          {/* The composer below answers from the ticked documents alone (say, a draft and the
              signed version in one base); the mode menu lifts it. */}
          <AppButton
            size="compact-sm"
            variant="subtle"
            leftSection={<MessageSquareText size={14} />}
            disabled={picked.length === 0}
            onClick={() => askKnowledgeFiles(kbId, picked)}
          >
            {t('kb.page.askSelected')}
          </AppButton>
          <AiModelMenu
            menuLabel={fillTemplate(t('kb.analyze.menu'), { count: String(picked.length) })}
            onPick={(url) => analyze(picked, url)}
            disabled={picked.length === 0}
            position="bottom-start"
          >
            <AppButton size="compact-sm" variant="subtle" leftSection={<Sparkles size={14} />} disabled={picked.length === 0}>
              {t('kb.analyze.action')}
            </AppButton>
          </AiModelMenu>
          {inQueue.length > 0 && (
            <AppButton size="compact-sm" variant="subtle" leftSection={<X size={14} />} onClick={() => { void knowledgeApi.cancelAnalysis(kbId, inQueue); }}>
              {t('kb.analyze.cancel')}
            </AppButton>
          )}
          {withAi.length > 0 && (
            <AppButton size="compact-sm" variant="subtle" onClick={() => clearSummary(withAi)}>
              {t('kb.analyze.clear')}
            </AppButton>
          )}
          <AppButton
            size="compact-sm"
            variant="subtle"
            color="red"
            leftSection={<Trash size={14} />}
            disabled={picked.length === 0}
            onClick={() => setConfirmDelete(picked)}
          >
            {t('kb.page.delete')}
          </AppButton>
          <Box flex={1} />
          <ToolbarIconButton
            icon={ScanSearch}
            label={t('kb.search.toggle')}
            active={contentSearch}
            onClick={() => {
              // The table goes away while searching: nothing selected may stay behind, out of sight.
              setSelection(EMPTY_SELECTION);
              setContentSearch((on) => !on);
            }}
          />
          <ToolbarSearchInput
            value={contentSearch ? contentQuery : filter}
            onChange={contentSearch ? setContentQuery : setFilter}
            placeholder={t(contentSearch ? 'kb.search.placeholder' : 'kb.page.filter')}
            clearLabel={t('kb.page.filterClear')}
            flex={0}
            miw={220}
          />
        </Group>

        {contentSearch ? (
          <KnowledgeContentSearch kbId={kbId} query={contentQuery} openPath={detailPath} onOpen={setDetailPath} t={t} />
        ) : !loaded ? (
          <Loader size="sm" m="md" />
        ) : files.length === 0 ? (
          <Stack align="center" justify="center" gap={8} py={48} c="var(--text-muted)">
            <FilePlus size={28} />
            <Text fz="var(--font-size-md)" fw={600} c="var(--mantine-color-text)">{t('kb.page.empty.title')}</Text>
            <Text fz="var(--font-size-sm)" c="var(--text-muted)" ta="center" maw={420}>{t('kb.page.empty.detail')}</Text>
          </Stack>
        ) : (
          <KnowledgeFileTable
            kbId={kbId}
            files={shown}
            analysis={analysis}
            selected={selected}
            focusPath={selection.focus}
            focusTick={focusTick}
            onToggle={toggle}
            onSelectAll={selectAll}
            onClearSelection={clearSelection}
            detailPath={detailPath}
            onRowClick={rowClick}
            onRowOpen={openFile}
            onRowKey={listKey}
            onMenu={openMenu}
            sort={layout.sort}
            onSort={sortBy}
            widths={layout.widths}
            onResize={resizeColumn}
            locale={locale}
            t={t}
          />
        )}
      </Stack>

      {detailFile && (
        <KnowledgeFileDetailPanel
          kbId={kbId}
          file={detailFile}
          analysis={analysis[detailFile.path]}
          onAnalyze={analyze}
          onClear={clearSummary}
          onClose={() => setDetailPath(null)}
          width={layout.panel}
          onResize={resizePanel}
          t={t}
        />
      )}

      <KnowledgeFileMenu
        menu={menu}
        onClose={closeMenu}
        onEscape={refocusList}
        withAi={menuActions.withAi}
        inQueue={menuActions.inQueue}
        onPreview={setDetailPath}
        onOpenFile={(rel) => { void knowledgeApi.openFile(kbId, rel); }}
        onReveal={(rel) => { void knowledgeApi.revealFile(kbId, rel); }}
        onAsk={(rels) => askKnowledgeFiles(kbId, rels)}
        onAnalyze={analyze}
        onCancel={(rels) => { void knowledgeApi.cancelAnalysis(kbId, rels); }}
        onClear={clearSummary}
        onDelete={setConfirmDelete}
        t={t}
      />

      <WebDialog
        open={confirmDelete !== null}
        title={fillTemplate(t('kb.page.deleteConfirm.title'), { count: String(confirmDelete?.length ?? 0) })}
        description={`${deleteNames(confirmDelete ?? [], t)}${t('kb.page.deleteConfirm.detail')}`}
        confirmText={t('kb.page.delete')}
        cancelText={t('kb.page.cancel')}
        danger
        onConfirm={() => { if (confirmDelete) deleteFiles(confirmDelete); }}
        onCancel={() => setConfirmDelete(null)}
      />
    </Flex>
  );
};
