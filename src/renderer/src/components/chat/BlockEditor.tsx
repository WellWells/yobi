import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Box, Button, Popover, Text } from '@mantine/core';
import { Sparkles } from 'lucide-react';
import type { WritingAction } from '../../../../shared/writingTools';
import { AppTextarea } from '../AppTextarea';
import { MessageMarkdown } from './MessageMarkdown';
import { RewriteResultCard } from './RewriteResultCard';
import { WritingToolsPanel } from './WritingToolsPanel';
import { contextAround, startRewrite } from './writingToolsActions';
import { useAppStore } from '../../store/appStore';
import { usePressOutside } from '../../hooks/usePressOutside';
import { matchesShortcut } from '../../store/shortcutStore';
import { useWritingToolsStore } from '../../store/writingToolsStore';
import {
  blockIndexAt, splitMarkdownBlocks, type MarkdownBlock,
} from '../../utils/markdownBlocks';
import { notionEditorBlocks, selectionLocator, type SelectionLocator } from '../../utils/notionEditorBlocks';
import styles from './BlockEditor.module.css';
import { READING_TEXT_STYLE } from '../../styles/readingText';

interface Layout {
  blocks: MarkdownBlock[];
  /** The text length the blocks were measured against. */
  length: number;
}

interface ActiveBlock {
  index: number;
  /** Frozen while a block is open: only that block's text changes, so the others just shift. */
  layout: Layout;
  /** Where the caret goes when the block opens, relative to the block. */
  caret: number;
}

interface BlockEditorProps {
  path: string;
  turnIndex: number;
  text: string;
  onChange: (text: string) => void;
  /** Open the block holding this source offset, caret there; then `onFocusConsumed`. */
  focus?: number;
  onFocusConsumed: () => void;
  t: (key: string) => string;
  /** A Notion document: Notion's blocks, shown as Notion has them; tables and child pages stay closed. */
  notion?: boolean;
}

const EMPTY_LAYOUT: Layout = { blocks: [], length: 0 };

function measure(text: string, notion: boolean): Layout {
  return { blocks: notion ? notionEditorBlocks(text) : splitMarkdownBlocks(text), length: text.length };
}

/** Blocks against the current text: those after the open block move by however much it grew. */
function placeBlocks(layout: Layout, active: ActiveBlock | null, length: number): MarkdownBlock[] {
  if (!active) return layout.blocks;
  const delta = length - layout.length;
  return layout.blocks.map((block, index) => {
    if (index < active.index) return block;
    if (index === active.index) return { ...block, end: block.end + delta };
    return { ...block, start: block.start + delta, end: block.end + delta };
  });
}

function visibleLength(text: string): number {
  return text.replace(/\s+/g, '').length;
}

/** Where in the block's Markdown a click landed, from the text rendered before the caret. */
function caretFromClick(content: HTMLElement, source: string, locate: SelectionLocator): number | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || !content.contains(selection.focusNode)) return null;
  const before = document.createRange();
  before.setStart(content, 0);
  before.setEnd(selection.focusNode!, selection.focusOffset);
  const shown = before.toString();
  const tail = shown.replace(/\s+/g, '').slice(-12);
  if (!tail) return 0;
  return locate(source, tail, { before: visibleLength(shown) - tail.length })?.end ?? null;
}

/**
 * The answer editor's paragraph mode: every block shows as it will read, and turns into its
 * Markdown only when clicked, one at a time. Nothing converts the Markdown to and from another
 * model, so footnotes, formulas, diagrams and `<details>` survive editing untouched. Each block
 * can also be sent through the writing tools; the result lands under it and changes the draft.
 */
