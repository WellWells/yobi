import React from 'react';
import { PasswordInput, type PasswordInputProps } from '@mantine/core';
import { buildInputStyles, type AppInputTone } from './inputStyles';

interface AppPasswordInputProps extends PasswordInputProps {
  tone?: AppInputTone;
  mono?: boolean;
}

export const AppPasswordInput = React.forwardRef<HTMLInputElement, AppPasswordInputProps>(({
  tone = 'default',
  mono = false,
  ...props
}, ref) => (
  <PasswordInput
    ref={ref}
    size="sm"
    variant="default"
    styles={buildInputStyles({ tone, mono })}
    {...props}
  />
));

AppPasswordInput.displayName = 'AppPasswordInput';
