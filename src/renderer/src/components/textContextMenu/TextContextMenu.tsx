import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Menu } from '@mantine/core';
import { ClipboardPaste, Copy, Scissors, TextSelect } from 'lucide-react';
import { ContextMenuPortal } from '../ContextMenuPortal';
import { ShortcutHint } from '../ShortcutHint';
import { clipboardApi } from '../../api/electronApi';
import { useI18nStore } from '../../store/i18nStore';
import { isMac } from '../../utils/keyLabels';
import { deleteFromField, insertIntoField, keepsSelectionOnPress, pasteIntoField, resolveTextMenuTarget, restoreField, type FieldTarget, type TextMenuTarget } from './textMenuTarget';
import { textMenuExtraFor, type TextMenuExtra } from './textMenuExtras';

interface OpenMenu {
  x: number;
  y: number;
  target: TextMenuTarget;
  extra: TextMenuExtra | null;
  /** Opened with Shift+F10 or the Menu key: focus goes into the menu, as there is no pointer. */
  fromKeyboard: boolean;
}

const MODIFIER_KEYS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'AltGraph']);

/** A keyboard-opened menu (Shift+F10, the Menu key) has no pointer: open it under the field. */
function menuPoint(e: MouseEvent, target: TextMenuTarget): { x: number; y: number } {
  if (e.clientX !== 0 || e.clientY !== 0 || target.kind !== 'field') return { x: e.clientX, y: e.clientY };
  const rect = target.el.getBoundingClientRect();
  return { x: rect.left, y: rect.bottom };
}

function selectedSlice(target: FieldTarget): string {
  return target.el.value.slice(target.start, target.end);
}

/**
 * The app's right-click menu for text: Cut / Copy / Paste / Select All in any field, Copy on
 * selected text, plus what the area around a field adds (`useTextMenuExtra`). Electron shows no
 * menu of its own; rows and attachments with their own menu call preventDefault and are left alone.
 * Paste reads with the async Clipboard API (granted by default; `execCommand('paste')` is not).
 */
export const TextContextMenu: React.FC = () => {
  const t = useI18nStore((s) => s.t);
  const [menu, setMenu] = useState<OpenMenu | null>(null);
  const menuRef = useRef<OpenMenu | null>(null);
  menuRef.current = menu;

  const dropdownRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    // Before Chromium moves the caret to the press point and drops the selection.
    const onPress = (e: MouseEvent) => {
      if (keepsSelectionOnPress(e, isMac)) e.preventDefault();
    };
    const onContextMenu = (e: MouseEvent) => {
      if (e.defaultPrevented) return;
      const target = resolveTextMenuTarget(e.target, window.getSelection()?.toString() ?? '');
      if (!target) return;
      e.preventDefault();
      const extra = target.kind === 'field' && !target.el.readOnly && !target.el.disabled ? textMenuExtraFor(target.el) : null;
      const point = menuPoint(e, target);
      setMenu({ ...point, target, extra, fromKeyboard: point.x !== e.clientX || point.y !== e.clientY });
    };
    window.addEventListener('mousedown', onPress, true);
    window.addEventListener('contextmenu', onContextMenu);
    return () => {
      window.removeEventListener('mousedown', onPress, true);
      window.removeEventListener('contextmenu', onContextMenu);
    };
  }, []);

  // Focus stays in the field while the menu is open, so its selection stays drawn: ↑↓ move into
  // the menu, Esc closes only this menu (not the dialog the field is in), and any other key goes to
  // the field and closes the menu, whose remembered selection it may change.
  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => {
      const open = menuRef.current;
      const dropdown = dropdownRef.current;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setMenu(null);
        if (open?.target.kind === 'field') restoreField(open.target);
        return;
      }
      if (dropdown?.contains(document.activeElement)) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const items = [...(dropdown?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([data-disabled])') ?? [])];
        const next = e.key === 'ArrowDown' ? items[0] : items.at(-1);
        if (!next) return;
        e.preventDefault();
        e.stopPropagation();
        next.focus();
        return;
      }
      if (!MODIFIER_KEYS.has(e.key)) setMenu(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [menu]);

  const close = useCallback(() => setMenu(null), []);

  if (!menu) return null;
  const { target, extra } = menu;

  const run = (action: () => void | Promise<void>) => () => {
    setMenu(null);
    void action();
  };

  if (target.kind === 'selection') {
    return (
      <ContextMenuPortal position={menu} onClose={close} trapFocus={menu.fromKeyboard} dropdownRef={dropdownRef}>
        <Menu.Item leftSection={<Copy size={13} />} rightSection={<ShortcutHint combo="CommandOrControl+C" />} onClick={run(() => { void clipboardApi.copyText(target.text); })}>
          {t('textMenu.copy')}
        </Menu.Item>
      </ContextMenuPortal>
    );
  }

  const cut = async () => {
    const text = selectedSlice(target);
    if (!(await clipboardApi.copyText(text))) return;
    deleteFromField(target);
  };
  const copy = async () => {
    restoreField(target);
    await clipboardApi.copyText(selectedSlice(target));
  };
  const paste = async () => {
    const text = await navigator.clipboard.readText().catch(() => '');
    if (text) pasteIntoField(target, text);
    else restoreField(target);
  };
  const selectAll = () => {
    target.el.focus();
    target.el.select();
  };
  const insert = (text: string) => {
    setMenu(null);
    insertIntoField(target.el, target.start, target.end, text);
  };

  return (
    <ContextMenuPortal position={menu} onClose={close} trapFocus={menu.fromKeyboard} dropdownRef={dropdownRef}>
      <Menu.Item leftSection={<Scissors size={13} />} rightSection={<ShortcutHint combo="CommandOrControl+X" />} disabled={!target.canCut} onClick={run(cut)}>
        {t('textMenu.cut')}
      </Menu.Item>
      <Menu.Item leftSection={<Copy size={13} />} rightSection={<ShortcutHint combo="CommandOrControl+C" />} disabled={!target.canCopy} onClick={run(copy)}>
        {t('textMenu.copy')}
      </Menu.Item>
      <Menu.Item leftSection={<ClipboardPaste size={13} />} rightSection={<ShortcutHint combo="CommandOrControl+V" />} disabled={!target.canPaste} onClick={run(paste)}>
        {t('textMenu.paste')}
      </Menu.Item>
      <Menu.Divider />
      <Menu.Item leftSection={<TextSelect size={13} />} rightSection={<ShortcutHint combo="CommandOrControl+A" />} disabled={!target.canSelectAll} onClick={run(selectAll)}>
        {t('textMenu.selectAll')}
      </Menu.Item>
      {extra && (
        <>
          <Menu.Divider />
          {extra(insert)}
        </>
      )}
    </ContextMenuPortal>
  );
};
