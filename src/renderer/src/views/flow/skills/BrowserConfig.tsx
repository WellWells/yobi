import React, { useEffect, useRef, useState } from 'react';
import { ActionIcon, Stack, Text, Tooltip } from '@mantine/core';
import { Plus, X } from 'lucide-react';
import { AppButton } from '../../../components/AppButton';
import { AppTextInput } from '../../../components/AppTextInput';
import { ToggleSwitch } from '../../../components/ToggleSwitch';
import { SettingRow } from '../../../components/SettingRow';
import { isValidUrlListOrVar } from './validation';
import type { SkillConfigProps } from './types';
import { fillTemplate } from '../../../../../shared/fillTemplate';
import { parseBrowserUrlRows, pasteBrowserUrlRows, serializeBrowserUrlRows } from './browserUrlRows';

interface UrlRow { id: number; value: string }

/**
 * From this many rows the form counts them and says the step has five minutes for all of them
 * (`runtime.ts`): the pages are read one after another.
 */
export const LONG_URL_LIST = 20;

export const BrowserConfig: React.FC<SkillConfigProps> = ({ step, onChange, t }) => {
  const url = step.config.url ?? '';
  const includeImage = step.config.includeImage === 'true';
  const nextId = useRef(0);
  const makeRows = (values: string[]): UrlRow[] => values.map((value) => ({ id: nextId.current++, value }));
  const [rows, setRows] = useState<UrlRow[]>(() => makeRows(parseBrowserUrlRows(url)));
  const source = useRef({ id: step.id, url });
  const inputs = useRef(new Map<number, HTMLInputElement>());
  const focusRow = useRef<number | null>(null);
  const canBeBatch = rows.length > 1 || rows.some((row) => /\{\{[^}]+\}\}/.test(row.value));

  useEffect(() => {
    if (source.current.id === step.id && source.current.url === url) return;
    source.current = { id: step.id, url };
    setRows(makeRows(parseBrowserUrlRows(url)));
  }, [step.id, url]);

  useEffect(() => {
    if (focusRow.current === null) return;
    inputs.current.get(focusRow.current)?.focus();
    focusRow.current = null;
  }, [rows]);

  const updateRows = (next: UrlRow[]): void => {
    const nextUrl = serializeBrowserUrlRows(next.map((row) => row.value));
    source.current = { id: step.id, url: nextUrl };
    setRows(next);
    onChange({ ...step.config, url: nextUrl });
  };

  return (
    <Stack gap="xs">
      {rows.map((row, index) => (
        <AppTextInput
          key={row.id}
          ref={(input) => {
            if (input) inputs.current.set(row.id, input);
            else inputs.current.delete(row.id);
          }}
          label={rows.length === 1 ? t('flow.skill.browser.url') : fillTemplate(t('flow.skill.browser.urlNumber'), { number: String(index + 1) })}
          placeholder={t('flow.skill.browser.url.placeholder')}
          value={row.value}
          onChange={(e) => {
            const value = e.currentTarget.value;
            updateRows(rows.map((current) => current.id === row.id ? { ...current, value } : current));
          }}
          onPaste={(e) => {
            const input = e.currentTarget;
            const pasted = pasteBrowserUrlRows(row.value, input.selectionStart ?? 0, input.selectionEnd ?? row.value.length, e.clipboardData.getData('text'));
            if (!pasted) return;
            e.preventDefault();
            const inserted = [{ ...row, value: pasted[0] }, ...makeRows(pasted.slice(1))];
            focusRow.current = inserted.at(-1)!.id;
            updateRows([...rows.slice(0, index), ...inserted, ...rows.slice(index + 1)]);
          }}
          size="sm"
          error={!isValidUrlListOrVar(serializeBrowserUrlRows([row.value])) ? t('flow.skill.browser.url.error') : undefined}
          rightSectionPointerEvents="all"
          rightSection={rows.length > 1 && (
            <Tooltip label={fillTemplate(t('flow.skill.browser.removeUrl'), { number: String(index + 1) })}>
              <ActionIcon
                variant="subtle"
                color="gray"
                aria-label={fillTemplate(t('flow.skill.browser.removeUrl'), { number: String(index + 1) })}
                onClick={() => {
                  const next = rows.filter((current) => current.id !== row.id);
                  focusRow.current = next[Math.min(index, next.length - 1)].id;
                  updateRows(next);
                }}
              >
                <X size={14} />
              </ActionIcon>
            </Tooltip>
          )}
        />
      ))}
      <AppButton
        variant="subtle"
        size="compact-xs"
        leftSection={<Plus size={14} />}
        style={{ alignSelf: 'flex-start' }}
        onClick={() => {
          const added = makeRows([''])[0];
          focusRow.current = added.id;
          updateRows([...rows, added]);
        }}
      >
        {t('flow.skill.browser.addUrl')}
      </AppButton>
      <Text fz="xs" c="dimmed">{t('flow.skill.browser.urls.hint')}</Text>
      {rows.length >= LONG_URL_LIST && (
        <Text fz="xs" c="var(--text-muted)" data-url-count="">
          {fillTemplate(t('flow.skill.browser.urls.many'), { count: String(rows.length) })}
        </Text>
      )}

      {(canBeBatch || step.config.requireAll === 'true') && (
        <SettingRow
          label={t('flow.skill.browser.requireAll')}
          hint={t('flow.skill.browser.requireAll.hint')}
          control={
            <ToggleSwitch
              checked={step.config.requireAll === 'true'}
              onChange={(e) => onChange({ ...step.config, requireAll: e.currentTarget.checked ? 'true' : 'false' })}
            />
          }
        />
      )}

      {/* The cover is single-page only: with more rows the runner skips it, so a cover turned on
          before the second row stays in view, marked, until it is turned off. */}
      {(rows.length === 1 || includeImage) && (
        <SettingRow
          label={t('flow.skill.includeImage')}
          hint={rows.length === 1
            ? t('flow.skill.includeImage.hint')
            : <Text span inherit c="var(--mantine-color-warning)" data-cover-skipped="">{t('flow.skill.includeImage.batchSkipped')}</Text>}
          control={
            <ToggleSwitch
              checked={includeImage}
              onChange={(e) => onChange({ ...step.config, includeImage: e.currentTarget.checked ? 'true' : 'false' })}
            />
          }
        />
      )}

      <SettingRow
        label={t('flow.skill.browser.emitFailFlag')}
        hint={fillTemplate(t('flow.skill.browser.emitFailFlag.hint'), { flag: `{{${step.outputKey}.isFailed}}` })}
        control={
          <ToggleSwitch
            checked={step.config.emitFailFlag === 'true'}
            onChange={(e) => onChange({ ...step.config, emitFailFlag: e.currentTarget.checked ? 'true' : 'false' })}
          />
        }
      />

      <Text fz="xs" c="dimmed">
        {fillTemplate(t('flow.skill.browser.outputHint'), { outputKey: `{{${step.outputKey}}}` })}
      </Text>
    </Stack>
  );
};
