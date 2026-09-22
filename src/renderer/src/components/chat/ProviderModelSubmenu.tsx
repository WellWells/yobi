import React from 'react';
import { Group, Menu, Text } from '@mantine/core';
import { Check, ChevronRight } from 'lucide-react';
import type { PickerModel } from '../../config/models';

/** The only thing the submenu needs from a provider's catalog entry. */
export interface SubmenuModelEntry {
  id: string;
  label: string;
}

/** What a provider row shares with every other: the row itself, the badges, the picked model. */
export interface ProviderSubmenuRowProps {
  model: PickerModel;
  isSelected: boolean;
  badges: React.ReactNode;
  itemStyle: React.CSSProperties;
  itemRef?: (node: HTMLButtonElement | null) => void;
  onChange: (url: string) => void;
}

interface ProviderModelSubmenuProps extends ProviderSubmenuRowProps {
  entries: readonly SubmenuModelEntry[];
  selectedModelId: string;
  /** The picked model's short form, shown on the row itself. */
  summary: React.ReactNode;
  onPickModel: (id: string) => void;
}

/**
 * A provider row that opens the models that provider offers. Gemini, Claude and ChatGPT read the
 * same way here — what differs is only where the list comes from and which store the pick goes to,
 * so the placement rules and the click semantics below live in one place rather than three.
 *
 * Only the names are shown: every provider writes its model descriptions in the *account's*
 * language, which is not necessarily the app's (English on a zh-TW machine, measured).
 */
export const ProviderModelSubmenu: React.FC<ProviderModelSubmenuProps> = ({
  model, entries, selectedModelId, summary, isSelected, badges, itemStyle, itemRef, onChange, onPickModel,
}) => {
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
              {summary}
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
        <Menu.RadioGroup value={selectedModelId}>
          {entries.map((entry) => (
            <Menu.RadioItem
              key={entry.id}
              value={entry.id}
              closeMenuOnClick
              // onClick, not the group's onChange: that one stays silent for the row already
              // chosen, and picking it is still how the user switches the chat over to this provider.
              onClick={() => {
                if (entry.id !== selectedModelId) onPickModel(entry.id);
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

/** Dimmed short form on the provider row; nothing when there is no pick to show. */
export const SubmenuSummaryText: React.FC<{ text: string | null | undefined }> = ({ text }) => {
  if (!text) return null;
  return <Text span fz="var(--font-size-sm)" c="dimmed">{text}</Text>;
};
