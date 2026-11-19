import React from 'react';
import { Stack, Text } from '@mantine/core';
import { AppTextInput } from '../../../components/AppTextInput';
import { SelectDropdown } from '../../../components/SelectDropdown';
import { fillTemplate } from '../../../../../shared/fillTemplate';
import { parseAppStoreUrl } from '../../../../../shared/linkSites/appStoreLinks';
import { parsePlayUrl } from '../../../../../shared/linkSites/playLinks';
import type { SkillConfigProps } from './types';

const STOREFRONT = /^[a-z]{2}$/i;
const STORES = ['appstore', 'googleplay'] as const;

/**
 * The app store step: an app's name or link, which store (App Store or Google Play; a link picks
 * its own, so the choice is left out then), and which country (prices and in-app purchases differ
 * by country). Name and country are free text so a `{{variable}}` from an earlier step fits either.
 */
export const AppStoreConfig: React.FC<SkillConfigProps> = ({ step, onChange, t }) => {
  const query = step.config.query ?? '';
  const country = step.config.country ?? '';
  const badCountry = country.trim() !== '' && !country.includes('{{') && !STOREFRONT.test(country.trim());
  const linkStore = parsePlayUrl(query.trim()) ? 'googleplay' : parseAppStoreUrl(query.trim()) ? 'appstore' : '';
  const store = step.config.store === 'googleplay' ? 'googleplay' : 'appstore';

  return (
    <Stack gap="xs">
      <AppTextInput
        label={t('flow.skill.app_store.query')}
        placeholder={t('flow.skill.app_store.query.placeholder')}
        value={query}
        onChange={(e) => onChange({ ...step.config, query: e.currentTarget.value })}
        size="sm"
      />
      {linkStore ? (
        <Text fz="xs" c="var(--text-muted)">
          {t(`flow.skill.app_store.store.fromLink.${linkStore}`)}
        </Text>
      ) : (
        <SelectDropdown
          label={t('flow.skill.app_store.store')}
          options={STORES.map((value) => ({ value, label: t(`flow.skill.app_store.store.${value}`) }))}
          value={store}
          onChange={(value) => onChange({ ...step.config, store: value === 'googleplay' ? 'googleplay' : '' })}
          size="sm"
        />
      )}
      <AppTextInput
        label={t('flow.skill.app_store.country')}
        placeholder={t('flow.skill.app_store.country.placeholder')}
        value={country}
        onChange={(e) => onChange({ ...step.config, country: e.currentTarget.value })}
        error={badCountry ? t('flow.skill.app_store.country.error') : undefined}
        size="sm"
        mono
      />
      <Text fz="xs" c="var(--text-muted)">
        {fillTemplate(t('flow.skill.app_store.outputHint'), {
          text: `{{${step.outputKey}.text}}`,
          purchases: `{{${step.outputKey}.purchases}}`,
        })}
      </Text>
    </Stack>
  );
};
