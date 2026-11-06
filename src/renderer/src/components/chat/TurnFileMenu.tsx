import React, { useCallback, useState } from 'react';
import { Menu, Portal } from '@mantine/core';
import { AppWindow, ExternalLink, Files, FolderOpen, Link2 } from 'lucide-react';
import { turnFileOpens } from '../../../../shared/turnMedia';
import type { TurnFileAction } from '../../../../shared/types';
import { fileApi } from '../../api/electronApi';
import { showAppNotice } from '../../hooks/useUiNotifications';
import { useI18nStore } from '../../store/i18nStore';
import { hostPlatform } from '../../utils/hostPlatform';
import { isMac } from '../../utils/keyLabels';
import { ContextMenuPortal } from '../ContextMenuPortal';
import { copyPathWithNotice } from '../sidebar/fileMenuActions';

type Translate = (key: string) => string;

interface TurnFileMenuState {
  x: number;
  y: number;
  file: string;
}

/** Does it, and says so when the file has gone since the turn was saved. */
async function runTurnFileAction(action: TurnFileAction, file: string, t: Translate): Promise<boolean> {
  const done = await fileApi.turnFileAction(action, file);
  if (!done) showAppNotice({ message: t('chat.attachment.missing'), level: 'warning' });
  return done;
}

/**
 * What a click on a file does: its default app, or for a type a click must not hand to one (a
 * script), its place in the folder.
 */
export function openTurnFile(file: string, t: Translate): void {
  if (turnFileOpens(file)) void runTurnFileAction('open', file, t);
  else void fileApi.showInFolder(file);
}

const TurnFileMenu: React.FC<{ menu: TurnFileMenuState; onClose: () => void }> = ({ menu, onClose }) => {
  const t = useI18nStore((s) => s.t);
  const { file } = menu;
  const opens = turnFileOpens(file);
  const run = (action: () => Promise<unknown>): void => {
    onClose();
    void action();
  };
  const copyFile = async (): Promise<void> => {
    if (!await runTurnFileAction('copy', file, t)) return;
    showAppNotice({ message: t('context.copied.file'), level: 'success' });
  };

  return (
    <Portal>
      <ContextMenuPortal position={menu} onClose={onClose}>
        <Menu.Item leftSection={<FolderOpen size={13} />} onClick={() => run(() => fileApi.showInFolder(file))}>
          {t(isMac ? 'context.showInFolder.mac' : 'context.showInFolder')}
        </Menu.Item>
        {opens && (
          <Menu.Item leftSection={<ExternalLink size={13} />} onClick={() => run(() => runTurnFileAction('open', file, t))}>
            {t('context.openDefault')}
          </Menu.Item>
        )}
        {opens && hostPlatform === 'win32' && (
          <Menu.Item leftSection={<AppWindow size={13} />} onClick={() => run(() => runTurnFileAction('openWith', file, t))}>
            {t('context.openWith')}
          </Menu.Item>
        )}
        <Menu.Divider />
        {opens && (
          <Menu.Item leftSection={<Files size={13} />} onClick={() => run(copyFile)}>
            {t('context.copyFile')}
          </Menu.Item>
        )}
        <Menu.Item leftSection={<Link2 size={13} />} onClick={() => run(() => copyPathWithNotice(file, t))}>
          {t('context.copyPath')}
        </Menu.Item>
      </ContextMenuPortal>
    </Portal>
  );
};

/** The right-click menu of the files a conversation shows: draw `menu`, call `openMenu` on the event. */
export function useTurnFileMenu(): {
  openMenu: (file: string, event: React.MouseEvent) => void;
  menu: React.ReactNode;
} {
  const [state, setState] = useState<TurnFileMenuState | null>(null);
  const close = useCallback(() => setState(null), []);
  const openMenu = useCallback((file: string, event: React.MouseEvent): void => {
    event.preventDefault();
    setState({ x: event.clientX, y: event.clientY, file });
  }, []);
  return { openMenu, menu: state && <TurnFileMenu menu={state} onClose={close} /> };
}
