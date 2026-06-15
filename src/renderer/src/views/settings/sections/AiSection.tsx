import React from 'react';
import { ActionIcon, Box, Group, Stack, Text } from '@mantine/core';
import {
  AlignJustify, AlignLeft, Eye, FileText, MessageSquare, Minus, Plus,
  SlidersHorizontal, Timer, User2, MonitorPlay,
} from 'lucide-react';
import { AppTextarea } from '../../../components/AppTextarea';
import { AppTextInput } from '../../../components/AppTextInput';
import {
  SectionCard, SettingRow, SettingField, SettingDivider, SegmentedControl, ToggleSwitch, GroupHeader, SectionTitle,
} from '../components';
import { TAG_SETS } from '../hooks/useSettingsNav';
import {
  MIN_RESPONSE_TIMEOUT_SEC, MAX_RESPONSE_TIMEOUT_SEC,
} from '../hooks/useSystemSettings';
import type { useSystemSettings } from '../hooks/useSystemSettings';
import type { usePromptPrefs } from '../hooks/usePromptPrefs';

type SystemSettings = ReturnType<typeof useSystemSettings>;
type PromptPrefs = ReturnType<typeof usePromptPrefs>;

interface Props {
  system: SystemSettings;
  prefs: PromptPrefs;
  t: (key: string) => string;
  locale: string;
  showSection: (tags: readonly string[], category: 'ai') => boolean;
  isSearching: boolean;
  sectionGap: number;
}

