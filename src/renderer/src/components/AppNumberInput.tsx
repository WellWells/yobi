import React from 'react';
import { NumberInput, type NumberInputProps } from '@mantine/core';
import { buildInputStyles, type AppInputTone } from './inputStyles';

interface AppNumberInputProps extends NumberInputProps {
  tone?: AppInputTone;
  mono?: boolean;
}

export const AppNumberInput = React.forwardRef<HTMLInputElement, AppNumberInputProps>(({
  tone = 'default',
  mono = false,
  ...props
}, ref) => (
  <NumberInput
    ref={ref}
    size="sm"
    variant="default"
    styles={buildInputStyles({ tone, mono })}
    {...props}
  />
));

AppNumberInput.displayName = 'AppNumberInput';
