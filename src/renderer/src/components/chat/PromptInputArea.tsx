import React, { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { ActionIcon, Box, Flex, Paper, Stack, Tooltip } from '@mantine/core';
import { ArrowUp, Globe, Square, SquarePen, Terminal } from 'lucide-react';
import { AppTextarea } from '../AppTextarea';
import { ModelDropdown } from './ModelDropdown';
import { ModeDropdown } from './ModeDropdown';
import { COMPOSER_FOOTER } from './ComposerPill';
import { ThinkingPill } from './ThinkingPill';
import { AttachmentChips } from './AttachmentChips';
import { ComposerAddButton } from './ComposerAddButton';
import { composerMenuDirection } from './composerMenuDirection';
import { ComposerNotice } from './ComposerNotice';
import { QuoteChips } from './QuoteChips';
import { SlashCommandMenu } from './SlashCommandMenu';
import { ModelCommandMenu } from './ModelCommandMenu';
import {
  builtinChatCommand,
  filterChatCommands,
  modelMenuQuery,
  parseSlashCommand,
  slashMenuQuery,
  type ChatCommand,
} from '../../hooks/useChatCommands';
import { useModelStops } from '../../hooks/useModelStops';
import { filterModelStops, stopKey, type ModelStop } from '../../config/modelStops';
import {
  chatModeFlowId,
  chatModeForCommandId,
  commandIcon,
  findChatMode,
  type ChatMode,
} from '../../config/chatModes';
import { renderServerIcon } from '../../config/connectorIcons';
import { composerNoticeText, pickComposerNotice } from '../../utils/composerNotice';
import { looksLikeFlowRequest } from '../../../../shared/flowIntent';
import { looksLikeWebSearchRequest } from '../../../../shared/webIntent';
import { looksLikeToolRequest } from '../../../../shared/toolIntent';
import { IMAGE_CHAT_FLOW_ID, imageRouteFor, pictureIsWholeJob } from '../../../../shared/imageRequest';
import { useAppStore } from '../../store/appStore';
import { useAgentRunStore } from '../../store/useAgentRunStore';
import { endTarget, homeTarget } from '../../utils/composerKeys';
import { isComposingKey } from '../../utils/imeKeys';
import { withQuotedContext } from '../../utils/composerQuotes';
import { collectPastedFiles, pasteMayHoldSystemFile } from '../../utils/pastedFiles';
import { comboLabel } from '../../../../shared/shortcuts';
import { isMac } from '../../utils/keyLabels';
import {
  BUILTIN_AGENT_FLOW_ID,
  BUILTIN_CHAT_FLOW_ID,
  BUILTIN_MODEL_FLOW_ID,
  BUILTIN_RECAP_FLOW_ID,
  type PromptAttachment,
  type ShellInfo,
} from '../../../../shared/types';
import { shellBangCommand } from '../../../../shared/shellBang';
import { attachmentApi, shellApi } from '../../api/electronApi';
import { composerFrameStyle, SHELL_COLOR } from './composerFrame';
import { mcpCommandFlowId, parseMcpCommandFlowId } from '../../../../shared/mcpCommand';
import { composerConnectors, type KeywordCandidate } from '../../../../shared/connectorKeywords';
import { desktopLinkFlowFor } from '../../../../shared/builtinFlows';
import { currentLinkSiteFilter } from '../../store/linkRecognitionStore';
import { useResolvedCombo } from '../../store/shortcutStore';
import { deleteAllText, wantsComposerClear } from './composerClear';
import { replaceAllText, useExternalEditor, wantsExternalEditor } from './composerExternalEditor';
import { insertPathsAtCaret, wantsPathPaste } from './composerPastePath';
import { showAppNotice } from '../../hooks/useUiNotifications';
import { fillTemplate } from '../../../../shared/fillTemplate';

interface PromptInputAreaProps {
  t: (key: string) => string;
  activeModelUrl: string;
  onChangeModel: (url: string) => void;
  /** A row of `/model`: the provider and, where it has them, one of its models. */
  onPickModel: (stop: ModelStop) => void;
  /** `/model <words>` sent with nothing matching them. */
  onUnknownModel: (query: string) => void;
  onSend: (text: string) => boolean;
  /** A draft starting with `!`: the command runs on this computer. Absent where nothing may run. */
  onRunShell?: (command: string) => boolean;
  attachments: PromptAttachment[];
  notice: string | null;
  onAddFiles: (files: File[]) => void;
  onAddFromClipboard: () => void;
  attachUnsupportedReason: string | null;
  attachAccept: string;
  onRemoveAttachment: (id: string) => void;
  chatCommands: ChatCommand[];
  /**
   * `connectorIds` overrides the conversation's active set for this one send. A connector command
   * discloses and sends in the same keystroke, and the state update has not flushed yet, so the
   * caller has to be handed the set it just produced rather than reading a stale one.
   */
  onRunCommand: (
    command: ChatCommand,
    input: string,
    connectorIds?: readonly string[],
    /** Same reason as `connectorIds`: a send that just turned web on cannot read it back yet. */
    web?: boolean,
  ) => boolean;
  onUnknownCommand: (command: string) => void;
  /** Agent when switched on or implied by web or a connector; chat otherwise. */
  chatMode: ChatMode;
  /** Mode switches the user did not pick (automatic routing and its undo); also the fallback when `onPickMode` is absent. */
  onChangeMode: (mode: ChatMode) => void;
  /** The user picked a mode themself (menu, `/agent`, `/chat`): also what a new chat starts in. */
  onPickMode?: (mode: ChatMode) => void;
  web: boolean;
  /** The user switched web off for this conversation; `web` is also false in the untouched default. */
  webOff: boolean;
  onToggleWeb: () => void;
  onSetWeb: (on: boolean) => void;
  /** Bumped when an agent run went online on its own; shows the same undo notice as a typed search. */
  autoWebSignal?: number;
  connectors: KeywordCandidate[];
  activeConnectorIds: readonly string[];
  onToggleConnector: (id: string) => void;
  /** Discloses connectors and switches to agent mode; returns the resulting active set. */
  onDiscloseConnectors: (ids: readonly string[]) => readonly string[];
  onRemoveConnectors: (ids: readonly string[]) => void;
  /** Empty chat: the composer sits under the greeting instead of docking at the bottom edge. */
  centered?: boolean;
  /** Nothing above it to keep apart (an empty chat docked at the foot of a narrow window): no rule on top. */
  bare?: boolean;
  /**
   * The conversation is waiting for an answer: the send button becomes Stop, as in Gemini, ChatGPT
   * and Claude. Enter still sends the draft (it waits its turn), only the button changes.
   */
  onStop?: () => void;
}

/** The conversation column (720) plus the composer's padding; rows above the centred composer use it too. */
export const CENTERED_MAX_WIDTH = 760;

export interface PromptInputAreaHandle {
  focusPrompt: () => void;
  insertQuote: (text: string) => void;
  /**
   * Sends `text` the way the send button sends the box's text — same modes, commands and routing —
   * while the box's own draft, quotes and attachments stay as they are (an edited question).
   */
  sendText: (text: string, hasAttachments: boolean) => void;
  /** A stopped question comes back to be edited; a draft typed meanwhile is never replaced. */
  restoreDraft: (text: string) => void;
}

/** What one send reads from, and clears in, the composer. */
interface SendSource {
  withQuotes: (text: string) => string;
  quoteCount: number;
  hasAttachments: boolean;
  /** The box's own text, which a command that only switches something may clear or fill. */
  fromDraft: boolean;
  /** The typed text went out; quotes and attachments stay. */
  clearText: () => void;
  /** The whole message went out. */
  clearAll: () => void;
  /**
   * An edited question: always a message, never a `!` or `/` command. The conversation was cut
   * back before it is routed, and a command (a model switch, an unknown name, `/new`) sends nothing.
   */
  asMessage?: boolean;
}

const NOOP = (): void => {};

export const PromptInputArea = React.forwardRef<PromptInputAreaHandle, PromptInputAreaProps>(({
  t,
  activeModelUrl,
  onChangeModel,
  onPickModel,
  onUnknownModel,
  onSend,
  onRunShell,
  attachments,
  notice,
  onAddFiles,
  onAddFromClipboard,
  attachUnsupportedReason,
  attachAccept,
  onRemoveAttachment,
  chatCommands,
  onRunCommand,
  onUnknownCommand,
  chatMode,
  onChangeMode,
  onPickMode,
  web,
  webOff,
  onToggleWeb,
  onSetWeb,
  autoWebSignal = 0,
  connectors,
  activeConnectorIds,
  onToggleConnector,
  onDiscloseConnectors,
  onRemoveConnectors,
  centered = false,
  bare = false,
  onStop,
}, ref) => {
  const [promptInput, setPromptInput] = useState('');
  const [quotes, setQuotes] = useState<string[]>([]);
  const [inputFocused, setInputFocused] = useState(false);
  const tempChatMode = useAppStore((s) => s.tempChatMode);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  /** What the last send attached on its own, and the mode before it, so undo restores the pill too. */
  const [autoAttached, setAutoAttached] = useState<{ ids: readonly string[]; from: ChatMode }>(
    { ids: [], from: 'chat' },
  );
  /** Whether the last send was routed to an agent run as a flow request, and the mode before it (for undo). */
  const [autoFlow, setAutoFlow] = useState<{ active: boolean; from: ChatMode }>(
    { active: false, from: 'chat' },
  );
  /**
   * Whether the last send turned "web" on because it asked for a web search. No mode is recorded:
   * the mode follows from the capabilities, so turning web back off is the whole undo.
   */
  const [autoWeb, setAutoWeb] = useState(false);
  // An agent run that went online by itself announces it the same way, with the same undo.
  useEffect(() => {
    if (autoWebSignal > 0) setAutoWeb(true);
  }, [autoWebSignal]);
  const [menuDismissed, setMenuDismissed] = useState(false);
  const cycleModelKeys = comboLabel(useResolvedCombo('chat.cycleModel'), isMac);
  const modelTooltip = cycleModelKeys
    ? fillTemplate(t('chat.model.tooltip'), { shortcut: cycleModelKeys })
    : fillTemplate(t('chat.model.tooltip').replace(' · {{shortcut}}', ''), { shortcut: '' });
  const promptInputRef = useRef<HTMLTextAreaElement>(null);

  // Ctrl+G: every save in the editor lands here as it happens; closing the editor brings the
  // caret back, at the end of what came in.
  const externalEditor = useExternalEditor({
    onText: (text, closed) => {
      const field = promptInputRef.current;
      if (text !== null) {
        if (!field || !replaceAllText(field, text)) setPromptInput(text);
        setMenuDismissed(false);
      }
      if (closed && field) {
        field.focus();
        field.setSelectionRange(field.value.length, field.value.length);
      }
    },
    onFailed: () => showAppNotice({ title: t('chat.editor.failed'), level: 'error' }),
  });
  const { finish: finishEditor, open: openEditor } = externalEditor;

  useImperativeHandle(ref, () => ({
    focusPrompt: () => promptInputRef.current?.focus(),
    insertQuote: (text: string) => {
      const quote = text.trim();
      if (quote) setQuotes((current) => [...current, quote]);
      promptInputRef.current?.focus();
    },
    sendText: (text: string, hasAttachments: boolean) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      routeSendRef.current(trimmed, {
        withQuotes: (value) => value,
        quoteCount: 0,
        hasAttachments,
        fromDraft: false,
        clearText: NOOP,
        clearAll: NOOP,
        asMessage: true,
      });
    },
    restoreDraft: (text: string) => {
      setPromptInput((current) => (current.trim() ? current : text));
      promptInputRef.current?.focus();
    },
  }), []);

  const slashQuery = slashMenuQuery(promptInput);
  const filteredCommands = useMemo(
    () => (slashQuery === null ? [] : filterChatCommands(chatCommands, slashQuery)),
    [slashQuery, chatCommands],
  );
  const menuOpen = slashQuery !== null && !menuDismissed
    && (filteredCommands.length > 0 || slashQuery === '');

  const { stops: modelStops, currentKey: currentModelKey } = useModelStops(activeModelUrl);
  const hasModelCommand = chatCommands.some((c) => c.flowId === BUILTIN_MODEL_FLOW_ID);
  const modelQuery = hasModelCommand ? modelMenuQuery(promptInput) : null;
  const filteredStops = useMemo(
    () => (modelQuery === null ? [] : filterModelStops(modelStops, modelQuery)),
    [modelQuery, modelStops],
  );
  // Stays open with nothing matching, so the typed words visibly found nothing.
  const modelMenuOpen = modelQuery !== null && !menuDismissed;
  const listLength = modelMenuOpen ? filteredStops.length : menuOpen ? filteredCommands.length : 0;
  const menuDirection = composerMenuDirection(centered);

  useEffect(() => { setHighlightedIndex(0); }, [slashQuery]);
  // An unfiltered list starts on the model already in use, so Enter there changes nothing.
  useEffect(() => {
    if (modelQuery === null) return;
    const current = modelQuery.trim() === ''
      ? filteredStops.findIndex((stop) => stopKey(stop) === currentModelKey)
      : -1;
    setHighlightedIndex(Math.max(current, 0));
  }, [modelQuery, filteredStops, currentModelKey]);

  const handleChangeMode = useCallback((mode: ChatMode) => {
    onChangeMode(mode);
    promptInputRef.current?.focus();
  }, [onChangeMode]);
  // The user's own pick, as opposed to a send that switched modes by itself or an undo of one.
  const pickMode = useCallback((mode: ChatMode) => {
    (onPickMode ?? onChangeMode)(mode);
    promptInputRef.current?.focus();
  }, [onPickMode, onChangeMode]);

  const selectCommand = useCallback((command: ChatCommand) => {
    if (command.action) {
      setPromptInput('');
      setMenuDismissed(false);
      onRunCommand(command, '');
      promptInputRef.current?.focus();
      return;
    }
    const mode = chatModeForCommandId(command.flowId);
    if (mode) {
      setPromptInput('');
      setMenuDismissed(false);
      pickMode(mode);
      return;
    }
    // Picking a connector is a declaration, not a command to run: it puts that server on the
    // table for the rest of the conversation and leaves the box empty to type into.
    if (parseMcpCommandFlowId(command.flowId)) {
      setPromptInput('');
      setMenuDismissed(false);
      onDiscloseConnectors([parseMcpCommandFlowId(command.flowId) as string]);
      promptInputRef.current?.focus();
      return;
    }
    setPromptInput(`/${command.command} `);
    setMenuDismissed(false);
    promptInputRef.current?.focus();
  }, [onRunCommand, pickMode, onDiscloseConnectors]);

  const pickModel = useCallback((stop: ModelStop) => {
    setPromptInput('');
    setMenuDismissed(false);
    onPickModel(stop);
    promptInputRef.current?.focus();
  }, [onPickModel]);

  const activeConnectorFlowIds = useMemo(
    () => new Set(activeConnectorIds.map(mcpCommandFlowId)),
    [activeConnectorIds],
  );

  const modeFlowId = chatModeFlowId(chatMode);
  const modeCommand = useMemo(
    () => (modeFlowId ? chatCommands.find((c) => c.flowId === modeFlowId) ?? null : null),
    [modeFlowId, chatCommands],
  );

  const modeOption = findChatMode(chatMode);
  const placeholder = modeOption.placeholderKey
    ? t(modeOption.placeholderKey)
    : t(tempChatMode ? 'chat.tempMode.input.placeholder' : 'input.placeholder.short');
  const modeNotice = modeCommand && !modeOption.takesAttachments && attachments.length > 0
    ? t('chat.mode.attachments.ignored')
    : null;

  // Only the ones still disclosed: answering the notice has to make it go away, and a connector
  // dropped from the pill in the meantime is already answered for.
  const autoAttachedConnectors = useMemo(
    () => connectors
      .filter((c) => autoAttached.ids.includes(c.id) && activeConnectorIds.includes(c.id)),
    [connectors, autoAttached, activeConnectorIds],
  );
  // The notice belongs to the conversation that produced it. Left alone it would still be on
  // screen after switching to another one, where answering it would drop a connector that
  // conversation disclosed for itself. An empty path is a conversation with no file yet — the
  // composer's connectors carry into the file its first turn creates, so the notice does too.
  const selectedPath = useAppStore((s) => s.selectedFile?.path ?? '');
  const noticePath = useRef('');
  useEffect(() => {
    const previous = noticePath.current;
    noticePath.current = selectedPath;
    if (previous && selectedPath && previous !== selectedPath) {
      setAutoAttached({ ids: [], from: 'chat' });
      setAutoWeb(false);
    }
  }, [selectedPath]);

  const undoAutoFlow = useCallback((): void => {
    if (autoFlow.from !== 'agent') handleChangeMode(autoFlow.from);
    setAutoFlow({ active: false, from: 'chat' });
  }, [autoFlow, handleChangeMode]);

  const undoAutoWeb = useCallback((): void => {
    onSetWeb(false);
    setAutoWeb(false);
  }, [onSetWeb]);

  const undoAutoAttach = useCallback((): void => {
    onRemoveConnectors(autoAttached.ids);
    // Web the same send turned on is named in the same notice, so it goes with the connectors.
    if (autoWeb) undoAutoWeb();
    // Only when the send moved it. Someone already in agent mode asked for that themselves.
    if (autoAttached.from !== 'agent') handleChangeMode(autoAttached.from);
    setAutoAttached({ ids: [], from: 'chat' });
  }, [autoAttached, autoWeb, undoAutoWeb, onRemoveConnectors, handleChangeMode]);

  // A `!` draft says where it will run before it is sent: the shell and folder can change between
  // commands (a `cd`, a new default terminal), so they are asked for each time the draft turns into one.
  const shellDraft = onRunShell !== undefined && shellBangCommand(promptInput) !== null;
  const [shellInfo, setShellInfo] = useState<ShellInfo | null>(null);
  useEffect(() => {
    if (!shellDraft) {
      setShellInfo(null);
      return;
    }
    let current = true;
    void shellApi.info(selectedPath || undefined)
      .then((info) => { if (current) setShellInfo(info); })
      .catch(() => undefined);
    return () => { current = false; };
  }, [shellDraft, selectedPath]);

  // One strip, one notice. The mode pill already names every disclosed connector, so this line
  // only carries what the pill cannot: that nobody chose it, and how to take it back.
  const composerNotice = pickComposerNotice({
    shell: shellDraft && shellInfo
      ? fillTemplate(t('chat.shell.notice'), { shell: shellInfo.shell, folder: shellInfo.folder })
      : null,
    autoAttachedNames: autoAttachedConnectors.map((c) => c.name),
    autoFlowActive: autoFlow.active,
    // Only while it is still on: switching it off in the pill has already answered the notice.
    autoWebActive: autoWeb && web,
    webLabel: t('chat.capability.web.label'),
    plain: notice ?? modeNotice,
    editorOpen: externalEditor.editing,
  });
  const AgentGlyph = commandIcon(BUILTIN_AGENT_FLOW_ID);
  // One brand mark only when one connector is named. Showing LINE's glyph next to "LINE, Notion"
  // reads as "LINE did this", so several fall back to the generic connector icon.
  const noticeIcon = composerNotice?.kind === 'connectors'
    ? renderServerIcon(autoAttachedConnectors.length === 1 ? autoAttachedConnectors[0].url : undefined, 15)
    : composerNotice?.kind === 'flow'
      ? <AgentGlyph size={15} />
      : composerNotice?.kind === 'web' ? <Globe size={15} />
        : composerNotice?.kind === 'editor' ? <SquarePen size={15} />
          : composerNotice?.kind === 'shell' ? <Terminal size={15} color={SHELL_COLOR} /> : null;
  const finishExternalEdit = useCallback((): void => { void finishEditor(true); }, [finishEditor]);
  const noticeAction = composerNotice?.kind === 'editor'
    ? finishExternalEdit
    : composerNotice?.kind === 'connectors'
    ? undoAutoAttach
    : composerNotice?.kind === 'flow'
      ? undoAutoFlow
      : composerNotice?.kind === 'web' ? undoAutoWeb : null;

  const withQuotes = useCallback(
    (text: string): string => withQuotedContext(quotes, text),
    [quotes],
  );
  const clearComposer = useCallback((): void => {
    setPromptInput('');
    setQuotes([]);
    // The draft went out; a later save in the editor must not refill the box.
    void finishEditor(false);
  }, [finishEditor]);

  const routeSend = useCallback((text: string, source: SendSource): void => {
    const { withQuotes, clearText } = source;
    const clearComposer = source.clearAll;
    const keepFocus = (): void => { promptInputRef.current?.focus(); };
    // Ahead of everything else: a `!` line is a command for this computer in any mode. Quotes and
    // attachments stay for the next message, since nothing here would carry them.
    const shellCommand = onRunShell && !source.asMessage ? shellBangCommand(text) : null;
    if (onRunShell && shellCommand !== null) {
      if (shellCommand && onRunShell(shellCommand)) clearText();
      keepFocus();
      return;
    }
    const parsed = source.asMessage ? null : parseSlashCommand(text);
    // Handled before the notices are cleared: switching models is not a send, so it leaves the
    // one about the last send standing.
    const modelCommand = parsed
      ? chatCommands.find((c) => c.flowId === BUILTIN_MODEL_FLOW_ID && c.command === parsed.command)
      : undefined;
    if (parsed && modelCommand) {
      if (!parsed.args) {
        // On its own it opens the list rather than doing nothing.
        if (source.fromDraft) {
          setPromptInput(`/${modelCommand.command} `);
          setMenuDismissed(false);
        }
        keepFocus();
        return;
      }
      const stop = filterModelStops(modelStops, parsed.args)[0];
      if (stop) pickModel(stop);
      else onUnknownModel(parsed.args);
      keepFocus();
      return;
    }
    // Not a send either: showing the recap leaves the notice about the last send, and its undo, standing.
    const recapCommand = parsed
      ? chatCommands.find((c) => c.flowId === BUILTIN_RECAP_FLOW_ID
        && (c.command === parsed.command || (c.aliases ?? []).includes(parsed.command)))
      : undefined;
    if (recapCommand) {
      onRunCommand(recapCommand, '');
      clearComposer();
      keepFocus();
      return;
    }
    // A send is the only place the notice can be answered for, so it starts every send clear
    // rather than being left over from the one before.
    setAutoAttached({ ids: [], from: chatMode });
    setAutoFlow({ active: false, from: chatMode });
    setAutoWeb(false);
    // An explicit web-search request turns web on for this conversation, undone like an auto-attached connector.
    // The run is handed the value because state has not flushed yet.
    const enableWeb = (): void => {
      onSetWeb(true);
      setAutoWeb(true);
    };
    const webForAgentRun = (input: string): true | undefined => {
      if (web || !looksLikeWebSearchRequest(input)) return undefined;
      enableWeb();
      return true;
    };
    if (parsed) {
      if (!parsed.command) return;
      const match = chatCommands.find((c) =>
        c.command === parsed.command || (c.aliases ?? []).includes(parsed.command));
      if (!match) {
        onUnknownCommand(parsed.command);
        return;
      }
      const mode = chatModeForCommandId(match.flowId);
      if (mode && !parsed.args) {
        if (source.fromDraft) setPromptInput('');
        pickMode(mode);
        return;
      }
      const connectorId = parseMcpCommandFlowId(match.flowId);
      if (connectorId) {
        const disclosed = onDiscloseConnectors([connectorId]);
        if (!parsed.args) {
          if (source.fromDraft) setPromptInput('');
          keepFocus();
          return;
        }
        // An ordinary agent turn with the connector disclosed, not invoked; it keeps every built-in tool.
        // Falls back to the connector command if the agent built-in is missing; the run handler accepts either.
        const runAs = chatCommands.find((c) => c.flowId === BUILTIN_AGENT_FLOW_ID) ?? match;
        if (onRunCommand(runAs, withQuotes(parsed.args), disclosed, webForAgentRun(parsed.args))) clearComposer();
        keepFocus();
        return;
      }
      if (match.flowId === BUILTIN_CHAT_FLOW_ID) {
        if (onSend(withQuotes(parsed.args))) clearComposer();
        keepFocus();
        return;
      }
      if (match.flowId === BUILTIN_AGENT_FLOW_ID) {
        if (onRunCommand(match, withQuotes(parsed.args), undefined, webForAgentRun(parsed.args))) clearComposer();
        keepFocus();
        return;
      }
      if (onRunCommand(match, withQuotes(parsed.args))) clearComposer();
      keepFocus();
      return;
    }
    // A link on its own runs what a bot chat runs for it, in any mode — the agent too: an X post
    // shows its text and media, a YouTube video the download menu with its summary button. No
    // model and no connector; the turn's buttons download, summarize or analyze.
    // An agent waiting on this conversation takes the link as its answer, as a bot chat does.
    const answering = useAgentRunStore.getState().pendingQuestion?.conversationPath
      === (useAppStore.getState().selectedFile?.path ?? '');
    // A site switched off in Settings › Recognize links is an ordinary message.
    const plainMessage = source.quoteCount === 0 && !source.hasAttachments && !answering;
    const linkFlow = plainMessage
      ? desktopLinkFlowFor(text, currentLinkSiteFilter())
      : null;
    if (linkFlow) {
      if (onRunCommand(builtinChatCommand(linkFlow), text)) clearComposer();
      keepFocus();
      return;
    }
    // Naming a connector in an ordinary sentence discloses it and makes this an agent turn.
    // Disclosure, not instruction: the model still decides the connector is not the right
    // instrument for this question, exactly as it does for one the user typed a slash for.
    const { named, attached, forThisMessage } = composerConnectors(text, connectors, activeConnectorIds, webOff);
    const messageScope = forThisMessage.length > 0 ? [...activeConnectorIds, ...forThisMessage] : undefined;
    const agentCommand = chatCommands.find((c) => c.flowId === BUILTIN_AGENT_FLOW_ID);
    // Decided up front but applied only on the branch that runs as an agent: a flow request below
    // is routed on its own terms.
    const wantsWeb = !web && agentCommand !== undefined && looksLikeWebSearchRequest(text);
    // A picture asked for ("使用 gpt 產生…"; nobody named = Gemini) is drawn on that page for this
    // message only, the mode and the model left as set — unless the chat's own model is the one
    // asked for and its ordinary send below brings the picture back, in its own thread. Only when
    // the picture is the whole job (`pictureIsWholeJob`); the agent below draws too.
    if (
      plainMessage
      && pictureIsWholeJob(text, named.length > 0)
      && imageRouteFor(text, activeModelUrl, { agent: Boolean(modeCommand), temporary: tempChatMode })
    ) {
      if (onRunCommand(builtinChatCommand(IMAGE_CHAT_FLOW_ID), text)) clearComposer();
      keepFocus();
      return;
    }
    if (attached.length > 0 && agentCommand) {
      // The set is handed to the run rather than read back from state, which has not flushed
      // yet — the same reason the connector command path passes its own. Web likewise.
      const disclosed = onDiscloseConnectors(attached);
      setAutoAttached({ ids: attached, from: chatMode });
      if (wantsWeb) enableWeb();
      if (onRunCommand(agentCommand, withQuotes(text), [...disclosed, ...forThisMessage], wantsWeb ? true : undefined)) clearComposer();
      keepFocus();
      return;
    }
    // Asking for a flow is asking for something to be built, which only an agent run can do.
    // Routed here rather than left to the model: in plain chat there is no `build_flow` to call,
    // so the answer would be a description of the flow the user wanted created.
    if (!modeCommand && agentCommand && looksLikeFlowRequest(text)) {
      handleChangeMode('agent');
      setAutoFlow({ active: true, from: chatMode });
      if (onRunCommand(agentCommand, withQuotes(text))) clearComposer();
      keepFocus();
      return;
    }
    if (wantsWeb && agentCommand) {
      enableWeb();
      if (onRunCommand(agentCommand, withQuotes(text), messageScope, true)) clearComposer();
      keepFocus();
      return;
    }
    // A question an agent lookup answers (weather, stock price, exchange rate, a linked page) runs as an
    // agent turn for this message only; the mode stays plain chat, which is faster and keeps the provider's thread.
    if (!modeCommand && agentCommand && (messageScope || looksLikeToolRequest(text))) {
      if (onRunCommand(agentCommand, withQuotes(text), messageScope)) clearComposer();
      keepFocus();
      return;
    }
    if (modeCommand) {
      if (onRunCommand(modeCommand, withQuotes(text), messageScope)) clearComposer();
      keepFocus();
      return;
    }
    if (onSend(withQuotes(text))) clearComposer();
    keepFocus();
  }, [
    chatCommands, chatMode, connectors, activeConnectorIds, web, webOff,
    activeModelUrl, tempChatMode,
    modeCommand, handleChangeMode, pickMode, onDiscloseConnectors, onRunCommand, onUnknownCommand,
    onSetWeb, onSend, modelStops, pickModel, onUnknownModel, onRunShell,
  ]);

  const handleSendPrompt = useCallback(() => {
    const text = promptInput.trim();
    if (!text) return;
    routeSend(text, {
      withQuotes,
      quoteCount: quotes.length,
      hasAttachments: attachments.length > 0,
      fromDraft: true,
      clearText: () => {
        setPromptInput('');
        void finishEditor(false);
      },
      clearAll: clearComposer,
    });
  }, [promptInput, quotes.length, attachments.length, withQuotes, clearComposer, finishEditor, routeSend]);

  // The handle is made once; it reaches the routing as it is at the moment of the send.
  const routeSendRef = useRef(routeSend);
  routeSendRef.current = routeSend;

  const handlePaste = useCallback((event: React.ClipboardEvent<HTMLElement>) => {
    const files = collectPastedFiles(event.clipboardData);
    if (files.length > 0) {
      event.preventDefault();
      onAddFiles(files);
      return;
    }
    if (pasteMayHoldSystemFile(event.clipboardData)) {
      event.preventDefault();
      onAddFromClipboard();
    }
  }, [onAddFiles, onAddFromClipboard]);

  // Ctrl+Shift+V: main answers with the copied files' paths, or — nothing copied — pastes the
  // clipboard the ordinary way, which then reaches handlePaste exactly like Ctrl+V.
  const pasteCopiedPaths = useCallback(async () => {
    const paths = await attachmentApi.pastePaths().catch((): string[] => []);
    const field = promptInputRef.current;
    if (paths.length === 0 || !field) return;
    const refused = insertPathsAtCaret(field, paths);
    if (refused === null) return;
    setPromptInput(refused);
    setMenuDismissed(false);
  }, []);

  const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (isComposingKey(event.nativeEvent)) return;
    const field = promptInputRef.current;
    const caret = field && field.selectionStart === field.selectionEnd ? field.selectionStart : null;

    if ((event.key === 'Home' || event.key === 'End')
      && !event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey
      && caret !== null && field) {
      const target = event.key === 'Home' ? homeTarget(promptInput, caret) : endTarget(promptInput, caret);
      if (target !== null) {
        event.preventDefault();
        field.setSelectionRange(target, target);
        return;
      }
    }

    if (wantsPathPaste(event)) {
      event.preventDefault();
      void pasteCopiedPaths();
      return;
    }

    if (wantsExternalEditor(event)) {
      event.preventDefault();
      void openEditor(promptInput);
      return;
    }

    if (field && wantsComposerClear(event, field, Boolean(promptInput) || quotes.length > 0)) {
      event.preventDefault();
      if (!deleteAllText(field)) setPromptInput('');
      setQuotes([]);
      setMenuDismissed(false);
      return;
    }

    if ((menuOpen || modelMenuOpen) && event.key === 'Escape') {
      event.preventDefault();
      setMenuDismissed(true);
      return;
    }
    if (listLength > 0) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setHighlightedIndex((i) => (i + 1) % listLength);
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setHighlightedIndex((i) => (i - 1 + listLength) % listLength);
        return;
      }
      if ((event.key === 'Enter' && !event.shiftKey) || event.key === 'Tab') {
        event.preventDefault();
        if (modelMenuOpen) pickModel(filteredStops[highlightedIndex] ?? filteredStops[0]);
        else selectCommand(filteredCommands[highlightedIndex] ?? filteredCommands[0]);
        return;
      }
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      handleSendPrompt();
    }
  }, [
    promptInput, quotes.length, menuOpen, modelMenuOpen, listLength, filteredCommands, filteredStops,
    highlightedIndex, selectCommand, pickModel, handleSendPrompt, openEditor, pasteCopiedPaths,
  ]);

  return (
    <Stack
      gap={8}
      bg="var(--mantine-color-body)"
      p="12px"
      w="100%"
      maw={centered ? CENTERED_MAX_WIDTH : undefined}
      mx={centered ? 'auto' : undefined}
      style={{ borderTop: centered || bare ? undefined : '1px solid var(--mantine-color-default-border)', flexShrink: 0 }}
    >
      <Box pos="relative">
      {menuOpen && (
        <SlashCommandMenu
          commands={filteredCommands}
          highlightedIndex={highlightedIndex}
          onSelect={selectCommand}
          onHover={setHighlightedIndex}
          emptyLabel={t('chat.slash.empty')}
          activeFlowIds={activeConnectorFlowIds}
          direction={menuDirection}
        />
      )}
      {modelMenuOpen && (
        <ModelCommandMenu
          stops={filteredStops}
          currentKey={currentModelKey}
          highlightedIndex={highlightedIndex}
          onSelect={pickModel}
          onHover={setHighlightedIndex}
          emptyLabel={t('chat.model.command.empty')}
          direction={menuDirection}
        />
      )}
      <Paper
        shadow="none"
        radius="var(--radius-lg)"
        bg="var(--mantine-color-default)"
        withBorder
        onFocusCapture={() => setInputFocused(true)}
        onBlurCapture={() => setInputFocused(false)}
        onClick={() => promptInputRef.current?.focus()}
        onPaste={handlePaste}
        style={composerFrameStyle({ temporary: tempChatMode, shell: shellDraft, focused: inputFocused })}
      >
        {composerNotice && (
          <ComposerNotice
            icon={noticeIcon}
            message={composerNoticeText(composerNotice, t)}
            actionLabel={composerNotice.actionKey ? t(composerNotice.actionKey) : null}
            onAction={noticeAction}
          />
        )}

        {attachments.length > 0 && (
          <Box p="10px 12px 0">
            <AttachmentChips
              attachments={attachments}
              onRemove={onRemoveAttachment}
              removeLabel={t('attach.remove')}
            />
          </Box>
        )}

        {quotes.length > 0 && (
          <Box p="10px 12px 0">
            <QuoteChips
              quotes={quotes}
              onRemove={(index) => setQuotes((current) => current.filter((_, i) => i !== index))}
              removeLabel={t('chat.selection.quoteRemove')}
            />
          </Box>
        )}

        <Box p="8px 12px 2px">
          <AppTextarea
            ref={promptInputRef}
            tone="prompt"
            value={promptInput}
            onChange={(event) => { setPromptInput(event.target.value); setMenuDismissed(false); }}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            minRows={2}
          />
        </Box>

        <Flex className={COMPOSER_FOOTER} align="center" justify="space-between" gap={8} p="8px 12px">
          <Flex align="center" gap={6} style={{ flexShrink: 0 }}>
          <ComposerAddButton
            t={t}
            onAddFiles={onAddFiles}
            disabledReason={attachUnsupportedReason}
            accept={attachAccept}
          />
          <ModeDropdown
            value={chatMode}
            onChangeMode={pickMode}
            web={web}
            onToggleWeb={onToggleWeb}
            connectors={connectors}
            activeConnectorIds={activeConnectorIds}
            onToggleConnector={onToggleConnector}
            t={t}
            menuDirection={menuDirection}
          />
          </Flex>
          <Flex align="center" gap={8} miw={0}>
          <ThinkingPill url={activeModelUrl} menuDirection={menuDirection} />
          <ModelDropdown
            value={activeModelUrl}
            onChange={onChangeModel}
            tooltipLabel={modelTooltip}
            menuDirection={menuDirection}
          />
          {onStop ? (
            <Tooltip label={t('input.stop')} position="top">
              <ActionIcon
                onClick={onStop}
                aria-label={t('input.stop')}
                radius="xl"
                size={34}
                style={{ background: 'var(--mantine-color-accent)', color: '#fff' }}
              >
                <Square size={12} fill="currentColor" strokeWidth={0} />
              </ActionIcon>
            </Tooltip>
          ) : (
          <Tooltip label={t('input.send')} position="top">
            <ActionIcon
              onClick={handleSendPrompt}
              disabled={!promptInput.trim()}
              aria-label={t('input.send')}
              radius="xl"
              size={34}
              style={{
                background: promptInput.trim() ? 'var(--mantine-color-accent)' : 'var(--mantine-color-default)',
                color: promptInput.trim() ? '#fff' : 'var(--mantine-color-dimmed)',
                transition: 'background 0.15s ease, box-shadow 0.15s ease',
              }}
            >
              <ArrowUp size={16} strokeWidth={2.5} />
            </ActionIcon>
          </Tooltip>
          )}
          </Flex>
        </Flex>
      </Paper>
      </Box>
    </Stack>
  );
});

PromptInputArea.displayName = 'PromptInputArea';

