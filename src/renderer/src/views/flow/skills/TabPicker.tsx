import React, { useEffect, useRef, useState } from 'react';
import { Stack, Text } from '@mantine/core';
import { AppTextInput } from '../../../components/AppTextInput';
import { SelectDropdown } from '../../../components/SelectDropdown';
import { StatusLine } from '../../../components/StatusLine';
import { useTabPickerFacts, type TabChainStep } from './browserTabs';
import { shortUrl } from '../stepSummary/core';

/** The "other" choice: a value no page field holds (it would be a tab handle or a variable). */
const OTHER = '\u0000other';
const ALL = 'all';

export interface TabChoice {
  value: string;
  opener?: TabChainStep;
}

/**
 * The picker's choices: the Open page steps before this one (their `{{tab}}`), "all open tabs" for
 * a Close page step, then "other" for a variable or a typed handle.
 */
export function tabChoices(openers: readonly TabChainStep[], withAll: boolean): TabChoice[] {
  return [
    ...openers.map((opener) => ({ value: `{{${opener.tab}}}`, opener })),
    ...(withAll ? [{ value: ALL }] : []),
    { value: OTHER },
  ];
}

/** The listed choice the stored value is, or null when it is blank or not one of them (shown as "other"). */
export function chosenTab(value: string, choices: readonly TabChoice[]): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.toLowerCase() === ALL && choices.some((choice) => choice.value === ALL)) return ALL;
  return choices.find((choice) => choice.value !== OTHER && choice.value === trimmed)?.value ?? null;
}

interface TabPickerProps {
  stepId: string;
  value: string;
  onChange: (value: string) => void;
  label: string;
  /** Close page steps can close every tab the run opened. */
  withAll?: boolean;
  t: (key: string) => string;
}

/**
 * Which tab an Operate or Close page step works on, picked from the Open page steps before it. A
 * stored value that is none of them (a variable, a handle, a step since renamed or deleted) shows
 * as "other" with its text untouched; nothing is rewritten by opening the form.
 */
export const TabPicker: React.FC<TabPickerProps> = ({ stepId, value, onChange, label, withAll = false, t }) => {
  const { openers, issue } = useTabPickerFacts(stepId, t);
  const choices = tabChoices(openers, withAll);
  const chosen = chosenTab(value, choices);
  const [otherPicked, setOtherPicked] = useState(false);
  const other = otherPicked || (value.trim() !== '' && chosen === null);
  const otherInput = useRef<HTMLInputElement | null>(null);
  const focusOther = useRef(false);

  useEffect(() => {
    if (!focusOther.current) return;
    focusOther.current = false;
    otherInput.current?.focus();
  }, [other]);

  const labelOf = (choice: TabChoice): string => {
    if (choice.value === OTHER) return t('flow.tabPicker.other');
    if (choice.value === ALL) return t('flow.tabPicker.all');
    const opener = choice.opener!;
    return [`#${opener.number} ${opener.name}`, opener.url ? shortUrl(opener.url, 40) : '', choice.value].filter(Boolean).join(' · ');
  };
  const error = issue?.tone === 'error' ? issue.text : undefined;

  return (
    <Stack gap={4}>
      <SelectDropdown
        label={label}
        placeholder={t(openers.length > 0 ? 'flow.tabPicker.placeholder' : 'flow.tabPicker.none')}
        options={choices.map((choice) => ({ value: choice.value, label: labelOf(choice) }))}
        value={other ? OTHER : chosen}
        onChange={(next) => {
          if (next === OTHER) {
            focusOther.current = true;
            setOtherPicked(true);
            return;
          }
          setOtherPicked(false);
          onChange(next);
        }}
        searchable
        size="sm"
        error={other ? undefined : error}
        data-tab-picker=""
      />
      {other && (
        <AppTextInput
          ref={otherInput}
          aria-label={label}
          placeholder={t('flow.skill.browser_js.page.placeholder')}
          value={value}
          onChange={(e) => onChange(e.currentTarget.value)}
          size="sm"
          mono
          error={error}
          data-tab-other=""
        />
      )}
      {issue?.tone === 'warning' && <StatusLine tone="warning">{issue.text}</StatusLine>}
      {other && !error && (
        <Text fz="xs" c="var(--text-muted)">{t('flow.tabPicker.other.hint')}</Text>
      )}
    </Stack>
  );
};
