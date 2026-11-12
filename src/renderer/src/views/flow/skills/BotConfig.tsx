import React, { useId } from 'react';
import { Stack, Text } from '@mantine/core';
import { AppTextarea } from '../../../components/AppTextarea';
import { ChatRecipientPicker } from '../../../components/ChatRecipientPicker';
import { ToggleSwitch } from '../../../components/ToggleSwitch';
import { SelectDropdown } from '../../../components/SelectDropdown';
import type { BotPlatform } from '../../../../../shared/types';
import { LINE_SELF_MAX_RECIPIENTS, botStepTargets } from '../../../../../shared/botRecipients';
import { recipientTokens } from '../../../utils/recipientChoices';
import { flowBotCommand } from '../../../../../shared/flowBotCommand';
import type { SkillConfigProps } from './types';
import { FieldLabelRow } from './FieldLabelRow';
import { fillTemplate } from '../../../../../shared/fillTemplate';

const TEMPLATE_RE = /\{\{[^}]+\}\}/;

/**
 * What the step's choices become on each platform, as the sender makes them: Telegram, Discord
 * and Slack send buttons; LINE has none, so the official account lists the command to type under
 * the message and LINE PC (the user's own account) numbers the lines for a reply.
 */
function buttonsDescKey(platform: BotPlatform | 'auto'): string {
  if (platform === 'line') return 'flow.skill.bot.choices.line.desc';
  if (platform === 'lineSelf') return 'flow.skill.bot.choices.lineSelf.desc';
  if (platform === 'auto') return 'flow.skill.bot.buttons.desc.auto';
  return 'flow.skill.bot.buttons.desc';
}

export type AttachmentType = 'auto' | 'photo' | 'document' | 'video' | 'audio';

/**
 * How an attachment may be sent, as each sender reads `attachmentType`: Telegram picks among all
 * five; Discord, Slack and LINE PC only tell a picture ("photo": the URL goes as an image) from a
 * link; LINE decides by itself. `auto` (and a variable) may land on Telegram, so it offers all.
 */
export function botAttachmentTypes(platform: BotPlatform | 'auto'): AttachmentType[] {
  if (platform === 'telegram' || platform === 'auto') return ['auto', 'photo', 'document', 'video', 'audio'];
  if (platform === 'line') return [];
  return ['auto', 'photo'];
}

/** A LINE PC step naming more chats than one step may send to: every run would refuse it. */
export function lineSelfRecipientOverflow(platform: BotPlatform | 'auto', recipients: string): number | null {
  if (platform !== 'lineSelf') return null;
  const count = recipientTokens(recipients).length;
  return count > LINE_SELF_MAX_RECIPIENTS ? count : null;
}

