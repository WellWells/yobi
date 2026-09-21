import React from 'react';
import { Group, Menu, Text } from '@mantine/core';
import { Check, ChevronRight } from 'lucide-react';
import { geminiModelApi } from '../../api/electronApi';
import { useAppStore } from '../../store/appStore';
import { geminiModelShortLabel, selectedGeminiModel } from '../../../../shared/geminiModels';
import type { GeminiModelChoice, GeminiModelState } from '../../../../shared/geminiModels';
import type { PickerModel } from '../../config/models';

/** Reflected in the menu at once; main's answer — and its broadcast to every window — settles it. */
export function chooseGeminiModel(patch: Partial<GeminiModelChoice>): void {
  const { geminiModels, setGeminiModels } = useAppStore.getState();
  if (geminiModels) setGeminiModels({ ...geminiModels, choice: { ...geminiModels.choice, ...patch } });
  void geminiModelApi.set(patch).then(setGeminiModels);
}

/** The page's own short form ("Flash-Lite"). Thinking has its own control in the composer. */
export const GeminiModelSummary: React.FC<{ state: GeminiModelState }> = ({ state }) => {
  const model = selectedGeminiModel(state);
  if (!model) return null;
  return <Text span fz="var(--font-size-sm)" c="dimmed">{geminiModelShortLabel(model.label)}</Text>;
};

interface GeminiModelSubmenuProps {
  model: PickerModel;
  state: GeminiModelState;
  isSelected: boolean;
  badges: React.ReactNode;
  itemStyle: React.CSSProperties;
  itemRef?: (node: HTMLButtonElement | null) => void;
  onChange: (url: string) => void;
}

/**
 * The Gemini row, opening the models the page offers. Picking one also picks Gemini. Only the
 * names are shown: the page's descriptions are in the Google account's language, not the app's.
 */
export const GeminiModelSubmenu: React.FC<GeminiModelSubmenuProps> = ({
  model, state, isSelected, badges, itemStyle, itemRef, onChange,
}) => {
  const catalog = state.catalog;
  if (!catalog) return null;
  const Icon = model.icon;

  return (
    // Fixed, because the parent dropdown scrolls: an absolutely placed submenu would be clipped by it.
    // Left first: every model menu hangs off the right edge of the window, so opening right lands
    // on top of the menu this one came from (the header's rewrite submenu did exactly that).
    <Menu.Sub floatingStrategy="fixed" position="left-start">
      <Menu.Sub.Target>
        <Menu.Sub.Item
          ref={itemRef}
          leftSection={<Icon size={15} />}
          closeMenuOnClick
          onClick={() => onChange(model.url)}
          rightSection={
            <Group gap={6} wrap="nowrap">
              <GeminiModelSummary state={state} />
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
              // onClick, not the group's onChange: that one stays silent for the row already
              // chosen, and picking it is still how the user switches the chat over to Gemini.
              onClick={() => {
                if (entry.id !== state.choice.modelId) chooseGeminiModel({ modelId: entry.id });
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
