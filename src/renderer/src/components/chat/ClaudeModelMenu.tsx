import React from 'react';
import { Group, Menu, Text } from '@mantine/core';
import { Check, ChevronRight } from 'lucide-react';
import { claudeModelApi } from '../../api/electronApi';
import { useAppStore } from '../../store/appStore';
import { selectedClaudeModel } from '../../../../shared/claudeModels';
import type { ClaudeModelChoice, ClaudeModelState } from '../../../../shared/claudeModels';
import type { PickerModel } from '../../config/models';

/**
 * Reflected in the menu at once; main's answer — and its broadcast to every window — settles it.
 * A different model hands effort and thinking back to the page, as main does.
 */
export function chooseClaudeModel(patch: Partial<ClaudeModelChoice>): void {
  const { claudeModels, setClaudeModels } = useAppStore.getState();
  if (claudeModels) {
    const current = claudeModels.choice;
    const base = patch.modelId !== undefined && patch.modelId !== current.modelId
      ? { ...current, effort: '', thinking: null }
      : current;
    setClaudeModels({ ...claudeModels, choice: { ...base, ...patch } });
  }
  void claudeModelApi.set(patch).then(setClaudeModels);
}

/** The chosen model ("Sonnet 5"). Effort and thinking have their own control in the composer. */
export const ClaudeModelSummary: React.FC<{ state: ClaudeModelState }> = ({ state }) => {
  const model = selectedClaudeModel(state);
  if (!model) return null;
  return <Text span fz="var(--font-size-sm)" c="dimmed">{model.label}</Text>;
};

interface ClaudeModelSubmenuProps {
  model: PickerModel;
  state: ClaudeModelState;
  isSelected: boolean;
  badges: React.ReactNode;
  itemStyle: React.CSSProperties;
  itemRef?: (node: HTMLButtonElement | null) => void;
  onChange: (url: string) => void;
}

/**
 * The Claude row, opening the models this account can pick. Picking one also picks Claude. Only
 * the names are shown: claude.ai writes its descriptions in the account's language, which is not
 * necessarily the app's (English on a zh-TW machine, measured).
 */
export const ClaudeModelSubmenu: React.FC<ClaudeModelSubmenuProps> = ({
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
              <ClaudeModelSummary state={state} />
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
              // and picking it is still how the user switches the chat over to Claude.
              onClick={() => {
                if (entry.id !== state.choice.modelId) chooseClaudeModel({ modelId: entry.id });
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
