import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Divider, Group, Menu, SimpleGrid, Stack, Text, Title } from '@mantine/core';
import {
  ArrowUpDown, Check, ChevronDown, Download, LayoutTemplate, ListFilter, Plus, Search, Sparkles, Workflow,
} from 'lucide-react';
import type { FlowDefinition, TriggerType } from '../../../../shared/types';
import type { FlowFolder } from '../../../../shared/flowFolders';
import { AppButton } from '../../components/AppButton';
import { AppSegmentedControl } from '../../components/AppSegmentedControl';
import { GroupHeader } from '../../components/GroupHeader';
import { ToolbarIconButton, ToolbarSearchInput } from '../../components/PanelToolbar';
import { Z_POPOVER } from '../../config/zLayers';
import { useScrollEdgeFade } from '../../hooks/useScrollEdgeFade';
import type { FlowTemplate } from './examples';
import { FlowTemplateGallery } from './FlowTemplateGallery';
import { FlowCard, TRIGGER_ICON, TemplateCard } from './FlowHomeCards';
import {
  featuredTemplates, filterFlows, groupByCategory, sortFlows, triggerKindsOf,
} from './flowHomeModel';
import type { FlowHomeFilter, FlowHomeSort, FlowHomeStatus } from './flowHomeModel';
import { flowRowStatus } from './flowRowStatus';
import { useFlowLastRuns, useFlowNextRuns } from './useFlowRowFacts';

type HomeTab = 'flows' | 'templates';

/** Cards two to a row once the page is this wide (by the grid's own width, not the window's). */
const TWO_CARDS_FROM = '520px';
const NO_FILTER: FlowHomeFilter = { status: 'all', kinds: [] };
const SORTS: readonly FlowHomeSort[] = ['order', 'name', 'lastRun'];
const STATUSES: readonly FlowHomeStatus[] = ['all', 'enabled', 'disabled'];

interface FlowHomeProps {
  flows: FlowDefinition[];
  folders: FlowFolder[];
  t: (key: string) => string;
  locale: string;
  /** Opens 智慧分類 (the sidebar's ✨ beside 新增分類); unset while every flow is in a category. */
  onSmartSort?: () => void;
  onOpenFlow: (flowId: string) => void;
  onBlank: () => void;
  onGenerate: (seed: string) => void;
  onImport: () => void;
  onPickTemplate: (template: FlowTemplate) => void;
}

/**
 * The flow page with no flow open, after Claude's scheduled-tasks page: a page title, your flows
 * or the templates, one toolbar. Your flows are cards grouped by category (as the sidebar); with
 * none yet, a way to start blank and six templates to start from.
 */
