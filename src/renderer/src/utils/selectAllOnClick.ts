import type React from 'react';

export const selectAllOnClick = {
  onFocus: (event: React.FocusEvent<HTMLInputElement>): void => event.currentTarget.select(),
  onMouseDown: (event: React.MouseEvent<HTMLInputElement>): void => {
    if (event.button !== 0) return;
    const input = event.currentTarget;
    event.preventDefault();
    input.focus();
    input.select();
  },
} as const;
