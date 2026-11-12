import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActionIcon, Alert, Box, Checkbox, Group, Loader, Stack, Text, Tooltip, UnstyledButton } from '@mantine/core';
import { ArrowUp, BookOpenText, Square, Tag } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { flowApi } from '../../../api/electronApi';
import { AppButton } from '../../../components/AppButton';
import { AppTextarea } from '../../../components/AppTextarea';
import { ModelDropdown } from '../../../components/chat/ModelDropdown';
import { MessageMarkdown } from '../../../components/chat/MessageMarkdown';
import { Z_POPOVER } from '../../../config/zLayers';
import { PROVIDER_URLS } from '../../../../../shared/types';
import type { FlowBuildIssue, FlowDefinition } from '../../../../../shared/types';
import { fillTemplate } from '../../../../../shared/fillTemplate';
import type { AssistChange } from '../../../../../shared/flowAssist';
import { useFlowAssistStore, threadOf } from '../../../store/useFlowAssistStore';
import type { AssistResult, AssistRetry } from '../../../store/useFlowAssistStore';
import { useI18nStore } from '../../../store/i18nStore';
import { isComposingKey } from '../../../utils/imeKeys';
import { locateStep } from '../outline/locateStep';
import { summaryContext } from '../outline/rowText';
import { useNamedModels } from '../useNamedModels';
import { applyNames, applyProposal, cancelAssist, startEdit, startExplain, startNames } from './flowAssistActions';
import { namingTargets } from './assistMaterial';

const DEFAULT_MODEL: string = PROVIDER_URLS.gemini;

const CHANGE_KEY: Record<AssistChange['kind'], string> = {
  added: 'flow.assist.change.added',
  changed: 'flow.assist.change.changed',
  removed: 'flow.assist.change.removed',
};

const CHANGE_COLOR: Record<AssistChange['kind'], string> = {
  added: 'var(--mantine-color-success)',
  changed: 'var(--text-secondary)',
  removed: 'var(--mantine-color-error)',
};

const RUNNING_KEY = {
  edit: 'flow.assist.running.edit',
  explain: 'flow.assist.running.explain',
  names: 'flow.assist.running.names',
} as const;

const SUGGESTIONS = ['flow.assist.suggest.notify', 'flow.assist.suggest.schedule', 'flow.assist.suggest.shorter'] as const;

function issueText(issue: FlowBuildIssue, t: (key: string) => string): string {
  return fillTemplate(t(`flow.build.issue.${issue.kind}`), {
    step: String(issue.step),
    skill: t(`flow.skill.${issue.skill}`),
    detail: issue.kind === 'setup' ? t(`flow.build.need.${issue.detail}`) : issue.detail,
  });
}

function stepRowLabel(change: AssistChange, t: (key: string) => string): string {
  return `#${change.index} ${change.label.trim() || t(`flow.skill.${change.type}`)}`;
}

interface PanelProps {
  flow: FlowDefinition;
  t: (key: string) => string;
}

/**
 * The right pane's Assistant tab: say what to change and see the changes before they count,
 * have the flow explained, have its steps named. Every result is a proposal; applying puts it in
 * the draft, and only the editor's Save writes it.
 */
