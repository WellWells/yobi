import { SimpleGrid, Stack, Text } from '@mantine/core';
import { AppTextarea } from '../../../components/AppTextarea';
import { SelectDropdown } from '../../../components/SelectDropdown';
import { useI18nStore } from '../../../store/i18nStore';
import { TRANSLATE_LANGUAGES, languageDisplayName } from '../../../../../shared/translateLanguages';
import { fillTemplate } from '../../../../../shared/fillTemplate';
import { LlmOption } from './LlmConfigHelp';
import { PAIR_FIELDS_FROM } from './fieldLayout';
import type { SkillConfigProps } from './types';

export function TranslateConfig({ step, onChange, t }: SkillConfigProps) {
  const locale = useI18nStore((s) => s.locale);
  const languages: Array<{ value: string; label: string }> = TRANSLATE_LANGUAGES
    .map((tag) => ({ value: tag, label: languageDisplayName(tag, locale) }));
  // Imported flows may use other Microsoft language tags or variables; keep their values visible.
  for (const tag of [step.config.to, step.config.from]) {
    if (tag && tag !== 'auto' && !languages.some((option) => option.value === tag)) {
      languages.push({ value: tag, label: tag });
    }
  }
  return (
    <Stack gap="xs">
      <AppTextarea
        label={t('flow.skill.translate.text')}
        placeholder={t('flow.skill.translate.text.placeholder')}
        value={step.config.text ?? ''}
        onChange={(e) => onChange({ ...step.config, text: e.currentTarget.value })}
        minRows={3}
        maxRows={12}
        autosize
        withAsterisk
        size="sm"
      />
      {/* Source before target, so the pair reads "from → to" when the card is wide enough for one row. */}
      <SimpleGrid type="container" cols={{ base: 1, [PAIR_FIELDS_FROM]: 2 }} spacing="xs" verticalSpacing="xs">
        <SelectDropdown
          label={t('flow.skill.translate.from')}
          options={[{ value: 'auto', label: t('flow.skill.translate.auto') }, ...languages]}
          value={step.config.from || 'auto'}
          onChange={(from) => onChange({ ...step.config, from: from === 'auto' ? '' : from })}
          searchable
          size="sm"
        />
        <SelectDropdown
          label={t('flow.skill.translate.to')}
          placeholder={t('flow.skill.translate.to.placeholder')}
          options={languages}
          value={step.config.to || null}
          onChange={(to) => onChange({ ...step.config, to })}
          searchable
          withAsterisk
          size="sm"
        />
      </SimpleGrid>
      <Text fz="xs" c="var(--text-muted)">{t('flow.skill.translate.hint')}</Text>
      <LlmOption
        label={t('flow.skill.translate.emitFailFlag')}
        hint={fillTemplate(t('flow.skill.translate.emitFailFlag.hint'), { flag: `{{${step.outputKey}.isFailed}}` })}
        t={t}
        checked={step.config.emitFailFlag === 'true'}
        onChange={(e) => onChange({ ...step.config, emitFailFlag: e.currentTarget.checked ? 'true' : 'false' })}
      />
    </Stack>
  );
}
