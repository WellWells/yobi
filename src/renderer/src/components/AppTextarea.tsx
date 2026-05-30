import React from 'react';
import { Textarea, type TextareaProps } from '@mantine/core';
import { buildInputStyles, type AppInputResize, type AppInputTone } from './inputStyles';

type AppTextareaTone = AppInputTone | 'prompt';

interface AppTextareaProps extends TextareaProps {
  tone?: AppTextareaTone;
  mono?: boolean;
  resize?: AppInputResize;
}

const PROMPT_TEXTAREA_STYLES = {
  root: { width: '100%' },
  wrapper: { width: '100%' },
  input: {
    width: '100%',
    background: 'transparent',
    border: 'none',
    outline: 'none',
    boxShadow: 'none',
    color: 'var(--mantine-color-text)',
    fontSize: 'var(--font-size-xl)',
    fontFamily: 'var(--font-sans)',
    lineHeight: 1.55,
    resize: 'none',
    padding: '2px 0',
  },
} satisfies NonNullable<TextareaProps['styles']>;

export const AppTextarea = React.forwardRef<HTMLTextAreaElement, AppTextareaProps>(({
  tone = 'default',
  mono = false,
  resize = 'none',
  ...props
}, ref) => {
  if (tone === 'prompt') {
    return (
      <Textarea
        ref={ref}
        unstyled
        autosize
        minRows={3}
        maxRows={3}
        styles={PROMPT_TEXTAREA_STYLES}
        {...props}
      />
    );
  }

  return (
      <Textarea
        ref={ref}
        size="sm"
        variant="default"
        styles={buildInputStyles({ tone, mono, resize })}
        {...props}
      />
    );
});

AppTextarea.displayName = 'AppTextarea';
