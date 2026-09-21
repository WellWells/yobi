import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, Group, Stack, Text } from '@mantine/core';
import { TriangleAlert, Sparkles } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { AppModal } from '../../components/AppModal';
import { AppTextarea } from '../../components/AppTextarea';
import { AppTextInput } from '../../components/AppTextInput';
import { AppButton } from '../../components/AppButton';
import { FlowBuildProgressView } from '../../components/FlowBuildProgress';
import { useFlowBuildStore, EMPTY_BUILD } from '../../store/useFlowBuildStore';
import type { FlowBuildOutcome, FlowClarification } from '../../../../shared/types';
import { ModelDropdown } from '../../components/chat/ModelDropdown';
import { flowApi } from '../../api/electronApi';
import { PROVIDER_URLS } from '../../../../shared/types';
import { Z_MODAL, Z_POPOVER } from '../../config/zLayers';

/** What `pickProvider` falls back to, so an unset picker shows the model that will really run. */
const DEFAULT_GENERATE_MODEL: string = PROVIDER_URLS.gemini;

interface FlowGenerateModalProps {
  open: boolean;
  t: (key: string) => string;
  onClose: () => void;
  onBuild: (
    description: string,
    buildId: string,
    answers?: FlowClarification[],
    providerUrl?: string,
  ) => Promise<FlowBuildOutcome>;
}

