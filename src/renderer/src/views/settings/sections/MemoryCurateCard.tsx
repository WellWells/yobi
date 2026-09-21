import React from 'react';
import { Badge, Box, Checkbox, Group, Stack, Text } from '@mantine/core';
import { AppTextarea } from '../../../components/AppTextarea';
import type { MemoryCurateChange } from '../../../../../shared/memoryCurate';

export interface CardPick {
  checked: boolean;
  /** The sentence a merge or rewrite leaves, as the user may have edited it. */
  text?: string;
}

interface Props {
  change: MemoryCurateChange;
  pick: CardPick;
  maxChars: number;
  onChange: (pick: CardPick) => void;
  t: (key: string) => string;
}

/** Whether a ticked card can be applied as it stands. */
export function cardPickValid(change: MemoryCurateChange, pick: CardPick, maxChars: number): boolean {
  if (!pick.checked || change.op === 'remove') return true;
  const length = (pick.text ?? '').trim().length;
  return length > 0 && length <= maxChars;
}

/**
 * One proposed change: what goes (struck through), what replaces it, and the model's reason.
 * A change the model was not sure about starts unticked, so removing it takes the user's own click.
 */
export const MemoryCurateCard: React.FC<Props> = ({ change, pick, maxChars, onChange, t }) => {
  const label = t(`settings.memory.curate.op.${change.op}`);
  const length = (pick.text ?? '').trim().length;
  const invalid = !cardPickValid(change, pick, maxChars);
  return (
    <Box
      p="8px 10px"
      bg="var(--mantine-color-bg-tertiary)"
      style={{ border: '1px solid var(--mantine-color-default-border)', borderRadius: 'var(--radius-sm)' }}
    >
      <Group gap={10} wrap="nowrap" align="flex-start">
        <Checkbox
          mt={2}
          size="xs"
          checked={pick.checked}
          aria-label={label}
          onChange={(event) => onChange({ ...pick, checked: event.currentTarget.checked })}
        />
        <Stack gap={4} style={{ minWidth: 0, flex: 1 }}>
          <Group gap={6} wrap="nowrap">
            <Text fz="var(--font-size-sm)" fw={600}>{label}</Text>
            {!change.sure && <Badge size="xs" variant="light" color="orange">{t('settings.memory.curate.unsure')}</Badge>}
          </Group>
          {change.why && <Text fz="var(--font-size-sm)" c="dimmed" style={{ overflowWrap: 'anywhere' }}>{change.why}</Text>}
          {change.before.map((item) => (
            <Text key={item.id} fz="var(--font-size-base)" td="line-through" c="dimmed" style={{ overflowWrap: 'anywhere' }}>
              {item.text}
            </Text>
          ))}
          {change.op !== 'remove' && (
            <>
              <AppTextarea
                value={pick.text ?? ''}
                autosize
                minRows={1}
                maxRows={4}
                disabled={!pick.checked}
                error={invalid}
                aria-label={label}
                onChange={(event) => onChange({ ...pick, text: event.currentTarget.value })}
              />
              {invalid && (
                <Text fz="var(--font-size-sm)" c="var(--mantine-color-error)">{`${length} / ${maxChars}`}</Text>
              )}
            </>
          )}
        </Stack>
      </Group>
    </Box>
  );
};
