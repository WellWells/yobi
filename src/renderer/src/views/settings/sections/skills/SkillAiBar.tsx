import React from 'react';
import { Group, Stack } from '@mantine/core';
import { Sparkles, Square } from 'lucide-react';
import { AppButton } from '../../../../components/AppButton';
import { AppTextarea } from '../../../../components/AppTextarea';
import { ModelDropdown } from '../../../../components/chat/ModelDropdown';
import { StatusLine } from '../../components';
import { Z_POPOVER } from '../../../../config/zLayers';
import { SKILL_DRAFT_REQUEST_MAX } from '../../../../../../shared/skillAuthoring';
import { SkillDraftProgress } from './SkillDraftProgress';
import type { DraftProgress } from './skillDraftProgressModel';

/** What the request box asks for: a new skill, a change, or (optional) notes on a conversation. */
export type SkillAiMode = 'new' | 'revise' | 'conversation';

interface Props {
  mode: SkillAiMode;
  request: string;
  onRequest: (value: string) => void;
  modelUrl: string;
  onModel: (url: string) => void;
  drafting: boolean;
  /** What the running (or last) draft is doing. */
  progress: DraftProgress | null;
  /** Another model call (a try, a test case) is running: one at a time. */
  blocked: boolean;
  error: string | null;
  onDraft: () => void;
  onStop: () => void;
  t: (key: string) => string;
}

const PLACEHOLDER: Record<SkillAiMode, string> = {
  new: 'settings.skills.ai.placeholder.new',
  revise: 'settings.skills.ai.placeholder.revise',
  conversation: 'settings.skills.ai.placeholder.conversation',
};

/**
 * The editor's AI row: say what the skill should do (or what to change), pick the model, and the
 * draft comes back into the editor. The same model writes, tries and runs the test cases, and is
 * remembered for next time. Nothing is saved from here; the editor's Save does that.
 */
export const SkillAiBar: React.FC<Props> = ({ mode, request, onRequest, modelUrl, onModel, drafting, progress, blocked, error, onDraft, onStop, t }) => {
  const needsRequest = mode !== 'conversation';
  const canDraft = Boolean(modelUrl) && !blocked && (!needsRequest || Boolean(request.trim()));
  return (
    <Stack gap={8}>
      <AppTextarea
        value={request}
        onChange={(event) => onRequest(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && canDraft && !drafting) onDraft();
        }}
        placeholder={t(PLACEHOLDER[mode])}
        aria-label={t(PLACEHOLDER[mode])}
        maxLength={SKILL_DRAFT_REQUEST_MAX}
        autosize
        minRows={2}
        maxRows={5}
      />
      <Group justify="space-between" align="center" wrap="nowrap">
        <ModelDropdown value={modelUrl} onChange={onModel} zIndex={Z_POPOVER} tooltipLabel={t('settings.skills.ai.model')} />
        <Group gap={8} wrap="nowrap">
          {drafting && (
            <AppButton variant="default" size="xs" leftSection={<Square size={12} />} onClick={onStop}>{t('settings.skills.ai.stop')}</AppButton>
          )}
          <AppButton size="xs" variant="light" loading={drafting} disabled={!canDraft} leftSection={<Sparkles size={13} />} onClick={onDraft}>
            {t(mode === 'revise' ? 'settings.skills.ai.revise' : 'settings.skills.ai.write')}
          </AppButton>
        </Group>
      </Group>
      <SkillDraftProgress progress={progress} t={t} />
      {error && <StatusLine tone="error">{error}</StatusLine>}
    </Stack>
  );
};
