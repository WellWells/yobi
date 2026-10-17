import { useCallback, useEffect, useRef, useState } from 'react';
import { headerTitleToWrite } from './headerMenuModel';

export interface HeaderTitleEditOptions {
  /** The open conversation's file; null when none is open. */
  path: string | null;
  /** The title the header shows right now. */
  title: string;
  /** Writes a changed title to the file the edit was started on. */
  writeTitle: (path: string, title: string) => Promise<void> | void;
}

export interface HeaderTitleEdit {
  editing: boolean;
  value: string;
  setValue: (value: string) => void;
  start: () => void;
  commit: () => void;
  cancel: () => void;
}

/**
 * The chat header's in-place H1 edit. The edit belongs to the conversation it was started on:
 * moving to another one drops the draft, and a commit writes only to that file and only when the
 * text differs from the title the edit started from.
 */
export function useHeaderTitleEdit({ path, title, writeTitle }: HeaderTitleEditOptions): HeaderTitleEdit {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const startedRef = useRef<{ path: string; title: string } | null>(null);

  // Another conversation was opened (a finished translation, a reload) while the box kept focus.
  useEffect(() => {
    startedRef.current = null;
    setEditing(false);
    setValue('');
  }, [path]);

  const start = useCallback(() => {
    if (!path) return;
    startedRef.current = { path, title };
    setValue(title);
    setEditing(true);
  }, [path, title]);

  const cancel = useCallback(() => {
    startedRef.current = null;
    setEditing(false);
  }, []);

  const commit = useCallback(() => {
    const started = startedRef.current;
    // Enter commits, then the box unmounts and blurs: the second call finds nothing to do.
    startedRef.current = null;
    setEditing(false);
    if (!started || started.path !== path) return;
    const next = headerTitleToWrite(value, started.title);
    if (next === null) return;
    void writeTitle(started.path, next);
  }, [path, value, writeTitle]);

  return { editing, value, setValue, start, commit, cancel };
}
