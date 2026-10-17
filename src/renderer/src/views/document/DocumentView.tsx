import React, { useCallback, useMemo, useState } from 'react';
import { Alert, Box, Flex, Group, Menu as MMenu, Stack, Tooltip } from '@mantine/core';
import { CloudUpload, ExternalLink, Info, Pencil, RefreshCw, Sparkles } from 'lucide-react';
import type { ConversationDoc } from '../../../../shared/conversationDoc';
import { notionBlockRanges } from '../../../../shared/notion/notionBlocks';
import type { NotionConflictView } from '../../../../shared/notion/notionSyncTypes';
import { clipboardApi } from '../../api/electronApi';
import { AppButton } from '../../components/AppButton';
import { AnswerEditor } from '../../components/chat/AnswerEditor';
import { ChatHeaderRow } from '../../components/chat/ChatHeaderRow';
import { ConversationFindBar } from '../../components/chat/ConversationFindBar';
import { HeaderTitleField, type HeaderTitleEditProps } from '../../components/chat/HeaderTitleField';
import { MessageMarkdown } from '../../components/chat/MessageMarkdown';
import { HeaderMenuDropdown } from '../../components/chat/headerMenu/HeaderMenuDropdown';
import { HeaderMoreMenu } from '../../components/chat/headerMenu/HeaderMoreMenu';
import { NotionIcon } from '../../config/brandIcons';
import { draftKey, useAnswerEditStore } from '../../store/answerEditStore';
import { useAppStore } from '../../store/appStore';
import { useDocAssistantStore } from '../../store/docAssistantStore';
import { readingMaxWidth, useReadingStore } from '../../store/readingStore';
import { READING_TEXT_STYLE } from '../../styles/readingText';
import { ConflictCard } from './ConflictCard';
import { DocAssistantPanel } from './DocAssistantPanel';
import { DocumentChangeMarks } from './DocumentChangeMarks';
import { sendableChanges, sendCount, syncLine } from './documentSync';
import { SyncStatusLabel } from './SyncStatusLabel';
import { useNotionDoc } from './useNotionDoc';

/** The same reading column as a conversation's answers. */
const MAX_WIDTH = 720;

interface DocumentViewProps {
  path: string;
  content: string;
  /** The document as one answer (`notionConversation`): what the editor and the rewrite tools work on. */
  conversation: ConversationDoc;
  /** The chat's scroll area: the selection bar and Ctrl+F work on what this view puts in it. */
  contentAreaRef: React.RefObject<HTMLDivElement | null>;
  titleEdit: HeaderTitleEditProps;
  onOpenHistory: () => void;
  /** Export ▸ in ⋮: the same dialogs as a conversation's, which show the page as it reads. */
  captureBusy: boolean;
  onOpenCaptureDialog: () => void;
  onOpenShareDialog: () => void;
  t: (key: string) => string;
}

/**
 * A Notion page kept in Yobi: read it, edit it with the answer tools or the writing assistant, and
 * see — before anything is sent — where it differs from Notion: the document marks each change in
 * its margin, with Notion's text a hover away, and the header's one button sends them. Takes the
 * conversation's place beside the sidebar; there is no composer.
 */
