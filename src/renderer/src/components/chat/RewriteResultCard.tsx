import React, { useMemo, useState } from 'react';
import { ActionIcon, Box, Group, Loader, Stack, Text, Tooltip } from '@mantine/core';
import { Check, Copy, Quote, RotateCcw, Sparkles, TriangleAlert, X } from 'lucide-react';
import { AppButton } from '../AppButton';
import { MessageMarkdown } from './MessageMarkdown';
import { findModelOption } from '../../config/models';
import { useProviderModels } from '../../hooks/useProviderModels';
import { useAppStore } from '../../store/appStore';
import { draftKey, useAnswerEditStore } from '../../store/answerEditStore';
import { useAgentRunStore } from '../../store/useAgentRunStore';
import { translateBusy, turnKey, useTranslateStore } from '../../store/translateStore';
import { isReshape } from '../../../../shared/writingTools';
import type { RewriteJob } from '../../store/writingToolsStore';
import { diffText } from '../../utils/textDiff';
import { READING_TEXT_STYLE } from '../../styles/readingText';
import { touchesLockedBlock } from '../../utils/notionEditorBlocks';
import { DiffLine } from './DiffLine';
import { rewriteBusy, useWritingToolsStore } from '../../store/writingToolsStore';
import {
  cancelRewrite, copyRewrite, discardRewrite, putBlockReason, putRewrite, quoteRewrite, retryRewrite,
  type PutMode,
} from './writingToolsActions';

interface RewriteResultCardProps {
  job: RewriteJob;
  t: (key: string) => string;
}

const INSTRUCTION_LABEL_MAX = 40;

function titleFor(job: RewriteJob, t: (key: string) => string): string {
  if (job.action !== 'custom') return t(`chat.writing.action.${job.action}`);
  const text = job.instruction.replace(/\s+/g, ' ');
  return text.length > INSTRUCTION_LABEL_MAX ? `${text.slice(0, INSTRUCTION_LABEL_MAX)}…` : text;
}

/**
 * A rewrite's result, under the passage it reworks. Nothing changes until "replace" or "insert
 * below" is pressed; until then the result can be copied, quoted into the composer, retried or
 * dropped.
 */