export const BlockEditor: React.FC<BlockEditorProps> = ({ path, turnIndex, text, onChange, focus, onFocusConsumed, t, notion = false }) => {
  const [active, setActive] = useState<ActiveBlock | null>(null);
  const [toolsFor, setToolsFor] = useState<number | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const job = useWritingToolsStore((s) => s.job);
  // The question this answer replied to, sent with a paragraph's rewrite as context.
  const question = useAppStore((s) => (
    s.selectedFile?.path === path ? s.conversation?.turns[turnIndex]?.prompt : undefined
  ));

  const locate = useMemo(() => selectionLocator(notion, t), [notion, t]);

  const live = useMemo(() => (active ? null : measure(text, notion)), [active, text, notion]);
  const layout = active?.layout ?? live ?? EMPTY_LAYOUT;
  const blocks = placeBlocks(layout, active, text.length);
  const definitions = blocks
    .filter((block) => block.kind === 'definition')
    .map((block) => text.slice(block.start, block.end))
    .join('\n\n');

  /**
   * Opens the block holding `offset`, measured afresh: the block closed a moment ago may have been
   * split in two or joined to the next, so an index from the old layout could name the wrong one.
   */
  const openAt = useCallback((offset: number): void => {
    const current = measure(text, notion);
    const index = blockIndexAt(current.blocks, offset);
    if (index < 0 || current.blocks[index].kind === 'locked') return;
    setActive({ index, layout: current, caret: Math.max(0, offset - current.blocks[index].start) });
  }, [text, notion]);

  // Opened from a selection ("edit" on the bar): straight to that block, caret where the selection began.
  useEffect(() => {
    if (focus === undefined) return;
    openAt(focus);
    onFocusConsumed();
  }, [focus, openAt, onFocusConsumed]);

  // Only when a block opens: typing changes the text, never `active`, so the caret is left alone.
  useLayoutEffect(() => {
    const area = textareaRef.current;
    if (!active || !area) return;
    area.focus({ preventScroll: true });
    const caret = Math.min(active.caret, area.value.length);
    area.setSelectionRange(caret, caret);
    area.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const rootRef = useRef<HTMLDivElement>(null);
  /** Focus back on the editor card, so Ctrl+S and Esc keep working after a panel or a paragraph closes. */
  const focusEditor = useCallback((): void => {
    rootRef.current?.closest<HTMLElement>('[tabindex="-1"]')?.focus({ preventScroll: true });
  }, []);

  // A press on a paragraph's own "rewrite" button is its toggle, not a press outside.
  usePressOutside([panelRef], (target) => {
    if (!target.closest('[data-block-tools]')) setToolsFor(null);
  }, toolsFor !== null);

  const closeTools = useCallback((): void => {
    setToolsFor(null);
    focusEditor();
  }, [focusEditor]);

  const run = useCallback((index: number, action: WritingAction, instruction?: string): void => {
    const block = blocks[index];
    if (!block) return;
    setToolsFor(null);
    setActive(null);
    focusEditor();
    void startRewrite({
      action,
      ...(instruction ? { instruction } : {}),
      text: text.slice(block.start, block.end),
      context: contextAround(text, block, question),
      target: { kind: 'draft', path, turnIndex, original: text, range: { start: block.start, end: block.end } },
    });
  }, [blocks, text, question, path, turnIndex, focusEditor]);

  const draftTarget = job?.target.kind === 'draft' && job.target.path === path && job.target.turnIndex === turnIndex
    ? job.target
    : null;
  const draftJob = draftTarget ? job : null;
  const jobBlock = draftTarget ? blockIndexAt(blocks, draftTarget.range.start) : -1;

  // The result card held focus (its buttons); when it goes, focus comes back to the editor so Ctrl+S still saves.
  const hadCard = useRef(false);
  useEffect(() => {
    const hasCard = draftJob !== null;
    if (hadCard.current && !hasCard && (document.activeElement === document.body || !document.activeElement)) focusEditor();
    hadCard.current = hasCard;
  }, [draftJob, focusEditor]);

  if (blocks.length === 0) {
    return (
      <AppTextarea
        tone="body"
        autosize
        minRows={4}
        value={text}
        aria-label={t('chat.edit.title')}
        placeholder={t('chat.edit.emptyHint')}
        onChange={(event) => {
          const value = event.currentTarget.value;
          const caret = event.currentTarget.selectionStart;
          onChange(value);
          // The first character makes a paragraph, which would replace this box and drop the focus:
          // that paragraph opens right away, caret where the typing is.
          const next = measure(value, notion);
          const index = blockIndexAt(next.blocks, caret);
          if (index >= 0) setActive({ index, layout: next, caret: Math.max(0, caret - next.blocks[index].start) });
        }}
      />
    );
  }

  return (
    <Box ref={rootRef}>
      {blocks.map((block, index) => {
        const source = text.slice(block.start, block.end);
        const card = index === jobBlock && draftJob ? <RewriteResultCard job={draftJob} t={t} /> : null;

        if (active?.index === index) {
          return (
            <React.Fragment key={`b${index}`}>
              <Box className={styles.active}>
                <AppTextarea
                  ref={textareaRef}
                  tone="body"
                  autosize
                  minRows={1}
                  value={source}
                  aria-label={t('chat.edit.block')}
                  onChange={(event) => onChange(`${text.slice(0, block.start)}${event.currentTarget.value}${text.slice(block.end)}`)}
                  onBlur={() => setActive(null)}
                  onKeyDown={(event) => {
                    // Esc closes the open paragraph first; the next Esc reaches the editor and cancels.
                    if (event.nativeEvent.isComposing || !matchesShortcut(event, 'answerEditor.cancel')) return;
                    event.preventDefault();
                    event.stopPropagation();
                    setActive(null);
                    focusEditor();
                  }}
                  styles={{ input: { fontSize: 'var(--font-size-md)', lineHeight: 1.7 } }}
                />
              </Box>
              {card}
            </React.Fragment>
          );
        }

        if (block.kind === 'locked') {
          return (
            <Box key={`b${index}`} className={styles.locked}>
              <Box className="md-content" style={{ ...READING_TEXT_STYLE, lineHeight: 1.75, color: 'var(--text-primary)' }}>
                <MessageMarkdown notion={notion}>{source}</MessageMarkdown>
              </Box>
              <Text fz="var(--font-size-xs)" c="var(--text-muted)">{t('notion.block.lockedHint')}</Text>
            </Box>
          );
        }

        return (
          <React.Fragment key={`b${index}`}>
            <Box
              className={styles.block}
              data-rewriting={index === jobBlock || undefined}
              // A link in an answer being edited is text to edit, not a page to open.
              // Events from the writing tools panel reach here through the React tree (it is portalled
              // out of the block in the DOM); only presses on the block itself count.
              onClickCapture={(event) => {
                if (!event.currentTarget.contains(event.target as Node)) return;
                if ((event.target as Element).closest('a')) event.preventDefault();
              }}
              onMouseUp={(event) => {
                if (!event.currentTarget.contains(event.target as Node)) return;
                if (event.button !== 0 || (event.target as Element).closest('[data-block-tools]')) return;
                const content = event.currentTarget.querySelector<HTMLElement>('[data-block-content]');
                const caret = content ? caretFromClick(content, source, locate) : null;
                openAt(block.start + (caret ?? source.length));
              }}
            >
              <Box className={styles.tools} data-block-tools data-open={toolsFor === index || undefined}>
                <Popover
                  opened={toolsFor === index}
                  onChange={(opened) => { if (!opened) setToolsFor(null); }}
                  position="bottom-end"
                  shadow="md"
                  // The panel is taller than a short window: capped to the room on its side, its list scrolls.
                  middlewares={{ flip: true, shift: true, size: { padding: 12 } }}
                  closeOnClickOutside={false}
                  closeOnEscape={false}
                >
                  <Popover.Target>
                    <Button
                      size="compact-xs"
                      variant="default"
                      leftSection={<Sparkles size={12} />}
                      onClick={() => setToolsFor((current) => (current === index ? null : index))}
                    >
                      {t('chat.selection.rewrite')}
                    </Button>
                  </Popover.Target>
                  <Popover.Dropdown
                    p={0}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      overflow: 'hidden',
                      background: 'var(--bg-tertiary)',
                      border: '1px solid var(--border)',
                    }}
                  >
                    <Box ref={panelRef} style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                      <WritingToolsPanel
                        onRun={(action, instruction) => run(index, action, instruction)}
                        onClose={closeTools}
                        t={t}
                      />
                    </Box>
                  </Popover.Dropdown>
                </Popover>
              </Box>
              {block.kind === 'definition' ? (
                <Text component="div" className={styles.definition} data-block-content>{source}</Text>
              ) : (
                <Box
                  className="md-content"
                  data-block-content
                  style={{ ...READING_TEXT_STYLE, lineHeight: 1.75, color: 'var(--text-primary)' }}
                >
                  <MessageMarkdown notion={notion}>{definitions ? `${source}\n\n${definitions}` : source}</MessageMarkdown>
                </Box>
              )}
            </Box>
            {card}
          </React.Fragment>
        );
      })}
    </Box>
  );
};
