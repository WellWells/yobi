import React, { useEffect, useRef } from 'react';
import { Box } from '@mantine/core';
import { mountBackdropPainter } from '../theme/backdropPainter';
import classes from './AppBackdrop.module.css';

/**
 * The window's drawn background, for the themes that have one. Always mounted; whether it shows,
 * what it draws and whether it moves all follow attributes on <html>, so switching themes still
 * renders nothing in React.
 */
export const AppBackdrop: React.FC = React.memo(() => {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => (canvas.current ? mountBackdropPainter(canvas.current) : undefined), []);
  return (
    <Box className={classes.backdrop} aria-hidden="true">
      <Box className={classes.back} />
      <Box className={classes.front} />
      <Box component="canvas" ref={canvas} className={classes.canvas} />
    </Box>
  );
});
AppBackdrop.displayName = 'AppBackdrop';
