import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Badge, Box, Group, Popover, Text, UnstyledButton } from '@mantine/core';
import { Undo2 } from 'lucide-react';
import { dedentPair } from '../../../../shared/docAssistant';
import type { NotionPendingChange } from '../../../../shared/notion/notionSyncTypes';
import { AppButton } from '../../components/AppButton';
import { RenderedDiff } from '../../components/chat/RenderedDiff';
import { locateChanges, setHighlight, type ChangeSpot } from './documentMarks';

interface DocumentChangeMarksProps {
  /** The document as written (the spaced body), which the page under the marks is drawn from. */
  body: string;
  changes: readonly NotionPendingChange[];
  /** A sync is running: nothing is taken back meanwhile. */
  busy: boolean;
  onRevert: (id: string) => void;
  t: (key: string) => string;
}

/** What a change did, for its colour: the same three an editor's gutter uses, and one for what cannot be sent. */
type MarkTone = 'changed' | 'added' | 'removed' | 'blocked';

interface MarkBox {
  id: string;
  /** From the top of the reading column; a removal is a point between two blocks (height 0). */
  top: number;
  height: number;
  tone: MarkTone;
}

const TONE_COLOR: Record<MarkTone, string> = {
  changed: 'var(--accent)',
  added: 'var(--mantine-color-success)',
  removed: 'var(--mantine-color-error)',
  blocked: 'var(--mantine-color-warning)',
};

const HOVER_HIGHLIGHT = 'yobi-change-hover';
/** Resting on a change this long opens its card: passing over it on the way elsewhere does not. */
const OPEN_DELAY_MS = 500;
/** Time to move from the change to its card without it closing. */
const CLOSE_DELAY_MS = 350;
/** The card hangs this far from its change; the change's hover band reaches over the gap, either side. */
const CARD_OFFSET = 6;
const BAND_SLACK = CARD_OFFSET + 4;

function toneOf(spot: ChangeSpot): MarkTone {
  if (spot.change.locked || spot.change.conflict) return 'blocked';
  if (spot.edge !== 'whole') return 'removed';
  return spot.change.before.trim() ? 'changed' : 'added';
}

function boxOf(spot: ChangeSpot, origin: DOMRect): MarkBox {
  const rect = spot.range.getBoundingClientRect();
  const tone = toneOf(spot);
  if (spot.edge === 'whole') return { id: spot.change.id, top: rect.top - origin.top, height: rect.height, tone };
  return { id: spot.change.id, top: (spot.edge === 'after' ? rect.bottom + 6 : rect.top - 6) - origin.top, height: 0, tone };
}

function sameBoxes(a: readonly MarkBox[], b: readonly MarkBox[]): boolean {
  return a.length === b.length && a.every((box, i) => {
    const other = b[i];
    return box.id === other.id && box.tone === other.tone && Math.abs(box.top - other.top) < 0.5 && Math.abs(box.height - other.height) < 0.5;
  });
}

/** The card a change opens: what Notion has there and what the document has now, as both read. */
const ChangeCard: React.FC<{ change: NotionPendingChange; busy: boolean; onRevert: () => void; t: (key: string) => string }> = ({
  change, busy, onRevert, t,
}) => {
  const [before, after] = dedentPair(change.before, change.after);
  const reason = change.conflict ? t('notion.sync.conflictReason') : change.locked ? t('notion.sync.lockedReason') : null;
  return (
    <Box style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <Group justify="space-between" gap={8} mb={8} wrap="nowrap" style={{ flexShrink: 0 }}>
        <Text fz="var(--font-size-xs)" c="var(--text-muted)" truncate>
          {change.heading ? t('notion.sync.under').replace('{{heading}}', change.heading) : t('notion.sync.top')}
        </Text>
        {(change.conflict || change.locked) && (
          <Badge variant="light" size="sm" color="var(--mantine-color-warning)" style={{ flexShrink: 0 }}>
            {t(change.conflict ? 'notion.sync.conflictBadge' : 'notion.sync.lockedBadge')}
          </Badge>
        )}
      </Group>
      {reason && <Text fz="var(--font-size-xs)" c="var(--text-secondary)" mb={8} style={{ flexShrink: 0 }}>{reason}</Text>}
      {/* The card is capped to the room on its side of the change; the comparison scrolls inside it. */}
      <Box style={{ flex: 1, minHeight: 0, overflowY: 'auto' }} pr={4}>
        <RenderedDiff
          before={before}
          after={after}
          beforeLabel={t('notion.marks.before')}
          afterLabel={before ? t('notion.marks.after') : t('notion.sync.added')}
          srRemoved={t('history.diff.removed')}
          srAdded={t('history.diff.added')}
        />
        {!after && <Text fz="var(--font-size-xs)" c="var(--text-muted)" pl={50} mt={4}>{t('notion.marks.removed')}</Text>}
      </Box>
      <Group justify="flex-end" mt={10} style={{ flexShrink: 0 }}>
        <AppButton size="compact-sm" variant="subtle" leftSection={<Undo2 size={13} />} disabled={busy} onClick={onRevert}>
          {t('notion.marks.revert')}
        </AppButton>
      </Group>
    </Box>
  );
};

