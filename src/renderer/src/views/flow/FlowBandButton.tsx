import React from 'react';
import { ActionIcon, Button, Tooltip } from '@mantine/core';

interface FlowBandButtonProps {
  /** The band is too narrow for words: the icon alone, named by its tooltip. */
  compact: boolean;
  label: string;
  icon: React.ReactNode;
  /** Run is the band's one filled control, Stop the red one; the rest are outlined. */
  tone?: 'default' | 'primary' | 'danger';
  onClick: () => void;
  disabled?: boolean;
}

/**
 * A button in the flow editor's top band. The band shares its row with the window's caption
 * controls floating at its end, so at the window's narrowest the labels give way to icons; the
 * controls stay 30px, the toolbar's height, either way.
 */
export const FlowBandButton: React.FC<FlowBandButtonProps> = ({ compact, label, icon, tone = 'default', onClick, disabled }) => {
  const shared = { onClick, disabled };
  if (compact) {
    const iconOnly = { ...shared, size: 30, 'aria-label': label };
    return (
      <Tooltip label={label} position="bottom">
        {tone === 'default' ? <ActionIcon variant="default" {...iconOnly}>{icon}</ActionIcon>
          : tone === 'danger' ? <ActionIcon variant="filled" color="red" {...iconOnly}>{icon}</ActionIcon>
            : <ActionIcon variant="filled" {...iconOnly}>{icon}</ActionIcon>}
      </Tooltip>
    );
  }
  const labelled = { ...shared, size: 'xs', leftSection: icon };
  if (tone === 'danger') return <Button variant="filled" color="red" {...labelled}>{label}</Button>;
  if (tone === 'primary') return <Button variant="filled" {...labelled}>{label}</Button>;
  return <Button variant="default" {...labelled}>{label}</Button>;
};
