import React from 'react';
import { Button, Loader, type ButtonProps, type ElementProps } from '@mantine/core';

type AppButtonProps = ButtonProps & ElementProps<'button', keyof ButtonProps>;

export const AppButton = React.forwardRef<HTMLButtonElement, AppButtonProps>(({
  loading,
  leftSection,
  disabled,
  ...props
}, ref) => {
  if (loading && leftSection) {
    return (
      <Button
        ref={ref}
        {...props}
        leftSection={<Loader size={14} color="var(--button-color)" />}
        disabled
      />
    );
  }

  return (
    <Button
      ref={ref}
      {...props}
      leftSection={leftSection}
      loading={loading}
      disabled={disabled}
    />
  );
});

AppButton.displayName = 'AppButton';
