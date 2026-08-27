import type { ComponentType } from 'react';
import { MessageSquare, Search, SquarePen, Waypoints, Workflow, Zap } from 'lucide-react';
import {
  BUILTIN_AGENT_FLOW_ID,
  BUILTIN_CHAT_FLOW_ID,
  BUILTIN_NEW_FLOW_ID,
  BUILTIN_QUICKSEARCH_FLOW_ID,
  BUILTIN_SEARCH_FLOW_ID,
} from '../../../shared/types';

export type CommandIcon = ComponentType<{ size?: number }>;

export const BUILTIN_COMMAND_ICONS = new Map<string, CommandIcon>([
  [BUILTIN_NEW_FLOW_ID, SquarePen],
  [BUILTIN_CHAT_FLOW_ID, MessageSquare],
  [BUILTIN_AGENT_FLOW_ID, Waypoints],
  [BUILTIN_SEARCH_FLOW_ID, Search],
  [BUILTIN_QUICKSEARCH_FLOW_ID, Zap],
]);

export const FLOW_COMMAND_ICON: CommandIcon = Workflow;

export function commandIcon(flowId: string): CommandIcon {
  return BUILTIN_COMMAND_ICONS.get(flowId) ?? FLOW_COMMAND_ICON;
}

export type ChatMode = 'chat' | 'agent' | 'search' | 'quicksearch';

export interface ChatModeOption {
  mode: ChatMode;
  commandId: string;
  flowId: string | null;
  labelKey: string;
  descriptionKey: string;
  placeholderKey: string | null;
  takesAttachments: boolean;
  icon: CommandIcon;
}

export const CHAT_MODES: ChatModeOption[] = [
  {
    mode: 'chat',
    commandId: BUILTIN_CHAT_FLOW_ID,
    flowId: null,
    labelKey: 'chat.mode.chat.label',
    descriptionKey: 'chat.mode.chat.description',
    placeholderKey: null,
    takesAttachments: true,
    icon: commandIcon(BUILTIN_CHAT_FLOW_ID),
  },
  {
    mode: 'agent',
    commandId: BUILTIN_AGENT_FLOW_ID,
    flowId: BUILTIN_AGENT_FLOW_ID,
    labelKey: 'chat.mode.agent.label',
    descriptionKey: 'chat.mode.agent.description',
    placeholderKey: 'chat.mode.agent.placeholder',
    takesAttachments: true,
    icon: commandIcon(BUILTIN_AGENT_FLOW_ID),
  },
  {
    mode: 'search',
    commandId: BUILTIN_SEARCH_FLOW_ID,
    flowId: BUILTIN_SEARCH_FLOW_ID,
    labelKey: 'chat.mode.search.label',
    descriptionKey: 'chat.mode.search.description',
    placeholderKey: 'chat.mode.search.placeholder',
    takesAttachments: false,
    icon: commandIcon(BUILTIN_SEARCH_FLOW_ID),
  },
  {
    mode: 'quicksearch',
    commandId: BUILTIN_QUICKSEARCH_FLOW_ID,
    flowId: BUILTIN_QUICKSEARCH_FLOW_ID,
    labelKey: 'chat.mode.quicksearch.label',
    descriptionKey: 'chat.mode.quicksearch.description',
    placeholderKey: 'chat.mode.quicksearch.placeholder',
    takesAttachments: false,
    icon: commandIcon(BUILTIN_QUICKSEARCH_FLOW_ID),
  },
];

export const DEFAULT_CHAT_MODE: ChatMode = 'chat';

export function findChatMode(mode: ChatMode): ChatModeOption {
  return CHAT_MODES.find((option) => option.mode === mode) ?? CHAT_MODES[0];
}

export function chatModeFlowId(mode: ChatMode): string | null {
  return findChatMode(mode).flowId;
}

export function chatModeForCommandId(commandId: string): ChatMode | null {
  return CHAT_MODES.find((option) => option.commandId === commandId)?.mode ?? null;
}

export function chatModeLabelKeyForCommand(command: string): string | null {
  return CHAT_MODES.find((option) => option.flowId !== null && option.mode === command)?.labelKey ?? null;
}
