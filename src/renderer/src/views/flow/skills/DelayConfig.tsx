import React from 'react';
import { Group, Stack, Text } from '@mantine/core';
import { AppNumberInput } from '../../../components/AppNumberInput';
import { SelectDropdown } from '../../../components/SelectDropdown';
import type { SkillConfigProps } from './types';

const MAX_MS = 3_600_000;
const DEFAULT_MS = 1_000;
const UNIT_FACTOR: Record<string, number> = { ms: 1, seconds: 1_000, minutes: 60_000 };
const UNITS_LARGEST_FIRST = ['minutes', 'seconds'] as const;

/** The wait the runner reads: `delayMs` alone (blank = 1 s, an explicit 0 = no wait). */
export function delayMsOf(config: Record<string, string>): number {
  const raw = (config.delayMs ?? '').trim();
  if (raw === '') return DEFAULT_MS;
  const ms = Number(raw);
  return Number.isFinite(ms) ? Math.min(Math.max(Math.round(ms), 0), MAX_MS) : DEFAULT_MS;
}

/**
 * The unit the form shows a wait in: the one the user picked (`delayUnit`), else the largest unit
 * that divides the wait exactly (1000 → 1 second, not 1000 ms). The number itself always comes
 * from `delayMs`; `delayValue` is never read: an AI edit changes `delayMs` and leaves it behind,
 * so a form that trusted it showed 2 seconds for a 5-second wait.
 */
export function delayUnitFor(config: Record<string, string>, ms: number): string {
  const stored = config.delayUnit;
  if (stored && UNIT_FACTOR[stored]) return stored;
  if (ms === 0) return 'seconds';
  return UNITS_LARGEST_FIRST.find((unit) => ms % UNIT_FACTOR[unit] === 0) ?? 'ms';
}

/** The wait in `unit`, to the thousandth (1 s in minutes reads 0.017, not 0.016666…). */
export function delayValueIn(ms: number, unit: string): number {
  return Math.round((ms / (UNIT_FACTOR[unit] ?? 1)) * 1_000) / 1_000;
}

export const DelayConfig: React.FC<SkillConfigProps> = ({ step, onChange, t }) => {
  const ms = delayMsOf(step.config);
  const unit = delayUnitFor(step.config, ms);
  const factor = UNIT_FACTOR[unit];
  const maxInUnit = MAX_MS / factor;

  // `delayValue` is dropped on every write: the form no longer reads it, so a stale copy only misleads.
  const write = (next: Record<string, string>): void => {
    const config: Record<string, string> = { ...step.config, ...next };
    delete config.delayValue;
    onChange(config);
  };

  const handleValueChange = (v: number | string) => {
    const num = typeof v === 'number' ? v : 0;
    const clampedMs = Math.min(Math.max(Math.round(num * factor), 0), MAX_MS);
    write({ delayUnit: unit, delayMs: String(clampedMs) });
  };

  return (
    <Stack gap="xs">
      <Group gap="xs" align="flex-end" grow>
        <AppNumberInput
          label={t('flow.skill.delay.value')}
          value={delayValueIn(ms, unit)}
          onChange={handleValueChange}
          min={0}
          max={maxInUnit}
          step={unit === 'ms' ? 100 : 1}
          allowNegative={false}
          size="sm"
        />
        <SelectDropdown
          label={t('flow.skill.delay.unit')}
          options={[
            { value: 'ms', label: t('flow.skill.delay.unit.ms') },
            { value: 'seconds', label: t('flow.skill.delay.unit.seconds') },
            { value: 'minutes', label: t('flow.skill.delay.unit.minutes') },
          ]}
          value={unit}
          onChange={(nextUnit) => write({ delayUnit: nextUnit, delayMs: String(ms) })}
          size="sm"
        />
      </Group>
      <Text fz="xs" c="var(--text-muted)">{t('flow.skill.delay.max')}</Text>
    </Stack>
  );
};