export const DocumentView: React.FC<DocumentViewProps> = ({
  path, content, conversation, contentAreaRef, titleEdit, onOpenHistory, captureBusy, onOpenCaptureDialog, onOpenShareDialog, t,
}) => {
  const body = conversation.turns[0]?.response ?? '';
  const url = conversation.thread.notion?.url ?? '';
  const editing = useAnswerEditStore((s) => Boolean(s.drafts[draftKey(path, 0)]));
  const startEdit = useAnswerEditStore((s) => s.start);
  const fullWidth = useReadingStore((state) => state.prefs.fullWidth);
  const markdownZoom = useAppStore((state) => state.markdownZoom);
  const sync = useNotionDoc(path, content, editing);
  const assistantOpen = useDocAssistantStore((s) => s.open);
  const setAssistantOpen = useDocAssistantStore((s) => s.setOpen);
  const [menuOpen, setMenuOpen] = useState(false);
  const [editActionsSlot, setEditActionsSlot] = useState<HTMLDivElement | null>(null);
  const line = useMemo(() => syncLine(sync.status, sync.busy), [sync.status, sync.busy]);
  // The same reading zoom as a conversation (Ctrl+= / Ctrl+-).
  const zoomStyle = markdownZoom === 100 ? undefined : { zoom: markdownZoom / 100 };

  // The conflict's own block (by place: the same text may sit elsewhere on the page too).
  const editConflict = useCallback((conflict: NotionConflictView): void => {
    const at = notionBlockRanges(body)[conflict.localAt]?.start;
    startEdit(path, 0, body, at);
  }, [body, path, startEdit]);

  // Refreshing is the document's own row, first in the shared menu.
  const { pull } = sync;
  const pullAction = useMemo(() => ({
    label: t('notion.menu.pull'),
    node: (
      <MMenu.Item
        leftSection={<RefreshCw size={14} />}
        disabled={sync.busy || editing}
        onClick={() => { setMenuOpen(false); pull(); }}
      >
        {t('notion.menu.pull')}
      </MMenu.Item>
    ),
  }), [t, sync.busy, pull, editing]);

  const applyBlocked = editing ? t('notion.assistant.blocked.editing') : sync.busy ? t('notion.assistant.blocked.busy') : null;

  // One button sends every change that can go; the document itself, marked, is what it sends.
  const toSend = sendCount(sync.status);
  const asking = useDocAssistantStore((s) => Boolean(s.threads[path]?.job));
  const syncBlocked = editing ? t('notion.sync.editingReason') : asking ? t('notion.sync.assistantReason') : null;
  const { push } = sync;
  const pushAll = useCallback((): void => {
    const status = sync.status;
    if (!status) return;
    push(sendableChanges(status).map((change) => change.id), status.titleChange?.to ?? null);
  }, [push, sync.status]);

  return (
    <Flex flex={1} miw={0} bg="var(--mantine-color-body)" style={{ overflow: 'hidden' }}>
    <Stack gap={0} flex={1} miw={0} pos="relative" style={{ overflow: 'hidden' }}>
      <ChatHeaderRow>
        <HeaderTitleField {...titleEdit} t={t} icon={NotionIcon} extra={<SyncStatusLabel line={line} t={t} />} />
        {/* The document's two actions sit in the header, where they are at hand wherever the page is scrolled to. */}
        <Group gap={6} wrap="nowrap" ml="auto" style={{ flexShrink: 0 }}>
          {url && (
            <AppButton size="compact-sm" variant="subtle" leftSection={<ExternalLink size={13} />} onClick={() => { void clipboardApi.openExternalUrl(url); }}>
              {t('notion.menu.open')}
            </AppButton>
          )}
          {toSend > 0 && (
            <Tooltip label={syncBlocked ?? ''} disabled={!syncBlocked} position="bottom" multiline maw={260}>
              <AppButton
                size="compact-sm"
                variant="light"
                leftSection={<CloudUpload size={13} />}
                loading={sync.busy}
                // data-disabled keeps the tooltip saying why reachable; a disabled button gets no pointer events.
                data-disabled={syncBlocked !== null || undefined}
                aria-disabled={syncBlocked !== null || undefined}
                onClick={() => { if (!syncBlocked && !sync.busy) pushAll(); }}
              >
                {t('notion.sync.push').replace('{{count}}', String(toSend))}
              </AppButton>
            </Tooltip>
          )}
          {/* While editing, the editor puts its Cancel and Save here (AnswerEditor's actionsTarget). */}
          <Box ref={setEditActionsSlot} display={editing ? 'flex' : 'none'} />
          {!editing && (
            <AppButton size="compact-sm" variant="default" leftSection={<Pencil size={13} />} onClick={() => startEdit(path, 0, body)}>
              {t('notion.edit.action')}
            </AppButton>
          )}
          {!assistantOpen && (
            <AppButton size="compact-sm" variant="subtle" leftSection={<Sparkles size={13} />} onClick={() => setAssistantOpen(true)}>
              {t('notion.assistant.open')}
            </AppButton>
          )}
          {/* The conversation's own ⋮, minus "ask another model": a page has no question to re-ask. */}
          <HeaderMoreMenu opened={menuOpen} onToggle={() => setMenuOpen((open) => !open)} onClose={() => setMenuOpen(false)} t={t}>
            <HeaderMenuDropdown
              t={t}
              filePath={path}
              fileContent={content}
              conversation={conversation}
              captureBusy={captureBusy}
              onOpenCaptureDialog={onOpenCaptureDialog}
              onOpenShareDialog={onOpenShareDialog}
              leadingAction={pullAction}
              showLayout={false}
              onOpenHistory={onOpenHistory}
              onClose={() => setMenuOpen(false)}
            />
          </HeaderMoreMenu>
        </Group>
      </ChatHeaderRow>

      <Box ref={contentAreaRef} flex={1} style={{ overflowY: 'auto' }}>
        <ConversationFindBar containerRef={contentAreaRef} resetKey={path} onClosed={() => contentAreaRef.current?.focus()} t={t} />
        <Stack gap={14} w="100%" maw={readingMaxWidth(fullWidth, MAX_WIDTH)} mx="auto" px={28} py={20} pos="relative">
          {sync.status?.partial && (
            <Alert color="var(--mantine-color-warning)" variant="light" icon={<Info size={16} />} data-selection-ignore>
              {t('notion.notice.partial')}
            </Alert>
          )}
          {sync.updated > 0 && (
            <Alert
              variant="light"
              icon={<RefreshCw size={16} />}
              data-selection-ignore
              withCloseButton
              closeButtonLabel={t('notion.notice.dismiss')}
              onClose={sync.dismissUpdated}
            >
              <Group gap={8} justify="space-between" wrap="nowrap">
                <Box>{t('notion.notice.updated').replace('{{count}}', String(sync.updated))}</Box>
                <AppButton size="compact-sm" variant="subtle" onClick={() => { sync.dismissUpdated(); onOpenHistory(); }}>
                  {t('notion.notice.viewChanges')}
                </AppButton>
              </Group>
            </Alert>
          )}
          {sync.status?.conflicts.map((conflict) => (
            <ConflictCard
              key={conflict.key}
              conflict={conflict}
              disabled={sync.busy || editing}
              onResolve={sync.resolve}
              onEdit={editConflict}
              t={t}
            />
          ))}

          <Box data-turn-index={0} style={zoomStyle}>
            {editing ? (
              <AnswerEditor
                path={path}
                turnIndex={0}
                response={body}
                turnCount={1}
                editedAt={null}
                locked={false}
                t={t}
                notion
                actionsTarget={editActionsSlot}
              />
            ) : (
              <Box className="md-content md-response" data-find-scope style={{ ...READING_TEXT_STYLE, lineHeight: 1.75, color: 'var(--text-primary)' }}>
                <MessageMarkdown notion>{body}</MessageMarkdown>
              </Box>
            )}
            {/* Where a rewrite's result card goes when its block is no longer on the page. */}
            {!editing && <Box data-rewrite-slot={0} />}
          </Box>
          {!editing && sync.status?.connected && !sync.status.unsynced && sync.status.pending.length > 0 && (
            <DocumentChangeMarks body={body} changes={sync.status.pending} busy={sync.busy} onRevert={sync.revert} t={t} />
          )}
        </Stack>
      </Box>
    </Stack>
    {assistantOpen && <DocAssistantPanel path={path} contentAreaRef={contentAreaRef} applyBlocked={applyBlocked} t={t} />}
    </Flex>
  );
};
