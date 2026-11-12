import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActionIcon, Loader, Tooltip } from '@mantine/core';
import { Sparkles } from 'lucide-react';
import { aiNameApi } from '../api/electronApi';
import { useI18nStore } from '../store/i18nStore';
import type { AiNameSource } from '../../../shared/aiName';
import { AiModelMenu } from './AiModelMenu';
import { AI_NAME_BUTTON_ATTR } from './renameKeys';

/**
 * One naming request at a time per box: a newer pick, typing, Escape or the box closing drops the
 * one running (main also drops it when another box starts one). A late answer for a dropped
 * request is ignored.
 */
export function useAiName(onName: (name: string) => void, onError: (message: string) => void) {
  const [busy, setBusy] = useState(false);
  const runningRef = useRef<string | null>(null);
  const onNameRef = useRef(onName);
  onNameRef.current = onName;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const cancel = useCallback(() => {
    const id = runningRef.current;
    if (!id) return;
    runningRef.current = null;
    setBusy(false);
    void aiNameApi.cancel(id).catch(() => undefined);
  }, []);

  useEffect(() => cancel, [cancel]);

  const start = useCallback((providerUrl: string, source: AiNameSource) => {
    cancel();
    const id = crypto.randomUUID();
    runningRef.current = id;
    setBusy(true);
    const settle = (): boolean => {
      if (runningRef.current !== id) return false;
      runningRef.current = null;
      setBusy(false);
      return true;
    };
    void aiNameApi.suggest({ id, providerUrl, source }).then((result) => {
      if (!settle()) return;
      if (result.ok) onNameRef.current(result.name);
      else if (result.reason === 'failed') onErrorRef.current(result.error);
    }, () => {
      if (settle()) onErrorRef.current(useI18nStore.getState().t('aiName.error.empty'));
    });
  }, [cancel]);

  return { busy, start, cancel };
}

interface AiNameButtonProps {
  busy: boolean;
  /** Nothing to name it from yet: the button stays, greyed, and says so. */
  disabled: boolean;
  onPick: (providerUrl: string) => void;
  onCancel: () => void;
  onMenuClose?: () => void;
}

/**
 * The ✨ at the end of every rename box. Hovering or clicking opens the model menu; picking a model
 * names it. While it runs the button is a spinner that cancels. A press never takes focus from the
 * box (a box that saves on blur would close under the user).
 */
export const AiNameButton: React.FC<AiNameButtonProps> = ({ busy, disabled, onPick, onCancel, onMenuClose }) => {
  const t = useI18nStore((s) => s.t);
  // A press is the button's alone: it keeps focus in the box (mousedown's default would move it)
  // and never reaches the row around the box (open, select, drag).
  const attrs = {
    [AI_NAME_BUTTON_ATTR]: '',
    onPointerDown: (event: React.PointerEvent) => event.stopPropagation(),
    onKeyDown: (event: React.KeyboardEvent) => event.stopPropagation(),
    onClick: (event: React.MouseEvent) => event.stopPropagation(),
  };
  const keepFocus = (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
  };

  if (busy) {
    return (
      <Tooltip label={t('aiName.busy')}>
        <ActionIcon
          {...attrs}
          variant="subtle"
          size={22}
          c="dimmed"
          aria-label={t('aiName.busy')}
          onMouseDown={keepFocus}
          onClick={(event) => {
            event.stopPropagation();
            onCancel();
          }}
        >
          <Loader size={12} />
        </ActionIcon>
      </Tooltip>
    );
  }

  const button = (
    <ActionIcon
      {...attrs}
      variant="subtle"
      size={22}
      c="dimmed"
      aria-label={t('aiName.button')}
      aria-haspopup={disabled ? undefined : 'menu'}
      aria-disabled={disabled || undefined}
      // data-disabled keeps pointer events, so the tooltip saying why can still show.
      data-disabled={disabled || undefined}
      onMouseDown={keepFocus}
    >
      <Sparkles size={14} />
    </ActionIcon>
  );
  if (disabled) {
    return <Tooltip label={t('aiName.error.noMaterial')}>{button}</Tooltip>;
  }
  return (
    <AiModelMenu menuLabel={t('aiName.menu')} onPick={onPick} onClose={onMenuClose}>
      {button}
    </AiModelMenu>
  );
};
