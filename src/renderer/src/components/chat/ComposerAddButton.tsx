import React, { useRef } from 'react';
import { ActionIcon, FileButton, Tooltip } from '@mantine/core';
import { Plus } from 'lucide-react';
import styles from './ComposerAddButton.module.css';

interface ComposerAddButtonProps {
  t: (key: string) => string;
  onAddFiles: (files: File[]) => void;
  disabledReason: string | null;
  accept: string;
}

export const ComposerAddButton: React.FC<ComposerAddButtonProps> = ({
  t,
  onAddFiles,
  disabledReason,
  accept,
}) => {
  const resetPicker = useRef<() => void>(null);
  const handleFiles = (files: File[]): void => {
    onAddFiles(files);
    resetPicker.current?.();
  };

  return (
  <FileButton onChange={handleFiles} resetRef={resetPicker} multiple accept={accept}>
    {(props) => (
      <Tooltip label={disabledReason ?? t('attach.add')} position="top">
        <ActionIcon
          {...props}
          variant="subtle"
          className={styles.button}
          size={30}
          radius="xl"
          aria-label={t('attach.add')}
          aria-disabled={disabledReason ? true : undefined}
          data-disabled={disabledReason ? true : undefined}
          c={disabledReason ? 'var(--mantine-color-dimmed)' : 'var(--mantine-color-text)'}
          onClick={(event) => {
            if (disabledReason) {
              event.preventDefault();
              return;
            }
            props.onClick();
          }}
        >
          <Plus size={17} />
        </ActionIcon>
      </Tooltip>
    )}
  </FileButton>
  );
};
