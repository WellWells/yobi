import React from 'react';
import { Box } from '@mantine/core';

export interface AgentFlowIconProps {
  size?: number;
}

const iconSrc = new URL('../../../../assets/sparkles.svg', import.meta.url).toString();

const iconMaskStyle: React.CSSProperties = {
  display: 'inline-block',
  flexShrink: 0,
  backgroundColor: 'currentColor',
  WebkitMaskImage: `url("${iconSrc}")`,
  WebkitMaskRepeat: 'no-repeat',
  WebkitMaskPosition: 'center',
  WebkitMaskSize: 'contain',
  maskImage: `url("${iconSrc}")`,
  maskRepeat: 'no-repeat',
  maskPosition: 'center',
  maskSize: 'contain',
};

export const AgentFlowIcon: React.FC<AgentFlowIconProps> = ({ size = 15 }) => (
  <Box component="span" w={size} h={size} aria-hidden="true" style={iconMaskStyle} />
);

