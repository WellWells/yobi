import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActionIcon, Box, Divider, Group, NavLink, Stack, Text, Tooltip } from '@mantine/core';
import {
  ArrowUp, Briefcase, FoldVertical, List, ListChecks, MessageCircle, ScrollText, Sparkles, SpellCheck, Table2, WandSparkles,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { WritingAction } from '../../../../shared/writingTools';
import { WRITING_INSTRUCTION_MAX_CHARS } from '../../../../shared/writingTools';
import { AppTextInput } from '../AppTextInput';
import { GroupHeader } from '../GroupHeader';
import { ModelDropdown } from './ModelDropdown';
import { Z_POPOVER } from '../../config/zLayers';
import { matchesShortcut } from '../../store/shortcutStore';
import { useWritingToolsStore } from '../../store/writingToolsStore';
import { ensureWritingModel } from './writingToolsActions';
import styles from './ComposerSuggestList.module.css';

type PresetAction = Exclude<WritingAction, 'custom'>;

interface Row {
  action: PresetAction;
  Icon: LucideIcon;
}

/** Fix the text, change its tone, or turn it into another shape — in that order of how much it changes. */
const GROUPS: ReadonlyArray<{ id: 'fix' | 'tone' | 'reshape'; rows: Row[] }> = [
  { id: 'fix', rows: [{ action: 'proofread', Icon: SpellCheck }, { action: 'rewrite', Icon: WandSparkles }] },
  {
    id: 'tone',
    rows: [
      { action: 'friendly', Icon: MessageCircle },
      { action: 'professional', Icon: Briefcase },
      { action: 'concise', Icon: FoldVertical },
    ],
  },
  {
    id: 'reshape',
    rows: [
      { action: 'summary', Icon: ScrollText },
      { action: 'keyPoints', Icon: ListChecks },
      { action: 'list', Icon: List },
      { action: 'table', Icon: Table2 },
    ],
  },
];

const ROWS: PresetAction[] = GROUPS.flatMap((group) => group.rows.map((row) => row.action));

export const WRITING_PANEL_WIDTH = 320;
/** Tall enough for every row; the floating toolbar uses it to choose above or below the selection. */
export const WRITING_PANEL_HEIGHT = 490;

interface WritingToolsPanelProps {
  onRun: (action: WritingAction, instruction?: string) => void;
  onClose: () => void;
  t: (key: string) => string;
}

/**
 * The writing tools as a command menu, like the composer's: say how to change the text, or pick a
 * change with the mouse or ↑↓ Enter. The model is chosen at the bottom, per use, and remembered.
 */
export const WritingToolsPanel: React.FC<WritingToolsPanelProps> = ({ onRun, onClose, t }) => {
  const modelUrl = useWritingToolsStore((s) => s.modelUrl);
  const chooseModel = useWritingToolsStore((s) => s.chooseModel);
  const [instruction, setInstruction] = useState('');
  // -1: no row highlighted, so Enter sends what was typed.
  const [highlighted, setHighlighted] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void ensureWritingModel();
    inputRef.current?.focus({ preventScroll: true });
  }, []);

  const submit = useCallback((): void => {
    const typed = instruction.trim();
    if (typed) onRun('custom', typed);
  }, [instruction, onRun]);

  const handleKeyDown = useCallback((event: React.KeyboardEvent): void => {
    // Enter picks a Zhuyin or Cangjie candidate while composing; arrows move within the candidates.
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (event.target !== inputRef.current) return;
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      // Past either end returns to the input: nothing highlighted, Enter sends the typed request.
      setHighlighted((current) => {
        const next = current + step;
        if (current === -1 && step === -1) return ROWS.length - 1;
        return next < 0 || next >= ROWS.length ? -1 : next;
      });
      return;
    }
    if (!matchesShortcut(event, 'writingTools.submitClose')) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.target !== inputRef.current) return;
    event.preventDefault();
    if (highlighted >= 0) onRun(ROWS[highlighted]);
    else submit();
  }, [highlighted, onClose, onRun, submit]);

  const indexOf = useMemo(() => new Map(ROWS.map((action, index) => [action, index])), []);
  const listRef = useRef<HTMLDivElement>(null);
  // Arrow keys move the highlight, not the scroll: keep the highlighted row in a scrolled list's view.
  useEffect(() => {
    if (highlighted < 0) return;
    listRef.current?.querySelector(`[data-writing-index="${highlighted}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [highlighted]);

  return (
    // The input and the model row stay put; when the box is capped to the window, the list scrolls.
    <Stack gap={0} w={WRITING_PANEL_WIDTH} mah="100%" style={{ minHeight: 0 }} onKeyDown={handleKeyDown}>
      <Box p={10} pb={6} style={{ flexShrink: 0 }}>
        <AppTextInput
          ref={inputRef}
          value={instruction}
          maxLength={WRITING_INSTRUCTION_MAX_CHARS}
          onChange={(event) => {
            setInstruction(event.currentTarget.value);
            setHighlighted(-1);
          }}
          placeholder={t('chat.writing.prompt')}
          aria-label={t('chat.writing.prompt')}
          leftSection={<Sparkles size={15} />}
          rightSection={instruction.trim() ? (
            <Tooltip label={t('chat.writing.send')} position="bottom">
              <ActionIcon variant="filled" size="sm" aria-label={t('chat.writing.send')} onClick={submit}>
                <ArrowUp size={14} />
              </ActionIcon>
            </Tooltip>
          ) : null}
        />
      </Box>

      <Box ref={listRef} pb={4} style={{ flex: '1 1 auto', minHeight: 0, overflowY: 'auto' }}>
        {GROUPS.map((group) => (
          <Box key={group.id} pt={6}>
            <Box px={12} pb={2}>
              <GroupHeader variant="plain" label={t(`chat.writing.group.${group.id}`)} />
            </Box>
            {group.rows.map(({ action, Icon }) => {
              const index = indexOf.get(action) ?? -1;
              return (
                <NavLink
                  key={action}
                  data-writing-index={index}
                  className={styles.item}
                  classNames={{ section: styles.section }}
                  active={index === highlighted}
                  py={6}
                  onMouseEnter={() => setHighlighted(index)}
                  onMouseLeave={() => setHighlighted(-1)}
                  // Keeps focus (and so the typed request) in the input.
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => onRun(action)}
                  leftSection={<Icon size={15} />}
                  label={<Text fz="var(--font-size-md)">{t(`chat.writing.action.${action}`)}</Text>}
                />
              );
            })}
          </Box>
        ))}
      </Box>

      {modelUrl && (
        <>
          <Divider color="var(--border)" style={{ flexShrink: 0 }} />
          <Group justify="space-between" wrap="nowrap" gap={8} px={12} py={6} style={{ flexShrink: 0 }}>
            <Text fz="var(--font-size-sm)" c="var(--text-muted)">{t('chat.writing.modelLabel')}</Text>
            <ModelDropdown
              value={modelUrl}
              onChange={chooseModel}
              menuDirection="down"
              zIndex={Z_POPOVER}
              tooltipLabel={t('chat.writing.model')}
            />
          </Group>
        </>
      )}
    </Stack>
  );
};
