import React, { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { ActionIcon, Box, Flex, Paper, Stack, Text, Tooltip } from '@mantine/core';
import { ArrowUp } from 'lucide-react';
import { AppTextarea } from '../AppTextarea';
import { ModelDropdown } from './ModelDropdown';
import { ModeDropdown } from './ModeDropdown';
import { AttachmentChips } from './AttachmentChips';
import { QuoteChips } from './QuoteChips';
import { SlashCommandMenu } from './SlashCommandMenu';
import {
  filterChatCommands,
  parseSlashCommand,
  slashMenuQuery,
  type ChatCommand,
} from '../../hooks/useChatCommands';
import { chatModeFlowId, chatModeForCommandId, findChatMode, type ChatMode } from '../../config/chatModes';
import { useAppStore } from '../../store/appStore';
import { endTarget, homeTarget } from '../../utils/composerKeys';
import { withQuotedContext } from '../../utils/composerQuotes';
import { SHIFT_TAB_HINT } from '../../utils/keyLabels';
import { BUILTIN_CHAT_FLOW_ID, type PromptAttachment } from '../../../../shared/types';

interface PromptInputAreaProps {
  t: (key: string) => string;
  activeModelUrl: string;
  onChangeModel: (url: string) => void;
  onSend: (text: string) => boolean;
  attachments: PromptAttachment[];
  notice: string | null;
  onRemoveAttachment: (id: string) => void;
  chatCommands: ChatCommand[];
  onRunCommand: (command: ChatCommand, input: string) => boolean;
  onUnknownCommand: (command: string) => void;
  chatMode: ChatMode;
  onChangeMode: (mode: ChatMode) => void;
}

export interface PromptInputAreaHandle {
  focusPrompt: () => void;
  insertQuote: (text: string) => void;
}

export const PromptInputArea = React.forwardRef<PromptInputAreaHandle, PromptInputAreaProps>(({
  t,
  activeModelUrl,
  onChangeModel,
  onSend,
  attachments,
  notice,
  onRemoveAttachment,
  chatCommands,
  onRunCommand,
  onUnknownCommand,
  chatMode,
  onChangeMode,
}, ref) => {
  const [promptInput, setPromptInput] = useState('');
  const [quotes, setQuotes] = useState<string[]>([]);
  const [inputFocused, setInputFocused] = useState(false);
  const tempChatMode = useAppStore((s) => s.tempChatMode);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [menuDismissed, setMenuDismissed] = useState(false);
  const promptInputRef = useRef<HTMLTextAreaElement>(null);

  useImperativeHandle(ref, () => ({
    focusPrompt: () => promptInputRef.current?.focus(),
    // A quote is held beside the message rather than typed into it: the user sees the
    // passage they picked, not the blockquote syntax, and can drop it again without
    // editing their own sentence around it.
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

  useEffect(() => { setHighlightedIndex(0); }, [slashQuery]);

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
    setPromptInput(`/${command.command} `);
    setMenuDismissed(false);
    promptInputRef.current?.focus();
  }, [onRunCommand, handleChangeMode]);

  const modeFlowId = chatModeFlowId(chatMode);
  const modeCommand = useMemo(
    () => (modeFlowId ? chatCommands.find((c) => c.flowId === modeFlowId) ?? null : null),
    [modeFlowId, chatCommands],
  );

  const modeOption = findChatMode(chatMode);
  const placeholder = modeOption.placeholderKey
    ? t(modeOption.placeholderKey)
    : t(tempChatMode ? 'chat.tempMode.input.placeholder' : 'input.placeholder.short');
  const modeNotice = modeCommand && attachments.length > 0
    ? t('chat.mode.attachments.ignored')
    : null;

  // Quotes ride in front of whatever the message turns out to be — an ordinary turn, a
  // slash command's argument, a mode command's input.
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
      if (match.flowId === BUILTIN_CHAT_FLOW_ID) {
        // `/chat <text>` is the one-shot form: chat mode runs no flow, so the text
        // takes the ordinary send and the pill stays where the user left it.
        if (onSend(withQuotes(parsed.args))) clearComposer();
        keepFocus();
        return;
      }
      if (onRunCommand(match, withQuotes(parsed.args))) clearComposer();
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
    promptInput, chatCommands, modeCommand, handleChangeMode,
    onRunCommand, onUnknownCommand, onSend, withQuotes, clearComposer,
  ]);

  const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    const field = promptInputRef.current;
    const caret = field && field.selectionStart === field.selectionEnd ? field.selectionStart : null;

    if (
      event.key.toLowerCase() === 'c'
      && event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey
      && caret !== null && (promptInput || quotes.length > 0)
    ) {
      event.preventDefault();
      clearComposer();
      setMenuDismissed(false);
      return;
    }

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

    if (menuOpen && event.key === 'Escape') {
      event.preventDefault();
      setMenuDismissed(true);
      return;
    }
    if (menuOpen && filteredCommands.length > 0) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setHighlightedIndex((i) => (i + 1) % filteredCommands.length);
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setHighlightedIndex((i) => (i - 1 + filteredCommands.length) % filteredCommands.length);
        return;
      }
      if ((event.key === 'Enter' && !event.shiftKey) || event.key === 'Tab') {
        event.preventDefault();
        selectCommand(filteredCommands[highlightedIndex] ?? filteredCommands[0]);
        return;
      }
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      handleSendPrompt();
    }
  }, [promptInput, menuOpen, filteredCommands, highlightedIndex, selectCommand, handleSendPrompt]);

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
          <ModeDropdown value={chatMode} onChange={handleChangeMode} t={t} />
          <Flex align="center" gap={8}>
          <ModelDropdown
            value={activeModelUrl}
            onChange={onChangeModel}
            tooltipLabel={t('chat.model.tooltip').replace('{{shortcut}}', SHIFT_TAB_HINT)}
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

      {(notice ?? modeNotice) && (
        <Text fz="var(--font-size-sm)" c="var(--mantine-color-dimmed)" ta="center">
          {notice ?? modeNotice}
        </Text>
      )}
    </Stack>
  );
});

PromptInputArea.displayName = 'PromptInputArea';

