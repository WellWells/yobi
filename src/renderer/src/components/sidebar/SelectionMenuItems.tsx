import React from 'react';
import { Menu } from '@mantine/core';
import { FileArchive, FileText, Files, Image } from 'lucide-react';

export type SelectionAction = 'pdf' | 'png' | 'zip' | 'copy';

interface SelectionMenuItemsProps {
  onAction: (action: SelectionAction) => void;
  disabled?: boolean;
  t: (key: string) => string;
}

/**
 * The batch actions on the checked conversations. One list, two ways in: the action bar's
 * Export button and a right-click on any row while selecting, so the two never drift apart.
 */
export const SelectionMenuItems: React.FC<SelectionMenuItemsProps> = ({ onAction, disabled, t }) => (
  <>
    <Menu.Item leftSection={<FileText size={13} />} disabled={disabled} onClick={() => onAction('pdf')}>
      {t('selection.export.pdf')}
    </Menu.Item>
    <Menu.Item leftSection={<Image size={13} />} disabled={disabled} onClick={() => onAction('png')}>
      {t('selection.export.png')}
    </Menu.Item>
    <Menu.Item leftSection={<FileArchive size={13} />} disabled={disabled} onClick={() => onAction('zip')}>
      {t('selection.export.zip')}
    </Menu.Item>
    <Menu.Divider />
    <Menu.Item leftSection={<Files size={13} />} disabled={disabled} onClick={() => onAction('copy')}>
      {t('selection.copyFiles')}
    </Menu.Item>
  </>
);
