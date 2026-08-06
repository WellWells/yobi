import React from 'react';
import { Box, Group, Stack, Text } from '@mantine/core';
import { FileDown } from 'lucide-react';

interface Props {
  title: string;
  onHeight: (height: number) => void;
  onEscape: () => void;
  onEnter?: () => void;
  children: React.ReactNode;
}

/*
 * The frame every stage of the quick-export panel shares: drag header, keyboard handling,
 * and the height report the main process sizes the window from. The panel grows and
 * shrinks as its stage changes — and switching format never round-trips through main —
 * so the height has to be pushed out from here rather than measured once before showing.
 */
export const PromptShell: React.FC<Props> = ({ title, onHeight, onEscape, onEnter, children }) => {
  const ref = React.useRef<HTMLDivElement | null>(null);

  React.useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return undefined;
    const observer = new ResizeObserver(() => onHeight(Math.ceil(node.getBoundingClientRect().height)));
    observer.observe(node);
    return () => observer.disconnect();
  }, [onHeight]);

  React.useEffect(() => {
    /* Stages with no text field would leave focus on <body>, where Escape never arrives. */
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
      style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', outline: 'none' }}
      onKeyDown={(event) => {
        /* A dropdown that already handled the key owns it — Escape should close it, not the panel. */
        if (event.defaultPrevented) return;
        if (event.key === 'Escape') { event.preventDefault(); onEscape(); }
        if (event.key === 'Enter' && onEnter) { event.preventDefault(); onEnter(); }
      }}
    >
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
  );
};
