import type React from 'react';
import { useEffect, useRef } from 'react';

/** Puts text into the field the menu was opened on, at its caret or over its selection. */
export type InsertIntoField = (text: string) => void;

/** Extra items a part of the UI adds to the text menu of fields inside it, after the edit commands. */
export type TextMenuExtra = (insert: InsertIntoField) => React.ReactNode;

interface ExtraEntry {
  root: React.RefObject<HTMLElement | null>;
  render: React.RefObject<TextMenuExtra>;
}

const entries = new Set<ExtraEntry>();

/** The extra items for a field: those of the innermost registered area that holds it. */
export function textMenuExtraFor(field: Element): TextMenuExtra | null {
  let best: { root: HTMLElement; render: TextMenuExtra } | null = null;
  for (const entry of entries) {
    const root = entry.root.current;
    if (!root || !root.contains(field)) continue;
    if (!best || best.root.contains(root)) best = { root, render: entry.render.current };
  }
  return best?.render ?? null;
}

/**
 * Adds `render`'s items to the right-click menu of every field inside `root` (the flow step form
 * adds 「插入資料 ▸」). The latest `render` is used without re-registering on each render.
 */
export function useTextMenuExtra(root: React.RefObject<HTMLElement | null>, render: TextMenuExtra): void {
  const renderRef = useRef(render);
  renderRef.current = render;
  useEffect(() => {
    const entry: ExtraEntry = { root, render: renderRef };
    entries.add(entry);
    return () => { entries.delete(entry); };
  }, [root]);
}
