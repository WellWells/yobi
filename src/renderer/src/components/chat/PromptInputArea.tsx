import React, { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { ActionIcon, Box, Flex, Paper, Stack, Tooltip } from '@mantine/core';
import { ArrowUp, Globe } from 'lucide-react';
import { AppTextarea } from '../AppTextarea';
import { ModelDropdown } from './ModelDropdown';
import { ModeDropdown } from './ModeDropdown';
import { ThinkingPill } from './ThinkingPill';
import { AttachmentChips } from './AttachmentChips';
import { ComposerAddButton } from './ComposerAddButton';
import { ComposerNotice } from './ComposerNotice';
import { QuoteChips } from './QuoteChips';
import { SlashCommandMenu } from './SlashCommandMenu';
import { ModelCommandMenu } from './ModelCommandMenu';
import {
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
import { renderConnectorIcon } from '../../config/connectorIcons';
import { findCatalogEntry } from '../../../../shared/mcpCatalog';
import { composerNoticeText, pickComposerNotice } from '../../utils/composerNotice';
import { looksLikeFlowRequest } from '../../../../shared/flowIntent';
import { looksLikeWebSearchRequest } from '../../../../shared/webIntent';
import { useAppStore } from '../../store/appStore';
import { endTarget, homeTarget } from '../../utils/composerKeys';
import { withQuotedContext } from '../../utils/composerQuotes';
import { collectPastedFiles, pasteMayHoldSystemFile } from '../../utils/pastedFiles';
import { toTokens } from '../../../../shared/shortcuts';
import { isMac } from '../../utils/keyLabels';
import {
  BUILTIN_AGENT_FLOW_ID,
  BUILTIN_CHAT_FLOW_ID,
  BUILTIN_MODEL_FLOW_ID,
  type PromptAttachment,
} from '../../../../shared/types';
import { mcpCommandFlowId, parseMcpCommandFlowId } from '../../../../shared/mcpCommand';
import { matchConnectorKeywords } from '../../../../shared/connectorKeywords';
import type { ConnectorChoice } from './ModeDropdown';
import { useResolvedCombo } from '../../store/shortcutStore';

interface PromptInputAreaProps {
  t: (key: string) => string;
  activeModelUrl: string;
  onChangeModel: (url: string) => void;
  /** A row of `/model`: the provider and, where it has them, one of its models. */
  onPickModel: (stop: ModelStop) => void;
  /** `/model <words>` sent with nothing matching them. */
  onUnknownModel: (query: string) => void;
  onSend: (text: string) => boolean;
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
  /** Derived from the capabilities below — the composer shows it, it is never picked directly. */
  chatMode: ChatMode;
  /** Still used by `/chat` and `/agent`, which now set the capabilities that imply the mode. */
  onChangeMode: (mode: ChatMode) => void;
  web: boolean;
  onToggleWeb: () => void;
  onSetWeb: (on: boolean) => void;
  connectors: ConnectorChoice[];
  activeConnectorIds: readonly string[];
  onToggleConnector: (id: string) => void;
  /** Discloses connectors and switches to agent mode; returns the resulting active set. */
  onDiscloseConnectors: (ids: readonly string[]) => readonly string[];
  onRemoveConnectors: (ids: readonly string[]) => void;
}

export interface PromptInputAreaHandle {
  focusPrompt: () => void;
  insertQuote: (text: string) => void;
}

export const PromptInputArea = React.forwardRef<PromptInputAreaHandle, PromptInputAreaProps>(({
  t,
  activeModelUrl,
  onChangeModel,
  onPickModel,
  onUnknownModel,
  onSend,
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
  web,
  onToggleWeb,
  onSetWeb,
  connectors,
  activeConnectorIds,
  onToggleConnector,
  onDiscloseConnectors,
  onRemoveConnectors,
}, ref) => {
  const [promptInput, setPromptInput] = useState('');
  const [quotes, setQuotes] = useState<string[]>([]);
  const [inputFocused, setInputFocused] = useState(false);
  const tempChatMode = useAppStore((s) => s.tempChatMode);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  /**
   * What the last send attached on its own, and the mode it was in beforehand. The mode is part
   * of the record because undoing has to put the composer back where it was: dropping only the
   * connector would leave the pill on Agent, so the next ordinary question would still be
   * answered by a full agent run — the very thing the user just said no to.
   */
  const [autoAttached, setAutoAttached] = useState<{ ids: readonly string[]; from: ChatMode }>(
    { ids: [], from: 'chat' },
  );
  /**
   * Whether the last send was routed to an agent run because it read as "build me a flow", and
   * the mode it was in beforehand. Recorded for the same reason the connector notice is: the
   * undo has to put the pill back, or every following question keeps paying for an agent run.
   */
  const [autoFlow, setAutoFlow] = useState<{ active: boolean; from: ChatMode }>(
    { active: false, from: 'chat' },
  );
  /**
   * Whether the last send turned "web" on because it asked for a web search. No mode is recorded:
   * the mode follows from the capabilities, so turning web back off is the whole undo.
   */
  const [autoWeb, setAutoWeb] = useState(false);
  const [menuDismissed, setMenuDismissed] = useState(false);
  const cycleModelKeys = toTokens(useResolvedCombo('chat.cycleModel'), isMac).join(' + ');
  const modelTooltip = cycleModelKeys
    ? t('chat.model.tooltip').replace('{{shortcut}}', cycleModelKeys)
    : t('chat.model.tooltip').replace(' · {{shortcut}}', '').replace('{{shortcut}}', '');
  const promptInputRef = useRef<HTMLTextAreaElement>(null);

  useImperativeHandle(ref, () => ({
    focusPrompt: () => promptInputRef.current?.focus(),
    insertQuote: (text: string) => {
      const quote = text.trim();
      if (quote) setQuotes((current) => [...current, quote]);
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
      handleChangeMode(mode);
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
  }, [onRunCommand, handleChangeMode, onDiscloseConnectors]);

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

  // One strip, one notice. The mode pill already names every disclosed connector, so this line
  // only carries what the pill cannot: that nobody chose it, and how to take it back.
  const composerNotice = pickComposerNotice({
    autoAttachedNames: autoAttachedConnectors.map((c) => c.name),
    autoFlowActive: autoFlow.active,
    // Only while it is still on: switching it off in the pill has already answered the notice.
    autoWebActive: autoWeb && web,
    webLabel: t('chat.capability.web.label'),
    plain: notice ?? modeNotice,
  });
  const AgentGlyph = commandIcon(BUILTIN_AGENT_FLOW_ID);
  // One brand mark only when one connector is named. Showing LINE's glyph next to "LINE, Notion"
  // reads as "LINE did this", so several fall back to the generic connector icon.
  const noticeIcon = composerNotice?.kind === 'connectors'
    ? renderConnectorIcon(
      autoAttachedConnectors.length === 1
        ? findCatalogEntry(autoAttachedConnectors[0].url)
        : undefined,
      15,
    )
    : composerNotice?.kind === 'flow'
      ? <AgentGlyph size={15} />
      : composerNotice?.kind === 'web' ? <Globe size={15} /> : null;
  const noticeAction = composerNotice?.kind === 'connectors'
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
  }, []);

  const handleSendPrompt = useCallback(() => {
    const text = promptInput.trim();
    if (!text) return;
    const keepFocus = (): void => { promptInputRef.current?.focus(); };
    const parsed = parseSlashCommand(text);
    // Handled before the notices are cleared: switching models is not a send, so it leaves the
    // one about the last send standing.
    const modelCommand = parsed
      ? chatCommands.find((c) => c.flowId === BUILTIN_MODEL_FLOW_ID && c.command === parsed.command)
      : undefined;
    if (parsed && modelCommand) {
      if (!parsed.args) {
        // On its own it opens the list rather than doing nothing.
        setPromptInput(`/${modelCommand.command} `);
        setMenuDismissed(false);
        keepFocus();
        return;
      }
      const stop = filterModelStops(modelStops, parsed.args)[0];
      if (stop) pickModel(stop);
      else onUnknownModel(parsed.args);
      keepFocus();
      return;
    }
    // A send is the only place the notice can be answered for, so it starts every send clear
    // rather than being left over from the one before.
    setAutoAttached({ ids: [], from: chatMode });
    setAutoFlow({ active: false, from: chatMode });
    setAutoWeb(false);
    // Asking for a web search in so many words turns "web" on for this conversation. It is off by
    // default so that an ordinary question stays an ordinary chat turn; this message says
    // otherwise. It stays on, like a connector named in a sentence, and is undone the same way.
    // The run is handed the value rather than reading it back from state, which has not flushed.
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
        setPromptInput('');
        handleChangeMode(mode);
        return;
      }
      const connectorId = parseMcpCommandFlowId(match.flowId);
      if (connectorId) {
        const disclosed = onDiscloseConnectors([connectorId]);
        if (!parsed.args) {
          setPromptInput('');
          keepFocus();
          return;
        }
        // The turn itself is an ordinary agent turn — the connector is disclosed to it, not the
        // thing being invoked, so it keeps every built-in tool and can decide the connector does
        // not fit this request.
        // Falls back to the connector command itself rather than doing nothing if the agent
        // built-in is somehow absent from the list: the run handler resolves either shape.
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
    // Naming a connector in an ordinary sentence discloses it and makes this an agent turn.
    // Disclosure, not instruction: the model still decides the connector is not the right
    // instrument for this question, exactly as it does for one the user typed a slash for.
    const attached = matchConnectorKeywords(text, connectors).filter((id) => !activeConnectorIds.includes(id));
    const agentCommand = chatCommands.find((c) => c.flowId === BUILTIN_AGENT_FLOW_ID);
    // Decided up front but applied only on the branch that runs as an agent: a flow request below
    // is routed on its own terms.
    const wantsWeb = !web && agentCommand !== undefined && looksLikeWebSearchRequest(text);
    if (attached.length > 0 && agentCommand) {
      // The set is handed to the run rather than read back from state, which has not flushed
      // yet — the same reason the connector command path passes its own. Web likewise.
      const disclosed = onDiscloseConnectors(attached);
      setAutoAttached({ ids: attached, from: chatMode });
      if (wantsWeb) enableWeb();
      if (onRunCommand(agentCommand, withQuotes(text), disclosed, wantsWeb ? true : undefined)) clearComposer();
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
      if (onRunCommand(agentCommand, withQuotes(text), undefined, true)) clearComposer();
      keepFocus();
      return;
    }
    if (modeCommand) {
      if (onRunCommand(modeCommand, withQuotes(text))) clearComposer();
      keepFocus();
      return;
    }
    if (onSend(withQuotes(text))) clearComposer();
    keepFocus();
  }, [
    promptInput, chatCommands, chatMode, connectors, activeConnectorIds, web,
    modeCommand, handleChangeMode, onDiscloseConnectors, onRunCommand, onUnknownCommand,
    onSetWeb, onSend, withQuotes, clearComposer, modelStops, pickModel, onUnknownModel,
  ]);

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

  const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
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
    promptInput, menuOpen, modelMenuOpen, listLength, filteredCommands, filteredStops,
    highlightedIndex, selectCommand, pickModel, handleSendPrompt,
  ]);

  return (
    <Stack
      gap={8}
      bg="var(--mantine-color-body)"
      p="12px"
      style={{ borderTop: '1px solid var(--mantine-color-default-border)', flexShrink: 0 }}
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
        style={tempChatMode ? {
          borderStyle: 'dashed',
          borderColor: inputFocused ? 'var(--mantine-color-violet-4)' : 'var(--mantine-color-violet-6)',
          boxShadow: inputFocused ? '0 0 0 2px color-mix(in srgb, var(--mantine-color-violet-5) 25%, transparent)' : 'none',
          background: 'color-mix(in srgb, var(--mantine-color-default) 82%, transparent)',
          transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
          cursor: 'text',
        } : {
          borderColor: inputFocused ? 'var(--mantine-color-accent)' : 'var(--mantine-color-default-border)',
          boxShadow: inputFocused ? '0 0 0 2px var(--mantine-color-accent-dim)' : 'none',
          transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
          cursor: 'text',
        }}
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

        {}
        <Flex align="center" justify="space-between" gap={8} p="8px 12px">
          <Flex align="center" gap={6}>
          <ComposerAddButton
            t={t}
            onAddFiles={onAddFiles}
            disabledReason={attachUnsupportedReason}
            accept={attachAccept}
          />
          <ModeDropdown
            value={chatMode}
            web={web}
            onToggleWeb={onToggleWeb}
            connectors={connectors}
            activeConnectorIds={activeConnectorIds}
            onToggleConnector={onToggleConnector}
            t={t}
          />
          </Flex>
          <Flex align="center" gap={8}>
          <ThinkingPill url={activeModelUrl} />
          <ModelDropdown
            value={activeModelUrl}
            onChange={onChangeModel}
            tooltipLabel={modelTooltip}
          />
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
          </Flex>
        </Flex>
      </Paper>
      </Box>
    </Stack>
  );
});

PromptInputArea.displayName = 'PromptInputArea';

