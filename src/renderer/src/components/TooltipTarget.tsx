import React, { cloneElement } from 'react';
import { Tooltip, type TooltipProps } from '@mantine/core';

type TooltipTargetProps = Pick<TooltipProps, 'label' | 'position' | 'disabled' | 'multiline' | 'maw' | 'openDelay' | 'withArrow'> & {
  children: React.ReactElement;
};

/**
 * A tooltip around a `Menu.Target` / `Popover.Target` child. Put it where the bare `<Tooltip>` would go.
 *
 * The target clones `aria-haspopup`, `aria-expanded`, `aria-controls`, `id`, the ref and its click
 * handler onto its child. A bare `Tooltip` there keeps every prop it does not know for its own bubble,
 * so the trigger lost its expanded state and its link to the menu (WCAG 4.1.2). This hands them on to
 * the control instead; the tooltip only gets the props listed above.
 */
export function TooltipTarget({
  label, position, disabled, multiline, maw, openDelay, withArrow, children, ...targetProps
}: TooltipTargetProps): React.ReactElement {
  return (
    <Tooltip label={label} position={position} disabled={disabled} multiline={multiline} maw={maw} openDelay={openDelay} withArrow={withArrow}>
      {cloneElement(children, targetProps)}
    </Tooltip>
  );
}