export const FlowAssistPanel: React.FC<PanelProps> = ({ flow, t }) => {
  const { job, result } = useFlowAssistStore(useShallow((s) => threadOf(s.threads, flow.id)));
  const { modelUrl, setModelUrl, patch, focusInput } = useFlowAssistStore(useShallow((s) => ({
    modelUrl: s.modelUrl, setModelUrl: s.setModelUrl, patch: s.patch, focusInput: s.focusInput,
  })));
  const models = useNamedModels();
  const locale = useI18nStore((s) => s.locale);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // AI flow building's model, read once: the config is what remembers it.
  useEffect(() => {
    if (modelUrl) return undefined;
    let cancelled = false;
    void flowApi.getAiUrl().then((url) => {
      if (!cancelled && !useFlowAssistStore.getState().modelUrl) setModelUrl(url.trim() || DEFAULT_MODEL);
    }).catch(() => setModelUrl(DEFAULT_MODEL));
    return () => { cancelled = true; };
  }, [modelUrl, setModelUrl]);

  useEffect(() => {
    if (focusInput > 0) inputRef.current?.focus();
  }, [focusInput]);

  const send = (text: string): void => {
    if (!text.trim() || job) return;
    setDraft('');
    void startEdit(flow.id, text);
  };
  const retry = (what: AssistRetry): void => {
    if (what.kind === 'edit') void startEdit(flow.id, what.change);
    else if (what.kind === 'explain') void startExplain(flow.id);
    else void startNames(flow.id, summaryContext(flow, t, models, locale));
  };
  const hasSteps = flow.steps.length > 0;
  const canName = useMemo(() => namingTargets(flow, t).length > 0, [flow, t]);

  return (
    <Stack gap={0} h="100%" miw={0} style={{ overflow: 'hidden' }} data-flow-assist="">
      <Group gap={6} px={8} pt={8} pb={6} wrap="wrap">
        <AppButton size="compact-xs" variant="default" leftSection={<BookOpenText size={13} />} disabled={Boolean(job) || !hasSteps || !modelUrl} onClick={() => { void startExplain(flow.id); }}>
          {t('flow.assist.explain')}
        </AppButton>
        <AppButton
          size="compact-xs"
          variant="default"
          leftSection={<Tag size={13} />}
          disabled={Boolean(job) || !canName || !modelUrl}
          onClick={() => { void startNames(flow.id, summaryContext(flow, t, models, locale)); }}
        >
          {t('flow.assist.names')}
        </AppButton>
      </Group>

      <Box flex={1} px={10} pb={10} style={{ overflowY: 'auto', minHeight: 0 }}>
        {job ? (
          <Group gap={8} wrap="nowrap" py={6}>
            <Loader size={14} />
            <Text fz="var(--font-size-sm)" c="var(--text-muted)" style={{ flex: 1 }}>{t(RUNNING_KEY[job.kind])}</Text>
            <AppButton size="compact-xs" variant="subtle" onClick={() => cancelAssist(flow.id)}>{t('flow.assist.stop')}</AppButton>
          </Group>
        ) : result ? (
          <ResultView flowId={flow.id} result={result} t={t} onRetry={retry} onDismiss={() => patch(flow.id, { result: null })} />
        ) : (
          <Stack gap={8} py={4}>
            <Text fz="var(--font-size-base)" c="var(--text-muted)" style={{ lineHeight: 1.6 }}>{t('flow.assist.empty')}</Text>
            <Stack gap={6} align="flex-start">
              {SUGGESTIONS.map((key) => (
                <AppButton key={key} size="compact-xs" variant="default" disabled={!hasSteps || !modelUrl} onClick={() => setDraft(t(key))} style={{ maxWidth: '100%' }}>
                  <Text fz="var(--font-size-sm)" truncate>{t(key)}</Text>
                </AppButton>
              ))}
            </Stack>
          </Stack>
        )}
      </Box>

      <Box px={8} pt={8} pb={8} style={{ borderTop: '1px solid var(--mantine-color-default-border)', flexShrink: 0 }}>
        <AppTextarea
          ref={inputRef}
          value={draft}
          onChange={(event) => setDraft(event.currentTarget.value)}
          placeholder={t('flow.assist.placeholder')}
          aria-label={t('flow.assist.placeholder')}
          autosize
          minRows={2}
          maxRows={8}
          size="sm"
          onKeyDown={(event) => {
            // Enter sends, Shift+Enter is a new line; Enter that ends an IME composition is neither.
            if (event.key !== 'Enter' || event.shiftKey || isComposingKey(event.nativeEvent)) return;
            event.preventDefault();
            send(draft);
          }}
        />
        <Group justify="space-between" gap={6} mt={6} wrap="nowrap">
          <Box style={{ minWidth: 0 }}>
            {modelUrl && <ModelDropdown value={modelUrl} onChange={setModelUrl} menuDirection="up" zIndex={Z_POPOVER} tooltipLabel={t('flow.assist.model')} />}
          </Box>
          {job ? (
            <Tooltip label={t('flow.assist.stop')} position="top">
              <ActionIcon size={28} variant="default" aria-label={t('flow.assist.stop')} onClick={() => cancelAssist(flow.id)}>
                <Square size={12} />
              </ActionIcon>
            </Tooltip>
          ) : (
            <Tooltip label={t('flow.assist.send')} position="top">
              <ActionIcon size={28} variant="filled" aria-label={t('flow.assist.send')} disabled={!draft.trim() || !modelUrl} onClick={() => send(draft)}>
                <ArrowUp size={14} />
              </ActionIcon>
            </Tooltip>
          )}
        </Group>
      </Box>
    </Stack>
  );
};