/**
 * The document as its own sync preview: every place that differs from Notion has a bar in the
 * margin, the way an editor marks unsaved lines — whoever changed it (the writing assistant, the
 * editor, another app). Resting on the place (or clicking its bar) opens a card with Notion's text
 * and the document's, and a way back to Notion's. Sits in the reading column, over the page.
 */
export const DocumentChangeMarks: React.FC<DocumentChangeMarksProps> = ({ body, changes, busy, onRevert, t }) => {
  const layerRef = useRef<HTMLDivElement>(null);
  const spotsRef = useRef<Map<string, ChangeSpot>>(new Map());
  const [boxes, setBoxes] = useState<MarkBox[]>([]);
  const boxesRef = useRef(boxes);
  boxesRef.current = boxes;
  const [openId, setOpenId] = useState<string | null>(null);
  const hoveredRef = useRef<string | null>(null);
  const pinnedRef = useRef(false);
  /**
   * The pointer is on the card. Asked when the close timer fires, not when it is set: moving from
   * the page onto the card, React's enter (built from `mouseout`) comes before the column's native
   * `mouseleave`, which would schedule the close after the card had cancelled it.
   */
  const overCardRef = useRef(false);
  const timers = useRef<{ open?: number; close?: number }>({});

  // Where each change is on the page, again whenever the page is drawn again or changes size.
  useEffect(() => {
    const layer = layerRef.current;
    const column = layer?.parentElement;
    if (!layer || !column) return undefined;
    let frame = 0;
    const measure = (): void => {
      frame = 0;
      const scope = column.querySelector<HTMLElement>('[data-find-scope]');
      const spots = scope ? locateChanges(scope, body, changes) : [];
      spotsRef.current = new Map(spots.map((spot) => [spot.change.id, spot]));
      const origin = layer.getBoundingClientRect();
      const next = spots.map((spot) => boxOf(spot, origin));
      setBoxes((prev) => (sameBoxes(prev, next) ? prev : next));
    };
    const schedule = (): void => {
      if (!frame) frame = window.requestAnimationFrame(measure);
    };
    schedule();
    const resize = new ResizeObserver(schedule);
    resize.observe(column);
    // Code blocks, formulas and diagrams finish drawing after the text.
    const mutation = new MutationObserver(schedule);
    const scope = column.querySelector('[data-find-scope]');
    if (scope) mutation.observe(scope, { childList: true, subtree: true, characterData: true });
    return () => {
      resize.disconnect();
      mutation.disconnect();
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [body, changes]);

  const clearTimers = useCallback((): void => {
    window.clearTimeout(timers.current.open);
    window.clearTimeout(timers.current.close);
  }, []);

  const close = useCallback((): void => {
    clearTimers();
    pinnedRef.current = false;
    overCardRef.current = false;
    setOpenId(null);
  }, [clearTimers]);

  const scheduleClose = useCallback((): void => {
    if (pinnedRef.current) return;
    window.clearTimeout(timers.current.close);
    timers.current.close = window.setTimeout(() => {
      if (!overCardRef.current && !pinnedRef.current) setOpenId(null);
    }, CLOSE_DELAY_MS);
  }, []);

  /** The change under the pointer (null: none): its text is tinted, and after a rest its card opens. */
  const hover = useCallback((id: string | null): void => {
    if (hoveredRef.current === id) return;
    hoveredRef.current = id;
    const spot = id ? spotsRef.current.get(id) : undefined;
    setHighlight(HOVER_HIGHLIGHT, spot?.edge === 'whole' ? spot.range : null);
    window.clearTimeout(timers.current.open);
    if (!id) {
      scheduleClose();
      return;
    }
    window.clearTimeout(timers.current.close);
    timers.current.open = window.setTimeout(() => {
      // Selecting text is reading, not asking about the change: the selection toolbar has the place.
      if (window.getSelection()?.toString().trim()) return;
      pinnedRef.current = false;
      setOpenId(id);
    }, OPEN_DELAY_MS);
  }, [scheduleClose]);

  useEffect(() => {
    const column = layerRef.current?.parentElement;
    const layer = layerRef.current;
    if (!column || !layer) return undefined;
    const onMove = (event: MouseEvent): void => {
      // A button held down is a selection being dragged.
      if (event.buttons !== 0) return;
      const y = event.clientY - layer.getBoundingClientRect().top;
      const hit = boxesRef.current.find((box) => y >= box.top - BAND_SLACK && y <= box.top + Math.max(box.height, 4) + BAND_SLACK);
      hover(hit?.id ?? null);
    };
    const onLeave = (): void => hover(null);
    column.addEventListener('mousemove', onMove);
    column.addEventListener('mouseleave', onLeave);
    return () => {
      column.removeEventListener('mousemove', onMove);
      column.removeEventListener('mouseleave', onLeave);
    };
  }, [hover]);

  // Nothing of it stays behind: no tint, no timer about to open a card.
  useEffect(() => () => {
    clearTimers();
    setHighlight(HOVER_HIGHLIGHT, null);
  }, [clearTimers]);

  const open = boxes.find((box) => box.id === openId) ?? null;
  const openChange = open ? changes.find((change) => change.id === open.id) ?? null : null;

  return (
    <Box ref={layerRef} pos="absolute" inset={0} style={{ pointerEvents: 'none' }} data-selection-ignore data-find-omit>
      {boxes.map((box) => {
        const change = changes.find((entry) => entry.id === box.id);
        const where = change?.heading ? t('notion.sync.under').replace('{{heading}}', change.heading) : t('notion.sync.top');
        return (
          <UnstyledButton
            key={box.id}
            aria-label={t('notion.marks.label').replace('{{where}}', where)}
            aria-expanded={openId === box.id}
            onClick={() => {
              clearTimers();
              pinnedRef.current = openId !== box.id;
              setOpenId((current) => (current === box.id ? null : box.id));
            }}
            pos="absolute"
            left={8}
            top={box.height ? box.top : box.top - 4}
            w={14}
            h={box.height ? box.height : 8}
            style={{ pointerEvents: 'auto', display: 'flex', justifyContent: 'center', cursor: 'pointer' }}
          >
            <Box
              w={box.height ? 3 : 8}
              h="100%"
              style={{
                background: TONE_COLOR[box.tone],
                borderRadius: box.height ? 2 : 4,
                opacity: openId === box.id ? 1 : 0.75,
              }}
            />
          </UnstyledButton>
        );
      })}
      <Popover
        opened={open !== null && openChange !== null}
        onChange={(opened) => { if (!opened) close(); }}
        position="bottom-start"
        offset={CARD_OFFSET}
        width={440}
        shadow="md"
        // Capped to the room on its side (`size` sets the dropdown's max height), as the block editor's tools are.
        middlewares={{ flip: true, shift: { padding: 12 }, size: { padding: 12 } }}
        returnFocus={false}
      >
        <Popover.Target>
          {/* Where the card hangs from: the change's own span of the column. */}
          <Box pos="absolute" left={28} right={28} top={open?.top ?? 0} h={Math.max(open?.height ?? 0, 2)} style={{ pointerEvents: 'none' }} />
        </Popover.Target>
        <Popover.Dropdown
          p={12}
          style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
          data-selection-ignore
          onMouseEnter={() => {
            overCardRef.current = true;
            window.clearTimeout(timers.current.close);
          }}
          onMouseLeave={() => {
            overCardRef.current = false;
            scheduleClose();
          }}
        >
          {openChange && (
            <ChangeCard
              change={openChange}
              busy={busy}
              onRevert={() => {
                close();
                onRevert(openChange.id);
              }}
              t={t}
            />
          )}
        </Popover.Dropdown>
      </Popover>
    </Box>
  );
};
