import React, { useCallback, useState } from 'react';
import { ActionIcon, Badge, Box, Group, Text, Tooltip } from '@mantine/core';
import { Check, Copy, FileText, FolderOpen, Image, Pencil, X } from 'lucide-react';
import type { TurnMeta } from '../../../../shared/conversationDoc';
import { readTurnButtons, readTurnFiles, readTurnMedia, readTurnXPost, revealTargets } from '../../../../shared/conversationDoc';
import { isUntypedBuiltinCommand } from '../../../../shared/imageRequest';
import { isAccountLink, parseXMediaInput } from '../../../../shared/xMedia';
import { TurnMedia } from './TurnMedia';
import { TurnPickTiles } from './TurnPickTiles';
import { PostCardView } from './postCard/PostCardView';
import { readPostCard } from '../../../../shared/postCard';
import type { CaptureFormat, CaptureTurn } from '../../../../shared/types';
import type { TokenUsage } from '../../../../shared/tokenEstimate';
import { useAppStore } from '../../store/appStore';
import { useAgentRunStore, type AgentChoicePick } from '../../store/useAgentRunStore';
import { clipboardApi, fileApi } from '../../api/electronApi';
import { isMac } from '../../utils/keyLabels';
import { AppButton } from '../AppButton';
import { TokenUsageLabel } from './TokenUsageLabel';
import { chatModeLabelKeyForCommand } from '../../config/chatModes';
import { MessageMarkdown } from './MessageMarkdown';
import { TurnTrace } from './TurnTrace';
import { MemoryNotes } from './MemoryNotes';
import { ProviderSwitchNote } from './ProviderSwitchNote';
import { AnswerEditor } from './AnswerEditor';
import { undoAnswerEdit } from './answerEditActions';
import { draftKey, useAnswerEditStore } from '../../store/answerEditStore';
import styles from './AssistantTurn.module.css';
import { READING_TEXT_STYLE } from '../../styles/readingText';
import { TranslationBlock } from './translate/TranslationBlock';
import { TurnTranslateControls } from './translate/TurnTranslateControls';
import { useTurnTranslation } from './translate/useTurnTranslation';
import { translationOnly } from '../../store/translateStore';
import { fillTemplate } from '../../../../shared/fillTemplate';

const CAPTURE_ACTIONS = [
  { format: 'png' as CaptureFormat, labelKey: 'chat.copyAsPng', Icon: Image },
  { format: 'pdf' as CaptureFormat, labelKey: 'chat.copyAsPdf', Icon: FileText },
];

interface AssistantTurnProps {
  response: string;
  meta: TurnMeta;
  formattedTime: string | null;
  t: (key: string) => string;
  turnIndex?: number;
  onCaptureAs?: (format: CaptureFormat, turn: CaptureTurn) => Promise<boolean>;
  /** Answers the agent's waiting question with the picked choice, addressed to the run that asked it. */
  onChoose?: (pick: AgentChoicePick) => void;
  /** The conversation file, when its answers can be edited (not the temporary chat). */
  editPath?: string;
  /** A reply is on its way into this conversation: editing waits for it. */
  editLocked?: boolean;
  turnCount?: number;
  /** When the answer was last edited, formatted; null when it never was. */
  editedLabel?: string | null;
  /** The edit has not reached the model yet: the next question carries it. */
  editUnsent?: boolean;
  /** The conversation file, or the temporary chat's key: where a translation is kept. */
  translatePath?: string;
  /** Sends a flow button's command line (`/ytdl … 720`), as if typed. */
  onTurnButton?: (commandLine: string) => void;
  /** "Analyze" under a forwarded X post (`xp`): the agent reads the post and its replies. */
  onAnalyzeXPost?: (link: string) => void;
}

