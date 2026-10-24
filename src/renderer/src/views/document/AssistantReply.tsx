import React, { useState } from 'react';
import { ActionIcon, Badge, Box, Group, Stack, Text, Tooltip } from '@mantine/core';
import { Check, ChevronDown, ChevronRight, Copy, Undo2, X } from 'lucide-react';
import { dedentPair } from '../../../../shared/docAssistant';
import { clipboardApi } from '../../api/electronApi';
import { AppButton } from '../../components/AppButton';
import { MessageMarkdown } from '../../components/chat/MessageMarkdown';
import { RenderedDiff } from '../../components/chat/RenderedDiff';
import type { AssistantEditCard, AssistantMessage } from '../../store/docAssistantStore';
import { fillTemplate } from '../../../../shared/fillTemplate';

interface AssistantReplyProps {
  message: AssistantMessage;
  /** Why an edit cannot go in or come out right now (the editor is open, a sync is running); null when it can. */
  applyBlocked: string | null;
  /** Answering is possible: no request is out. */
  canAnswer: boolean;
  onApply: (editIds: string[]) => void;
  onSkip: (editIds: string[]) => void;
  onRevert: (editIds: string[]) => void;
  /** The pointer is on an edit's row (null: it left), to mark its place on the page. */
  onHover: (edit: AssistantEditCard | null) => void;
  onReveal: (edit: AssistantEditCard) => void;
  onAnswer: (answer: string) => void;
  t: (key: string) => string;
}

const STATE_BADGE: Record<Exclude<AssistantEditCard['state'], 'pending' | 'applied'>, string> = {
  skipped: 'notion.assistant.edit.skipped',
  reverted: 'notion.assistant.edit.reverted',
  stale: 'notion.assistant.edit.stale',
};

/** A button that says why it does nothing right now, instead of going grey without a word. */
const BlockedButton: React.FC<React.ComponentProps<typeof AppButton> & { blocked: string | null; onPress: () => void }> = ({
  blocked, onPress, ...props
}) => (
  <Tooltip label={blocked ?? ''} disabled={!blocked} position="bottom" multiline maw={260}>
    <AppButton
      {...props}
      // data-disabled keeps the tooltip reachable; a disabled button gets no pointer events.
      data-disabled={blocked !== null || undefined}
      aria-disabled={blocked !== null || undefined}
      onClick={(event) => {
        event.stopPropagation();
        if (!blocked) onPress();
      }}
    />
  </Tooltip>
);

/**
 * One edit as a row: where it is, and what came of it. The pointer on the row marks its place on
 * the page; a click goes there. The before/after opens below it — at once for an edit still
 * waiting to go in, which the user has to judge from it.
 */
