import React, { useMemo } from 'react';
import { Button, Group, Stack, Text } from '@mantine/core';
import { Plus, Search, Sparkles } from 'lucide-react';
import { AppTextInput } from '../../components/AppTextInput';
import { FLOW_TEMPLATES, type FlowTemplate, type TemplateCategory } from './examples';
import { TemplateRail } from './TemplateRail';

interface FlowTemplateGalleryProps {
  t: (key: string) => string;
  query: string;
  /** Its own search box (the dialog); the landing page's 範本 tab searches from the page's toolbar. */
  onQueryChange?: (query: string) => void;
  onPick: (template: FlowTemplate) => void;
  /** Creates an empty flow: the gallery is where a new flow starts, so starting blank lives here too. */
  onBlank: () => void;
  /**
   * Opens "Create with AI", seeded with the search when nothing in the catalogue matched it: that
   * text is the user's own words for the flow they were looking for.
   */
  onGenerate: (seed: string) => void;
}

/**
 * Rail order, least to set up first: selected text needs nothing, a folder needs one answer and no
 * bot, then the scheduled rails, split by what they bring you so none of them runs to a third
 * screen, and the slash commands last.
 */
const CATEGORIES: { key: TemplateCategory; labelKey: string; descKey: string }[] = [
  { key: 'hotkey', labelKey: 'flow.templates.category.hotkey', descKey: 'flow.templates.category.hotkey.desc' },
  { key: 'file', labelKey: 'flow.templates.category.file', descKey: 'flow.templates.category.file.desc' },
  { key: 'brief', labelKey: 'flow.templates.category.brief', descKey: 'flow.templates.category.brief.desc' },
  { key: 'follow', labelKey: 'flow.templates.category.follow', descKey: 'flow.templates.category.follow.desc' },
  { key: 'chats', labelKey: 'flow.templates.category.chats', descKey: 'flow.templates.category.chats.desc' },
  { key: 'command', labelKey: 'flow.templates.category.command', descKey: 'flow.templates.category.command.desc' },
];

/**
 * Everything a template can be recognised by. The raw skill type is in there alongside its
 * translated name so "line" finds the LINE templates whichever language the app is in.
 */
function haystack(tpl: FlowTemplate, t: (key: string) => string): string {
  return [
    t(tpl.titleKey),
    t(tpl.descKey),
    tpl.command ?? '',
    tpl.primarySkill,
    t(`flow.skill.${tpl.primarySkill}`),
  ].join(' ').toLowerCase();
}

/** The template catalogue: the "new flow" dialog's body, and the landing page's 範本 tab. */
export const FlowTemplateGallery: React.FC<FlowTemplateGalleryProps> = ({
  t, query, onQueryChange, onPick, onBlank, onGenerate,
}) => {
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return FLOW_TEMPLATES;
    const terms = q.split(/\s+/);
    return FLOW_TEMPLATES.filter((tpl) => {
      const text = haystack(tpl, t);
      return terms.every((term) => text.includes(term));
    });
  }, [query, t]);

  const byCategory = useMemo(() => {
    const groups = new Map<TemplateCategory, FlowTemplate[]>();
    for (const tpl of matches) {
      const list = groups.get(tpl.category) ?? [];
      list.push(tpl);
      groups.set(tpl.category, list);
    }
    return groups;
  }, [matches]);

  return (
    <Stack gap="lg">
      <Stack gap="sm">
        {onQueryChange && (
          <AppTextInput
            autoFocus
            value={query}
            onChange={(e) => onQueryChange(e.currentTarget.value)}
            placeholder={t('flow.templates.search.placeholder')}
            leftSection={<Search size={14} />}
            tone="tertiary"
          />
        )}

        {/* Not filtered by the search: they are the way out when nothing in the catalogue fits. */}
        <Group gap="xs">
          <Button variant="default" size="xs" leftSection={<Plus size={14} />} onClick={onBlank}>
            {t('flow.templates.blank')}
          </Button>
          <Button
            variant="default"
            size="xs"
            leftSection={<Sparkles size={14} />}
            onClick={() => onGenerate(matches.length === 0 ? query.trim() : '')}
          >
            {t('flow.generate')}
          </Button>
        </Group>
      </Stack>

      {matches.length === 0 && (
        <Text fz="sm" c="var(--text-muted)" ta="center" py="lg">
          {t('flow.templates.search.noMatch')}
        </Text>
      )}

      {CATEGORIES.map(({ key, labelKey, descKey }) => {
        const templates = byCategory.get(key) ?? [];
        if (templates.length === 0) return null;
        return (
          <TemplateRail
            key={key}
            label={t(labelKey)}
            blurb={t(descKey)}
            templates={templates}
            t={t}
            onPick={onPick}
          />
        );
      })}
    </Stack>
  );
};
