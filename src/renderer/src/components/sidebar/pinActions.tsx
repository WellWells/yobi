import React from 'react';
import { ActionIcon, Menu as MMenu, Tooltip } from '@mantine/core';
import { Pin, PinOff } from 'lucide-react';
import type { OutputFile } from '../../../../shared/types';

/**
 * What one pin action on the checked conversations does: unpin when every one of them is pinned
 * already, otherwise pin them all (a mixed set is pinned, as in Apple Notes). Null with nothing checked.
 */
export function selectionPinTarget(files: readonly OutputFile[], selected: ReadonlySet<string>): boolean | null {
  const picked = files.filter((file) => selected.has(file.path));
  if (picked.length === 0) return null;
  return !picked.every((file) => file.pinned);
}

interface SelectionPinProps {
  /** `true` pins, `false` unpins, `null` = nothing checked. */
  target: boolean | null;
  onPin: (pinned: boolean) => void;
  disabled?: boolean;
  t: (key: string) => string;
}

/** The pin row of the right-click menu while selecting. */
export const SelectionPinMenuItem: React.FC<SelectionPinProps> = ({ target, onPin, disabled, t }) => (
  <MMenu.Item
    leftSection={target === false ? <PinOff size={13} /> : <Pin size={13} />}
    disabled={disabled || target === null}
    onClick={() => { if (target !== null) onPin(target); }}
  >
    {t(target === false ? 'context.unpin' : 'context.pin')}
  </MMenu.Item>
);

/** The pin button on the selection bar, beside Export: an icon, its name on hover. */
export const SelectionPinButton: React.FC<SelectionPinProps> = ({ target, onPin, disabled, t }) => {
  const label = t(target === false ? 'context.unpin' : 'context.pin');
  return (
    <Tooltip label={label} position="top">
      <ActionIcon
        size="input-xs"
        variant="default"
        aria-label={label}
        disabled={disabled || target === null}
        onClick={() => { if (target !== null) onPin(target); }}
      >
        {target === false ? <PinOff size={14} /> : <Pin size={14} />}
      </ActionIcon>
    </Tooltip>
  );
};