export const AiSection: React.FC<Props> = ({
  system, prefs, t, locale, showSection, isSearching, sectionGap,
}) => (
  <Box>
    {isSearching && <GroupHeader label={t('settings.group.ai')} />}

    <SectionCard style={{ marginBottom: sectionGap, display: showSection(TAG_SETS.timeout, 'ai') ? 'block' : 'none' }}>
      <SectionTitle icon={<Timer size={15} />} label={t('settings.responseTimeout.title')} />
      <Group gap={10} align="center">
        <ActionIcon
          variant="default"
          size={32}
          aria-label={t('settings.responseTimeout.decrease')}
          onClick={() => {
            const base = system.timeoutInputIsInteger ? system.timeoutParsed : system.responseTimeoutSec;
            void system.persistResponseTimeoutSec(base - 1);
          }}
          disabled={system.responseTimeoutSec <= MIN_RESPONSE_TIMEOUT_SEC}
        >
          <Minus size={14} />
        </ActionIcon>

        <Box pos="relative" w={120}>
          <AppTextInput
            type="text"
            inputMode="numeric"
            tone="body"
            numeric
            value={system.responseTimeoutInput}
            onChange={(e) => system.setResponseTimeoutInput(e.target.value.replace(/[^\d]/g, ''))}
            onBlur={() => {
              const base = system.timeoutInputIsInteger ? system.timeoutParsed : system.responseTimeoutSec;
              void system.persistResponseTimeoutSec(base);
            }}
            error={system.timeoutInvalid}
            rightSection={
              <Text component="span" fz="var(--font-size-base)" c="dimmed">
                {t('settings.responseTimeout.seconds')}
              </Text>
            }
            rightSectionWidth={30}
          />
        </Box>

        <ActionIcon
          variant="default"
          size={32}
          aria-label={t('settings.responseTimeout.increase')}
          onClick={() => {
            const base = system.timeoutInputIsInteger ? system.timeoutParsed : system.responseTimeoutSec;
            void system.persistResponseTimeoutSec(base + 1);
          }}
          disabled={system.responseTimeoutSec >= MAX_RESPONSE_TIMEOUT_SEC}
        >
          <Plus size={14} />
        </ActionIcon>

        <Text fz="var(--font-size-sm)" c="dimmed">
          {t('settings.responseTimeout.range')}
        </Text>
      </Group>
      <Text
        fz="var(--font-size-sm)"
        mt={8}
        lh={1.6}
        c={system.timeoutInvalid ? 'var(--mantine-color-error)' : 'dimmed'}
      >
        {system.timeoutInvalid
          ? t('settings.responseTimeout.invalid')
          : t('settings.responseTimeout.hint')}
      </Text>
    </SectionCard>

    <Box display={showSection(TAG_SETS.prompt, 'ai') ? 'block' : 'none'}>
      <SectionCard style={{ marginBottom: sectionGap }}>

        <Box mb={14} pb={14} style={{ borderBottom: '1px solid var(--mantine-color-default-border)' }}>
          <SettingRow
            icon={<AlignLeft size={13} />}
            label={t('settings.prompt.localeSync.title')}
            hint={t('settings.prompt.localeSync.hint').replace('{{locale}}', locale)}
            alignStart
            control={
              <ToggleSwitch
                checked={prefs.syncSystemLanguageToModel}
                onChange={() => { void prefs.handleToggleSyncSystemLanguageToModel(); }}
              />
            }
          />
        </Box>

        <SectionTitle icon={<SlidersHorizontal size={15} />} label={t('settings.prompt.persona.title')} />

        <Stack gap={12}>
          <SettingField
            icon={<User2 size={13} />}
            label={t('settings.prompt.nickname.label')}
            hint={t('settings.prompt.nickname.hint')}
          >
            <AppTextInput
              value={prefs.promptPrefs.nickname ?? ''}
              tone="body"
              onChange={(e) => prefs.setPromptPrefs({ ...prefs.promptPrefs, nickname: e.target.value })}
              onBlur={(e) => {
                const next = { ...prefs.promptPrefs, nickname: e.target.value };
                prefs.setPromptPrefs(next);
                void prefs.savePromptPrefs(next);
              }}
              placeholder={t('settings.prompt.nickname.placeholder')}
            />
          </SettingField>

          <SettingField icon={<MessageSquare size={13} />} label={t('settings.prompt.tone.label')}>
            <SegmentedControl
              value={prefs.promptPrefs.tone}
              options={[
                { value: 'default', label: t('settings.prompt.tone.default') },
                { value: 'professional', label: t('settings.prompt.tone.professional') },
                { value: 'casual', label: t('settings.prompt.tone.casual') },
                { value: 'direct', label: t('settings.prompt.tone.direct') },
              ]}
              onChange={prefs.handleToneChange}
            />
          </SettingField>

          <SettingField icon={<AlignJustify size={13} />} label={t('settings.prompt.length.label')}>
            <SegmentedControl
              value={prefs.promptPrefs.length}
              options={[
                { value: 'auto', label: t('settings.prompt.length.auto') },
                { value: 'concise', label: t('settings.prompt.length.concise') },
                { value: 'detailed', label: t('settings.prompt.length.detailed') },
              ]}
              onChange={prefs.handleLengthChange}
            />
          </SettingField>
        </Stack>

        <SettingDivider my={14} />

        <SectionTitle icon={<FileText size={15} />} label={t('settings.prompt.templates.title')} mb={10} />
        <AppTextarea
          value={prefs.promptPrefs.customInstructions}
          onChange={(e) => prefs.setPromptPrefs({ ...prefs.promptPrefs, customInstructions: e.target.value })}
          onBlur={(e) => {
            const next = { ...prefs.promptPrefs, customInstructions: e.target.value };
            prefs.setPromptPrefs(next);
            void prefs.savePromptPrefs(next);
          }}
          placeholder={t('settings.prompt.templates.promptPlaceholder')}
          autosize
          minRows={3}
          maxRows={10}
          styles={{
            input: {
              background: 'var(--mantine-color-body)',
              border: '1.5px solid var(--mantine-color-default-border)',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--mantine-color-default-color)',
              fontSize: 'var(--font-size-base)',
            },
          }}
        />
      </SectionCard>

      <SectionCard style={{ marginBottom: sectionGap }}>
        <SectionTitle icon={<MonitorPlay size={15} />} label={t('settings.youtube.prompt.title')} mb={8} />
        <AppTextarea
          value={prefs.youtubePrompt}
          onChange={(e) => prefs.setYoutubePrompt(e.target.value)}
          onBlur={(e) => { void prefs.saveYoutubePrompt(e.target.value); }}
          placeholder={t('settings.youtube.prompt.placeholder')}
          autosize
          minRows={3}
          maxRows={12}
          styles={{
            input: {
              background: 'var(--mantine-color-body)',
              border: '1.5px solid var(--mantine-color-default-border)',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--mantine-color-default-color)',
              fontSize: 'var(--font-size-base)',
            },
          }}
        />
        <Text fz="var(--font-size-sm)" mt={6} c="dimmed">{t('settings.youtube.prompt.hint')}</Text>
      </SectionCard>

      <SectionCard style={{ marginBottom: sectionGap }}>
        <SectionTitle icon={<Eye size={15} />} label={t('settings.prompt.preview.title')} mb={8} />
        {prefs.combinedPromptPreview ? (
          <Box
            component="pre"
            bg="var(--mantine-color-bg-tertiary)"
            style={{
              border: '1px solid var(--mantine-color-default-border)',
              borderRadius: 'var(--radius-sm)',
              padding: '10px 12px',
              margin: 0,
              fontSize: 'var(--font-size-sm)',
              color: 'var(--mantine-color-default-color)',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              fontFamily: 'var(--font-sans)',
              lineHeight: 1.65,
            }}
          >
            {prefs.combinedPromptPreview}
          </Box>
        ) : (
          <Text
            fz="var(--font-size-sm)"
            c="dimmed"
            bg="var(--mantine-color-bg-tertiary)"
            fs="italic"
            p="10px 12px"
            style={{
              border: '1px solid var(--mantine-color-default-border)',
              borderRadius: 'var(--radius-sm)',
            }}
          >
            {t('settings.prompt.preview.empty')}
          </Text>
        )}
      </SectionCard>
    </Box>
  </Box>
);
