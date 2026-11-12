import React from 'react';
import { Box, Text } from '@mantine/core';
import { ChevronDown } from 'lucide-react';
import { sectionRowKey } from '../../utils/timeGroups';
import type { SidebarSectionKey } from '../../utils/timeGroups';
import styles from '../Sidebar.module.css';

interface SectionRowProps<K extends string> {
  section: K;
  label: string;
  collapsed: boolean;
  /** Nothing in it yet (the folders heading before the first folder): no chevron, nothing to toggle. */
  empty?: boolean;
  /** What the section is narrowed to, after the name in a lighter tone (「對話 · Gemini」). */
  detail?: string;
  /** What the closed section holds that must not hide (the flow list's warning and running marks). */
  status?: React.ReactNode;
  /** The heading's own buttons at its right end — the folders' 「＋」, the conversations' filter. */
  actions?: React.ReactNode;
  onToggle: (section: K) => void;
  /** The chat list's keyboard walk; the flow list has none. */
  registerItemRef?: (key: string, node: HTMLDivElement | null) => void;
}

/**
 * A section's heading (「已釘選」「資料夾」「對話」, the flow list's 「資料夾」「流程」): its name and a
 * chevron after it, as ChatGPT's and Claude's 「最近項目 ⌄」, and the section's own buttons at the
 * right end, as their filter beside 「最近項目」 and Gemini's beside 「全部」. The name and chevron
 * open and close the section; the list's keys reach that part like a folder row (Enter/Space
 * toggle, → opens, ← closes), and Tab reaches the buttons. The buttons sit beside the toggle, not
 * in it, so a click on one never folds the section.
 */
function SectionRowView<K extends string = SidebarSectionKey>({
  section, label, collapsed, empty = false, detail, status, actions, onToggle, registerItemRef,
}: SectionRowProps<K>): React.ReactElement {
  return (
    <Box className={styles.sectionRow}>
      <Box
        ref={(node: HTMLDivElement | null) => registerItemRef?.(sectionRowKey(section), node)}
        tabIndex={0}
        role={empty ? undefined : 'button'}
        aria-expanded={empty ? undefined : !collapsed}
        className={styles.sectionItem}
        data-empty={empty || undefined}
        onClick={empty ? undefined : () => onToggle(section)}
      >
        <Text component="span" fz="var(--font-size-sm)" fw={600} lh="18px" truncate>{label}</Text>
        {detail && (
          <Text component="span" fz="var(--font-size-sm)" lh="18px" c="var(--text-muted)" truncate className={styles.sectionDetail}>
            {`· ${detail}`}
          </Text>
        )}
        {!empty && <ChevronDown size={13} className={styles.sectionChevron} data-collapsed={String(collapsed)} aria-hidden />}
      </Box>
      {(status || actions) && <Box className={styles.sectionActions}>{status}{actions}</Box>}
    </Box>
  );
}

export const SectionRow = React.memo(SectionRowView) as typeof SectionRowView;
