import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { Box, Group, Loader, Table, Text, Tooltip, UnstyledButton } from '@mantine/core';
import { ChevronDown, ChevronUp, FileText, ScanText, TriangleExclamationPoint } from 'lucide-react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { formatByteSize } from '../../utils/byteSize';
import { measureElementKeepLast, observeRectKeepLast } from '../../utils/virtualKeepLast';
import type { KnowledgeFile } from '../../../../shared/knowledgeStatus';
import { fillTemplate } from '../../../../shared/fillTemplate';
import { clampWidth, fileTypeOf, KB_COLUMNS } from './knowledgeColumns';
import type { KbColumn, KbSort } from './knowledgeColumns';
import { extractNoneHint, extractTone, knowledgeSummaryStatus, splitKnowledgePath, summaryTone } from './knowledgeFileRows';
import type { KnowledgeRowAnalysis, KnowledgeRowTone } from './knowledgeFileRows';
import { KnowledgeSummaryHint } from './KnowledgeSummaryHint';
import { KnowledgeCheckCell } from './KnowledgeCheckCell';
import { rowKeyReachesList } from './knowledgeSelection';
import type { SelectMods } from './knowledgeSelection';
import { isMac } from '../../utils/keyLabels';

const TONE_COLOR: Record<KnowledgeRowTone, string> = {
  warning: 'var(--warning-text)',
  busy: 'var(--text-muted)',
  plain: 'var(--text-secondary)',
  empty: 'var(--text-muted)',
};

const EXTRACT_ICON = { text: FileText, ocr: ScanText, ocrPartial: ScanText, none: TriangleExclamationPoint } as const;
/** A row's height before it is measured (one line of name; a folder line makes it taller). */
const ROW_ESTIMATE = 37;
const CHECK_WIDTH = 32;
const CELL_CLIP: React.CSSProperties = { overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' };
const COLUMN_LABEL: Record<KbColumn, string> = {
  name: 'kb.page.col.name',
  modified: 'kb.page.col.modified',
  created: 'kb.page.col.created',
  type: 'kb.page.col.type',
  size: 'kb.page.col.size',
  extract: 'kb.page.col.extract',
  summary: 'kb.page.col.summary',
};

const StatusLabel: React.FC<{ tone: KnowledgeRowTone; icon: typeof FileText | null; label: string; detail: React.ReactNode; color?: string; maw?: number }> = ({
  tone, icon: Icon, label, detail, color = TONE_COLOR[tone], maw = 280,
}) => (
  <Tooltip label={detail} disabled={!detail} multiline maw={maw} position="bottom-start">
    <Group gap={6} wrap="nowrap" c={color}>
      {tone === 'busy' ? <Loader size={12} color="var(--text-muted)" /> : Icon ? <Icon size={14} style={{ flexShrink: 0 }} /> : null}
      <Text fz="var(--font-size-sm)" c={color} truncate="end">{label}</Text>
    </Group>
  </Tooltip>
);

interface HeaderCellProps {
  column: KbColumn;
  label: string;
  width: number;
  sort: KbSort;
  onSort: (column: KbColumn) => void;
  onResize: (column: KbColumn, width: number, done: boolean) => void;
  resizeLabel: string;
}

/** A header: click sorts (again = the other way); its right edge drags the column's width. */
function HeaderCell({ column, label, width, sort, onSort, onResize, resizeLabel }: HeaderCellProps): React.ReactElement {
  const drag = useRef<{ x: number; width: number } | null>(null);
  const sorted = sort.column === column;
  const Arrow = sort.direction === 'asc' ? ChevronUp : ChevronDown;
  const right = column === 'size';
  return (
    <Table.Th
      w={width}
      p={0}
      pos="relative"
      aria-sort={sorted ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      <UnstyledButton
        onClick={() => onSort(column)}
        w="100%"
        px={8}
        py={6}
        style={{ display: 'flex', alignItems: 'center', gap: 4, justifyContent: right ? 'flex-end' : 'flex-start' }}
      >
        <Text fz="var(--font-size-sm)" fw={600} truncate="end">{label}</Text>
        {sorted && <Arrow size={12} style={{ flexShrink: 0 }} />}
      </UnstyledButton>
      <Box
        role="separator"
        aria-orientation="vertical"
        aria-label={resizeLabel}
        pos="absolute"
        top={0}
        bottom={0}
        right={-3}
        w={6}
        style={{ cursor: 'col-resize', zIndex: 1, touchAction: 'none' }}
        onClick={(event) => event.stopPropagation()}
        onDoubleClick={(event) => event.stopPropagation()}
        onPointerDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = { x: event.clientX, width };
        }}
        onPointerMove={(event) => {
          const start = drag.current;
          if (start) onResize(column, clampWidth(start.width + event.clientX - start.x), false);
        }}
        onPointerUp={(event) => {
          const start = drag.current;
          drag.current = null;
          if (start) onResize(column, clampWidth(start.width + event.clientX - start.x), true);
        }}
      />
    </Table.Th>
  );
}

