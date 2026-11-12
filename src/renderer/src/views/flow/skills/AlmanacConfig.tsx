import React from 'react';
import { Chip, Group, Input, Stack, Text } from '@mantine/core';
import { AppNumberInput } from '../../../components/AppNumberInput';
import { AppTextInput } from '../../../components/AppTextInput';
import { GroupHeader } from '../../../components/GroupHeader';
import { SelectDropdown } from '../../../components/SelectDropdown';
import { ToggleSwitch } from '../../../components/ToggleSwitch';
import { fillTemplate } from '../../../../../shared/fillTemplate';
import { ALMANAC_ACTIVITY_PRESETS, MAX_ALMANAC_DAYS, MAX_ALMANAC_FILTER_DAYS } from '../../../../../shared/almanac';
import { almanacDateSpanDays, almanacFiltered, almanacOneDay } from '../../../../../shared/almanacSpan';
import type { SkillConfigProps } from './types';

/** The twelve signs in order, as stored (Traditional; the run reads either script). */
export const ZODIAC_CHIPS = [
  { id: 'rat', sign: '鼠' }, { id: 'ox', sign: '牛' }, { id: 'tiger', sign: '虎' }, { id: 'rabbit', sign: '兔' },
  { id: 'dragon', sign: '龍' }, { id: 'snake', sign: '蛇' }, { id: 'horse', sign: '馬' }, { id: 'goat', sign: '羊' },
  { id: 'monkey', sign: '猴' }, { id: 'rooster', sign: '雞' }, { id: 'dog', sign: '狗' }, { id: 'pig', sign: '豬' },
] as const;

const SIMPLIFIED_SIGN: Readonly<Record<string, string>> = { 龙: '龍', 马: '馬', 鸡: '雞', 猪: '豬' };

/** The signs a free-form field names (「屬虎」「龍、狗」「龙」), in chip order. */
export function zodiacSigns(raw: string): string[] {
  const named = new Set([...raw].map((ch) => SIMPLIFIED_SIGN[ch] ?? ch));
  return ZODIAC_CHIPS.map((chip) => chip.sign).filter((sign) => named.has(sign));
}

/**
 * The field after a chip is toggled: the signs joined with 、. Until then the text stays as the
 * AI or the person wrote it (「屬虎」), so opening the card never rewrites it.
 */
export function toggledZodiac(raw: string, sign: string): string {
  const signs = new Set(zodiacSigns(raw));
  if (signs.has(sign)) signs.delete(sign);
  else signs.add(sign);
  return ZODIAC_CHIPS.map((chip) => chip.sign).filter((item) => signs.has(item)).join('、');
}

/**
 * The almanac step: which day (Gregorian, or a lunar date), how many days, and optionally an
 * activity to keep only the good days for. An activity the AI wrote that is not a preset stays
 * selectable as itself. The days field follows a month, year or range in the date, and the time
 * field shows only when the run reads it (one day, no filter) or already holds something.
 */
