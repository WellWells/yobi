import React from 'react';
import { Box, Group, Menu as MMenu, Text } from '@mantine/core';
import { CalendarDays, ListFilter } from 'lucide-react';
import { CONVERSATION_SORTS, isConversationSort } from '../../../../shared/sidebarView';
import type { ModelIcon } from '../../config/models';
import { useSidebarViewStore } from '../../store/sidebarViewStore';
import { ToggleSwitch } from '../ToggleSwitch';
import { SectionActionButton } from './SectionActionButton';

/** The value of the "all models" choice; a provider name is never empty. */
const ALL_MODELS = '';
const MODEL_ICON_SIZE = 14;

interface SidebarFilterMenuProps {
  /** The models the 「對話」 section's conversations came from, the most used first. */
  providers: readonly string[];
  /** The model the section is narrowed to, or null. */
  providerFilter: string | null;
  onProviderFilter: (provider: string | null) => void;
  providerIcon: (provider: string) => ModelIcon;
  t: (key: string) => string;
}

/**
 * The filter beside the 「對話」 heading, where ChatGPT, Gemini and Perplexity put theirs: Sort By
 * (it orders the folders' conversations too), Group by Date on the shared switch, and — once
 * there are conversations from two models or more — which model's to show. The model choice
 * narrows this section only; the pinned and the folders keep everything.
 */
export const SidebarFilterMenu: React.FC<SidebarFilterMenuProps> = ({
  providers, providerFilter, onProviderFilter, providerIcon, t,
}) => {
  const view = useSidebarViewStore((s) => s.view);
  const setSidebarView = useSidebarViewStore((s) => s.setSidebarView);
  return (
    <MMenu position="bottom-end" offset={4} withinPortal shadow="md" width={220}>
      <MMenu.Target>
        <SectionActionButton
          icon={ListFilter}
          label={t('sidebar.view.filter')}
          active={providerFilter !== null}
          onClick={() => undefined}
        />
      </MMenu.Target>
      <MMenu.Dropdown>
        <MMenu.Label>{t('sidebar.view.sortBy')}</MMenu.Label>
        <MMenu.RadioGroup
          value={view.sort}
          onChange={(value) => { if (isConversationSort(value)) setSidebarView({ sort: value }); }}
        >
          {CONVERSATION_SORTS.map((sort) => (
            <MMenu.RadioItem key={sort} value={sort}>{t(`sidebar.view.sort.${sort}`)}</MMenu.RadioItem>
          ))}
        </MMenu.RadioGroup>
        {/* The same switch as the settings page; the whole row toggles it and the menu stays open. */}
        <MMenu.Item
          closeMenuOnClick={false}
          leftSection={<CalendarDays size={14} />}
          rightSection={(
            <Box style={{ pointerEvents: 'none' }}>
              <ToggleSwitch
                size="sm"
                checked={view.groupByDate}
                onChange={() => {}}
                tabIndex={-1}
                aria-label={t('sidebar.view.groupByDate')}
              />
            </Box>
          )}
          onClick={() => setSidebarView({ groupByDate: !view.groupByDate })}
        >
          {t('sidebar.view.groupByDate')}
        </MMenu.Item>
        {providers.length > 1 && (
          <>
            <MMenu.Divider />
            <MMenu.Label>{t('sidebar.view.model')}</MMenu.Label>
            <MMenu.RadioGroup
              value={providerFilter ?? ALL_MODELS}
              onChange={(value) => onProviderFilter(value === ALL_MODELS ? null : value)}
            >
              <MMenu.RadioItem value={ALL_MODELS} closeMenuOnClick>
                <Group gap={8} wrap="nowrap">
                  <Box w={MODEL_ICON_SIZE} style={{ flexShrink: 0 }} />
                  <Text fz="inherit" truncate>{t('sidebar.view.allModels')}</Text>
                </Group>
              </MMenu.RadioItem>
              {providers.map((provider) => {
                const Icon = providerIcon(provider);
                return (
                  <MMenu.RadioItem key={provider} value={provider} closeMenuOnClick>
                    <Group gap={8} wrap="nowrap">
                      <Icon size={MODEL_ICON_SIZE} />
                      <Text fz="inherit" truncate>{provider}</Text>
                    </Group>
                  </MMenu.RadioItem>
                );
              })}
            </MMenu.RadioGroup>
          </>
        )}
      </MMenu.Dropdown>
    </MMenu>
  );
};