interface FileRowProps {
  kbId: string;
  index: number;
  measure: (element: Element | null) => void;
  file: KnowledgeFile;
  analysis: KnowledgeRowAnalysis | undefined;
  /** Drawn as selected: in the selection, or the row the preview shows. */
  active: boolean;
  checked: boolean;
  /** The list's one Tab stop (the keyboard's row). */
  focusable: boolean;
  onToggle: (rel: string) => void;
  onRowClick: (rel: string, mods: SelectMods) => void;
  onRowOpen: (rel: string) => void;
  onRowKey: (rel: string, event: React.KeyboardEvent<HTMLTableRowElement>) => void;
  onMenu: (rel: string, at: { x: number; y: number }) => void;
  formatDate: (ms: number) => string;
  t: (key: string) => string;
}

/** Ctrl on Windows/Linux, ⌘ on macOS: the modifier that adds one row to a file manager's selection. */
function selectMods(event: React.MouseEvent | React.KeyboardEvent): SelectMods {
  return { toggle: isMac ? event.metaKey : event.ctrlKey, range: event.shiftKey };
}

function drawsSame(a: KnowledgeFile, b: KnowledgeFile): boolean {
  return a === b || (a.path === b.path && a.read === b.read && a.size === b.size && a.mtime === b.mtime
    && a.created === b.created && a.error === b.error && a.ai?.at === b.ai?.at && a.ai?.stale === b.ai?.stale);
}

/** Memoised: a re-read list hands every row a new `file` object, so it compares what it draws. */
const FileRow = React.memo(FileRowView, (a, b) => a.kbId === b.kbId
  && a.index === b.index
  && a.active === b.active
  && a.checked === b.checked
  && a.focusable === b.focusable
  && a.analysis === b.analysis
  && a.formatDate === b.formatDate
  && a.t === b.t
  && a.onToggle === b.onToggle
  && a.onRowClick === b.onRowClick
  && a.onRowOpen === b.onRowOpen
  && a.onRowKey === b.onRowKey
  && a.onMenu === b.onMenu
  && a.measure === b.measure
  && drawsSame(a.file, b.file));

function FileRowView({
  kbId, index, measure, file, analysis, active, checked, focusable, onToggle, onRowClick, onRowOpen, onRowKey, onMenu, formatDate, t,
}: FileRowProps): React.ReactElement {
  const { name, folder } = splitKnowledgePath(file.path);
  const summary = knowledgeSummaryStatus(file, analysis);
  const extractIcon = file.read === 'pending' ? null : EXTRACT_ICON[file.read];
  // A written summary shows itself on hover (read on the first hover); a failure shows why.
  const summaryDetail: React.ReactNode = summary === 'failed'
    ? analysis?.error ?? ''
    : (summary === 'ready' || summary === 'stale') && file.ai
      ? (
        <KnowledgeSummaryHint
          kbId={kbId}
          path={file.path}
          at={file.ai.at}
          emptyLabel={t('kb.page.summaryNoText')}
          {...(summary === 'stale' ? { staleNote: t('kb.page.summaryStale') } : {})}
        />
      )
      : '';
  const cells: Record<KbColumn, React.ReactNode> = {
    name: (
      <>
        <Text fz="var(--font-size-sm)" truncate="end" title={file.path}>{name}</Text>
        {folder && <Text fz="var(--font-size-xs)" c="var(--text-muted)" truncate="end">{folder}</Text>}
      </>
    ),
    modified: formatDate(file.mtime),
    created: formatDate(file.created),
    type: fileTypeOf(file.path) ? fillTemplate(t('kb.page.type'), { ext: fileTypeOf(file.path) }) : '',
    size: formatByteSize(file.size),
    extract: (
      <StatusLabel
        tone={extractTone(file.read)}
        icon={extractIcon}
        label={t(`kb.page.extract.${file.read}`)}
        detail={file.read === 'none' ? t(extractNoneHint(file.error)) : ''}
      />
    ),
    summary: (
      <StatusLabel
        tone={summaryTone(summary)}
        icon={summary === 'failed' || summary === 'stale' ? TriangleExclamationPoint : null}
        label={t(`kb.page.summary.${summary}`)}
        detail={summaryDetail}
        maw={summary === 'failed' ? 280 : 360}
        {...(summary === 'failed' ? { color: 'var(--error-text)' } : {})}
      />
    ),
  };
  return (
    <Table.Tr
      ref={measure}
      data-index={index}
      bg={active || checked ? 'var(--accent-dim)' : undefined}
      aria-selected={checked}
      style={{ cursor: 'default' }}
      tabIndex={focusable ? 0 : -1}
      onClick={(event) => onRowClick(file.path, selectMods(event))}
      onDoubleClick={() => onRowOpen(file.path)}
      onContextMenu={(event) => {
        event.preventDefault();
        onMenu(file.path, { x: event.clientX, y: event.clientY });
      }}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        // Shift+F10 and the menu key open the row's menu, under its name, as a file manager does.
        if (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) {
          event.preventDefault();
          const rect = event.currentTarget.getBoundingClientRect();
          onMenu(file.path, { x: Math.round(rect.left + CHECK_WIDTH), y: Math.round(rect.bottom) });
          return;
        }
        if (!rowKeyReachesList(event.key)) return;
        onRowKey(file.path, event);
      }}
    >
      {/* The box ticks like Ctrl+click; it is not a Tab stop of its own (Space on the row does it). */}
      <KnowledgeCheckCell checked={checked} onToggle={() => onToggle(file.path)} label={name} />
      {KB_COLUMNS.map((column) => (
        <Table.Td
          key={column}
          ta={column === 'size' ? 'right' : undefined}
          c={column === 'name' || column === 'extract' || column === 'summary' ? undefined : 'var(--text-muted)'}
          className={column === 'modified' || column === 'created' || column === 'size' ? 'tabular-nums' : undefined}
          style={CELL_CLIP}
        >
          {cells[column]}
        </Table.Td>
      ))}
    </Table.Tr>
  );
}

