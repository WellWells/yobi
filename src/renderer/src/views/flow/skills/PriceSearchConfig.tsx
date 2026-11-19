import React from 'react';
import { Stack, Text } from '@mantine/core';
import { AppTextInput } from '../../../components/AppTextInput';
import { SelectDropdown } from '../../../components/SelectDropdown';
import { SettingRow } from '../../../components/SettingRow';
import { ToggleSwitch } from '../../../components/ToggleSwitch';
import { fillTemplate } from '../../../../../shared/fillTemplate';
import { FieldPair } from './FieldPair';
import type { SkillConfigProps } from './types';

const SORTS = ['price', 'unit', 'relevance'] as const;
const PRICE = /^\d[\d,]*(\.\d+)?$/;

/**
 * The price search step: the product, the words and price range that keep accessories out, how
 * to order the offers, and whether to remember the lowest price between runs. Every field is
 * free text so a `{{variable}}` fits; a price that is neither a number nor a variable is flagged
 * before the run refuses it.
 */
export const PriceSearchConfig: React.FC<SkillConfigProps> = ({ step, onChange, t }) => {
  const set = (key: string, value: string): void => onChange({ ...step.config, [key]: value });
  const priceError = (key: 'minPrice' | 'maxPrice'): string | undefined => {
    const value = (step.config[key] ?? '').trim();
    if (!value || value.includes('{{') || PRICE.test(value)) return undefined;
    return fillTemplate(t('flow.error.priceSearchNumber'), { value });
  };
  const tracking = step.config.track === 'true';

  return (
    <Stack gap="xs">
      <AppTextInput
        label={t('flow.skill.price_search.query')}
        placeholder={t('flow.skill.price_search.query.placeholder')}
        value={step.config.query ?? ''}
        onChange={(e) => set('query', e.currentTarget.value)}
        size="sm"
      />
      <AppTextInput
        label={t('flow.skill.price_search.exclude')}
        placeholder={t('flow.skill.price_search.exclude.placeholder')}
        value={step.config.exclude ?? ''}
        onChange={(e) => set('exclude', e.currentTarget.value)}
        size="sm"
      />
      <FieldPair>
        <AppTextInput
          label={t('flow.skill.price_search.minPrice')}
          placeholder={t('flow.skill.price_search.price.placeholder')}
          value={step.config.minPrice ?? ''}
          onChange={(e) => set('minPrice', e.currentTarget.value)}
          error={priceError('minPrice')}
          size="sm"
        />
        <AppTextInput
          label={t('flow.skill.price_search.maxPrice')}
          placeholder={t('flow.skill.price_search.price.placeholder')}
          value={step.config.maxPrice ?? ''}
          onChange={(e) => set('maxPrice', e.currentTarget.value)}
          error={priceError('maxPrice')}
          size="sm"
        />
      </FieldPair>
      <SelectDropdown
        label={t('flow.skill.price_search.sort')}
        options={SORTS.map((value) => ({ value, label: t(`flow.skill.price_search.sort.${value}`) }))}
        value={SORTS.find((value) => value === step.config.sort) ?? 'price'}
        onChange={(value) => set('sort', value === 'price' ? '' : value)}
        size="sm"
      />
      <SettingRow
        label={t('flow.skill.price_search.track')}
        hint={fillTemplate(t('flow.skill.price_search.track.hint'), { dropped: `{{${step.outputKey}.dropped}}` })}
        control={
          <ToggleSwitch
            aria-label={t('flow.skill.price_search.track')}
            checked={tracking}
            onChange={(e) => set('track', e.currentTarget.checked ? 'true' : 'false')}
          />
        }
      />
      <Text fz="xs" c="var(--text-muted)">
        {fillTemplate(t('flow.skill.price_search.outputHint'), {
          json: `{{${step.outputKey}}}`,
          text: `{{${step.outputKey}.text}}`,
          lowest: `{{${step.outputKey}.lowest}}`,
          lowestUrl: `{{${step.outputKey}.lowestUrl}}`,
        })}
      </Text>
    </Stack>
  );
};
