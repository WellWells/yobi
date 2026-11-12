import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Anchor, Box, Chip, CopyButton, Flex, Group, Pill, Stack, Text, Tooltip, UnstyledButton } from '@mantine/core';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useShallow } from 'zustand/react/shallow';
import { useAppStore } from '../store/appStore';
import { useI18nStore } from '../store/i18nStore';
import { clipboardApi, systemApi } from '../api/electronApi';
import { PanelToolbar, ToolbarIconButton, ToolbarSearchInput } from './PanelToolbar';
import { EmptyState } from './EmptyState';
import { CopyIconButton } from './CopyIconButton';
import { Check, Copy, FolderOpen, ScrollText, Trash, Upload } from 'lucide-react';
import {
  LOG_LEVELS,
  filterLogs,
  isAllLevels,
  isolateLevel,
  parseLogLine,
  scopeRoot,
  splitLogUrls,
  toggleLevel,
  toggleScope,
  type LogLevel,
  type LogTone,
} from './logFormat';
import styles from './LogPanel.module.css';
import { useShortcutAction } from '../shortcuts/useShortcutAction';

const toneTextColor: Record<LogTone, string> = {
  error: 'var(--mantine-color-error)',
  warning: 'var(--mantine-color-warning)',
  success: 'var(--mantine-color-success)',
  active: 'var(--mantine-color-accent)',
  plain: 'var(--text-secondary)',
};

const levelTagClass: Record<LogLevel, string> = {
  error: styles.levelError,
  warning: styles.levelWarning,
  info: styles.levelInfo,
};

const levelLabelKey: Record<LogLevel, string> = {
  error: 'log.level.error',
  warning: 'log.level.warning',
  info: 'log.level.info',
};

function openLogLink(event: React.MouseEvent<HTMLAnchorElement>): void {
  event.preventDefault();
  void clipboardApi.openExternalUrl(event.currentTarget.href);
}

interface LogEntryProps {
  log: string;
  index: number;
  onLevelClick: (level: LogLevel) => void;
  onScopeClick: (scope: string) => void;
  levelHint: string;
  levelLabels: Record<LogLevel, string>;
  scopeHint: string;
}

export const LogEntry = React.memo<LogEntryProps>(({
  log, index, onLevelClick, onScopeClick, levelHint, levelLabels, scopeHint,
}) => {
  const t = useI18nStore((s) => s.t);
  const { time, scope, depth, text, level, tone, startsRun } = parseLogLine(log);
  const rowClass = [
    styles.logEntry,
    index % 2 !== 0 ? styles.odd : styles.even,
    startsRun && index > 0 ? styles.runStart : '',
  ].filter(Boolean).join(' ');

  return (
    <Flex className={rowClass} align="baseline" gap={8} px={6} py={3}>
      <UnstyledButton
        className={`${styles.level} ${levelTagClass[level]}`}
        onClick={() => onLevelClick(level)}
        aria-label={`${levelHint}: ${levelLabels[level]}`}
      >
        {`[${levelLabels[level]}]`}
      </UnstyledButton>
      {time && (
        <Text component="span" size="sm" lh={1.6} className={styles.logTime}>
          {time}
        </Text>
      )}
      <Flex gap={6} align="baseline" className={styles.message} style={{ paddingLeft: Math.min(depth, 4) * 14 }}>
        {scope && (
          <Tooltip label={scope} multiline>
            <UnstyledButton
              className={styles.scope}
              onClick={() => onScopeClick(scope)}
              aria-label={`${scopeHint}: ${scope}`}
            >
              {scope}
            </UnstyledButton>
          </Tooltip>
        )}
        <Text
          component="span"
          size="sm"
          c={toneTextColor[tone]}
          lh={1.6}
          fw={startsRun ? 600 : undefined}
          className={styles.logText}
        >
          {splitLogUrls(text).map((segment, i) => (segment.href ? (
            <Tooltip key={i} label={segment.href} inline multiline>
              <Anchor href={segment.href} inherit c="var(--mantine-color-accent)" underline={tone === 'active' ? 'always' : 'hover'} onClick={openLogLink}>
                {segment.text}
              </Anchor>
            </Tooltip>
          ) : (
            <React.Fragment key={i}>{segment.text}</React.Fragment>
          )))}
        </Text>
      </Flex>
      <Box className={styles.copyEntry}>
        <CopyIconButton value={log} copyLabel={t('log.copy.entry')} copiedLabel={t('common.copied')} size={22} />
      </Box>
    </Flex>
  );
});

