import React from 'react';
import { Stack, Text } from '@mantine/core';
import { AppTextInput } from '../../../components/AppTextInput';
import { AppTextarea } from '../../../components/AppTextarea';
import { ChatRecipientPicker } from '../../../components/ChatRecipientPicker';
import { ToggleSwitch } from '../../../components/ToggleSwitch';
import { SelectDropdown } from '../../../components/SelectDropdown';
import type { BotPlatform } from '../../../../../shared/types';
import type { SkillConfigProps } from './types';

export const BotConfig: React.FC<SkillConfigProps> = ({ step, onChange, t }) => {
  const platform = (step.config.platform || 'auto') as BotPlatform | 'auto';
  const chatIdsRaw = (step.config.chatIds ?? step.config.chatId ?? '').trim();

  return (
    <Stack gap="xs">
      <SelectDropdown
        label={t('agentflow.skill.bot.platform')}
        options={[
          { value: 'auto', label: t('agentflow.skill.bot.platform.auto') },
          { value: 'telegram', label: t('agentflow.skill.bot.platform.telegram') },
          { value: 'line', label: t('agentflow.skill.bot.platform.line') },
        ]}
        value={platform}
        onChange={(value) => onChange({ ...step.config, platform: value })}
        size="sm"
      />
      <Text fz="xs" c="dimmed">{t(`agentflow.skill.bot.platform.${platform}.hint`)}</Text>
      {platform === 'line' && (step.config.attachment ?? '').trim() !== '' && (
        <Text fz="xs" c="orange">{t('agentflow.skill.bot.platform.line.attachmentWarning')}</Text>
      )}
      <ChatRecipientPicker
        value={chatIdsRaw}
        onChange={(next) => onChange({ ...step.config, chatIds: next, chatId: '' })}
        platform={platform}
        label={t('agentflow.skill.bot.chatId')}
        hint={t('agentflow.skill.bot.chatId.hint')}
        placeholder={t('agentflow.skill.bot.chatId.placeholder')}
        emptyHint={t('agentflow.skill.bot.chatId.noPaired')}
        blankHint={t('agentflow.skill.bot.chatId.allPaired')}
      />
      <AppTextarea
        label={t('agentflow.skill.bot.message')}
        placeholder={t('agentflow.skill.bot.message.placeholder')}
        value={step.config.message ?? ''}
        onChange={(e) => onChange({ ...step.config, message: e.currentTarget.value })}
        minRows={3}
        autosize
        size="sm"
      />
      <AppTextInput
        label={t('agentflow.skill.bot.attachment')}
        placeholder={t('agentflow.skill.bot.attachment.placeholder')}
        value={step.config.attachment ?? ''}
        onChange={(e) => onChange({ ...step.config, attachment: e.currentTarget.value })}
        size="sm"
        tone="body"
        mono
      />
      <Text fz="xs" c="dimmed">{t('agentflow.skill.bot.attachment.hint')}</Text>
      {platform !== 'line' && (step.config.attachment ?? '').trim() !== '' && (
        <SelectDropdown
          label={t('agentflow.skill.bot.attachmentType')}
          options={[
            { value: 'auto', label: t('agentflow.skill.bot.attachmentType.auto') },
            { value: 'photo', label: t('agentflow.skill.bot.attachmentType.photo') },
            { value: 'document', label: t('agentflow.skill.bot.attachmentType.document') },
          ]}
          value={step.config.attachmentType || 'auto'}
          onChange={(value) => onChange({ ...step.config, attachmentType: value })}
          size="sm"
        />
      )}
      <ToggleSwitch
        label={t('agentflow.skill.bot.emitFailFlag')}
        size="sm"
        checked={step.config.emitFailFlag === 'true'}
        onChange={(e) => onChange({ ...step.config, emitFailFlag: e.currentTarget.checked ? 'true' : 'false' })}
      />
      {step.config.emitFailFlag === 'true' && (
        <Text fz="xs" c="dimmed">{t('agentflow.skill.bot.emitFailFlag.hint')}</Text>
      )}
    </Stack>
  );
};
