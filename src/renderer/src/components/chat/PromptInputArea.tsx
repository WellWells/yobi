import React, { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { ActionIcon, Box, Flex, Paper, Stack, Text, Tooltip } from '@mantine/core';
import { ArrowUp } from 'lucide-react';
import { AppTextarea } from '../AppTextarea';
import { ModelDropdown } from './ModelDropdown';
import { AttachmentChips } from './AttachmentChips';
import { SlashCommandMenu } from './SlashCommandMenu';
import { parseSlashCommand, slashMenuQuery, type ChatCommand } from '../../hooks/useChatCommands';
import type { PromptAttachment } from '../../../../shared/types';

interface PromptInputAreaProps {
  t: (key: string) => string;
  activeModelUrl: string;
  onChangeModel: (url: string) => void;
  onSend: (text: string) => void;
  attachments: PromptAttachment[];
  notice: string | null;
  onRemoveAttachment: (id: string) => void;
  chatCommands: ChatCommand[];
  onRunCommand: (command: ChatCommand, input: string) => void;
  onUnknownCommand: (command: string) => void;
}

export interface PromptInputAreaHandle {
  focusPrompt: () => void;
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
}, ref) => {
  const [promptInput, setPromptInput] = useState('');
  const [inputFocused, setInputFocused] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [menuDismissed, setMenuDismissed] = useState(false);
  const promptInputRef = useRef<HTMLTextAreaElement>(null);

  useImperativeHandle(ref, () => ({
    focusPrompt: () => promptInputRef.current?.focus(),
  }), []);

  const slashQuery = slashMenuQuery(promptInput);
  const filteredCommands = useMemo(
    () => (slashQuery === null ? [] : chatCommands.filter((c) => c.command.startsWith(slashQuery))),
    [slashQuery, chatCommands],
  );
  const menuOpen = slashQuery !== null && !menuDismissed
    && (filteredCommands.length > 0 || slashQuery === '');

  useEffect(() => { setHighlightedIndex(0); }, [slashQuery]);

  const selectCommand = useCallback((command: ChatCommand) => {
    setPromptInput(`/${command.command} `);
    setMenuDismissed(false);
    promptInputRef.current?.focus();
  }, []);

  const handleSendPrompt = useCallback(() => {
    const text = promptInput.trim();
    if (!text) return;
    const parsed = parseSlashCommand(text);
    if (parsed) {
      if (!parsed.command) return;
      const match = chatCommands.find((c) => c.command === parsed.command);
      if (match) {
        onRunCommand(match, parsed.args);
        setPromptInput('');
      } else {
        onUnknownCommand(parsed.command);
      }
      return;
    }
    onSend(text);
    setPromptInput('');
  }, [promptInput, chatCommands, onRunCommand, onUnknownCommand, onSend]);

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
        style={{
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

        <Box p="8px 12px 2px">
          <AppTextarea
            ref={promptInputRef}
            tone="prompt"
            value={promptInput}
            onChange={(event) => { setPromptInput(event.target.value); setMenuDismissed(false); }}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing || event.keyCode === 229) return;
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
            }}
            placeholder={t('input.placeholder.short')}
            minRows={2}
          />
        </Box>

        <Flex align="center" justify="flex-end" gap={8} p="8px 12px">
          <ModelDropdown value={activeModelUrl} onChange={onChangeModel} />
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
      </Paper>
      </Box>

      {notice && (
        <Text fz="var(--font-size-sm)" c="var(--mantine-color-dimmed)" ta="center">
          {notice}
        </Text>
      )}
    </Stack>
  );
});

PromptInputArea.displayName = 'PromptInputArea';

