import React, { useEffect, useRef, useState } from 'react';
import { Box, Text, UnstyledButton } from '@mantine/core';
import { useReducedMotion } from '@mantine/hooks';
import { isMac } from '../utils/keyLabels';
import { SWIPE, swipeTransition } from '../utils/rowSwipe';
import type { SwipeSide } from '../utils/rowSwipe';
import { useRowSwipe } from '../hooks/useRowSwipe';
import type { SwipeAction } from '../hooks/useRowSwipe';
import styles from './SwipeRow.module.css';

export type { SwipeAction } from '../hooks/useRowSwipe';

export interface SwipeRowProps {
  /** Revealed by swiping right (Apple Notes: pin). */
  leading?: readonly SwipeAction[];
  /** Revealed by swiping left (Mail: more, trash). */
  trailing?: readonly SwipeAction[];
  disabled?: boolean;
  children: React.ReactNode;
}

const NO_ACTIONS: readonly SwipeAction[] = [];

/**
 * A list row that a two-finger trackpad swipe slides aside to reveal actions (macOS). Off macOS,
 * when disabled, or with no actions it is just its children: Windows and Linux keep right-click
 * and the keyboard, since their mice have no horizontal axis.
 */
export function SwipeRow({ leading, trailing, disabled, children }: SwipeRowProps): React.ReactElement {
  const hasActions = (leading?.length ?? 0) + (trailing?.length ?? 0) > 0;
  if (!isMac || disabled || !hasActions) return <>{children}</>;
  return (
    <SwipeSurface leading={leading ?? NO_ACTIONS} trailing={trailing ?? NO_ACTIONS}>
      {children}
    </SwipeSurface>
  );
}

interface SwipeSurfaceProps {
  leading: readonly SwipeAction[];
  trailing: readonly SwipeAction[];
  children: React.ReactNode;
}

function SwipeSurface({ leading, trailing, children }: SwipeSurfaceProps): React.ReactElement {
  const { rootRef, view, close, trigger } = useRowSwipe(leading, trailing);
  const reducedMotion = useReducedMotion() ?? false;
  const moved = view.offset !== 0;
  // The actions stay drawn while the row slides back; the side is remembered for that slide.
  const [revealed, setRevealed] = useState(false);
  const sideRef = useRef<SwipeSide>('trailing');
  if (view.offset < 0) sideRef.current = 'trailing';
  else if (view.offset > 0) sideRef.current = 'leading';
  const side = sideRef.current;

  useEffect(() => {
    if (moved || view.tracking) {
      setRevealed(true);
      return undefined;
    }
    const timer = setTimeout(() => setRevealed(false), reducedMotion ? 0 : SWIPE.SNAP_MS);
    return () => clearTimeout(timer);
  }, [moved, view.tracking, reducedMotion]);

  const actions = side === 'trailing' ? trailing : leading;
  const openWidth = actions.length * SWIPE.ACTION_WIDTH_PX;
  const transition = swipeTransition(view.tracking, reducedMotion);

  return (
    <Box ref={rootRef} className={styles.root} data-swipe-row data-revealed={revealed || moved ? 'true' : undefined}>
      {(revealed || moved) && actions.length > 0 && (
        // Mouse-only shortcut layer: the same actions are in the row's context menu.
        <Box
          aria-hidden
          className={styles.actions}
          data-side={side}
          data-armed={view.armed === side ? 'true' : undefined}
          style={{ width: Math.max(Math.abs(view.offset), openWidth) }}
        >
          {actions.map((action) => (
            <UnstyledButton
              key={action.id}
              tabIndex={-1}
              className={styles.cell}
              data-full={action.fullSwipe ? 'true' : undefined}
              // dnd-kit's sortable listens for pointerdown on the row wrapper (flow rows).
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                trigger(action);
              }}
            >
              <Box component="span" className={styles.circle} data-tone={action.tone}>
                <action.icon size={15} />
              </Box>
              <Text component="span" className={styles.label}>{action.label}</Text>
            </UnstyledButton>
          ))}
        </Box>
      )}
      <Box
        className={styles.content}
        style={{ transform: moved ? `translateX(${view.offset}px)` : undefined, transition }}
        onClickCapture={(e) => {
          // A click on an open row closes it; it does not also open the row.
          if (!moved || view.tracking) return;
          e.preventDefault();
          e.stopPropagation();
          close();
        }}
      >
        {children}
      </Box>
    </Box>
  );
}
