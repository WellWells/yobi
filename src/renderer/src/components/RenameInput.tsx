import React, { useCallback, useRef, useState } from 'react';
import { Group } from '@mantine/core';
import { useMergedRef } from '@mantine/hooks';
import type { AiNameSource } from '../../../shared/aiName';
import { AppTextInput } from './AppTextInput';
import { AiNameButton, useAiName } from './AiNameButton';
import { isAiNameTarget, renameKeyAction } from './renameKeys';
import type { RenameMode } from './renameKeys';

type AppTextInputProps = React.ComponentProps<typeof AppTextInput>;

interface RenameInputProps extends Omit<AppTextInputProps, 'value' | 'onChange' | 'error' | 'rightSection'> {
  value: string;
  onChange: (value: string) => void;
  /**
   * What the ✨ names it from; null = nothing yet (an empty category, a blank flow). A getter is
   * read only when a model is picked (a step card's name reads the steps around it, which the card
   * does not redraw for).
   */
  ai: AiNameSource | (() => AiNameSource | null) | null;
  /** Enter, or leaving the box when `commitOnBlur`. */
  onCommit?: () => void;
  /** Escape (when no name is being asked for). */
  onCancel?: () => void;
  /** The box saves when it loses focus (the sidebar rows, the titles). */
  commitOnBlur?: boolean;
  /** 'field': a form field with no save of its own (the flow editor's name): Enter does nothing. */
  mode?: RenameMode;
  /** Drawn before the ✨, inside the box (the export dialog's `.pdf`); widen `rightSectionWidth` to fit. */
  suffix?: React.ReactNode;
}

/**
 * Every rename box: the text input with the ✨ at its end. The button and its model menu are part of
 * the box — hovering, clicking and picking a model never count as leaving it. A name that comes back
 * replaces the text, selected, so typing over it or pressing Enter both work; typing while a name is
 * on its way drops the request.
 */
export const RenameInput = React.forwardRef<HTMLInputElement, RenameInputProps>(({
  value, onChange, ai, onCommit, onCancel, commitOnBlur = false, mode = 'rename', suffix,
  onKeyDown, onBlur, ...rest
}, ref) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const mergedRef = useMergedRef(ref, inputRef);
  const [error, setError] = useState<string | null>(null);

  const onName = useCallback((name: string) => {
    setError(null);
    onChange(name);
    // Selected for typing over only while the user is still here (in the box, its menu, or
    // nowhere): one who went on to type in another field keeps that field.
    const active = document.activeElement;
    const stillHere = !active || active === document.body || active === inputRef.current || isAiNameTarget(active);
    if (!stillHere) return;
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  }, [onChange]);
  const naming = useAiName(onName, setError);

  const commit = (): void => {
    naming.cancel();
    onCommit?.();
  };

  // The menu closed with focus in it (a model was picked, or Escape): back to the box. Focus gone
  // somewhere else means the user left while the menu was open: a box that saves on blur saves.
  const onMenuClose = (): void => {
    requestAnimationFrame(() => {
      const input = inputRef.current;
      if (!input || document.activeElement === input) return;
      const active = document.activeElement;
      if (!active || active === document.body || isAiNameTarget(active)) {
        input.focus();
        return;
      }
      if (commitOnBlur) commit();
    });
  };

  const button = (
    <AiNameButton
      busy={naming.busy}
      disabled={ai === null}
      onPick={(providerUrl) => {
        const source = typeof ai === 'function' ? ai() : ai;
        if (!source) return;
        setError(null);
        naming.start(providerUrl, source);
      }}
      onCancel={naming.cancel}
      onMenuClose={onMenuClose}
    />
  );

  return (
    <AppTextInput
      ref={mergedRef}
      {...rest}
      value={value}
      error={error}
      onChange={(event) => {
        const next = event.currentTarget.value;
        naming.cancel();
        setError(null);
        onChange(next);
      }}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        if (event.defaultPrevented) return;
        const action = renameKeyAction(event.nativeEvent, mode);
        if (action === 'commit') {
          event.preventDefault();
          commit();
        } else if (action === 'cancel' && (naming.busy || onCancel)) {
          // Escape stops a running name first; only the next one cancels the rename.
          event.preventDefault();
          event.stopPropagation();
          if (naming.busy) naming.cancel();
          else onCancel?.();
        }
      }}
      onBlur={(event) => {
        onBlur?.(event);
        if (!commitOnBlur || isAiNameTarget(event.relatedTarget)) return;
        commit();
      }}
      rightSectionPointerEvents="all"
      rightSection={suffix ? <Group gap={4} wrap="nowrap">{suffix}{button}</Group> : button}
    />
  );
});

RenameInput.displayName = 'RenameInput';