interface ResultProps {
  flowId: string;
  result: AssistResult;
  t: (key: string) => string;
  onRetry: (what: AssistRetry) => void;
  onDismiss: () => void;
}

const ResultView: React.FC<ResultProps> = ({ flowId, result, t, onRetry, onDismiss }) => {
  switch (result.kind) {
    case 'proposal':
      return <ProposalView flowId={flowId} result={result} t={t} onDismiss={onDismiss} />;
    case 'questions':
      return <QuestionsView flowId={flowId} result={result} t={t} />;
    case 'names':
      return <NamesView flowId={flowId} result={result} t={t} onDismiss={onDismiss} />;
    case 'unchanged':
      return <Note text={t('flow.assist.unchanged')} quote={result.change} />;
    case 'applied':
      return <Note text={fillTemplate(t(result.what === 'edit' ? 'flow.assist.applied.edit' : 'flow.assist.applied.names'), { count: String(result.count) })} />;
    case 'explain':
      return (
        <Box className="md-content selectable" fz="var(--font-size-base)" style={{ lineHeight: 1.65, color: 'var(--text-primary)' }}>
          <MessageMarkdown>{result.markdown}</MessageMarkdown>
        </Box>
      );
    case 'error':
      return (
        <Alert color="var(--mantine-color-error)" variant="light" p={10}>
          <Stack gap={6}>
            <Text fz="var(--font-size-base)" style={{ wordBreak: 'break-word' }}>{result.message}</Text>
            {result.retry && (
              <Group gap={4}>
                <AppButton size="compact-xs" variant="subtle" onClick={() => onRetry(result.retry!)}>{t('flow.assist.retry')}</AppButton>
              </Group>
            )}
          </Stack>
        </Alert>
      );
  }
};

const Note: React.FC<{ text: string; quote?: string }> = ({ text, quote }) => (
  <Stack gap={4} py={4}>
    {quote && <Text fz="var(--font-size-sm)" c="var(--text-muted)" lineClamp={2}>{quote}</Text>}
    <Text fz="var(--font-size-base)" style={{ lineHeight: 1.6 }}>{text}</Text>
  </Stack>
);

const ProposalView: React.FC<{ flowId: string; result: Extract<AssistResult, { kind: 'proposal' }>; t: (key: string) => string; onDismiss: () => void }> = ({
  flowId, result, t, onDismiss,
}) => {
  const { changes } = result;
  const flowLines = [
    changes.name && t('flow.assist.change.name'),
    changes.description && t('flow.assist.change.description'),
    changes.trigger && t('flow.assist.change.trigger'),
    changes.variables && t('flow.assist.change.variables'),
  ].filter((line): line is string => Boolean(line));
  return (
    <Stack gap={8} py={4} data-assist-proposal="">
      <Text fz="var(--font-size-sm)" c="var(--text-muted)" lineClamp={2}>{result.change}</Text>
      <Text fz="var(--font-size-md)" fw={600}>{t('flow.assist.proposal.title')}</Text>
      <Stack gap={2}>
        {changes.steps.map((change) => {
          const label = (
            <Group gap={6} wrap="nowrap" align="baseline">
              <Text fz="var(--font-size-sm)" fw={600} c={CHANGE_COLOR[change.kind]} style={{ flexShrink: 0 }}>{t(CHANGE_KEY[change.kind])}</Text>
              <Text fz="var(--font-size-base)" truncate td={change.kind === 'removed' ? 'line-through' : undefined}>{stepRowLabel(change, t)}</Text>
            </Group>
          );
          // Only a changed step has a card to go to: an added one is not in the draft until the
          // proposal is applied, and applying it replaces this list.
          return change.kind !== 'changed' ? (
            <Box key={`${change.kind}-${change.stepId}`} px={4} py={3}>{label}</Box>
          ) : (
            <UnstyledButton
              key={`${change.kind}-${change.stepId}`}
              px={4}
              py={3}
              style={{ borderRadius: 'var(--mantine-radius-sm)' }}
              onClick={() => locateStep(change.stepId)}
            >
              {label}
            </UnstyledButton>
          );
        })}
        {flowLines.map((line) => (
          <Text key={line} fz="var(--font-size-base)" px={4} py={3}>{line}</Text>
        ))}
      </Stack>
      {changes.steps.some((change) => change.kind === 'changed') && (
        <Text fz="var(--font-size-sm)" c="var(--text-muted)">{t('flow.assist.proposal.hint')}</Text>
      )}
      {result.paused && <Text fz="var(--font-size-base)" c="var(--mantine-color-warning)">{t('flow.assist.proposal.paused')}</Text>}
      {result.issues.length > 0 && (
        <Stack gap={2}>
          {result.issues.map((issue) => (
            <Text key={`${issue.kind}-${issue.step}-${issue.detail}`} fz="var(--font-size-base)" c="var(--mantine-color-warning)">{issueText(issue, t)}</Text>
          ))}
        </Stack>
      )}
      <Group gap={6}>
        <AppButton size="compact-sm" variant="filled" onClick={() => applyProposal(flowId)}>{t('flow.assist.apply')}</AppButton>
        <AppButton size="compact-sm" variant="default" onClick={onDismiss}>{t('flow.assist.discard')}</AppButton>
      </Group>
    </Stack>
  );
};

