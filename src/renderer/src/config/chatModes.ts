import type { ComponentType } from 'react';
import { BrainCircuit, MessageSquare, SquarePen, Waypoints, Workflow } from 'lucide-react';
import {
  BUILTIN_AGENT_FLOW_ID,
  BUILTIN_CHAT_FLOW_ID,
  BUILTIN_MODEL_FLOW_ID,
  BUILTIN_NEW_FLOW_ID,
} from '../../../shared/types';

export type CommandIcon = ComponentType<{ size?: number }>;

export const BUILTIN_COMMAND_ICONS = new Map<string, CommandIcon>([
  [BUILTIN_NEW_FLOW_ID, SquarePen],
  // Not a provider's mark: those stand for the providers in the model menu right below.
  [BUILTIN_MODEL_FLOW_ID, BrainCircuit],
  [BUILTIN_CHAT_FLOW_ID, MessageSquare],
  [BUILTIN_AGENT_FLOW_ID, Waypoints],
]);

export const FLOW_COMMAND_ICON: CommandIcon = Workflow;

export function commandIcon(flowId: string): CommandIcon {
  return BUILTIN_COMMAND_ICONS.get(flowId) ?? FLOW_COMMAND_ICON;
}

export type ChatMode = 'chat' | 'agent';

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

/**
 * Which form a send takes. There is no mode picker any more: holding a capability — the web, or
 * any connector — IS the statement that this send should be able to act, so it runs as an agent.
 * With every capability off there is nothing to act with, and a plain chat turn is both faster
 * and the only shape that can continue the provider's own thread natively.
 */
export function chatModeForCapabilities(web: boolean, connectorIds: readonly string[]): ChatMode {
  return web || connectorIds.length > 0 ? 'agent' : 'chat';
}

export function chatModeLabelKeyForCommand(command: string): string | null {
  return CHAT_MODES.find((option) => option.flowId !== null && option.mode === command)?.labelKey ?? null;
}
