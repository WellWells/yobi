import React from 'react';
import { TextInput, type TextInputProps } from '@mantine/core';
import { buildInputStyles, mergeInputStyles, type AppInputTone } from './inputStyles';

interface AppTextInputProps extends TextInputProps {
  tone?: AppInputTone;
  mono?: boolean;
  numeric?: boolean;
}

export const AppTextInput = React.forwardRef<HTMLInputElement, AppTextInputProps>(({
  tone = 'default',
  mono = false,
  numeric = false,
  styles,
  ...props
}, ref) => (
  <TextInput
    ref={ref}
    size="sm"
    variant="default"
    styles={mergeInputStyles(buildInputStyles({ tone, mono, numeric }), styles)}
    // A mono field holds a code (a command, a variable name): a spelling squiggle there is noise,
    // and the app's right-click menu has no suggestions to offer for it.
    spellCheck={mono ? false : undefined}
    {...props}
  />
));

AppTextInput.displayName = 'AppTextInput';
