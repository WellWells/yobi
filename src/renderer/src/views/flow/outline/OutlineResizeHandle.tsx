import { useEffect, useRef } from 'react';
import type { KeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import { Box } from '@mantine/core';

interface OutlineResizeHandleProps {
  width: number;
  min: number;
  max: number;
  label: string;
  onResize: (width: number) => void;
}

/** The pane's left edge: dragging left gives the pane more room. */
export function OutlineResizeHandle({ width, min, max, label, onResize }: OutlineResizeHandleProps): React.JSX.Element {
  const stop = useRef<(() => void) | null>(null);
  useEffect(() => () => stop.current?.(), [min, max]);

  function resize(next: number): void {
    onResize(Math.round(Math.min(max, Math.max(min, next))));
  }

  function start(event: ReactPointerEvent<HTMLElement>): void {
    if (event.button !== 0 || stop.current) return;
    event.preventDefault();
    const target = event.currentTarget;
    const { clientX: startX, pointerId } = event;
    const { cursor, userSelect } = document.body.style;
    function move(next: PointerEvent): void {
      if (next.pointerId === pointerId) resize(width + startX - next.clientX);
    }
    function end(next: PointerEvent): void {
      if (next.pointerId === pointerId) cleanup();
    }
    function cleanup(): void {
      stop.current = null;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      window.removeEventListener('blur', cleanup);
      document.body.style.cursor = cursor;
      document.body.style.userSelect = userSelect;
      if (target.hasPointerCapture?.(pointerId)) target.releasePointerCapture(pointerId);
    }
    stop.current = cleanup;
    target.setPointerCapture?.(pointerId);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    window.addEventListener('blur', cleanup);
  }

  function keyDown(event: KeyboardEvent<HTMLElement>): void {
    const next = event.key === 'ArrowLeft' ? width + 16
      : event.key === 'ArrowRight' ? width - 16
        : event.key === 'Home' ? min
          : event.key === 'End' ? max : null;
    if (next === null) return;
    event.preventDefault();
    event.stopPropagation();
    resize(next);
  }

  return (
    <Box
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={width}
      tabIndex={0}
      pos="absolute"
      top={0}
      bottom={0}
      left={-4}
      w={8}
      style={{ cursor: 'col-resize', touchAction: 'none', zIndex: 2 }}
      onPointerDown={start}
      onLostPointerCapture={() => stop.current?.()}
      onKeyDown={keyDown}
    />
  );
}
