import React from 'react';
import { RotateCcw } from 'lucide-react';
import { AppButton } from '../../../components/AppButton';
import { SettingRow } from '../../../components/SettingRow';

interface Props {
  label: string;
  /** What the record means now: "only new items next time", or nothing read yet. */
  status: string;
  resetLabel: string;
  hasCheckpoint: boolean;
  onReset: () => void;
}

/**
 * A follow step's read record as one row: its state on the left, a secondary "reset" on the
 * right. Resetting can be redone by running again, so it is no standing red button.
 */
export const CheckpointRow: React.FC<Props> = ({ label, status, resetLabel, hasCheckpoint, onReset }) => (
  <SettingRow
    label={label}
    hint={status}
    control={(
      <AppButton
        variant="default"
        size="xs"
        leftSection={<RotateCcw size={14} />}
        onClick={onReset}
        disabled={!hasCheckpoint}
      >
        {resetLabel}
      </AppButton>
    )}
  />
);