const QuestionsView: React.FC<{ flowId: string; result: Extract<AssistResult, { kind: 'questions' }>; t: (key: string) => string }> = ({ flowId, result, t }) => {
  const [answers, setAnswers] = useState<string[]>(() => result.questions.map(() => ''));
  const ready = answers.some((answer) => answer.trim());
  return (
    <Stack gap={8} py={4}>
      <Text fz="var(--font-size-sm)" c="var(--text-muted)" lineClamp={2}>{result.change}</Text>
      <Text fz="var(--font-size-md)" fw={600}>{t('flow.assist.questions.title')}</Text>
      {result.questions.map((question, index) => (
        <AppTextarea
          key={question}
          label={question}
          size="sm"
          autosize
          minRows={1}
          maxRows={4}
          value={answers[index] ?? ''}
          onChange={(event) => {
            const value = event.currentTarget.value;
            setAnswers((before) => before.map((answer, at) => (at === index ? value : answer)));
          }}
        />
      ))}
      <Group gap={6}>
        <AppButton
          size="compact-sm"
          variant="filled"
          disabled={!ready}
          onClick={() => { void startEdit(flowId, result.change, result.questions.map((question, index) => ({ question, answer: answers[index] ?? '' }))); }}
        >
          {t('flow.assist.questions.send')}
        </AppButton>
      </Group>
    </Stack>
  );
};

const NamesView: React.FC<{ flowId: string; result: Extract<AssistResult, { kind: 'names' }>; t: (key: string) => string; onDismiss: () => void }> = ({
  flowId, result, t, onDismiss,
}) => {
  const [picked, setPicked] = useState<ReadonlySet<string>>(() => new Set(result.rows.map((row) => row.stepId)));
  const toggle = (id: string): void => setPicked((before) => {
    const next = new Set(before);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });
  return (
    <Stack gap={8} py={4} data-assist-names="">
      <Text fz="var(--font-size-md)" fw={600}>{t('flow.assist.names.title')}</Text>
      <Stack gap={4}>
        {result.rows.map((row) => (
          <Checkbox
            key={row.stepId}
            size="sm"
            checked={picked.has(row.stepId)}
            onChange={() => toggle(row.stepId)}
            label={(
              <Stack gap={0}>
                <Text fz="var(--font-size-base)" fw={500}>{`#${row.index} ${row.name}`}</Text>
                {row.before.trim() && <Text fz="var(--font-size-sm)" c="var(--text-muted)" td="line-through">{row.before}</Text>}
              </Stack>
            )}
          />
        ))}
      </Stack>
      {result.skipped > 0 && <Text fz="var(--font-size-sm)" c="var(--text-muted)">{fillTemplate(t('flow.assist.names.skipped'), { count: String(result.skipped) })}</Text>}
      <Group gap={6}>
        <AppButton size="compact-sm" variant="filled" disabled={picked.size === 0} onClick={() => applyNames(flowId, [...picked])}>{t('flow.assist.apply')}</AppButton>
        <AppButton size="compact-sm" variant="default" onClick={onDismiss}>{t('flow.assist.discard')}</AppButton>
      </Group>
    </Stack>
  );
};