interface TableHeaderProps {
  count: number;
  allSelected: boolean;
  someSelected: boolean;
  onSelectAll: (all: boolean) => void;
  sort: KbSort;
  onSort: (column: KbColumn) => void;
  widths: Readonly<Record<KbColumn, number>>;
  onResize: (column: KbColumn, width: number, done: boolean) => void;
  t: (key: string) => string;
}

/**
 * The header row. Memoised: the virtual list redraws the table on every scroll step, and the
 * header (seven cells with buttons and handles) would go with it each time (91 header
 * cells per scroll gesture).
 */
const TableHeader = React.memo(({
  count, allSelected, someSelected, onSelectAll, sort, onSort, widths, onResize, t,
}: TableHeaderProps) => (
  <Table.Thead>
    <Table.Tr>
      <KnowledgeCheckCell
        header
        focusable
        width={CHECK_WIDTH}
        checked={allSelected}
        indeterminate={someSelected && !allSelected}
        onToggle={() => onSelectAll(!allSelected)}
        label={t('selection.selectAll')}
      />
      {KB_COLUMNS.map((column) => (
        <HeaderCell
          key={column}
          column={column}
          label={fillTemplate(t(COLUMN_LABEL[column]), { count: String(count) })}
          width={widths[column]}
          sort={sort}
          onSort={onSort}
          onResize={onResize}
          resizeLabel={t('kb.page.col.resize')}
        />
      ))}
    </Table.Tr>
  </Table.Thead>
));
TableHeader.displayName = 'TableHeader';

export interface KnowledgeFileTableProps {
  kbId: string;
  files: readonly KnowledgeFile[];
  analysis: Readonly<Record<string, KnowledgeRowAnalysis>>;
  selected: ReadonlySet<string>;
  /** The keyboard's row; `focusTick` changing moves DOM focus to it (scrolled into view). */
  focusPath: string | null;
  focusTick: number;
  onToggle: (rel: string) => void;
  onSelectAll: (all: boolean) => void;
  /** A click on the list below its rows. */
  onClearSelection: () => void;
  detailPath: string | null;
  onRowClick: (rel: string, mods: SelectMods) => void;
  onRowOpen: (rel: string) => void;
  /** A key on a row; `page` is how many rows a Page key moves. */
  onRowKey: (rel: string, event: React.KeyboardEvent<HTMLTableRowElement>, page: number) => void;
  onMenu: (rel: string, at: { x: number; y: number }) => void;
  sort: KbSort;
  onSort: (column: KbColumn) => void;
  widths: Readonly<Record<KbColumn, number>>;
  onResize: (column: KbColumn, width: number, done: boolean) => void;
  locale: string;
  t: (key: string) => string;
}

