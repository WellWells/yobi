import React from 'react';
import { Checkbox, Table } from '@mantine/core';

export interface KnowledgeCheckCellProps {
  /** The header's select-all cell (`th`) or a row's cell (`td`). */
  header?: boolean;
  width?: number;
  checked: boolean;
  indeterminate?: boolean;
  /** The header's box stays a Tab stop; a row's is not (Space on the row ticks it). */
  focusable?: boolean;
  onToggle: () => void;
  label: string;
}

/**
 * The tick column's cell. The whole cell is the target (WCAG 2.5.8: the 16px box alone was too
 * small to hit), and the cell is the only source of the toggle: a click on the box bubbles here
 * too, so the box itself has no handler (no double toggle). A click or double-click stays in the
 * cell, so it never selects only this row or opens the file.
 */
export function KnowledgeCheckCell({ header = false, width, checked, indeterminate, focusable = false, onToggle, label }: KnowledgeCheckCellProps): React.ReactElement {
  const Cell = header ? Table.Th : Table.Td;
  return (
    <Cell
      w={width}
      onClick={(event: React.MouseEvent) => {
        event.stopPropagation();
        onToggle();
      }}
      onDoubleClick={(event: React.MouseEvent) => event.stopPropagation()}
    >
      {/* Space on a focused box clicks it, and that click reaches the cell like any other. */}
      <Checkbox
        size="xs"
        tabIndex={focusable ? undefined : -1}
        checked={checked}
        indeterminate={indeterminate}
        readOnly
        aria-label={label}
      />
    </Cell>
  );
}
