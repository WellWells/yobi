import React, { forwardRef, useMemo } from 'react';
import { ActionIcon, Tooltip } from '@mantine/core';
import { GripVertical } from 'lucide-react';
import { KeyboardSensor, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import type { Active, Announcements, DndContextProps, Over } from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { announce } from '../../store/announcerStore';
import { fillTemplate } from '../../../../shared/fillTemplate';

type Translate = (key: string) => string;

/** Over / dropped on: a slot in a sortable list ("3 of 7"), another target (a folder), or nothing. */
const PLACED_KEYS = {
  over: { slot: 'a11y.e.dnd.overSlot', target: 'a11y.e.dnd.overTarget', none: 'a11y.e.dnd.overNone' },
  end: { slot: 'a11y.e.dnd.endSlot', target: 'a11y.e.dnd.endTarget', none: 'a11y.e.dnd.endNone' },
} as const;

/** A sortable item's place in its own list, 1-based, from the data `useSortable` attaches. */
function positionOf(node: Active | Over | null, t: Translate): string | null {
  const sortable = (node?.data.current as { sortable?: { index: number; items: readonly unknown[] } } | undefined)?.sortable;
  if (!sortable || sortable.index < 0) return null;
  return fillTemplate(t('a11y.e.dnd.position'), { position: String(sortable.index + 1), total: String(sortable.items.length) });
}

/**
 * What a screen reader hears while a row is dragged (WCAG 4.1.3, 1.3.1):
 * dnd-kit's defaults are English and read raw ids ("Draggable item 1779170516366-fit5hs was moved
 * over…"), and its live region and instructions would be drawn inside `role="tree"` (axe
 * aria-required-children). Here every message names the flow, folder or step as the page shows it,
 * in the interface language, with its place ("3 of 7"), and goes to the window's one polite live
 * region (`announce`). dnd-kit's own nodes are portalled to `document.body`, out of the tree.
 * `nameOf` returns null for an id it does not know; the message then says "item", never the id.
 */
export function useDndAccessibility(
  nameOf: (id: string) => string | null,
  t: Translate,
): NonNullable<DndContextProps['accessibility']> {
  return useMemo(() => {
    const name = (node: Active | Over | null): string => (node && nameOf(String(node.id))) || t('a11y.e.dnd.item');
    const say = (key: string, vars: Record<string, string>): undefined => {
      announce(fillTemplate(t(key), vars));
      return undefined;
    };
    const placed = (phase: 'over' | 'end', active: Active, over: Over | null): undefined => {
      const keys = PLACED_KEYS[phase];
      const subject = name(active);
      if (!over) return say(keys.none, { name: subject });
      const position = positionOf(over, t);
      if (position) return say(keys.slot, { name: subject, position });
      return say(keys.target, { name: subject, target: name(over) });
    };
    const announcements: Announcements = {
      onDragStart: ({ active }) => say('a11y.e.dnd.start', { name: name(active) }),
      onDragOver: ({ active, over }) => placed('over', active, over),
      onDragEnd: ({ active, over }) => placed('end', active, over),
      onDragCancel: ({ active }) => say('a11y.e.dnd.cancel', { name: name(active) }),
    };
    return {
      announcements,
      screenReaderInstructions: { draggable: t('a11y.e.dnd.instructions') },
      container: typeof document === 'undefined' ? undefined : document.body,
    };
  }, [nameOf, t]);
}

const KEYBOARD_SENSOR = { coordinateGetter: sortableKeyboardCoordinates };
/**
 * The flow sidebar's rows: only Space picks a row up for keyboard sorting, so Enter is free to open
 * the flow, as Enter opens a row in every tree (WCAG 2.1.1).
 */
const KEYBOARD_SENSOR_SPACE_ONLY = {
  coordinateGetter: sortableKeyboardCoordinates,
  keyboardCodes: { start: ['Space'], cancel: ['Escape'], end: ['Space', 'Enter'] },
};

export function useFlowSensors(options?: { delay?: number; enterOpens?: boolean }) {
  // The same objects across draws: dnd-kit rebuilds every sortable's listeners when a sensor's
  // options change, and with fresh objects each draw every step card drew again per keystroke.
  const delay = options?.delay;
  const pointer = useMemo(
    () => ({ activationConstraint: delay ? { delay, tolerance: 5 } : { distance: 5 } }),
    [delay],
  );
  return useSensors(
    useSensor(PointerSensor, pointer),
    useSensor(KeyboardSensor, options?.enterOpens ? KEYBOARD_SENSOR_SPACE_ONLY : KEYBOARD_SENSOR),
  );
}

interface DragHandleProps extends React.HTMLAttributes<HTMLButtonElement> {
  label: string;
  locked?: boolean;
}

export const DragHandle = forwardRef<HTMLButtonElement, DragHandleProps>(
  ({ label, locked = false, ...listeners }, ref) => {
    const grip = (
      <ActionIcon
        ref={ref}
        variant="subtle"
        color="gray"
        size={24}
        aria-label={label}
        disabled={locked}
        style={{ cursor: locked ? 'default' : 'grab', touchAction: 'none', flexShrink: 0 }}
        {...listeners}
      >
        <GripVertical size={14} />
      </ActionIcon>
    );
    if (locked) return grip;
    return <Tooltip label={label} position="right">{grip}</Tooltip>;
  },
);
DragHandle.displayName = 'DragHandle';
