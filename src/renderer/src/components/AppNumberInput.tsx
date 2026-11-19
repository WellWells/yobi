import React from 'react';
import { NumberInput, type NumberInputProps } from '@mantine/core';
import { buildInputStyles, mergeInputStyles, type AppInputTone } from './inputStyles';
import { useFieldName } from './fieldLabel';

interface AppNumberInputProps extends NumberInputProps {
  tone?: AppInputTone;
  mono?: boolean;
}

export const AppNumberInput = React.forwardRef<HTMLInputElement, AppNumberInputProps>(({
  tone = 'default',
  mono = false,
  styles,
  ...props
}, ref) => {
  const named = useFieldName(props);
  return (
    <NumberInput
      ref={ref}
      size="sm"
      variant="default"
      styles={mergeInputStyles(buildInputStyles({ tone, mono }), styles)}
      {...named}
      {...props}
    />
  );
});

AppNumberInput.displayName = 'AppNumberInput';