export const AssistantTurn = React.memo<AssistantTurnProps>(({
  response, meta, formattedTime, t, turnIndex, onCaptureAs, onChoose,
  editPath, editLocked = false, turnCount = 0, editedLabel = null, editUnsent = false, translatePath,
  onTurnButton, onAnalyzeXPost,
}) => {
  const turnButtons = onTurnButton ? readTurnButtons(meta) : [];
  // A menu's items with their pictures (a person's stories) are drawn as those pictures.
  const pictureButtons = turnButtons.filter((button) => button.p);
  const flowButtons = turnButtons.filter((button) => !button.p);
  const xPost = onAnalyzeXPost ? readTurnXPost(meta) : null;
  // A whole account (an Instagram profile) is summed up as an account, not as a post and its replies.
  const xPostInput = xPost ? parseXMediaInput(xPost) : null;
  const xPostIsAccount = xPostInput ? isAccountLink(xPostInput) : false;
  // A forwarded forum article's header, drawn as a card while the answer still opens with it.
  const postCard = readPostCard(meta.pc, response)?.card ?? null;
  const savedFiles = readTurnFiles(meta);
  // What the chat only shows (a post's media, a video's cover) above what was saved for good.
  const shownMedia = [...readTurnMedia(meta), ...savedFiles];
  const translationPath = translatePath ?? editPath ?? '';
  const translation = useTurnTranslation(translationPath, turnIndex ?? -1, meta, response);
  const [translateMenuOpen, setTranslateMenuOpen] = useState(false);
  const editKey = editPath && turnIndex !== undefined ? draftKey(editPath, turnIndex) : null;
  const editable = editKey !== null;
  const editing = useAnswerEditStore((s) => editKey !== null && Boolean(s.drafts[editKey]));
  // Undo stays on offer until the conversation moves on: the next turn has already sent the edit.
  const justSaved = useAnswerEditStore((s) => {
    const saved = s.saved;
    return editable && saved !== null
      && saved.path === editPath && saved.turnIndex === turnIndex && saved.turnCount === turnCount;
  });
  const startEdit = useAnswerEditStore((s) => s.start);
  const dismissSaved = useAnswerEditStore((s) => s.setSaved);
  const [copied, setCopied] = useState(false);
  const [capturing, setCapturing] = useState<CaptureFormat | null>(null);
  const [captured, setCaptured] = useState<CaptureFormat | null>(null);
  const showTokenUsage = useAppStore((state) => state.showTokenUsage);
  // Only the question still waiting is marked: an answered one is just part of the conversation.
  const awaiting = useAgentRunStore((state) => Boolean(meta.r) && state.pendingQuestion?.runId === meta.r);
  const runId = meta.r;
  const choices = awaiting && onChoose && runId ? meta.ch ?? [] : [];

  const editBlockedReason = editLocked
    ? t('chat.edit.lockedSending')
    : awaiting ? t('chat.edit.lockedQuestion')
      // Saved against the answer it was made from: an edit in the meantime would make it a conflict.
      : translation.busy ? t('chat.edit.lockedTranslating') : null;
  const hideOriginal = translationOnly(translation);

  // A pasted link's built-in, or a drawn picture, was not a command anyone typed: no `/…` badge.
  const commandLabel = meta.c && !isUntypedBuiltinCommand(meta.c)
    ? (() => {
      const labelKey = chatModeLabelKeyForCommand(meta.c);
      return labelKey ? t(labelKey) : `/${meta.c}`;
    })()
    : null;

  const usage: TokenUsage | null = (typeof meta.ti === 'number' || typeof meta.to === 'number')
    ? { input: meta.ti ?? 0, output: meta.to ?? 0, exact: meta.tx === 1 }
    : null;

  const handleCopy = useCallback((): void => {
    void clipboardApi.copyText(response).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_600);
    });
  }, [response]);

  const handleCaptureAs = useCallback((format: CaptureFormat): void => {
    if (!onCaptureAs || capturing) return;
    setCapturing(format);
    void onCaptureAs(format, {
      prompt: '',
      response,
      provider: meta.p ?? '',
      timestamp: formattedTime ?? '',
    }).then((ok) => {
      setCapturing(null);
      if (!ok) return;
      setCaptured(format);
      window.setTimeout(() => setCaptured(null), 1_600);
    });
  }, [onCaptureAs, capturing, response, meta.p, formattedTime]);

  return (
    <Box className={styles.turn} data-turn-index={turnIndex}>
      <Group gap={8} mb={6} align="center">
        {meta.p && (
          <Text fz="var(--font-size-sm)" fw={600} c="var(--text-secondary)">
            {meta.p}
          </Text>
        )}
        {formattedTime && (
          <Text fz="var(--font-size-sm)" c="dimmed">
            {formattedTime}
          </Text>
        )}
        {commandLabel && (
          <Badge variant="light" size="sm">
            {commandLabel}
          </Badge>
        )}
        {awaiting && (
          <Badge variant="light" size="sm">
            {t('agent.question.waiting')}
          </Badge>
        )}
        {meta.fb === 1 && (
          <Badge variant="light" size="sm">
            {t('chat.context.degraded')}
          </Badge>
        )}
        {typeof meta.summarized === 'number' && meta.summarized > 0 && (
          <Badge variant="light" size="sm">
            {fillTemplate(t('chat.context.summarized'), { count: String(meta.summarized) })}
          </Badge>
        )}
        {typeof meta.dropped === 'number' && meta.dropped > 0 && (
          <Badge variant="light" size="sm">
            {fillTemplate(t('chat.context.dropped'), { count: String(meta.dropped) })}
          </Badge>
        )}
        {editedLabel && (
          <Tooltip
            multiline
            maw={300}
            position="bottom"
            label={(
              <>
                <Text fz="inherit">{fillTemplate(t('chat.edit.badgeTooltip'), { time: editedLabel })}</Text>
                <Text fz="inherit">{editUnsent ? t('chat.edit.badgeUnsent') : t('chat.edit.badgeSent')}</Text>
              </>
            )}
          >
            <Badge variant="light" size="sm" leftSection={<Pencil size={10} />}>
              {t('chat.edit.badge')}
            </Badge>
          </Tooltip>
        )}
        {usage && showTokenUsage && (
          <TokenUsageLabel usage={usage} labelKey="chat.tokens.label" t={t} />
        )}
      </Group>
      <ProviderSwitchNote meta={meta} t={t} />

      {editing && editPath && turnIndex !== undefined ? (
        <AnswerEditor
          path={editPath}
          turnIndex={turnIndex}
          response={response}
          turnCount={turnCount}
          editedAt={typeof meta.ed === 'string' ? meta.ed : null}
          locked={editLocked}
          t={t}
        />
      ) : (
        <>
        {postCard && !hideOriginal && <PostCardView card={postCard} t={t} />}
        <Box
          className="md-content md-response"
          data-find-scope
          // The card stands for the answer's opening block, which stays on the page (hidden) so a
          // selection still maps onto the Markdown.
          data-post-card={postCard ? '' : undefined}
          // "Translation only" hides the answer rather than swapping its text: selection and find map onto it.
          display={hideOriginal ? 'none' : undefined}
          style={{ ...READING_TEXT_STYLE, lineHeight: 1.75, color: 'var(--text-primary)' }}
        >
          <MessageMarkdown>{response}</MessageMarkdown>
        </Box>
        </>
      )}
      {/* Where a rewrite's result card goes when the block it belongs under is no longer on the page. */}
      {!editing && turnIndex !== undefined && <Box data-rewrite-slot={turnIndex} />}
      {!editing && turnIndex !== undefined && (
        <TranslationBlock
          path={translationPath}
          turnIndex={turnIndex}
          response={response}
          translation={translation.translation}
          outdated={translation.outdated}
          job={translation.job}
          view={translation.view}
          t={t}
        />
      )}

      {/* Not while a reply is on its way: that send already carries the edit, so an undo would leave the AI on the edited text. */}
      {/* Nor while it is being translated: the translation is saved against the answer it started from. */}
      {justSaved && !editing && !editLocked && !translation.busy && (
        <Group gap={6} mt={8}>
          <Check size={14} color="var(--mantine-color-success)" />
          <Text fz="var(--font-size-sm)" c="var(--text-secondary)">{t('chat.edit.saved')}</Text>
          <AppButton size="compact-xs" variant="subtle" onClick={() => { void undoAnswerEdit(response); }}>
            {t('chat.edit.undo')}
          </AppButton>
          <ActionIcon
            variant="subtle"
            size="sm"
            c="dimmed"
            aria-label={t('chat.edit.dismissSaved')}
            onClick={() => dismissSaved(null)}
          >
            <X size={12} />
          </ActionIcon>
        </Group>
      )}

      {meta.mem && <MemoryNotes raw={meta.mem} t={t} />}

      {choices.length > 0 && (
        <Group gap={6} mt={10} wrap="wrap">
          {choices.map((choice) => (
            <AppButton
              key={choice}
              variant="light"
              size="compact-sm"
              h="auto"
              py={4}
              styles={{ label: { whiteSpace: 'normal', textAlign: 'left', lineHeight: 1.5 } }}
              onClick={() => { if (runId) onChoose?.({ runId, text: choice }); }}
            >
              {choice}
            </AppButton>
          ))}
        </Group>
      )}

      {shownMedia.length > 0 && <TurnMedia files={shownMedia} />}

      {pictureButtons.length > 0 && onTurnButton && <TurnPickTiles buttons={pictureButtons} onPress={onTurnButton} />}

      {(flowButtons.length > 0 || xPost) && (
        <Group gap={6} mt={10} wrap="wrap">
          {flowButtons.map((button) => (
            <AppButton
              key={button.i}
              variant="light"
              size="compact-sm"
              h="auto"
              py={4}
              styles={{ label: { whiteSpace: 'normal', textAlign: 'left', lineHeight: 1.5 } }}
              onClick={() => onTurnButton?.(button.i)}
            >
              {button.l}
            </AppButton>
          ))}
          {xPost && (
            <AppButton variant="light" size="compact-sm" onClick={() => onAnalyzeXPost?.(xPost)}>
              {t(xPostIsAccount ? 'x.analyze.account' : 'x.analyze.button')}
            </AppButton>
          )}
        </Group>
      )}

      {savedFiles.length > 0 && (
        <Group gap={6} mt={10} wrap="wrap">
          {revealTargets(savedFiles).map((file) => (
            <AppButton
              key={file}
              variant="light"
              size="compact-sm"
              leftSection={<FolderOpen size={14} />}
              onClick={() => { void fileApi.showInFolder(file); }}
            >
              {t(isMac ? 'context.showInFolder.mac' : 'context.showInFolder')}
            </AppButton>
          ))}
        </Group>
      )}

      {meta.r && <TurnTrace runId={meta.r} t={t} />}

      {!editing && (
      <Group
        gap={4}
        mt={6}
        className={styles.actions}
        data-copied={copied || capturing !== null || captured !== null || translateMenuOpen || undefined}
      >
        <Tooltip label={copied ? t('chat.copied') : t('chat.copy')} position="bottom">
          <ActionIcon
            variant="subtle"
            size="sm"
            c="dimmed"
            aria-label={t('chat.copy')}
            onClick={handleCopy}
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
          </ActionIcon>
        </Tooltip>
        {editable && (
          <Tooltip label={editBlockedReason ?? t('chat.edit.action')} position="bottom">
            <ActionIcon
              variant="subtle"
              size="sm"
              c="dimmed"
              aria-label={t('chat.edit.action')}
              // data-disabled, not disabled: a disabled button gets no pointer events, so the tooltip saying why would never show.
              data-disabled={editBlockedReason !== null || undefined}
              onClick={() => {
                if (editBlockedReason === null && editPath && turnIndex !== undefined) startEdit(editPath, turnIndex, response);
              }}
            >
              <Pencil size={14} />
            </ActionIcon>
          </Tooltip>
        )}
        {turnIndex !== undefined && response.trim() && (
          <TurnTranslateControls
            path={translationPath}
            turnIndex={turnIndex}
            response={response}
            command={meta.c}
            translated={translation.translation !== null && !translation.outdated}
            busy={translation.busy}
            onMenuOpenChange={setTranslateMenuOpen}
            t={t}
          />
        )}
        {onCaptureAs && CAPTURE_ACTIONS.map(({ format, labelKey, Icon }) => (
          <Tooltip key={format} label={captured === format ? t('chat.copied') : t(labelKey)} position="bottom">
            <ActionIcon
              variant="subtle"
              size="sm"
              c="dimmed"
              aria-label={t(labelKey)}
              disabled={capturing !== null}
              loading={capturing === format}
              onClick={() => handleCaptureAs(format)}
            >
              {captured === format ? <Check size={14} /> : <Icon size={14} />}
            </ActionIcon>
          </Tooltip>
        ))}
      </Group>
      )}
    </Box>
  );
});
