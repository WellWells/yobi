import React from 'react';
import { Button, Loader, type ButtonProps, type ElementProps } from '@mantine/core';

type AppButtonProps = ButtonProps & ElementProps<'button', keyof ButtonProps>;

export const AppButton = React.forwardRef<HTMLButtonElement, AppButtonProps>(({
  loading,
  leftSection,
  disabled,
  ...props
}, ref) => {
  // Mantine's own `loading` covers the whole button and hides the label. The spinner goes in the
  // left slot instead — in place of the icon, or where one would be — and the label stays readable.
  if (loading) {
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
      disabled={disabled}
    />
  );
});

AppButton.displayName = 'AppButton';
