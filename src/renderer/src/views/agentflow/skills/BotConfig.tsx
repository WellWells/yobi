import React, { useEffect, useMemo, useState } from 'react';
import { Chip, Group, Stack, Text } from '@mantine/core';
import { AppTextInput } from '../../../components/AppTextInput';
import { AppTextarea } from '../../../components/AppTextarea';
import { ToggleSwitch } from '../../../components/ToggleSwitch';
import { SelectDropdown } from '../../../components/SelectDropdown';
import { telegramApi } from '../../../api/electronApi';
import type { TelegramPairedUser } from '../../../../../shared/types';
import type { SkillConfigProps } from './types';

export const BotConfig: React.FC<SkillConfigProps> = ({ step, onChange, t }) => {
  const [pairedUsers, setPairedUsers] = useState<TelegramPairedUser[]>([]);

  useEffect(() => {
    void telegramApi.getSettings().then((s) => setPairedUsers(s.pairing.pairedUsers));
  }, []);

  const chatIdsRaw = (step.config.chatIds ?? step.config.chatId ?? '').trim();
  const pairedIdSet = useMemo(() => new Set(pairedUsers.map((u) => String(u.userId))), [pairedUsers]);
  const parsedIds = useMemo(() => (
    chatIdsRaw ? chatIdsRaw.split(',').map((s) => s.trim()).filter(Boolean) : []
  ), [chatIdsRaw]);
  const selectedIds = useMemo(() => parsedIds.filter((id) => pairedIdSet.has(id)), [parsedIds, pairedIdSet]);
  const nonPairedIds = useMemo(() => parsedIds.filter((id) => !pairedIdSet.has(id)), [parsedIds, pairedIdSet]);

  const handleSelectionChange = (next: string[]) => {
    const merged = [...new Set([...next, ...nonPairedIds])];
    onChange({ ...step.config, chatIds: merged.join(','), chatId: '' });
  };

  return (
    <Stack gap="xs">
      <Stack gap={4}>
        <Text fz="sm" fw={500}>{t('agentflow.skill.bot.chatId')}</Text>
        <Text fz="xs" c="dimmed">{t('agentflow.skill.bot.chatId.hint')}</Text>
        <AppTextInput
          value={chatIdsRaw}
          onChange={(e) => onChange({ ...step.config, chatIds: e.currentTarget.value, chatId: '' })}
          placeholder={t('agentflow.skill.bot.chatId.placeholder')}
          tone="body"
          mono
        />
        {pairedUsers.length === 0 ? (
          <Text fz="xs" c="dimmed" fs="italic">{t('agentflow.skill.bot.chatId.noPaired')}</Text>
        ) : (
          <Chip.Group multiple value={selectedIds} onChange={handleSelectionChange}>
            <Group gap={4} wrap="wrap">
              {pairedUsers.map((u) => (
                <Chip key={String(u.userId)} value={String(u.userId)} size="xs" variant="light">
                  {u.firstName || u.lastName ? (
                    `${[u.firstName, u.lastName].filter(Boolean).join(' ')}${u.username ? ` (@${u.username})` : ''}`
                  ) : (
                    u.username ? `@${u.username}` : String(u.userId)
                  )}
                </Chip>
              ))}
            </Group>
          </Chip.Group>
        )}
        {chatIdsRaw.length === 0 && pairedUsers.length > 0 && (
          <Text fz="xs" c="dimmed" fs="italic">{t('agentflow.skill.bot.chatId.allPaired')}</Text>
        )}
      </Stack>
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
      {(step.config.attachment ?? '').trim() !== '' && (
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
