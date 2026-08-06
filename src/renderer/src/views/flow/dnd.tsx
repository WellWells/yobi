import React, { forwardRef } from 'react';
import { ActionIcon, Tooltip } from '@mantine/core';
import { GripVertical } from 'lucide-react';
import { KeyboardSensor, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';

export function useFlowSensors(options?: { delay?: number }) {
  const activationConstraint = options?.delay
    ? { delay: options.delay, tolerance: 5 }
    : { distance: 5 };
  return useSensors(
    useSensor(PointerSensor, { activationConstraint }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
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
