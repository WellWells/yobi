import React, { useEffect, useState } from 'react';
import { Divider, Group, Stack, Text, Button as MButton } from '@mantine/core';
import { KeyRound } from 'lucide-react';
import { AppTextInput } from '../../../components/AppTextInput';
import { AppTextarea } from '../../../components/AppTextarea';
import { AppNumberInput } from '../../../components/AppNumberInput';
import { AppPasswordInput } from '../../../components/AppPasswordInput';
import { emailApi } from '../../../api/electronApi';
import type { SkillConfigProps } from './types';

export const EmailSendConfig: React.FC<SkillConfigProps> = ({ step, onChange, t }) => {
  const [host, setHost] = useState('');
  const [port, setPort] = useState<number>(587);
  const [user, setUser] = useState('');
  const [password, setPassword] = useState('');
  const [hasPassword, setHasPassword] = useState(false);
  const [passwordPreview, setPasswordPreview] = useState('');
  const [busy, setBusy] = useState(false);

  const refreshSmtp = async () => {
    const s = await emailApi.getSettings();
    setHost(s.host);
    setPort(s.port);
    setUser(s.user);
    setHasPassword(s.hasPassword);
    setPasswordPreview(s.passwordPreview);
  };

  useEffect(() => { void refreshSmtp(); }, []);

  const handleSaveSmtp = async () => {
    setBusy(true);
    const result = await emailApi.updateCredentials({
      host: host.trim(),
      port: Number(port) || 587,
      user: user.trim(),
      password,
    });
    if (result.ok) setPassword('');
    await refreshSmtp();
    setBusy(false);
  };

  return (
    <Stack gap="xs">
      <Text fz="sm" fw={600}>{t('agentflow.skill.email_send.smtp')}</Text>
      <Text fz="xs" c="dimmed">{t('agentflow.skill.email_send.smtp.hint')}</Text>
      <AppTextInput
        label={t('settings.email.host')}
        placeholder={t('settings.email.host.placeholder')}
        value={host}
        onChange={(e) => setHost(e.currentTarget.value)}
        size="sm"
        tone="body"
      />
      <AppNumberInput
        label={t('settings.email.port')}
        value={port}
        onChange={(v) => setPort(Number(v) || 587)}
        min={1}
        max={65_535}
        size="sm"
        tone="body"
      />
      <AppTextInput
        label={t('settings.email.user')}
        placeholder={t('settings.email.user.placeholder')}
        value={user}
        onChange={(e) => setUser(e.currentTarget.value)}
        size="sm"
        tone="body"
      />
      <Group gap={8} align="flex-end">
        <AppPasswordInput
          flex={1}
          label={t('settings.email.password')}
          placeholder={t('settings.email.password.placeholder')}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          size="sm"
          tone="body"
        />
        <MButton
          variant="default"
          leftSection={<KeyRound size={13} />}
          onClick={() => { void handleSaveSmtp(); }}
          disabled={busy || !host.trim() || !user.trim()}
        >
          {t('settings.email.save')}
        </MButton>
      </Group>
      <Text fz="xs" c="dimmed">
        {t('settings.email.passwordCurrent')}:{' '}
        {hasPassword ? (passwordPreview || '****') : t('settings.email.passwordNotSet')}
      </Text>

      <Divider my={4} />

      <AppTextInput
        label={t('agentflow.skill.email_send.to')}
        placeholder={t('agentflow.skill.email_send.to.placeholder')}
        value={step.config.to ?? ''}
        onChange={(e) => onChange({ ...step.config, to: e.currentTarget.value })}
        size="sm"
      />
      <AppTextInput
        label={t('agentflow.skill.email_send.subject')}
        placeholder={t('agentflow.skill.email_send.subject.placeholder')}
        value={step.config.subject ?? ''}
        onChange={(e) => onChange({ ...step.config, subject: e.currentTarget.value })}
        size="sm"
      />
      <AppTextarea
        label={t('agentflow.skill.email_send.body')}
        placeholder={t('agentflow.skill.email_send.body.placeholder')}
        value={step.config.body ?? ''}
        onChange={(e) => onChange({ ...step.config, body: e.currentTarget.value })}
        minRows={3}
        autosize
        size="sm"
      />
      <AppTextInput
        label={t('agentflow.skill.email_send.fromName')}
        placeholder={t('agentflow.skill.email_send.fromName.placeholder')}
        value={step.config.fromName ?? ''}
        onChange={(e) => onChange({ ...step.config, fromName: e.currentTarget.value })}
        size="sm"
      />
      <Text fz="xs" c="dimmed">{t('agentflow.skill.email_send.hint')}</Text>
    </Stack>
  );
};