export const AlmanacConfig: React.FC<SkillConfigProps> = ({ step, onChange, t }) => {
  const set = (key: string, value: string): void => onChange({ ...step.config, [key]: value });
  const lunar = step.config.lunar === 'true';
  const activity = (step.config.activity ?? '').trim();
  const filtered = almanacFiltered(step.config);
  const maxDays = filtered ? MAX_ALMANAC_FILTER_DAYS : MAX_ALMANAC_DAYS;
  const spanDays = almanacDateSpanDays(step.config);
  const time = step.config.time ?? '';
  const timeApplies = almanacOneDay(step.config) && !filtered;
  const zodiacRaw = step.config.zodiac ?? '';
  const zodiacPicked = zodiacSigns(zodiacRaw);
  const presets = ALMANAC_ACTIVITY_PRESETS.map((item) => ({
    value: item.term,
    label: t(`flow.skill.almanac.activity.${item.id}`),
  }));
  const activityOptions = [
    { value: '', label: t('flow.skill.almanac.activity.none') },
    ...presets,
    ...(activity && !presets.some((item) => item.value === activity) ? [{ value: activity, label: activity }] : []),
  ];

  return (
    <Stack gap="xs">
      <AppTextInput
        label={t('flow.skill.almanac.date')}
        placeholder={t(lunar ? 'flow.skill.almanac.date.lunarPlaceholder' : 'flow.skill.almanac.date.placeholder')}
        value={step.config.date ?? ''}
        onChange={(e) => set('date', e.currentTarget.value)}
        size="sm"
      />
      <ToggleSwitch
        label={t('flow.skill.almanac.lunar')}
        size="sm"
        checked={lunar}
        onChange={(e) => set('lunar', e.currentTarget.checked ? 'true' : 'false')}
      />
      {lunar && (
        <ToggleSwitch
          label={t('flow.skill.almanac.leap')}
          size="sm"
          checked={step.config.leap === 'true'}
          onChange={(e) => set('leap', e.currentTarget.checked ? 'true' : 'false')}
        />
      )}

      {spanDays === null ? (
        <AppNumberInput
          label={t('flow.skill.almanac.days')}
          value={step.config.days ?? '1'}
          onChange={(v) => set('days', v === '' ? '' : String(v))}
          size="sm"
          w={160}
          min={1}
          max={maxDays}
          step={1}
          allowDecimal={false}
          allowNegative={false}
        />
      ) : (
        <AppTextInput
          label={t('flow.skill.almanac.days')}
          value={spanDays === 'byDate'
            ? t('flow.skill.almanac.days.byDate')
            : fillTemplate(t('flow.skill.almanac.days.fromDate'), { count: String(Math.min(spanDays, maxDays)) })}
          disabled
          size="sm"
          w={200}
        />
      )}

      {(timeApplies || time.trim() !== '') && (
        <AppTextInput
          label={t('flow.skill.almanac.time')}
          placeholder={t('flow.skill.almanac.time.placeholder')}
          value={time}
          onChange={(e) => set('time', e.currentTarget.value)}
          size="sm"
          w={200}
        />
      )}
      {!timeApplies && time.trim() !== '' && (
        <Text fz="xs" c="var(--mantine-color-warning)">{t('flow.skill.almanac.time.unused')}</Text>
      )}

      <GroupHeader variant="plain" label={t('flow.skill.almanac.group.filter')} />
      <SelectDropdown
        label={t('flow.skill.almanac.activity')}
        options={activityOptions}
        value={activity}
        onChange={(next) => set('activity', next ?? '')}
        size="sm"
      />
      <Input.Wrapper label={t('flow.skill.almanac.zodiac')}>
        <Group gap={4} wrap="wrap" pt={2}>
          {ZODIAC_CHIPS.map((chip) => (
            <Chip
              key={chip.id}
              size="xs"
              variant="light"
              checked={zodiacPicked.includes(chip.sign)}
              onChange={() => set('zodiac', toggledZodiac(zodiacRaw, chip.sign))}
            >
              {t(`flow.skill.almanac.sign.${chip.id}`)}
            </Chip>
          ))}
        </Group>
      </Input.Wrapper>
      <ToggleSwitch
        label={t('flow.skill.almanac.weekends')}
        size="sm"
        checked={step.config.weekends === 'true'}
        onChange={(e) => set('weekends', e.currentTarget.checked ? 'true' : 'false')}
      />
      {filtered && (
        <Text fz="xs" c="var(--text-muted)">{fillTemplate(t('flow.skill.almanac.filter.hint'), { max: String(MAX_ALMANAC_FILTER_DAYS) })}</Text>
      )}

      <Text fz="xs" c="var(--text-muted)">
        {fillTemplate(t('flow.skill.almanac.outputHint'), {
          value: `{{${step.outputKey}}}`,
          text: `{{${step.outputKey}.text}}`,
          lunar: `{{${step.outputKey}.lunar}}`,
        })}
      </Text>
    </Stack>
  );
};
