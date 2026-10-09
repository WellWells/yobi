import React, { useCallback, useEffect, useState } from 'react';
import { AppTextInput } from '../../components/AppTextInput';
import { formatTimeOfDay, parseTimeOfDay } from '../../../../shared/flowSchedule';

const ARROW_STEP_MINUTES = 15;
const SHIFT_STEP_MINUTES = 1;
const MINUTES_PER_DAY = 24 * 60;

export interface TimeFieldProps {
  hour: number;
  minute: number;
  onChange: (hour: number, minute: number) => void;
  label: string;
  disabled?: boolean;
}

/**
 * Free-typed time (`parseTimeOfDay` also takes "0900" and "9"); arrow keys step 15 minutes (Shift
 * for 1). Unreadable input is marked and kept rather than silently reverted.
 */
export const TimeField: React.FC<TimeFieldProps> = ({ hour, minute, onChange, label, disabled }) => {
  const committed = formatTimeOfDay(hour, minute);
  const [text, setText] = useState(committed);
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    setText(committed);
    setInvalid(false);
  }, [committed]);

  const commit = useCallback((value: string) => {
    const parsed = parseTimeOfDay(value);
    if (!parsed) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    setText(formatTimeOfDay(parsed.hour, parsed.minute));
    onChange(parsed.hour, parsed.minute);
  }, [onChange]);

  const step = useCallback((delta: number) => {
    const total = (hour * 60 + minute + delta + MINUTES_PER_DAY) % MINUTES_PER_DAY;
    onChange(Math.floor(total / 60), total % 60);
  }, [hour, minute, onChange]);

  return (
    <AppTextInput
      aria-label={label}
      aria-invalid={invalid}
      error={invalid}
      tone="tertiary"
      numeric
      value={text}
      disabled={disabled}
      w={92}
      inputMode="numeric"
      placeholder="09:00"
      onFocus={(event) => event.currentTarget.select()}
      onChange={(event) => {
        setText(event.currentTarget.value);
        // Only judge the value once it is finished; flagging mid-keystroke flashes red on "09:".
        if (invalid) setInvalid(false);
      }}
      onBlur={(event) => commit(event.currentTarget.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          commit(event.currentTarget.value);
          return;
        }
        if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
        event.preventDefault();
        const size = event.shiftKey ? SHIFT_STEP_MINUTES : ARROW_STEP_MINUTES;
        step(event.key === 'ArrowUp' ? size : -size);
      }}
    />
  );
};
