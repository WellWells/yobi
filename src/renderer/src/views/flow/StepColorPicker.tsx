import { useState } from 'react';
import { ActionIcon, Button, ColorSwatch, Popover, SimpleGrid, Stack, Tooltip } from '@mantine/core';
import { Check, Palette } from 'lucide-react';
import { FLOW_STEP_COLORS, readFlowStepColor } from '../../../../shared/flowStepColor';
import type { FlowStepColor } from '../../../../shared/flowStepColor';
import { GroupHeader } from '../../components/GroupHeader';
import { stepColorBackground, stepColorMark } from '../../theme/flowStepColors';

interface StepColorPickerProps {
  color?: FlowStepColor;
  onChange: (color: FlowStepColor | undefined) => void;
  t: (key: string) => string;
}

/** A long flow mounts a popover only after this card's palette has been opened. */
export function StepColorPicker({ color: value, onChange, t }: StepColorPickerProps) {
  const [armed, setArmed] = useState(false);
  const [opened, setOpened] = useState(false);
  const color = readFlowStepColor(value);
  const label = t('flow.step.color');
  const trigger = (
    <Tooltip label={label} position="top" disabled={opened}>
      <ActionIcon
        variant="subtle"
        size="sm"
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={opened}
        data-step-color-picker=""
        c={stepColorMark(color)}
        onClick={() => { setArmed(true); setOpened((before) => !before); }}
      >
        <Palette size={14} />
      </ActionIcon>
    </Tooltip>
  );
  if (!armed) return trigger;

  const choose = (next: FlowStepColor | undefined): void => {
    onChange(next);
    setOpened(false);
  };
  return (
    <Popover opened={opened} onChange={setOpened} position="bottom-end" withinPortal trapFocus returnFocus width={192}>
      <Popover.Target>{trigger}</Popover.Target>
      <Popover.Dropdown aria-label={label} data-step-color-menu="">
        <Stack gap="xs">
          <GroupHeader variant="plain" label={label} />
          <SimpleGrid cols={4} spacing="xs">
            {FLOW_STEP_COLORS.map((option) => (
              <Tooltip key={option} label={t(`flow.step.color.${option}`)}>
                <ColorSwatch
                  component="button"
                  type="button"
                  color={stepColorBackground(option)!}
                  size={32}
                  radius="sm"
                  withShadow={false}
                  aria-label={t(`flow.step.color.${option}`)}
                  aria-pressed={color === option}
                  data-color-option={option}
                  data-autofocus={color === option || (!color && option === FLOW_STEP_COLORS[0]) ? true : undefined}
                  style={{ border: `1px solid ${stepColorMark(option)}`, color: 'var(--mantine-color-text)' }}
                  onClick={() => choose(option)}
                >
                  {color === option && <Check size={16} />}
                </ColorSwatch>
              </Tooltip>
            ))}
          </SimpleGrid>
          <Button variant="subtle" size="compact-xs" fullWidth onClick={() => choose(undefined)}>
            {t('flow.step.color.default')}
          </Button>
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
}
