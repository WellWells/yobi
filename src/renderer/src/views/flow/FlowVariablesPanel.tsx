import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  ActionIcon, Badge, Box, Button, Code, Collapse, Divider, Group, Stack, Text, Tooltip,
} from '@mantine/core';
import { Plus, Settings2, SlidersHorizontal, Trash2, TriangleAlert } from 'lucide-react';
import { AppTextInput } from '../../components/AppTextInput';
import { SectionCard } from '../../components/SectionCard';
import { SelectDropdown } from '../../components/SelectDropdown';
import { ToggleSwitch } from '../../components/ToggleSwitch';
import { VariableField } from './VariableField';
import { FLOW_VAR_KEY_RE, FLOW_VAR_PREFIX } from '../../../../shared/flowVariables';
import { FLOW_VARIABLE_TYPES } from '../../../../shared/types';
import type {
  FlowDefinition, FlowVariable, FlowVariableType, SkillInstance,
} from '../../../../shared/types';

export interface FlowVariablesPanelProps {
  flow: FlowDefinition;
  t: (k: string) => string;
  onChange: (variables: FlowVariable[]) => void;
}

function nextKey(existing: FlowVariable[]): string {
  const used = new Set(existing.map((v) => v.key));
  let n = existing.length + 1;
  while (used.has(`var${n}`)) n++;
  return `var${n}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function countUsages(steps: SkillInstance[], key: string): number {
  if (!key) return 0;
  const esc = escapeRegExp(key);
  const ref = new RegExp(
    `\\{\\{\\s*${FLOW_VAR_PREFIX}\\.${esc}\\s*\\}\\}|vars\\[\\s*['"\`]${FLOW_VAR_PREFIX}\\.${esc}['"\`]\\s*\\]`,
  );
  return steps.filter(
    (s) => s.type !== 'comment' && Object.values(s.config).some((value) => ref.test(value)),
  ).length;
}

const UsageHint: React.FC<{ usages: number; t: (k: string) => string }> = ({ usages, t }) => {
  if (usages > 0) {
    return (
      <Text fz="xs" c="dimmed">
        {t('flow.variables.usedIn').replace('{{count}}', String(usages))}
      </Text>
    );
  }
  return (
    <Group gap={4} wrap="nowrap" align="center">
      <TriangleAlert size={12} color="var(--mantine-color-orange-filled)" />
      <Text fz="xs" c="orange">{t('flow.variables.unused')}</Text>
    </Group>
  );
};

interface DefinitionRowProps {
  variable: FlowVariable;
  keyError: string | undefined;
  usages: number;
  t: (k: string) => string;
  onPatch: (patch: Partial<FlowVariable>) => void;
  onRemove: () => void;
}

const DefinitionRow: React.FC<DefinitionRowProps> = ({
  variable, keyError, usages, t, onPatch, onRemove,
}) => (
  <Box
    p="xs"
    style={{
      background: 'var(--mantine-color-bg-tertiary)',
      borderRadius: 'var(--mantine-radius-md)',
      border: '1px solid var(--mantine-color-default-border)',
    }}
  >
    <Stack gap="xs">
      <Group gap="xs" wrap="nowrap" align="flex-start">
        <AppTextInput
          label={t('flow.variables.key')}
          value={variable.key}
          onChange={(e) => onPatch({ key: e.currentTarget.value.trim() })}
          error={keyError}
          size="xs"
          tone="body"
          mono
          style={{ flex: 1 }}
        />
        <SelectDropdown
          label={t('flow.variables.type')}
          options={FLOW_VARIABLE_TYPES.map((type) => ({
            value: type,
            label: t(`flow.variables.type.${type}`),
          }))}
          value={variable.type}
          onChange={(next) => onPatch({ type: next as FlowVariableType })}
          size="xs"
          style={{ flex: 1 }}
        />
        <Tooltip label={t('flow.variables.remove')}>
          <ActionIcon variant="subtle" color="red" size="md" mt={22} onClick={onRemove}>
            <Trash2 size={14} />
          </ActionIcon>
        </Tooltip>
      </Group>

      <Group gap="xs" wrap="nowrap" align="flex-start">
        <AppTextInput
          label={t('flow.variables.label')}
          value={variable.label}
          onChange={(e) => onPatch({ label: e.currentTarget.value })}
          size="xs"
          style={{ flex: 1 }}
        />
        <AppTextInput
          label={t('flow.variables.question')}
          placeholder={t('flow.variables.question.placeholder')}
          value={variable.question ?? ''}
          onChange={(e) => onPatch({ question: e.currentTarget.value })}
          size="xs"
          style={{ flex: 1 }}
        />
      </Group>

      <AppTextInput
        label={t('flow.variables.hint')}
        placeholder={t('flow.variables.hint.placeholder')}
        value={variable.hint ?? ''}
        onChange={(e) => onPatch({ hint: e.currentTarget.value })}
        size="xs"
      />

      {variable.type === 'select' && (
        <AppTextInput
          label={t('flow.variables.options')}
          placeholder={t('flow.variables.options.placeholder')}
          value={(variable.options ?? []).map((o) => (o.label === o.value ? o.value : `${o.value}=${o.label}`)).join(', ')}
          onChange={(e) => onPatch({
            options: e.currentTarget.value
              .split(',')
              .map((part) => part.trim())
              .filter(Boolean)
              .map((part) => {
                const eq = part.indexOf('=');
                if (eq < 0) return { value: part, label: part };
                const value = part.slice(0, eq).trim();
                const label = part.slice(eq + 1).trim();
                return { value, label: label || value };
              })
              .filter((o) => o.value),
          })}
          size="xs"
          tone="body"
          mono
        />
      )}

      <Divider my={2} />

      {
}
      <VariableField variable={variable} onChange={(value) => onPatch({ value })} t={t} />

      <Group justify="space-between" align="center">
        <Group gap={8} align="center">
          <Code fz="xs">{`{{${FLOW_VAR_PREFIX}.${variable.key}}}`}</Code>
          <UsageHint usages={usages} t={t} />
        </Group>
        <Group gap="md" align="center">
          {(variable.type === 'text' || variable.type === 'url' || variable.type === 'feed') && (
            <ToggleSwitch
              label={t('flow.variables.multilineToggle')}
              size="sm"
              checked={variable.multiline === true}
              onChange={(e) => onPatch({ multiline: e.currentTarget.checked })}
            />
          )}
          <ToggleSwitch
            label={t('flow.variables.requiredToggle')}
            size="sm"
            checked={variable.required === true}
            onChange={(e) => onPatch({ required: e.currentTarget.checked })}
          />
        </Group>
      </Group>
    </Stack>
  </Box>
);

export const FlowVariablesPanel: React.FC<FlowVariablesPanelProps> = ({ flow, t, onChange }) => {
  const [editing, setEditing] = useState(false);
  const variables = useMemo(() => flow.variables ?? [], [flow.variables]);

  const keyErrors = useMemo(() => {
    const seen = new Map<string, number>();
    return variables.map((v) => {
      if (!FLOW_VAR_KEY_RE.test(v.key)) return t('flow.variables.key.invalid');
      const count = (seen.get(v.key) ?? 0) + 1;
      seen.set(v.key, count);
      return count > 1 ? t('flow.variables.key.duplicate') : undefined;
    });
  }, [variables, t]);

  const usages = useMemo(
    () => variables.map((v) => countUsages(flow.steps, v.key)),
    [variables, flow.steps],
  );

  const missingCount = variables.filter((v) => v.required && !v.value.trim()).length;

  const variablesRef = useRef(variables);
  variablesRef.current = variables;
  const patchAt = useCallback((index: number, patch: Partial<FlowVariable>) => {
    onChange(variablesRef.current.map((v, i) => (i === index ? { ...v, ...patch } : v)));
  }, [onChange]);

  const patchValuesByKey = useCallback((patch: Record<string, string>) => {
    onChange(variablesRef.current.map((v) => (v.key in patch ? { ...v, value: patch[v.key] } : v)));
  }, [onChange]);

  const handleAdd = useCallback(() => {
    const key = nextKey(variables);
    onChange([...variables, { key, type: 'text', label: key, value: '' }]);
    setEditing(true);
  }, [variables, onChange]);

  const handleRemove = useCallback((index: number) => {
    onChange(variables.filter((_, i) => i !== index));
  }, [variables, onChange]);

  return (
    <SectionCard>
      <Stack gap="sm">
        <Group justify="space-between" align="center">
          <Group gap="xs" align="center">
            <Text fw={600} fz="sm" c="var(--mantine-color-default-color)">
              {t('flow.variables')}
            </Text>
            {missingCount > 0 && (
              <Badge color="red" variant="light" size="sm">
                {t('flow.variables.missingBadge')}
              </Badge>
            )}
          </Group>
          <Group gap="xs">
            {variables.length > 0 && (
              <Button
                variant={editing ? 'light' : 'default'}
                size="xs"
                leftSection={editing ? <SlidersHorizontal size={14} /> : <Settings2 size={14} />}
                onClick={() => setEditing((v) => !v)}
              >
                {editing ? t('flow.variables.doneEditing') : t('flow.variables.edit')}
              </Button>
            )}
            <Button variant="default" size="xs" leftSection={<Plus size={14} />} onClick={handleAdd}>
              {t('flow.variables.add')}
            </Button>
          </Group>
        </Group>

        {variables.length === 0 ? (
          <Text fz="xs" c="dimmed" style={{ lineHeight: 1.6 }}>{t('flow.variables.empty')}</Text>
        ) : (
          <>
            {
}
            <Text fz="xs" c="dimmed" style={{ lineHeight: 1.6 }}>
              {t('flow.variables.howto')}
            </Text>

            <Collapse expanded={!editing}>
              <Stack gap="sm">
                {variables.map((variable, index) => (
                  <Stack key={variable.key || index} gap={2}>
                    <VariableField
                      variable={variable}
                      allVariables={variables}
                      onChange={(value) => patchAt(index, { value })}
                      onChangeMany={patchValuesByKey}
                      t={t}
                    />
                    <UsageHint usages={usages[index]} t={t} />
                  </Stack>
                ))}
              </Stack>
            </Collapse>

            <Collapse expanded={editing}>
              <Stack gap="sm">
                {variables.map((variable, index) => (
                  <DefinitionRow
                    key={index}
                    variable={variable}
                    keyError={keyErrors[index]}
                    usages={usages[index]}
                    t={t}
                    onPatch={(patch) => patchAt(index, patch)}
                    onRemove={() => handleRemove(index)}
                  />
                ))}
              </Stack>
            </Collapse>
          </>
        )}
      </Stack>
    </SectionCard>
  );
};
