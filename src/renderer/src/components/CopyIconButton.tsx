import React from 'react';
import { ActionIcon, CopyButton, Tooltip } from '@mantine/core';
import type { FloatingPosition } from '@mantine/core';
import { Check, Copy } from 'lucide-react';

interface Props {
  value: string;
  copyLabel: string;
  copiedLabel: string;
  size?: number | string;
  position?: FloatingPosition;
}

export const CopyIconButton: React.FC<Props> = ({
  value, copyLabel, copiedLabel, size = 26, position = 'left',
}) => (
  <CopyButton value={value}>
    {({ copied, copy }) => (
      <Tooltip label={copied ? copiedLabel : copyLabel} position={position}>
        <ActionIcon variant="subtle" size={size} color={copied ? 'teal' : 'gray'} onClick={copy} aria-label={copyLabel}>
          {copied ? <Check size={13} /> : <Copy size={13} />}
        </ActionIcon>
      </Tooltip>
    )}
  </CopyButton>
);