LogEntry.displayName = 'LogEntry';

/** A page of Settings: it takes no props, so the redraws of Settings around it never reach it. */
export const LogPanel = React.memo(() => {
  const { logs, clearLogs, logLevelRequest, clearLogLevelRequest } = useAppStore(
    useShallow((s) => ({
      logs: s.logs,
      clearLogs: s.clearLogs,
      logLevelRequest: s.logLevelRequest,
      clearLogLevelRequest: s.clearLogLevelRequest,
    })),
  );
  const t = useI18nStore((s) => s.t);
  const viewportRef = useRef<HTMLDivElement>(null);
  const filterInputRef = useRef<HTMLInputElement>(null);
  const isNearBottomRef = useRef(true);
  const [query, setQuery] = useState('');
  const [levels, setLevels] = useState<LogLevel[]>([...LOG_LEVELS]);
  const [scope, setScope] = useState('');

  // Arriving from another view that asked for a specific level, e.g. the failure count in
  // the statistics page. Consumed once so the filter stays the user's after that.
  useEffect(() => {
    if (!logLevelRequest) return;
    setLevels([...logLevelRequest]);
    setQuery('');
    setScope('');
    clearLogLevelRequest();
  }, [logLevelRequest, clearLogLevelRequest]);

  const allLevels = isAllLevels(levels);
  const isFiltering = query.trim().length > 0 || !allLevels || scope !== '';

  const visibleLogs = useMemo(
    () => filterLogs(logs, { query, levels, scope }),
    [logs, query, levels, scope],
  );

  const handleClear = useCallback(() => clearLogs(), [clearLogs]);
  const handleOpenFolder = useCallback(() => { void systemApi.openLogDir(); }, []);

  const handleScopeClick = useCallback((clicked: string) => {
    setScope((current) => toggleScope(current, scopeRoot(clicked)));
  }, []);

  const handleScopeClear = useCallback(() => setScope(''), []);

  const handleLevelClick = useCallback((level: LogLevel) => {
    setLevels((current) => isolateLevel(current, level));
  }, []);

  // With "All" on, the level chips show unchecked and picking one narrows to it; otherwise
  // they toggle, and turning the last level off (or the last missing one on) goes back to "All".
  const handleLevelToggle = useCallback((level: LogLevel) => {
    setLevels((current) => (isAllLevels(current) ? [level] : toggleLevel(current, level)));
  }, []);

  const handleAllLevels = useCallback(() => setLevels([...LOG_LEVELS]), []);

  const handleExport = useCallback(() => {
    const content = visibleLogs.join('\n');
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const now = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    a.href = url;
    a.download = `yobi-logs-${now}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }, [visibleLogs]);

  useShortcutAction('nav.find', () => {
    filterInputRef.current?.focus();
    filterInputRef.current?.select();
  }, 'logs');

  const rowVirtualizer = useVirtualizer({
    count: visibleLogs.length,
    getScrollElement: () => viewportRef.current,
    estimateSize: () => 26,
    overscan: 15,
  });

  const handleScroll = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const { scrollTop, scrollHeight, clientHeight } = viewport;
    isNearBottomRef.current = scrollHeight - scrollTop - clientHeight <= 100;
  }, []);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    viewport.addEventListener('scroll', handleScroll, { passive: true });
    return () => viewport.removeEventListener('scroll', handleScroll);
  }, [handleScroll]);

  useEffect(() => {
    if (!isNearBottomRef.current || visibleLogs.length === 0) return;
    rowVirtualizer.scrollToIndex(visibleLogs.length - 1, { align: 'end' });
  }, [visibleLogs.length, rowVirtualizer]);

  const scopeHint = t('log.scope.filter');
  const levelHint = t('log.level.filter');

  const levelLabels = useMemo(() => ({
    error: t(levelLabelKey.error),
    warning: t(levelLabelKey.warning),
    info: t(levelLabelKey.info),
  }), [t]);

  return (
    <Stack gap={0} h="100%" className={styles.panel} style={{ overflow: 'hidden' }}>
      {/* The pane beside the settings nav is narrow in a small window: there the level chips take a
          row of their own under the rest (by the pane's width, not the window's; LogPanel.module.css). */}
      <PanelToolbar className={styles.toolbar} justify="flex-start">
        <ToolbarSearchInput
          ref={filterInputRef}
          flex="0 1 220px"
          miw={110}
          value={query}
          onChange={setQuery}
          placeholder={t('log.filter.placeholder')}
          clearLabel={t('log.filter.clear')}
        />

        <Group gap={4} wrap="nowrap" className={styles.levels} style={{ flexShrink: 0 }}>
          <Chip
            size="xs"
            variant="outline"
            color="brand"
            checked={allLevels}
            onChange={handleAllLevels}
          >
            {t('log.level.all')}
          </Chip>
          {LOG_LEVELS.map((level) => (
            <Chip
              key={level}
              size="xs"
              variant="outline"
              color="brand"
              checked={!allLevels && levels.includes(level)}
              onChange={() => handleLevelToggle(level)}
            >
              {levelLabels[level]}
            </Chip>
          ))}
        </Group>

        {scope && (
          <Pill
            size="sm"
            withRemoveButton
            onRemove={handleScopeClear}
            removeButtonProps={{ 'aria-label': t('log.scope.clear') }}
            style={{ minWidth: 60, maxWidth: 200 }}
          >
            {scope}
          </Pill>
        )}

        <Group gap={4} wrap="nowrap" ml="auto" style={{ flexShrink: 0 }}>
          <Text fz="var(--font-size-sm)" c="dimmed" mr={4} style={{ whiteSpace: 'nowrap' }}>
            {isFiltering ? `${visibleLogs.length}/${logs.length}` : logs.length} {t('log.entries')}
          </Text>
          <ToolbarIconButton icon={FolderOpen} label={t('log.openFolder')} onClick={handleOpenFolder} />
          <CopyButton value={visibleLogs.join('\n')}>
            {({ copied, copy }) => (
              <ToolbarIconButton
                icon={copied ? Check : Copy}
                label={copied ? t('common.copied') : t('log.copy.filtered')}
                onClick={copy}
                disabled={visibleLogs.length === 0}
              />
            )}
          </CopyButton>
          <ToolbarIconButton
            icon={Upload}
            label={t('log.export')}
            onClick={handleExport}
            disabled={visibleLogs.length === 0}
          />
          <ToolbarIconButton
            icon={Trash}
            label={t('log.clear')}
            onClick={handleClear}
            disabled={logs.length === 0}
          />
        </Group>
      </PanelToolbar>

      <Box
        flex={1}
        ref={viewportRef}
        bg="var(--mantine-color-body)"
        px={10}
        py={10}
        ff="var(--font-mono)"
        fz="var(--font-size-sm)"
        style={{ overflowY: 'auto' }}
      >
        {visibleLogs.length === 0 ? (
          <EmptyState icon={ScrollText} label={isFiltering ? t('log.empty.filtered') : t('log.empty')} fill />
        ) : (
          <Box style={{ height: `${rowVirtualizer.getTotalSize()}px`, position: 'relative' }}>
            {rowVirtualizer.getVirtualItems().map((virtualRow) => (
              <Box
                key={virtualRow.key}
                ref={rowVirtualizer.measureElement}
                data-index={virtualRow.index}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${virtualRow.start}px)`,
                }}
              >
                <LogEntry
                  log={visibleLogs[virtualRow.index]}
                  index={virtualRow.index}
                  onLevelClick={handleLevelClick}
                  onScopeClick={handleScopeClick}
                  levelHint={levelHint}
                  levelLabels={levelLabels}
                  scopeHint={scopeHint}
                />
              </Box>
            ))}
          </Box>
        )}
      </Box>
    </Stack>
  );
});

LogPanel.displayName = 'LogPanel';