export const FlowHome: React.FC<FlowHomeProps> = ({
  flows, folders, t, locale, onSmartSort, onOpenFlow, onBlank, onGenerate, onImport, onPickTemplate,
}) => {
  const [tab, setTab] = useState<HomeTab>('flows');
  // Each tab searches its own list.
  const [queries, setQueries] = useState<Record<HomeTab, string>>({ flows: '', templates: '' });
  const [searchOpen, setSearchOpen] = useState(false);
  const [filter, setFilter] = useState<FlowHomeFilter>(NO_FILTER);
  const [sort, setSort] = useState<FlowHomeSort>('order');
  const searchRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fadeClass = useScrollEdgeFade(scrollRef);
  const lastRuns = useFlowLastRuns();
  const nextRuns = useFlowNextRuns();
  const query = queries[tab];
  // A tab whose search has words shows them: the list is never filtered by a box the user can't see.
  const showSearch = searchOpen || query !== '';

  useEffect(() => {
    if (searchOpen) searchRef.current?.focus();
  }, [searchOpen]);

  const compareNames = useMemo(() => new Intl.Collator(locale, { numeric: true, sensitivity: 'base' }).compare, [locale]);
  const groups = useMemo(() => {
    const shown = sortFlows(
      filterFlows(flows, queries.flows, filter),
      sort,
      (id) => (lastRuns[id] ? Date.parse(lastRuns[id].at) : undefined),
      compareNames,
    );
    return groupByCategory(shown, folders, compareNames);
  }, [flows, folders, queries.flows, filter, sort, lastRuns, compareNames]);
  // Only the ways to start that some flow has: a filter for none would list nothing.
  const kinds = useMemo(() => [...new Set(flows.flatMap(triggerKindsOf))], [flows]);
  const featured = useMemo(() => featuredTemplates(), []);
  const filtered = filter.status !== 'all' || filter.kinds.length > 0;
  const shownCount = groups.reduce((sum, group) => sum + group.flows.length, 0);

  const setQuery = (value: string): void => setQueries((current) => ({ ...current, [tab]: value }));
  const closeSearch = (): void => {
    setQuery('');
    setSearchOpen(false);
  };
  const toggleKind = (kind: TriggerType): void => setFilter((current) => ({
    ...current,
    kinds: current.kinds.includes(kind) ? current.kinds.filter((each) => each !== kind) : [...current.kinds, kind],
  }));

  const toolbar = (
    <Group gap={4} wrap="nowrap">
      {showSearch ? (
        <ToolbarSearchInput
          ref={searchRef}
          flex="0 1 220px"
          miw={140}
          value={query}
          onChange={setQuery}
          placeholder={t(tab === 'flows' ? 'flow.home.search' : 'flow.templates.search.placeholder')}
          clearLabel={t('flow.home.search.clear')}
          onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); closeSearch(); } }}
        />
      ) : (
        <ToolbarIconButton icon={Search} label={t('flow.home.search')} onClick={() => setSearchOpen(true)} />
      )}
      {tab === 'flows' && flows.length > 0 && (
        <>
          <Menu position="bottom-end" offset={4} withinPortal zIndex={Z_POPOVER} closeOnItemClick={false}>
            <Menu.Target>
              <ToolbarIconButton icon={ListFilter} label={t('flow.home.filter')} active={filtered} onClick={() => undefined} />
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Label>{t('flow.home.filter.status')}</Menu.Label>
              {STATUSES.map((status) => (
                <Menu.Item
                  key={status}
                  rightSection={filter.status === status ? <Check size={13} /> : null}
                  onClick={() => setFilter((current) => ({ ...current, status }))}
                >
                  {t(`flow.home.filter.status.${status}`)}
                </Menu.Item>
              ))}
              <Menu.Divider />
              <Menu.Label>{t('flow.home.filter.trigger')}</Menu.Label>
              {kinds.map((kind) => {
                const Icon = TRIGGER_ICON[kind];
                return (
                  <Menu.Item
                    key={kind}
                    leftSection={<Icon size={13} />}
                    rightSection={filter.kinds.includes(kind) ? <Check size={13} /> : null}
                    onClick={() => toggleKind(kind)}
                  >
                    {t(`flow.trigger.${kind}`)}
                  </Menu.Item>
                );
              })}
              {filtered && (
                <>
                  <Menu.Divider />
                  <Menu.Item onClick={() => setFilter(NO_FILTER)}>{t('flow.home.filter.clear')}</Menu.Item>
                </>
              )}
            </Menu.Dropdown>
          </Menu>
          <Menu position="bottom-end" offset={4} withinPortal zIndex={Z_POPOVER}>
            <Menu.Target>
              <ToolbarIconButton icon={ArrowUpDown} label={t('flow.home.sort')} onClick={() => undefined} />
            </Menu.Target>
            <Menu.Dropdown>
              {SORTS.map((each) => (
                <Menu.Item key={each} rightSection={sort === each ? <Check size={13} /> : null} onClick={() => setSort(each)}>
                  {t(`flow.home.sort.${each}`)}
                </Menu.Item>
              ))}
            </Menu.Dropdown>
          </Menu>
          {onSmartSort && <ToolbarIconButton icon={Sparkles} label={t('flow.folder.sort.title')} onClick={onSmartSort} />}
        </>
      )}
      {/* The one framed control in the row. */}
      <Menu position="bottom-end" offset={4} withinPortal zIndex={Z_POPOVER}>
        <Menu.Target>
          <AppButton size="xs" variant="default" leftSection={<Plus size={14} />} rightSection={<ChevronDown size={13} />} ml={4}>
            {t('flow.newFlow')}
          </AppButton>
        </Menu.Target>
        <Menu.Dropdown>
          <Menu.Item leftSection={<LayoutTemplate size={13} />} onClick={() => { setSearchOpen(false); setTab('templates'); }}>
            {t('flow.home.new.template')}
          </Menu.Item>
          <Menu.Item leftSection={<Plus size={13} />} onClick={onBlank}>{t('flow.templates.blank')}</Menu.Item>
          <Menu.Item leftSection={<Sparkles size={13} />} onClick={() => onGenerate('')}>{t('flow.generate')}</Menu.Item>
          <Menu.Item leftSection={<Download size={13} />} onClick={onImport}>{t('flow.import')}</Menu.Item>
        </Menu.Dropdown>
      </Menu>
    </Group>
  );

  const renderFlows = (): React.ReactNode => {
    if (flows.length === 0) {
      return (
        <Stack gap="xl">
          <Stack gap="sm" align="center" py="xl">
            <Box c="var(--text-muted)"><Workflow size={72} strokeWidth={1} aria-hidden /></Box>
            <Text fz="sm" c="var(--text-muted)">{t('flow.home.none')}</Text>
            <AppButton size="xs" variant="default" leftSection={<Plus size={14} />} onClick={onBlank}>
              {t('flow.home.blank')}
            </AppButton>
          </Stack>
          <Divider />
          <Stack gap="sm">
            <GroupHeader variant="plain" label={t('flow.home.featured')} />
            <SimpleGrid type="container" cols={{ base: 1, [TWO_CARDS_FROM]: 2 }} spacing={10} verticalSpacing={10}>
              {featured.map((template) => (
                <TemplateCard key={template.key} template={template} t={t} locale={locale} onPick={onPickTemplate} />
              ))}
            </SimpleGrid>
          </Stack>
        </Stack>
      );
    }
    if (shownCount === 0) {
      return <Text fz="sm" c="var(--text-muted)" ta="center" py="xl">{t('flow.home.noMatch')}</Text>;
    }
    const grouped = groups.some((group) => group.name !== null);
    return (
      <Stack gap="lg">
        {groups.map((group) => (
          <Stack key={group.name ?? ''} gap="sm">
            {grouped && <GroupHeader variant="plain" label={group.name ?? t('flow.home.uncategorized')} />}
            <SimpleGrid type="container" cols={{ base: 1, [TWO_CARDS_FROM]: 2 }} spacing={10} verticalSpacing={10}>
              {group.flows.map((flow) => (
                <FlowCard
                  key={flow.id}
                  flow={flow}
                  status={flowRowStatus({ last: lastRuns[flow.id], next: nextRuns[flow.id] }, t)}
                  t={t}
                  onOpen={() => onOpenFlow(flow.id)}
                />
              ))}
            </SimpleGrid>
          </Stack>
        ))}
      </Stack>
    );
  };

  return (
    <Box ref={scrollRef} flex={1} className={fadeClass} style={{ overflowY: 'auto' }}>
      <Box maw={880} mx="auto" px={32} pt={8} pb={40}>
        <Title order={1} fz="var(--font-size-3xl)" fw={700} c="var(--mantine-color-text)" mb={16}>
          {t('nav.flow')}
        </Title>
        <Group justify="space-between" wrap="nowrap" gap="sm" mb={12}>
          <AppSegmentedControl
            size="xs"
            quiet
            fullWidth={false}
            value={tab}
            onChange={(next) => { if (next === 'flows' || next === 'templates') setTab(next); }}
            options={[
              { value: 'flows', label: t('flow.home.tab.flows') },
              { value: 'templates', label: t('flow.home.tab.templates') },
            ]}
          />
          {toolbar}
        </Group>
        <Divider mb="lg" />
        {tab === 'flows' ? renderFlows() : (
          <FlowTemplateGallery
            t={t}
            query={queries.templates}
            onPick={onPickTemplate}
            onBlank={onBlank}
            onGenerate={onGenerate}
          />
        )}
      </Box>
    </Box>
  );
};
