import React from 'react';
import { Group, Menu, Text } from '@mantine/core';
import { Check, ChevronRight } from 'lucide-react';
import { chatgptModelApi } from '../../api/electronApi';
import { useAppStore } from '../../store/appStore';
import { selectedChatgptModel } from '../../../../shared/chatgptModels';
import type { ChatgptModelChoice, ChatgptModelState } from '../../../../shared/chatgptModels';
import type { PickerModel } from '../../config/models';

/** Reflected in the menu at once; main's answer — and its broadcast to every window — settles it. */
export function chooseChatgptModel(patch: Partial<ChatgptModelChoice>): void {
  const { chatgptModels, setChatgptModels } = useAppStore.getState();
  if (chatgptModels) setChatgptModels({ ...chatgptModels, choice: { ...chatgptModels.choice, ...patch } });
  void chatgptModelApi.set(patch).then(setChatgptModels);
}

/** The chosen version on a plan with a choice of them; nothing on a plan without (Free). */
export function chatgptSummaryText(state: ChatgptModelState | null): string | null {
  return selectedChatgptModel(state)?.label ?? null;
}

/** "GPT-5.6 Sol". The effort step and the thinking switch have their own control in the composer. */
export const ChatgptModelSummary: React.FC<{ state: ChatgptModelState }> = ({ state }) => {
  const text = chatgptSummaryText(state);
  if (!text) return null;
  return <Text span fz="var(--font-size-sm)" c="dimmed">{text}</Text>;
};

interface ChatgptModelSubmenuProps {
  model: PickerModel;
  state: ChatgptModelState;
  isSelected: boolean;
  badges: React.ReactNode;
  itemStyle: React.CSSProperties;
  itemRef?: (node: HTMLButtonElement | null) => void;
  onChange: (url: string) => void;
}

/** The ChatGPT row on a plan with versions (Plus), opening them. Picking one also picks ChatGPT. */
export const ChatgptModelSubmenu: React.FC<ChatgptModelSubmenuProps> = ({
  model, state, isSelected, badges, itemStyle, itemRef, onChange,
}) => {
  const catalog = state.catalog;
  if (!catalog) return null;
  const Icon = model.icon;

  return (
    // Fixed and opening left, for the same reasons as the Gemini submenu: the parent scrolls, and
    // every model menu hangs off the right edge of the window.
    <Menu.Sub floatingStrategy="fixed" position="left-start">
      <Menu.Sub.Target>
        <Menu.Sub.Item
          ref={itemRef}
          leftSection={<Icon size={15} />}
          closeMenuOnClick
          onClick={() => onChange(model.url)}
          rightSection={
            <Group gap={6} wrap="nowrap">
              <ChatgptModelSummary state={state} />
              {badges}
              {isSelected && <Check size={13} color="var(--mantine-color-accent)" />}
              <ChevronRight size={14} color="var(--mantine-color-dimmed)" />
            </Group>
          }
          style={itemStyle}
        >
          {model.label}
        </Menu.Sub.Item>
      </Menu.Sub.Target>

      <Menu.Sub.Dropdown miw={180}>
        <Menu.RadioGroup value={state.choice.modelId}>
          {catalog.models.map((entry) => (
            <Menu.RadioItem
              key={entry.id}
              value={entry.id}
              closeMenuOnClick
              // onClick, not the group's onChange: that one stays silent for the row already chosen,
              // and picking it is still how the user switches the chat over to ChatGPT.
              onClick={() => {
                if (entry.id !== state.choice.modelId) chooseChatgptModel({ modelId: entry.id });
                onChange(model.url);
              }}
            >
              {entry.label}
            </Menu.RadioItem>
          ))}
        </Menu.RadioGroup>
      </Menu.Sub.Dropdown>
    </Menu.Sub>
  );
};
