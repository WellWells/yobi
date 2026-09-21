import React, { useEffect, useMemo, useState } from 'react';
import { Box, Code, Stack, Text, Tooltip, UnstyledButton } from '@mantine/core';
import { LayoutTemplate, Search } from 'lucide-react';
import { AppModal } from '../../components/AppModal';
import { AppTextInput } from '../../components/AppTextInput';
import { useDragScroll } from '../../hooks/useDragScroll';
import { FLOW_TEMPLATES, type FlowTemplate, type TemplateCategory } from './examples';
import { TemplateIcon } from './TemplateIcon';
import classes from './FlowTemplatesModal.module.css';
import { Z_MODAL } from '../../config/zLayers';

interface FlowTemplatesModalProps {
  open: boolean;
  t: (key: string) => string;
  onClose: () => void;
  onPick: (template: FlowTemplate) => void;
  /**
   * Mantine gives each Modal its own Escape listener, so with the setup wizard stacked on top
   * one keypress closes both and the gallery never gets to be the thing you come back to.
   */
  escapeDisabled?: boolean;
}

const CATEGORIES: { key: TemplateCategory; labelKey: string; descKey: string }[] = [
  { key: 'push', labelKey: 'flow.templates.category.push', descKey: 'flow.templates.category.push.desc' },
  { key: 'command', labelKey: 'flow.templates.category.command', descKey: 'flow.templates.category.command.desc' },
];

/**
 * The rail hides its scrollbar, and a Windows mouse has no horizontal axis, so a plain
 * wheel has to move it. Left alone when the gesture is already horizontal (a trackpad
 * swipe) or when there is nothing to scroll.
 */
function railWheel(e: React.WheelEvent<HTMLDivElement>): void {
  const rail = e.currentTarget;
  if (rail.scrollWidth <= rail.clientWidth) return;
  if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
  rail.scrollLeft += e.deltaY;
}

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

export const FlowTemplatesModal: React.FC<FlowTemplatesModalProps> = ({
  open, t, onClose, onPick, escapeDisabled = false,
}) => {
  const [query, setQuery] = useState('');
  // One instance for both rails: only one can be under the pointer at a time.
  const dragScroll = useDragScroll();

  // A gallery that reopens still filtered to the last search looks empty for no stated reason.
  // Keyed on `open` only, so returning from the wizard keeps the search the user typed.
  useEffect(() => {
    if (open) setQuery('');
  }, [open]);

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
    <AppModal
      opened={open}
      onClose={onClose}
      title={t('flow.templates')}
      icon={<LayoutTemplate size={16} />}
      size="min(54rem, 90vw)"
      yOffset="8dvh"
      zIndex={Z_MODAL}
      closeOnEscape={!escapeDisabled}
    >
      <Stack gap="lg">
        <AppTextInput
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.currentTarget.value)}
          placeholder={t('flow.templates.search.placeholder')}
          leftSection={<Search size={14} />}
          tone="tertiary"
        />

        {matches.length === 0 && (
          <Text fz="sm" c="dimmed" ta="center" py="lg">
            {t('flow.templates.search.noMatch')}
          </Text>
        )}

        {CATEGORIES.map(({ key, labelKey, descKey }) => {
          const templates = byCategory.get(key) ?? [];
          if (templates.length === 0) return null;
          return (
            <Stack key={key} gap={10}>
              {/* Heading plus one line on what the whole category does, so a tile can get
                  away with carrying nothing but its name. */}
              <Stack gap={2}>
                <Text fz="xs" fw={700} c="dimmed" tt="uppercase" style={{ letterSpacing: 0.4 }}>
                  {t(labelKey)}
                </Text>
                <Text fz="xs" c="dimmed" lh={1.4}>
                  {t(descKey)}
                </Text>
              </Stack>

              <Box className={classes.rail} onWheel={railWheel} {...dragScroll}>
                {templates.map((tpl) => (
                  // The description lives here rather than on the tile: clamped to two lines it
                  // ellipsised the longer half of the catalogue, and it was the single biggest
                  // contributor to the gallery's height. A tooltip is mouse-only, so the copy
                  // also reaches the accessible name below.
                  <Tooltip
                    key={tpl.key}
                    label={t(tpl.descKey)}
                    position="bottom"
                    maw={280}
                    multiline
                    events={{ hover: true, focus: true, touch: false }}
                  >
                    <UnstyledButton
                      className={classes.tile}
                      aria-label={`${t(tpl.titleKey)} ${t(tpl.descKey)}`}
                      onClick={() => { onPick(tpl); }}
                    >
                      <TemplateIcon template={tpl} size={28} />

                      <Text fz="sm" fw={600} className={classes.title}>
                        {t(tpl.titleKey)}
                      </Text>

                      {/* One fact per tile: how you invoke it, or how much it wants from you. */}
                      <Box className={classes.meta}>
                        {tpl.command ? (
                          <Code fz={10} fw={600}>{`/${tpl.command}`}</Code>
                        ) : (
                          <Text fz={10} c="dimmed">
                            {tpl.setupCount > 0
                              ? t('flow.templates.setup').replace('{{count}}', String(tpl.setupCount))
                              : t('flow.templates.ready')}
                          </Text>
                        )}
                      </Box>
                    </UnstyledButton>
                  </Tooltip>
                ))}
              </Box>
            </Stack>
          );
        })}
      </Stack>
    </AppModal>
  );
};