/**
 * The files as a file manager lists them. Only the rows in view are drawn (a base can hold hundreds
 * of files, re-read while a folder is indexed: drawing every row held the window's main thread,
 * 643 rows ≈ 0.6 s per redraw); the spacer rows keep the scroll height.
 */
export const KnowledgeFileTable: React.FC<KnowledgeFileTableProps> = ({
  kbId, files, analysis, selected, focusPath, focusTick, onToggle, onSelectAll, onClearSelection, detailPath,
  onRowClick, onRowOpen, onRowKey, onMenu, sort, onSort, widths, onResize, locale, t,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const rowVirtualizer = useVirtualizer({
    count: files.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_ESTIMATE,
    overscan: 8,
    getItemKey: (index) => files[index]?.path ?? index,
    observeElementRect: observeRectKeepLast,
    measureElement: measureElementKeepLast,
  });
  const items = rowVirtualizer.getVirtualItems();
  const padTop = items[0]?.start ?? 0;
  const padBottom = items.length > 0 ? rowVirtualizer.getTotalSize() - (items[items.length - 1]?.end ?? 0) : 0;

  const dateFormat = useMemo(() => new Intl.DateTimeFormat(locale, {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }), [locale]);
  const formatDate = useCallback((ms: number) => (ms > 0 ? dateFormat.format(ms) : ''), [dateFormat]);

  const rowKey = useCallback((rel: string, event: React.KeyboardEvent<HTMLTableRowElement>) => {
    const height = scrollRef.current?.clientHeight ?? 0;
    onRowKey(rel, event, Math.max(1, Math.floor(height / ROW_ESTIMATE) - 1));
  }, [onRowKey]);

  // The keyboard moved to a row: scroll it into view (it may not be drawn yet) and focus it.
  const focusIndex = focusPath === null ? -1 : files.findIndex((file) => file.path === focusPath);
  const focusIndexRef = useRef(focusIndex);
  focusIndexRef.current = focusIndex;
  useEffect(() => {
    const index = focusIndexRef.current;
    if (focusTick === 0 || index < 0) return undefined;
    rowVirtualizer.scrollToIndex(index, { align: 'auto' });
    const frame = window.requestAnimationFrame(() => {
      scrollRef.current?.querySelector<HTMLElement>(`tr[data-index="${index}"]`)?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
    // Only a keyboard move asks for focus (not a click or a re-read list); the index comes from the ref.
  }, [focusTick, rowVirtualizer]);
  // The one Tab stop: the keyboard's row, or the first row before there is one.
  const tabPath = focusIndex >= 0 ? focusPath : files[0]?.path ?? null;

  const selectedCount = files.reduce((count, file) => count + (selected.has(file.path) ? 1 : 0), 0);
  const allSelected = files.length > 0 && selectedCount === files.length;
  const total = CHECK_WIDTH + KB_COLUMNS.reduce((sum, column) => sum + widths[column], 0);

  return (
    <Box
      ref={scrollRef}
      data-kb-files
      flex={1}
      miw={0}
      style={{ overflow: 'auto' }}
      // A click on the empty list below the rows clears the selection, as a file manager does.
      onClick={(event) => { if (event.target === event.currentTarget) onClearSelection(); }}
    >
      <Table
        highlightOnHover
        stickyHeader
        verticalSpacing={6}
        horizontalSpacing={8}
        fz="var(--font-size-sm)"
        // Shift+click selects rows, not the text in them.
        style={{ tableLayout: 'fixed', width: total, minWidth: total, userSelect: 'none' }}
      >
        <TableHeader
          count={files.length}
          allSelected={allSelected}
          someSelected={selectedCount > 0}
          onSelectAll={onSelectAll}
          sort={sort}
          onSort={onSort}
          widths={widths}
          onResize={onResize}
          t={t}
        />
        <Table.Tbody>
          {padTop > 0 && <Table.Tr aria-hidden style={{ height: padTop }} />}
          {items.map((item) => {
            const file = files[item.index];
            if (!file) return null;
            return (
              <FileRow
                key={file.path}
                kbId={kbId}
                index={item.index}
                measure={rowVirtualizer.measureElement}
                file={file}
                analysis={analysis[file.path]}
                active={file.path === detailPath}
                checked={selected.has(file.path)}
                focusable={file.path === tabPath}
                onToggle={onToggle}
                onRowClick={onRowClick}
                onRowOpen={onRowOpen}
                onRowKey={rowKey}
                onMenu={onMenu}
                formatDate={formatDate}
                t={t}
              />
            );
          })}
          {padBottom > 0 && <Table.Tr aria-hidden style={{ height: padBottom }} />}
        </Table.Tbody>
      </Table>
    </Box>
  );
};
