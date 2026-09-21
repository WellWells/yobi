import React, { useEffect, useState } from 'react';
import { Anchor, Flex, Group, Stack, Text } from '@mantine/core';
import { Brain, TriangleAlert } from 'lucide-react';
import { canUndoMemoryNote, MEMORY_NOTE_KEYS, normalizeMemoryNotes } from '../../../../shared/userMemory';
import type { MemoryNote } from '../../../../shared/userMemory';
import { userMemoryApi } from '../../api/electronApi';
import { useAppStore } from '../../store/appStore';
import { useUserMemoryStore } from '../../store/userMemoryStore';

/** One text line; the icon box takes this height so the icon centres on the first line. */
const NOTE_LINE_HEIGHT = 'calc(var(--font-size-sm) * 1.55)';

interface Props {
  /** Straight from the turn's meta, which comes from a file the user can edit. */
  raw: unknown;
  t: (key: string) => string;
}

/** Settings may not be loaded yet, so the request waits in the store for the Memory page to take. */
function openCuration(focus: string): void {
  useUserMemoryStore.getState().requestCurate(focus);
  useAppStore.getState().openSettingsCategory('memory');
}

function noteText(note: MemoryNote, t: (key: string) => string): string {
  if (note.op === 'review' && !note.text) return t('memory.note.reviewAll');
  return t(MEMORY_NOTE_KEYS[note.op]).replace('{{text}}', note.text);
}

/**
 * What a reply changed in the user's memory, written by the program rather than by the model.
 * "Undo" appears only while the memory still looks the way the note left it, so a reopened
 * conversation never offers to undo something that has since moved on. A request to tidy the
 * memory changed nothing: its line opens the review, where each change is confirmed.
 */
export const MemoryNotes: React.FC<Props> = ({ raw, t }) => {
  const notes = normalizeMemoryNotes(raw);
  const entries = useUserMemoryStore((s) => s.snapshot?.entries ?? null);
  const [pending, setPending] = useState<number | null>(null);

  useEffect(() => {
    if (notes.length > 0) useUserMemoryStore.getState().initialize();
  }, [notes.length]);

  if (notes.length === 0) return null;

  const undo = (note: MemoryNote, index: number): void => {
    setPending(index);
    void userMemoryApi.undo(note)
      .then((result) => useUserMemoryStore.getState().apply(result.snapshot))
      .finally(() => setPending(null));
  };

  return (
    <Stack gap={2} mt={8}>
      {notes.map((note, index) => {
        const undoable = entries !== null && canUndoMemoryNote(note, entries);
        const full = note.op === 'full';
        const review = note.op === 'review';
        return (
          <Group key={`${note.op}-${note.id ?? ''}-${index}`} gap={6} wrap="nowrap" align="flex-start">
            <Flex h={NOTE_LINE_HEIGHT} align="center" c={full ? 'orange' : 'dimmed'} style={{ flexShrink: 0 }}>
              {full ? <TriangleAlert size={13} /> : <Brain size={13} />}
            </Flex>
            <Text fz="var(--font-size-sm)" lh={NOTE_LINE_HEIGHT} c={full ? 'orange' : 'dimmed'} style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
              {noteText(note, t)}
              {(review || full) && (
                <>
                  {' · '}
                  <Anchor component="button" type="button" fz="inherit" onClick={() => openCuration(review ? note.text : '')}>
                    {t(review ? 'memory.note.review.start' : 'memory.note.tidy')}
                  </Anchor>
                </>
              )}
              {undoable && (
                <>
                  {' · '}
                  <Anchor
                    component="button"
                    type="button"
                    fz="inherit"
                    disabled={pending !== null}
                    onClick={() => undo(note, index)}
                  >
                    {t('memory.note.undo')}
                  </Anchor>
                </>
              )}
              {index === notes.length - 1 && !review && (
                <>
                  {' · '}
                  <Anchor component="button" type="button" fz="inherit" onClick={() => useAppStore.getState().openSettingsCategory('memory')}>
                    {t('memory.note.manage')}
                  </Anchor>
                </>
              )}
            </Text>
          </Group>
        );
      })}
    </Stack>
  );
};
