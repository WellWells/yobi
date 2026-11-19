import React, { useEffect, useState } from 'react';
import { Menu } from '@mantine/core';
import { ExternalLink, Eye, FolderOpen, MessageSquareText, Sparkles, Trash, X } from 'lucide-react';
import { writingToolsApi } from '../../api/electronApi';
import { ContextMenuPortal } from '../../components/ContextMenuPortal';
import { DangerMenuItem } from '../../components/DangerMenuItem';
import { ModelMenuItems } from '../../components/chat/ModelMenuItems';
import { isMac } from '../../utils/keyLabels';
import { fillTemplate } from '../../../../shared/fillTemplate';

export interface KnowledgeFileMenuState {
  x: number;
  y: number;
  /** The files it acts on: the selection, after a right-click outside it selected that row (`contextSelect`). */
  rels: string[];
}

interface KnowledgeFileMenuProps {
  menu: KnowledgeFileMenuState | null;
  onClose: () => void;
  /** Escape closed it: focus goes back to the list, as a file manager's does. */
  onEscape: () => void;
  /** Of the menu's files: those with a summary, and those waiting or being analysed. */
  withAi: readonly string[];
  inQueue: readonly string[];
  onPreview: (rel: string) => void;
  onOpenFile: (rel: string) => void;
  onReveal: (rel: string) => void;
  onAsk: (rels: string[]) => void;
  onAnalyze: (rels: string[], model: string) => void;
  onCancel: (rels: string[]) => void;
  onClear: (rels: string[]) => void;
  onDelete: (rels: string[]) => void;
  t: (key: string) => string;
}

/**
 * A file row's right-click menu (and Shift+F10 / the menu key on a focused row): the toolbar's
 * actions for these files, plus what only one file has — its preview, the default program, and
 * where it is in the file manager.
 */
export const KnowledgeFileMenu: React.FC<KnowledgeFileMenuProps> = ({
  menu, onClose, onEscape, withAi, inQueue, onPreview, onOpenFile, onReveal, onAsk, onAnalyze, onCancel, onClear, onDelete, t,
}) => {
  const [modelUrl, setModelUrl] = useState('');
  useEffect(() => {
    if (!menu) return undefined;
    let live = true;
    void writingToolsApi.getModel().then((url) => { if (live) setModelUrl(url); }, () => undefined);
    return () => { live = false; };
  }, [menu]);

  if (!menu) return null;
  const { rels } = menu;
  const one = rels.length === 1 ? rels[0] : undefined;
  const count = { count: String(rels.length) };
  const run = (action: () => void) => () => {
    onClose();
    action();
  };

  return (
    <ContextMenuPortal position={menu} onClose={onClose} onEscape={onEscape}>
      {one !== undefined && (
        <>
          <Menu.Item leftSection={<Eye size={13} />} onClick={run(() => onPreview(one))}>{t('kb.menu.preview')}</Menu.Item>
          <Menu.Item leftSection={<ExternalLink size={13} />} onClick={run(() => onOpenFile(one))}>{t('kb.page.openFile')}</Menu.Item>
          <Menu.Item leftSection={<FolderOpen size={13} />} onClick={run(() => onReveal(one))}>{t(isMac ? 'context.showInFolder.mac' : 'context.showInFolder')}</Menu.Item>
          <Menu.Divider />
        </>
      )}
      <Menu.Item leftSection={<MessageSquareText size={13} />} onClick={run(() => onAsk(rels))}>
        {one !== undefined ? t('kb.menu.askOne') : fillTemplate(t('kb.menu.askMany'), count)}
      </Menu.Item>
      <Menu.Sub position="right-start">
        <Menu.Sub.Target>
          <Menu.Sub.Item leftSection={<Sparkles size={13} />}>
            {one !== undefined && withAi.length > 0 ? t('kb.analyze.again') : t('kb.analyze.action')}
          </Menu.Sub.Item>
        </Menu.Sub.Target>
        <Menu.Sub.Dropdown>
          <Menu.Label>{one !== undefined ? t('kb.analyze.menu.one') : fillTemplate(t('kb.analyze.menu'), count)}</Menu.Label>
          <ModelMenuItems value={modelUrl} onChange={(url) => run(() => onAnalyze(rels, url))()} />
        </Menu.Sub.Dropdown>
      </Menu.Sub>
      {inQueue.length > 0 && (
        <Menu.Item leftSection={<X size={13} />} onClick={run(() => onCancel([...inQueue]))}>{t('kb.analyze.cancel')}</Menu.Item>
      )}
      {withAi.length > 0 && (
        <Menu.Item onClick={run(() => onClear([...withAi]))}>{t('kb.analyze.clear')}</Menu.Item>
      )}
      <Menu.Divider />
      <DangerMenuItem leftSection={<Trash size={13} />} onClick={run(() => onDelete(rels))}>{t('kb.page.delete')}</DangerMenuItem>
    </ContextMenuPortal>
  );
};
