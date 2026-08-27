import React from 'react';
import { Box, Group, Stack, Text } from '@mantine/core';
import { FileDown } from 'lucide-react';
import type { PanelHeight } from '../../../../shared/types';

const SETTLE_MS = 130;
const OVERLAY_WATCH_ROUNDS = 6;

export function heightVerdict(next: PanelHeight, last: PanelHeight): 'emit' | 'confirm' | 'ignore' {
  if (next.panel === last.panel && next.total === last.total) return 'ignore';
  if (next.panel !== last.panel) return 'emit';
  return next.total < last.total ? 'confirm' : 'emit';
}

interface Props {
  title: string;
  onHeight: (height: PanelHeight) => void;
  onEscape: () => void;
  onEnter?: () => void;
  children: React.ReactNode;
}

function overlayPresent(): boolean {
  return document.querySelector('[aria-expanded="true"]') !== null;
}

function overlayBottom(panel: HTMLElement): number {
  const panelRect = panel.getBoundingClientRect();
  const root = document.getElementById('prompt-root');
  let bottom = 0;
  for (const child of Array.from(document.body.children)) {
    if (child === root || child.tagName === 'SCRIPT' || child.tagName === 'STYLE') continue;
    for (const element of Array.from(child.querySelectorAll('*'))) {
      const rect = element.getBoundingClientRect();
      if (rect.height > 0) bottom = Math.max(bottom, rect.bottom - panelRect.top);
    }
  }
  return bottom;
}

export const PromptShell: React.FC<Props> = ({ title, onHeight, onEscape, onEnter, children }) => {
  const ref = React.useRef<HTMLDivElement | null>(null);
  const contentRef = React.useRef<HTMLDivElement | null>(null);

  React.useLayoutEffect(() => {
    const node = ref.current;
    const content = contentRef.current;
    if (!node || !content) return undefined;
    let lastReported: PanelHeight = { panel: 0, total: 0 };
    const measure = (): PanelHeight => {
      const frameExtra = node.offsetHeight - node.clientHeight;
      const panel = content.getBoundingClientRect().height + frameExtra;
      return { panel: Math.ceil(panel), total: Math.ceil(Math.max(panel, overlayBottom(node))) };
    };

    let settleTimer = 0;
    let watching = 0;
    let confirming: PanelHeight | null = null;
    const again = (): void => {
      window.clearTimeout(settleTimer);
      settleTimer = window.setTimeout(settle, SETTLE_MS);
    };

    function settle(): void {
      const measured = measure();
      const verdict = heightVerdict(measured, lastReported);

      if (verdict === 'emit') {
        confirming = null;
        lastReported = measured;
        onHeight(measured);
      } else if (verdict === 'confirm' && !overlayPresent()) {
        if (confirming && confirming.panel === measured.panel && confirming.total === measured.total) {
          confirming = null;
          lastReported = measured;
          onHeight(measured);
        } else {
          confirming = measured;
          again();
          return;
        }
      }

      if (overlayPresent() && watching < OVERLAY_WATCH_ROUNDS) {
        watching += 1;
        again();
      } else if (!overlayPresent()) {
        watching = 0;
      }
    }

    const schedule = (): void => {
      window.clearTimeout(settleTimer);
      watching = 0;
      settleTimer = window.setTimeout(settle, SETTLE_MS);
    };

    const resize = new ResizeObserver(() => { window.clearTimeout(settleTimer); settle(); });
    resize.observe(content);
    const portals = new MutationObserver((records) => {
      const root = document.getElementById('prompt-root');
      if (root && records.every((record) => root.contains(record.target))) return;
      schedule();
    });
    portals.observe(document.body, { childList: true, subtree: true });
    schedule();
    return () => {
      window.clearTimeout(settleTimer);
      resize.disconnect();
      portals.disconnect();
    };
  }, [onHeight]);

  React.useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const active = document.activeElement;
    if (!active || active === document.body) node.focus();
  });

  return (
    <Box
      id="export-prompt-panel"
      ref={ref}
      tabIndex={-1}
      style={{
        position: 'fixed',
        inset: 0,
        boxSizing: 'border-box',
        overflow: 'hidden',
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border)',
        outline: 'none',
      }}
      onKeyDown={(event) => {
        if (event.defaultPrevented) return;
        if (event.key === 'Escape') { event.preventDefault(); onEscape(); }
        if (event.key === 'Enter' && onEnter) {
          if ((event.target as HTMLElement | null)?.closest('button')) return;
          event.preventDefault();
          onEnter();
        }
      }}
    >
      <Box ref={contentRef}>
        <Group
          gap={8}
          px={16}
          pt={14}
          pb={12}
          mb={14}
          style={{ WebkitAppRegion: 'drag', borderBottom: '1px solid var(--border)' } as React.CSSProperties}
        >
          <Box c="var(--accent)" style={{ display: 'flex' }}><FileDown size={15} /></Box>
          <Text fz="var(--font-size-base)" fw={700} c="var(--mantine-color-text)">{title}</Text>
        </Group>

        <Stack gap={14} px={16} pb={16}>{children}</Stack>
      </Box>
    </Box>
  );
};
