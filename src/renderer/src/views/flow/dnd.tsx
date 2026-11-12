import React, { forwardRef, useMemo } from 'react';
import { ActionIcon, Tooltip } from '@mantine/core';
import { GripVertical } from 'lucide-react';
import { KeyboardSensor, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';

const KEYBOARD_SENSOR = { coordinateGetter: sortableKeyboardCoordinates };

export function useFlowSensors(options?: { delay?: number }) {
  // The same objects across draws: dnd-kit rebuilds every sortable's listeners when a sensor's
  // options change, and with fresh objects each draw every step card drew again per keystroke.
  const delay = options?.delay;
  const pointer = useMemo(
    () => ({ activationConstraint: delay ? { delay, tolerance: 5 } : { distance: 5 } }),
    [delay],
  );
  return useSensors(
    useSensor(PointerSensor, pointer),
    useSensor(KeyboardSensor, KEYBOARD_SENSOR),
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