/** Local to one modal session; the main process only uses it to address its event stream. */
function newBuildId(): string {
  return `build-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

type Screen = 'compose' | 'running' | 'questions' | 'done' | 'failed';

export const FlowGenerateModal: React.FC<FlowGenerateModalProps> = ({
  open, t, onClose, onBuild,
}) => {
  const [description, setDescription] = useState('');
  /**
   * Which model generates the flow. Kept apart from the chat model on purpose: this one only
   * ever has to return a large JSON object, and the provider that converses best is often not
   * the one that does that best. Remembered in config, so it is picked once, not every time.
   */
  const [modelUrl, setModelUrl] = useState(DEFAULT_GENERATE_MODEL);
  const [screen, setScreen] = useState<Screen>('compose');
  const [buildId, setBuildId] = useState('');
  const [answers, setAnswers] = useState<string[]>([]);
  const clearBuild = useFlowBuildStore((state) => state.clearBuild);
  const build = useFlowBuildStore(useShallow((state) => (buildId ? state.builds[buildId] : undefined)));
  const state = build ?? EMPTY_BUILD;
  // The description the build actually started from, so a retry after questions sends the same
  // request rather than whatever is in the box by then.
  const submitted = useRef('');

  const reset = useCallback(() => {
    if (buildId) clearBuild(buildId);
    setScreen('compose');
    setBuildId('');
    setAnswers([]);
  }, [buildId, clearBuild]);

  const handleClose = useCallback(() => {
    // A build in flight is left running: it is queued work in the main process, and the flow
    // still arrives in the list. Only the panel goes away.
    reset();
    setDescription('');
    onClose();
  }, [reset, onClose]);

  // Loaded when the window opens rather than held in a store: it is read once per build and the
  // config is the thing that actually remembers it.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void flowApi.getAiUrl().then((url) => {
      if (!cancelled) setModelUrl(url.trim() || DEFAULT_GENERATE_MODEL);
    }).catch(() => { });
    return () => { cancelled = true; };
  }, [open]);

  const start = useCallback(async (text: string, replies?: FlowClarification[]) => {
    const id = newBuildId();
    setBuildId(id);
    setScreen('running');
    submitted.current = text;
    const outcome = await onBuild(text, id, replies, modelUrl).catch((err: unknown) => ({
      status: 'failed' as const,
      phase: 'build' as const,
      error: err instanceof Error ? err.message : String(err),
    }));
    if (outcome.status === 'questions') {
      setAnswers(outcome.questions.map(() => ''));
      setScreen('questions');
    } else {
      setScreen(outcome.status === 'created' ? 'done' : 'failed');
    }
  }, [onBuild, modelUrl]);

  const handleStart = useCallback(() => {
    const desc = description.trim();
    if (desc) void start(desc);
  }, [description, start]);

  const handleAnswers = useCallback(() => {
    const replies: FlowClarification[] = state.questions.map((question, index) => ({
      question,
      answer: (answers[index] ?? '').trim(),
    }));
    void start(submitted.current, replies);
  }, [answers, state.questions, start]);

  useEffect(() => {
    if (!open) reset();
    // `reset` changes with buildId; re-running it on a closed modal is harmless and keeps the
    // panel from reopening on stale state.
  }, [open, reset]);

  const issueRows = useMemo(() => (state.report?.issues ?? []).slice(0, 6), [state.report]);
  const answersReady = answers.length > 0 && answers.every((answer) => answer.trim().length > 0);

  return (
    <AppModal
      opened={open}
      onClose={handleClose}
      title={t('flow.generate.modal.title')}
      icon={<Sparkles size={16} />}
      size="md"
      zIndex={Z_MODAL}
    >
      <Stack gap="md">
        {screen === 'compose' ? (
          <>
            <Text fz="sm" fw={600}>{t('flow.generate.description.label')}</Text>
            <AppTextarea
              value={description}
              onChange={(e) => setDescription(e.currentTarget.value)}
              placeholder={t('flow.generate.description.placeholder')}
              autosize
              minRows={4}
              maxRows={10}
              resize="vertical"
            />
            <Group justify="space-between" align="center">
              <ModelDropdown
                value={modelUrl}
                onChange={setModelUrl}
                zIndex={Z_POPOVER}
                tooltipLabel={t('flow.generate.model.tooltip')}
              />
              <Group gap="xs">
                <Button variant="default" size="xs" onClick={handleClose}>
                  {t('dialog.cancel')}
                </Button>
                <AppButton
                  variant="filled"
                  size="xs"
                  leftSection={<Sparkles size={14} />}
                  disabled={!description.trim()}
                  onClick={handleStart}
                >
                  {t('flow.generate.button')}
                </AppButton>
              </Group>
            </Group>
          </>
        ) : (
          <>
            <FlowBuildProgressView state={state} />

            {screen === 'questions' && (
              <Stack gap="xs">
                <Text fz="sm" fw={600}>
                  {t('flow.build.questions.title').replace('{{count}}', String(state.questions.length))}
                </Text>
                {state.questions.map((question, index) => (
                  <Stack key={`${index}-${question}`} gap={4}>
                    <Text fz="xs">{`${index + 1}. ${question}`}</Text>
                    <AppTextInput
                      value={answers[index] ?? ''}
                      onChange={(e) => setAnswers((prev) => {
                        const next = [...prev];
                        next[index] = e.currentTarget.value;
                        return next;
                      })}
                      placeholder={t('flow.build.questions.placeholder')}
                    />
                  </Stack>
                ))}
                <Group justify="flex-end">
                  <Button variant="default" size="xs" onClick={handleClose}>
                    {t('dialog.cancel')}
                  </Button>
                  <AppButton variant="filled" size="xs" disabled={!answersReady} onClick={handleAnswers}>
                    {t('flow.build.questions.continue')}
                  </AppButton>
                </Group>
              </Stack>
            )}

            {screen === 'done' && state.report && (
              <Stack gap="xs">
                <Text fz="sm" fw={600}>
                  {t('flow.build.done.title').replace('{{name}}', state.flowName ?? '')}
                </Text>
                <Text fz="xs" c="dimmed">
                  {t('flow.build.done.summary')
                    .replace('{{steps}}', String(state.report.steps))
                    .replace('{{tools}}', String(state.report.skills.length))}
                </Text>
                {issueRows.length > 0 && (
                  <Alert color="yellow" icon={<TriangleAlert size={14} />} p="xs">
                    <Stack gap={2}>
                      <Text fz="xs" fw={600}>{t('flow.build.done.check')}</Text>
                      {issueRows.map((issue) => (
                        <Text key={`${issue.kind}-${issue.step}-${issue.detail}`} fz="xs">
                          {t(`flow.build.issue.${issue.kind}`)
                            .replace('{{step}}', String(issue.step))
                            .replace('{{skill}}', t(`flow.skill.${issue.skill}`))
                            .replace('{{detail}}', issue.kind === 'setup' ? t(`flow.build.need.${issue.detail}`) : issue.detail)}
                        </Text>
                      ))}
                    </Stack>
                  </Alert>
                )}
                <Group justify="flex-end">
                  <AppButton variant="filled" size="xs" onClick={handleClose}>
                    {t('flow.build.done.open')}
                  </AppButton>
                </Group>
              </Stack>
            )}

            {screen === 'failed' && (
              <Stack gap="xs">
                <Alert color="red" icon={<TriangleAlert size={14} />} p="xs">
                  <Stack gap={2}>
                    <Text fz="xs" fw={600}>
                      {t('flow.build.failed.title')
                        .replace('{{phase}}', t(`flow.build.phase.${state.error?.phase ?? 'build'}`))}
                    </Text>
                    <Text fz="xs">{state.error?.message ?? ''}</Text>
                  </Stack>
                </Alert>
                <Text fz="xs" c="dimmed">{t('flow.build.failed.next')}</Text>
                <Group justify="flex-end">
                  <Button variant="default" size="xs" onClick={handleClose}>
                    {t('dialog.cancel')}
                  </Button>
                  <AppButton variant="filled" size="xs" onClick={() => { reset(); }}>
                    {t('flow.build.failed.edit')}
                  </AppButton>
                </Group>
              </Stack>
            )}
          </>
        )}
      </Stack>
    </AppModal>
  );
};