export const RewriteResultCard: React.FC<RewriteResultCardProps> = ({ job, t }) => {
  const { extraModels } = useProviderModels(job.providerUrl);
  const pending = useAppStore((s) => s.pendingTurns[job.target.path]?.length ?? 0);
  const draftOpen = useAnswerEditStore((s) => Boolean(s.drafts[draftKey(job.target.path, job.target.turnIndex)]));
  const hasQuote = useWritingToolsStore((s) => s.quote !== null);
  const turnRun = useAppStore((s) => (
    s.selectedFile?.path === job.target.path ? s.conversation?.turns[job.target.turnIndex]?.meta.r : undefined
  ));
  const awaiting = useAgentRunStore((s) => Boolean(turnRun) && s.pendingQuestion?.runId === turnRun);
  const translating = useTranslateStore((s) => translateBusy(s.jobs[turnKey(job.target.path, job.target.turnIndex)]));
  const notionDoc = useAppStore((s) => s.selectedFile?.path === job.target.path && s.selectedFile.notion === true);
  // A table or child page in a Notion document is edited in Notion; replacing into it is not offered.
  const locked = useMemo(() => {
    const { target } = job;
    if (!notionDoc) return false;
    if (target.kind === 'file') return target.range ? touchesLockedBlock(target.response, target.range) : false;
    return touchesLockedBlock(target.original, target.range);
  }, [notionDoc, job]);
  const [copied, setCopied] = useState(false);
  const [putting, setPutting] = useState<PutMode | null>(null);

  const busy = rewriteBusy(job);
  // A passage that goes back in place is shown against the original, so a change of meaning shows;
  // a summary, list or table is a new block and is shown as it will read.
  const diff = useMemo(
    () => (job.status === 'done' && job.result && !isReshape(job.action) ? diffText(job.text.trim(), job.result.trim()) : null),
    [job.status, job.result, job.action, job.text],
  );
  const unchanged = diff !== null && diff.every((part) => part.kind === 'same');
  const blockReason = (mode: PutMode): string | null => {
    const reason = putBlockReason(job.target, mode, {
      pending,
      draftOpen: job.target.kind === 'file' && draftOpen,
      awaiting,
      translating: job.target.kind === 'file' && translating,
      result: job.result,
      locked,
    });
    return reason ? t(`chat.rewrite.blocked.${reason}`) : null;
  };
  const replaceBlocked = blockReason('replace');
  const insertBlocked = blockReason('insertBelow');
  const put = (mode: PutMode): void => {
    if (putting) return;
    setPutting(mode);
    void putRewrite(mode).finally(() => setPutting(null));
  };
  const copy = (): void => {
    void copyRewrite().then((ok) => {
      if (!ok) return;
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_600);
    });
  };

  const putButton = (mode: PutMode, label: string, blocked: string | null, primary: boolean): React.ReactNode => (
    <Tooltip label={blocked ?? label} disabled={!blocked} position="bottom" multiline maw={260}>
      <AppButton
        size="compact-sm"
        variant={primary ? 'light' : 'default'}
        loading={putting === mode}
        // data-disabled keeps pointer events, so the tooltip saying why can still show.
        data-disabled={blocked !== null || undefined}
        onClick={() => { if (!blocked) put(mode); }}
      >
        {label}
      </AppButton>
    </Tooltip>
  );

  const iconButton = (label: string, Icon: typeof Copy, onClick: () => void): React.ReactNode => (
    <Tooltip label={label} position="bottom">
      <ActionIcon variant="subtle" size="sm" c="dimmed" aria-label={label} onClick={onClick}>
        <Icon size={14} />
      </ActionIcon>
    </Tooltip>
  );

  return (
    <Box
      data-find-omit
      data-selection-ignore
      my={10}
      style={{
        border: '1px solid var(--border)',
        borderRadius: 'var(--mantine-radius-md)',
        background: 'var(--bg-secondary)',
        fontSize: 'var(--font-size-md)',
      }}
    >
      <Group justify="space-between" wrap="nowrap" gap={8} px={12} pt={10}>
        <Group gap={6} wrap="nowrap" style={{ minWidth: 0 }}>
          <Sparkles size={14} color="var(--accent)" style={{ flexShrink: 0 }} />
          <Text component="div" fz="var(--font-size-sm)" fw={600} c="var(--text-secondary)" truncate>{titleFor(job, t)}</Text>
        </Group>
        <Tooltip label={t('chat.rewrite.providerHint')} position="bottom" multiline maw={280}>
          <Text component="div" fz="var(--font-size-xs)" c="var(--text-muted)" style={{ flexShrink: 0 }}>
            {findModelOption(job.providerUrl, extraModels).label}
          </Text>
        </Tooltip>
      </Group>

      <Box px={12} py={8}>
        {busy && (
          <Group gap={8} wrap="nowrap">
            <Loader size={14} />
            <Text component="div" fz="var(--font-size-sm)" c="var(--text-secondary)" style={{ flex: 1 }}>
              {t(`chat.rewrite.${job.status}`)}
            </Text>
            <AppButton size="compact-sm" variant="default" onClick={cancelRewrite}>{t('chat.rewrite.cancel')}</AppButton>
          </Group>
        )}

        {job.status === 'error' && (
          <Group gap={8} wrap="nowrap" align="flex-start">
            <Box c="var(--mantine-color-error)" style={{ lineHeight: 0, paddingTop: 2 }}><TriangleAlert size={14} /></Box>
            <Text component="div" fz="var(--font-size-sm)" c="var(--mantine-color-error)" style={{ flex: 1 }}>{job.error}</Text>
          </Group>
        )}

        {job.status === 'done' && unchanged && (
          <Group gap={8} wrap="nowrap">
            <Box c="var(--mantine-color-success)" style={{ lineHeight: 0 }}><Check size={14} /></Box>
            <Text component="div" fz="var(--font-size-sm)" c="var(--text-secondary)">{t('chat.rewrite.unchanged')}</Text>
          </Group>
        )}

        {job.status === 'done' && diff && !unchanged && (
          <Stack gap={6}>
            <DiffLine label={t('chat.rewrite.diff.before')} parts={diff} side="removed" />
            <DiffLine label={t('chat.rewrite.diff.after')} parts={diff} side="added" />
          </Stack>
        )}

        {job.status === 'done' && !diff && (
          <Box
            className="md-content"
            style={{ ...READING_TEXT_STYLE, lineHeight: 1.75, color: 'var(--text-primary)' }}
          >
            <MessageMarkdown>{job.result}</MessageMarkdown>
          </Box>
        )}

        {job.status === 'done' && job.error && (
          <Text component="div" fz="var(--font-size-sm)" c="var(--mantine-color-error)" mt={4}>{job.error}</Text>
        )}
      </Box>

      {!busy && (
        <Group gap={6} px={12} pb={10} wrap="wrap">
          {job.status === 'done' && !unchanged && (
            <>
              {putButton('replace', t('chat.rewrite.replace'), replaceBlocked, true)}
              {putButton('insertBelow', t('chat.rewrite.insertBelow'), insertBlocked, false)}
              <Box w={1} h={18} bg="var(--border)" mx={2} />
              <Tooltip label={copied ? t('chat.copied') : t('chat.rewrite.copy')} position="bottom">
                <ActionIcon variant="subtle" size="sm" c="dimmed" aria-label={t('chat.rewrite.copy')} onClick={copy}>
                  {copied ? <Check size={14} /> : <Copy size={14} />}
                </ActionIcon>
              </Tooltip>
              {hasQuote && iconButton(t('chat.rewrite.quote'), Quote, quoteRewrite)}
            </>
          )}
          {iconButton(t('chat.rewrite.retry'), RotateCcw, retryRewrite)}
          {iconButton(t('chat.rewrite.discard'), X, discardRewrite)}
        </Group>
      )}
    </Box>
  );
};
