import React, { useEffect } from 'react';
import { Z_SETTINGS } from '../config/zLayers';
import { useI18nStore } from '../store/i18nStore';
import { AppModal } from './AppModal';
import { TOP_ROW_HEIGHT } from './PanelToolbar';

/** The dialog's widest, as Claude's settings: the nav and the 720px column with room to spare. */
export const SETTINGS_DIALOG_MAX_WIDTH = 1_120;
/** Its margin to the window's sides and foot; its top is the title row's foot. */
export const SETTINGS_DIALOG_MARGIN = 24;
/** The sides give way on a narrow window, down to half (12px at 480): the column needs the room more. */
const SIDE_MARGIN = `clamp(${SETTINGS_DIALOG_MARGIN / 2}px, 2.5vw, ${SETTINGS_DIALOG_MARGIN}px)`;

export const SETTINGS_DIALOG_ID = 'yobi-settings-dialog';

const DROPDOWNS = '.mantine-Popover-dropdown, .mantine-Menu-dropdown, .mantine-Combobox-dropdown, [data-menu-dropdown]';

/**
 * Whether an Escape pressed while Settings is open is someone else's: an open dropdown's (its
 * target is marked, as Mantine's own dialogs read it, or the focus is inside it), or a dialog
 * opened from inside Settings, which closes itself. Read in the capture phase, before the page's
 * handlers. A nested dialog closes from its own window capture listener, which may run first and,
 * without a transition, leave the page at once: so the key's target counts too. A dialog keeps the
 * focus inside it and dropdowns are portalled out, so a key from outside this dialog was theirs.
 */
export function escapeBelongsElsewhere(event: KeyboardEvent, ownRoot: Element | null): boolean {
  const target = event.target instanceof Element ? event.target : null;
  if (target && target !== document.body && !ownRoot?.contains(target)) return true;
  if (target?.getAttribute('data-mantine-stop-propagation') === 'true') return true;
  if (target?.closest(DROPDOWNS)) return true;
  return Array.from(document.querySelectorAll('[aria-modal="true"]'))
    .some((dialog) => !ownRoot?.contains(dialog) && dialog.checkVisibility());
}

/**
 * Escape closes Settings once nothing inside it wanted the key. Not Mantine's own handling: it
 * closes from the window's capture phase, before the page's handlers run, so Escape would also
 * close Settings when it cancels a shortcut recording or closes a dialog opened from a section.
 * Here a handler that took the key (stopped it or prevented its default) keeps Settings open.
 */
export function useEscapeToClose(opened: boolean, onClose: () => void): void {
  useEffect(() => {
    if (!opened) return undefined;
    const elsewhere = new WeakSet<KeyboardEvent>();
    const onCapture = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && escapeBelongsElsewhere(event, document.getElementById(SETTINGS_DIALOG_ID))) elsewhere.add(event);
    };
    const onBubble = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.isComposing || event.defaultPrevented || elsewhere.has(event)) return;
      onClose();
    };
    window.addEventListener('keydown', onCapture, true);
    window.addEventListener('keydown', onBubble);
    return () => {
      window.removeEventListener('keydown', onCapture, true);
      window.removeEventListener('keydown', onBubble);
    };
  }, [opened, onClose]);
}

interface SettingsDialogProps {
  opened: boolean;
  onClose: () => void;
  children: React.ReactNode;
}

/**
 * Settings as a dialog over the chat or flow view, as ChatGPT's and Claude's: the view stays in
 * sight, dimmed by the dialogs' one backdrop, and the dialog closes back to it. It opens below the
 * title row, which stays the window's title bar: the caption controls are over the backdrop and
 * the row still drags the window. Its size does not follow the page shown, so switching pages
 * does not move it. Kept mounted, as the views are: reopening keeps the page, the search and the
 * log's filter, and the sections keep their state and their listeners.
 *
 * No scroll lock: the window itself never scrolls, so the lock guarded nothing, while it put a
 * blocking wheel listener on the document that every scroll inside Settings had to wait for.
 */
export const SettingsDialog: React.FC<SettingsDialogProps> = ({ opened, onClose, children }) => {
  const t = useI18nStore((s) => s.t);
  useEscapeToClose(opened, onClose);
  return (
    <AppModal
      id={SETTINGS_DIALOG_ID}
      opened={opened}
      onClose={onClose}
      title={t('nav.settings')}
      closeOnEscape={false}
      closeButtonProps={{ 'aria-label': t('settings.dialog.close') }}
      keepMounted
      keepMountedMode="display-none"
      lockScroll={false}
      centered={false}
      zIndex={Z_SETTINGS}
      styles={{
        inner: {
          paddingTop: TOP_ROW_HEIGHT,
          paddingBottom: SETTINGS_DIALOG_MARGIN,
          paddingInline: SIDE_MARGIN,
        },
        content: {
          flex: `0 0 min(${SETTINGS_DIALOG_MAX_WIDTH}px, 100%)`,
          height: `calc(100dvh - ${TOP_ROW_HEIGHT + SETTINGS_DIALOG_MARGIN}px)`,
          maxHeight: 'none',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          background: 'var(--mantine-color-body)',
        },
        header: { background: 'var(--mantine-color-body)', minHeight: 0, paddingBlock: 10 },
        body: { flex: 1, minHeight: 0, padding: 0, display: 'flex' },
      }}
    >
      {children}
    </AppModal>
  );
};
