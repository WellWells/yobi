import React from 'react';
import { Box, Group, Text } from '@mantine/core';
import { YobiMark } from '../config/brandIcons';
import { useI18nStore } from '../store/i18nStore';
import { PanelToolbar } from './PanelToolbar';
import { ViewSwitch } from './ViewNav';

interface SidebarTopProps {
  /** The sidebar's main action (`SidebarActionRow`: 新對話, 新增流程), with its ▾. */
  action: React.ReactNode;
  /** The icon buttons at the end of the top row. */
  children: React.ReactNode;
}

/**
 * A sidebar's top, as Gemini's and Claude's: the window's title bar over the sidebar carries the
 * app's mark and name with the icon buttons at its end. Under it the 聊天｜流程 switch, then the
 * main action, as Claude's app puts its Chat｜Code switch above New chat: the switch decides what
 * the rows under it are, so switching changes the action below the pointer, and the action sits
 * on the list it adds to. The name is not a control: it is where the window is dragged by. On
 * macOS the traffic lights come first, and the row has room for them and the name both.
 */
export const SidebarTop: React.FC<SidebarTopProps> = ({ action, children }) => {
  const t = useI18nStore((s) => s.t);
  return (
    <>
      <PanelToolbar caption="left" withBottomBorder={false}>
        {/* 8px in: the mark's centre on the column of the icons in the rows below. */}
        <Group gap={8} wrap="nowrap" pl={8} miw={0}>
          <YobiMark size={20} />
          <Text fz="var(--font-size-3xl)" fw={600} truncate>{t('app.name')}</Text>
        </Group>
        <Group gap={4} wrap="nowrap" style={{ flexShrink: 0 }}>{children}</Group>
      </PanelToolbar>
      <ViewSwitch />
      <Box display="flex" px={10} pb={4} style={{ flexShrink: 0 }}>{action}</Box>
    </>
  );
};