export const BotConfig: React.FC<SkillConfigProps> = ({ step, onChange, t, flowVariables, flowTrigger, draftButton }) => {
  const messageId = useId();
  const rawPlatform = (step.config.platform ?? '').trim();
  // A flow variable picks the bot at run time (the X gallery template's Telegram/LINE setting).
  const variablePlatform = TEMPLATE_RE.test(rawPlatform) ? rawPlatform : '';
  const platform = (variablePlatform ? 'auto' : rawPlatform || 'auto') as BotPlatform | 'auto';
  const chatIdsRaw = botStepTargets(step.config);
  const hasAttachment = (step.config.attachment ?? '').trim() !== '';
  const attachmentTypes = botAttachmentTypes(platform);
  const overflow = lineSelfRecipientOverflow(platform, chatIdsRaw);
  // Buttons run the flow's bot command again: a flow no bot command starts sends none anywhere.
  const command = flowBotCommand([flowTrigger]);

  return (
    <Stack gap="xs">
      <SelectDropdown
        label={t('flow.skill.bot.platform')}
        options={[
          ...(variablePlatform
            ? [{ value: variablePlatform, label: fillTemplate(t('flow.skill.bot.platform.variable'), { name: variablePlatform }) }]
            : []),
          { value: 'auto', label: t('flow.skill.bot.platform.auto') },
          { value: 'telegram', label: t('flow.skill.bot.platform.telegram') },
          { value: 'line', label: t('flow.skill.bot.platform.line') },
          { value: 'lineSelf', label: t('flow.skill.bot.platform.lineSelf') },
          { value: 'discord', label: t('flow.skill.bot.platform.discord') },
          { value: 'slack', label: t('flow.skill.bot.platform.slack') },
        ]}
        value={variablePlatform || platform}
        onChange={(value) => onChange({ ...step.config, platform: value })}
        size="sm"
      />
      <Text fz="xs" c="dimmed">
        {variablePlatform ? t('flow.skill.bot.platform.variable.hint') : t(`flow.skill.bot.platform.${platform}.hint`)}
      </Text>
      {platform === 'line' && (step.config.attachment ?? '').trim() !== '' && (
        <Text fz="xs" c="var(--mantine-color-warning)">{t('flow.skill.bot.platform.line.attachmentWarning')}</Text>
      )}
      <ChatRecipientPicker
        value={chatIdsRaw}
        onChange={(next) => onChange({ ...step.config, chatIds: next, chatId: '' })}
        platform={platform}
        label={t('flow.skill.bot.recipients')}
        hint={t('flow.skill.bot.recipients.hint')}
        emptyHint={t('flow.skill.bot.recipients.noPaired')}
        blankHint={t('flow.skill.bot.recipients.allPaired')}
        error={overflow === null ? undefined : fillTemplate(t('flow.skill.bot.recipients.tooMany'), {
          count: String(overflow), max: String(LINE_SELF_MAX_RECIPIENTS),
        })}
        offerStepChoices
        variables={flowVariables}
      />
      <FieldLabelRow htmlFor={messageId} label={t('flow.skill.bot.message')}>
        {draftButton?.('message', 'botMessage', t('flow.skill.bot.message'))}
      </FieldLabelRow>
      <AppTextarea
        id={messageId}
        aria-label={t('flow.skill.bot.message')}
        placeholder={t('flow.skill.bot.message.placeholder')}
        value={step.config.message ?? ''}
        onChange={(e) => onChange({ ...step.config, message: e.currentTarget.value })}
        minRows={3}
        maxRows={12}
        autosize
        size="sm"
      />
      {/* One file per line is an album, so the field keeps line breaks. */}
      <AppTextarea
        label={t('flow.skill.bot.attachment')}
        placeholder={t('flow.skill.bot.attachment.placeholder')}
        value={step.config.attachment ?? ''}
        onChange={(e) => onChange({ ...step.config, attachment: e.currentTarget.value })}
        minRows={1}
        autosize
        size="sm"
        tone="body"
        mono
      />
      <Text fz="xs" c="dimmed">{t('flow.skill.bot.attachment.hint')}</Text>
      {attachmentTypes.length > 0 && hasAttachment && (
        <SelectDropdown
          label={t('flow.skill.bot.attachmentType')}
          options={attachmentTypes.map((value) => ({ value, label: t(`flow.skill.bot.attachmentType.${value}`) }))}
          value={attachmentTypes.includes(step.config.attachmentType as AttachmentType) ? step.config.attachmentType! : 'auto'}
          onChange={(value) => onChange({ ...step.config, attachmentType: value })}
          size="sm"
        />
      )}
      {(platform === 'line' || platform === 'auto') && hasAttachment && (
        <AppTextarea
          label={t('flow.skill.bot.preview')}
          description={t('flow.skill.bot.preview.desc')}
          value={step.config.preview ?? ''}
          onChange={(e) => onChange({ ...step.config, preview: e.currentTarget.value })}
          minRows={1}
          autosize
          size="sm"
          tone="body"
          mono
        />
      )}
      {(command || (step.config.buttons ?? '').trim() !== '') && (
        <AppTextarea
          label={t(platform === 'line' || platform === 'lineSelf' ? 'flow.skill.bot.choices' : 'flow.skill.bot.buttons')}
          description={command
            ? fillTemplate(t(buttonsDescKey(variablePlatform ? 'auto' : platform)), { command: `/${command}` })
            : <Text span fz="xs" c="var(--mantine-color-warning)">{t('flow.skill.bot.buttons.unused')}</Text>}
          placeholder={t('flow.skill.bot.buttons.placeholder')}
          value={step.config.buttons ?? ''}
          onChange={(e) => onChange({ ...step.config, buttons: e.currentTarget.value })}
          minRows={2}
          autosize
          size="sm"
          tone="body"
          mono
        />
      )}
      <ToggleSwitch
        label={t('flow.skill.bot.emitFailFlag')}
        size="sm"
        checked={step.config.emitFailFlag === 'true'}
        onChange={(e) => onChange({ ...step.config, emitFailFlag: e.currentTarget.checked ? 'true' : 'false' })}
      />
      {step.config.emitFailFlag === 'true' && (
        <Text fz="xs" c="dimmed">
          {fillTemplate(t('flow.skill.bot.emitFailFlag.hint'), { flag: `{{${step.outputKey}.isFailed}}` })}
        </Text>
      )}
    </Stack>
  );
};