const EditRow: React.FC<{
  edit: AssistantEditCard;
  applyBlocked: string | null;
  onApply: () => void;
  onSkip: () => void;
  onRevert: () => void;
  onHover: (edit: AssistantEditCard | null) => void;
  onReveal: () => void;
  t: (key: string) => string;
}> = ({ edit, applyBlocked, onApply, onSkip, onRevert, onHover, onReveal, t }) => {
  const pending = edit.state === 'pending';
  // Follows the state until the user opens or closes it: a row mounts pending and goes in a moment later.
  const [toggled, setOpen] = useState<boolean | null>(null);
  const open = toggled ?? pending;
  const [before, after] = dedentPair(edit.before, edit.after);
  const settled = edit.state !== 'pending' && edit.state !== 'applied';
  const where = edit.heading ? fillTemplate(t('notion.sync.under'), { heading: edit.heading }) : t('notion.sync.top');
  return (
    <Box
      className="yobi-assistant-edit"
      px={10}
      py={7}
      // Border, background and hover in globals.css (.yobi-assistant-edit): an inline background would beat :hover.
      style={{ cursor: 'pointer', opacity: settled ? 0.65 : 1 }}
      onMouseEnter={() => onHover(edit)}
      onMouseLeave={() => onHover(null)}
      onClick={onReveal}
    >
      <Group gap={6} wrap="nowrap">
        <ActionIcon
          variant="subtle"
          size="xs"
          c="dimmed"
          aria-label={open ? t('notion.assistant.edit.hideDiff') : t('notion.assistant.edit.showDiff')}
          aria-expanded={open}
          onClick={(event) => {
            event.stopPropagation();
            setOpen(!open);
          }}
        >
          {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </ActionIcon>
        <Text fz="var(--font-size-xs)" c="var(--text-secondary)" truncate style={{ flex: 1, minWidth: 0 }}>{where}</Text>
        {settled && (
          <Badge variant="light" size="sm" color={edit.state === 'stale' ? 'var(--mantine-color-warning)' : undefined} style={{ flexShrink: 0 }}>
            {t(STATE_BADGE[edit.state as keyof typeof STATE_BADGE])}
          </Badge>
        )}
        {edit.state === 'applied' && (
          <Tooltip label={applyBlocked ?? t('notion.assistant.edit.revert')} position="bottom" multiline maw={260}>
            <ActionIcon
              variant="subtle"
              size="sm"
              c="dimmed"
              aria-label={t('notion.assistant.edit.revert')}
              data-disabled={applyBlocked !== null || undefined}
              aria-disabled={applyBlocked !== null || undefined}
              onClick={(event) => {
                event.stopPropagation();
                if (!applyBlocked) onRevert();
              }}
            >
              <Undo2 size={14} />
            </ActionIcon>
          </Tooltip>
        )}
      </Group>
      {open && (
        <Box mt={8} onClick={(event) => event.stopPropagation()} style={{ cursor: 'auto' }}>
          <RenderedDiff
            before={before}
            after={after}
            beforeLabel={t('notion.assistant.edit.before')}
            afterLabel={before ? t('notion.sync.after') : t('notion.sync.added')}
            srRemoved={t('history.diff.removed')}
            srAdded={t('history.diff.added')}
          />
          {!edit.after.trim() && <Text fz="var(--font-size-xs)" c="var(--text-muted)" pl={50} mt={4}>{t('notion.assistant.edit.removes')}</Text>}
        </Box>
      )}
      {pending && (
        <Group justify="flex-end" gap={6} mt={8}>
          <AppButton size="compact-sm" variant="subtle" leftSection={<X size={13} />} onClick={(event) => { event.stopPropagation(); onSkip(); }}>
            {t('notion.assistant.edit.skip')}
          </AppButton>
          <BlockedButton size="compact-sm" variant="light" leftSection={<Check size={13} />} blocked={applyBlocked} onPress={onApply}>
            {t('notion.assistant.edit.apply')}
          </BlockedButton>
        </Group>
      )}
    </Box>
  );
};

/**
 * One reply of the document assistant: its message, then either its question (with answers to
 * pick) or the edits it made, already in the document, each one a row to find it by or undo it.
 * Edits that waited (the editor was open) are applied from here. Places it named but that are
 * nowhere in the document are listed apart, to copy.
 */
export const AssistantReply: React.FC<AssistantReplyProps> = ({
  message, applyBlocked, canAnswer, onApply, onSkip, onRevert, onHover, onReveal, onAnswer, t,
}) => {
  const edits = message.edits ?? [];
  const pending = edits.filter((edit) => edit.state === 'pending').map((edit) => edit.id);
  const applied = edits.filter((edit) => edit.state === 'applied').map((edit) => edit.id);
  const unplaced = message.unplaced ?? [];
  return (
    <Stack gap={10}>
      {message.text && (
        <Box className="md-content" fz="var(--font-size-sm)" style={{ lineHeight: 1.65, color: 'var(--text-primary)' }}>
          <MessageMarkdown>{message.text}</MessageMarkdown>
        </Box>
      )}
      {message.ask && (
        <Stack gap={6}>
          <Text fz="var(--font-size-sm)" fw={600}>{message.ask.question}</Text>
          {message.ask.options.length > 0 && (
            <Stack gap={6} align="flex-start">
              {message.ask.options.map((option) => (
                <AppButton
                  key={option}
                  size="compact-sm"
                  variant="default"
                  disabled={!canAnswer}
                  onClick={() => onAnswer(option)}
                  h="auto"
                  py={5}
                  maw="100%"
                  // An answer is a sentence at times: it wraps instead of being cut off.
                  styles={{ label: { whiteSpace: 'normal', textAlign: 'left', lineHeight: 1.45 } }}
                >
                  {option}
                </AppButton>
              ))}
            </Stack>
          )}
        </Stack>
      )}
      {edits.length > 0 && (
        <Stack gap={6}>
          <Group justify="space-between" gap={6} wrap="nowrap">
            <Text fz="var(--font-size-xs)" fw={600} c="var(--text-muted)">
              {fillTemplate(t(pending.length === edits.length ? 'notion.assistant.edits.count' : 'notion.assistant.edits.made'), { count: String(edits.length) })}
            </Text>
            <Group gap={4} wrap="nowrap">
              {applied.length > 1 && (
                <BlockedButton size="compact-sm" variant="subtle" leftSection={<Undo2 size={13} />} blocked={applyBlocked} onPress={() => onRevert(applied)}>
                  {t('notion.assistant.edits.revertAll')}
                </BlockedButton>
              )}
              {pending.length > 1 && (
                <>
                  <AppButton size="compact-sm" variant="subtle" onClick={() => onSkip(pending)}>
                    {t('notion.assistant.edits.skipAll')}
                  </AppButton>
                  <BlockedButton size="compact-sm" leftSection={<Check size={13} />} blocked={applyBlocked} onPress={() => onApply(pending)}>
                    {fillTemplate(t('notion.assistant.edits.applyAll'), { count: String(pending.length) })}
                  </BlockedButton>
                </>
              )}
            </Group>
          </Group>
          {edits.map((edit) => (
            <EditRow
              key={edit.id}
              edit={edit}
              applyBlocked={applyBlocked}
              onApply={() => onApply([edit.id])}
              onSkip={() => onSkip([edit.id])}
              onRevert={() => onRevert([edit.id])}
              onHover={onHover}
              onReveal={() => onReveal(edit)}
              t={t}
            />
          ))}
        </Stack>
      )}
      {unplaced.length > 0 && (
        <Stack gap={6}>
          <Text fz="var(--font-size-xs)" fw={600} c="var(--mantine-color-warning)">
            {fillTemplate(t('notion.assistant.unplaced.title'), { count: String(unplaced.length) })}
          </Text>
          <Text fz="var(--font-size-xs)" c="var(--text-muted)">{t('notion.assistant.unplaced.hint')}</Text>
          {unplaced.map((edit, index) => (
            <Group key={`${index}:${edit.find.slice(0, 20)}`} gap={6} wrap="nowrap" align="flex-start">
              <Text fz="var(--font-size-xs)" c="var(--text-secondary)" lineClamp={3} style={{ flex: 1, minWidth: 0, whiteSpace: 'pre-wrap' }}>
                {edit.replace || edit.find}
              </Text>
              <Tooltip label={t('notion.assistant.unplaced.copy')} position="bottom">
                <ActionIcon
                  variant="subtle"
                  size="sm"
                  c="dimmed"
                  aria-label={t('notion.assistant.unplaced.copy')}
                  onClick={() => { void clipboardApi.copyText(edit.replace); }}
                >
                  <Copy size={13} />
                </ActionIcon>
              </Tooltip>
            </Group>
          ))}
        </Stack>
      )}
    </Stack>
  );
};
