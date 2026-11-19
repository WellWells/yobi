import React from 'react';
import { PasswordInput, type PasswordInputProps } from '@mantine/core';
import { buildInputStyles, mergeInputStyles, type AppInputTone } from './inputStyles';
import { useFieldName } from './fieldLabel';

interface AppPasswordInputProps extends PasswordInputProps {
  tone?: AppInputTone;
  mono?: boolean;
}

export const AppPasswordInput = React.forwardRef<HTMLInputElement, AppPasswordInputProps>(({
  tone = 'default',
  mono = false,
  styles,
  ...props
}, ref) => {
  const named = useFieldName(props);
  return (
    <PasswordInput
      ref={ref}
      size="sm"
      variant="default"
      styles={mergeInputStyles(buildInputStyles({ tone, mono }), styles)}
      {...named}
      {...props}
    />
  );
});

AppPasswordInput.displayName = 'AppPasswordInput';
