import React from 'react';
import { Group, Menu, Text, VisuallyHidden } from '@mantine/core';
import { Check, ChevronRight } from 'lucide-react';
import type { PickerModel } from '../../config/models';
import { useI18nStore } from '../../store/i18nStore';

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
 * A provider row that opens that provider's models; shared by Gemini, Claude and ChatGPT.
 * Only names are shown: providers write model descriptions in the account's language, not the app's.
 */
export const ProviderModelSubmenu: React.FC<ProviderModelSubmenuProps> = ({
  model, entries, selectedModelId, summary, isSelected, badges, itemStyle, itemRef, onChange, onPickModel,
}) => {
  const Icon = model.icon;
  const t = useI18nStore((s) => s.t);

  return (
    // Fixed: the parent dropdown scrolls and would clip an absolute submenu.
    // Left first: model menus sit at the window's right edge, so opening right would cover the parent.
    <Menu.Sub floatingStrategy="fixed" position="left-start">
      <Menu.Sub.Target>
        <Menu.Sub.Item
          ref={itemRef}
          leftSection={<Icon size={15} />}
          closeMenuOnClick
          // A row that opens a submenu stays a `menuitem`, so the pick is told as "current".
          aria-current={isSelected ? 'true' : undefined}
          onClick={() => onChange(model.url)}
          rightSection={
            <Group gap={6} wrap="nowrap">
              {summary}
              {badges}
              {isSelected && <Check size={13} color="var(--mantine-color-accent-text)" />}
              <ChevronRight size={14} color="var(--mantine-color-dimmed)" />
            </Group>
          }
          style={itemStyle}
        >
          {model.label}
          {/* Screen readers rarely speak aria-current on a menuitem; the name says it too. */}
          {isSelected && <VisuallyHidden>{` ${t('a11y.f.currentChoice')}`}</VisuallyHidden>}
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
