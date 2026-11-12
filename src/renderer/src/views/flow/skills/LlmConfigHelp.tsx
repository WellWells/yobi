import type { ChangeEventHandler } from 'react';
import { ActionIcon, Group, Input, Stack, Text, Tooltip } from '@mantine/core';
import { Info } from 'lucide-react';
import { ToggleSwitch } from '../../../components/ToggleSwitch';
import { fillTemplate } from '../../../../../shared/fillTemplate';

interface HelpProps {
  label: string;
  hint: string | readonly string[];
  t: (key: string) => string;
}

function LlmHelp({ label, hint, t }: HelpProps) {
  const paragraphs = typeof hint === 'string' ? [hint] : hint;
  return (
    <Tooltip
      label={<Stack gap={6}>{paragraphs.map((text) => <Text key={text} size="inherit">{text}</Text>)}</Stack>}
      multiline
      w={320}
      maw="calc(100vw - 32px)"
      events={{ hover: true, focus: true, touch: true }}
    >
      <ActionIcon
        type="button"
        variant="subtle"
        size="xs"
        c="var(--text-muted)"
        aria-label={fillTemplate(t('flow.skill.llm.optionHelp'), { label })}
        onClick={(event) => event.stopPropagation()}
      >
        <Info size={14} />
      </ActionIcon>
    </Tooltip>
  );
}

export function LlmFieldLabel({ htmlFor, ...help }: HelpProps & { htmlFor: string }) {
  return (
    <Group gap={6}>
      <Input.Label htmlFor={htmlFor}>{help.label}</Input.Label>
      <LlmHelp {...help} />
    </Group>
  );
}

export function LlmOption({ checked, onChange, ...help }: HelpProps & {
  checked: boolean;
  onChange: ChangeEventHandler<HTMLInputElement>;
}) {
  return (
    <Group gap={6} wrap="nowrap">
      <ToggleSwitch label={help.label} size="sm" checked={checked} onChange={onChange} />
      <LlmHelp {...help} />
    </Group>
  );
}
