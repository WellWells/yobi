import React, { useEffect, useState } from 'react';
import { Box, UnstyledButton } from '@mantine/core';
import {
  doWindowAction,
  getWindowActionTitle,
  macInactiveColor,
  macWindowButtonDefs,
  noDrag,
  winButtonDefs,
  winButtonIcon,
} from './constants';
import { windowApi } from '../../api/electronApi';
import styles from '../TitleBar.module.css';

export const MacWindowControls = React.memo<{ t: (k: string) => string; focused: boolean }>(({ t, focused }) => (
  <Box className={styles.macGroup} style={noDrag}>
    {macWindowButtonDefs.map((btn) => (
      <UnstyledButton
        key={btn.action}
        onClick={() => doWindowAction(btn.action)}
        title={getWindowActionTitle(t, btn.action)}
        className={styles.macBtn}
        data-no-press
        style={{ background: focused ? btn.color : macInactiveColor }}
      >
        <Box component="span" className={styles.macBtnIcon}>
          {btn.icon}
        </Box>
      </UnstyledButton>
    ))}
  </Box>
));

export const WindowsControls = React.memo<{ t: (k: string) => string; focused: boolean }>(({ t, focused }) => {
  // The title bar is ours, so nothing tells this button the window state unless we ask. The
  // initial query covers the case main restores a maximized window before the renderer loads.
  const [maximized, setMaximized] = useState(false);
  useEffect(() => {
    void windowApi.isMaximized().then(setMaximized);
    return windowApi.onMaximizedChanged(setMaximized);
  }, []);

  return (
    <Box className={styles.winControls} style={{ ...noDrag, opacity: focused ? 1 : 0.5 }}>
      {winButtonDefs.map(({ action }) => (
        <UnstyledButton
          key={action}
          onClick={() => doWindowAction(action)}
          title={getWindowActionTitle(t, action, maximized)}
          className={`${styles.winBtn}${action === 'close' ? ` ${styles.winClose}` : ''}`}
          data-no-press
        >
          {winButtonIcon(action, maximized)}
        </UnstyledButton>
      ))}
    </Box>
  );
});
