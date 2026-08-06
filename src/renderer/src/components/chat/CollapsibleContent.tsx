import React, { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { Box, Text, UnstyledButton } from '@mantine/core';
import { ChevronDown, ChevronUp } from 'lucide-react';

interface CollapsibleContentProps {
  children: React.ReactNode;
  fadeColor: string;
  t: (key: string) => string;
  collapsedMaxHeight?: number;
}

const DEFAULT_MAX_HEIGHT = 300;
const OVERFLOW_SLACK = 24;

export const CollapsibleContent = React.memo<CollapsibleContentProps>(({
  children, fadeColor, t, collapsedMaxHeight = DEFAULT_MAX_HEIGHT,
}) => {
  const contentRef = useRef<HTMLDivElement>(null);
  const [overflowing, setOverflowing] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useLayoutEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const measure = (): void => setOverflowing(el.scrollHeight > collapsedMaxHeight + OVERFLOW_SLACK);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [collapsedMaxHeight, children]);

  const toggle = useCallback((): void => setExpanded((prev) => !prev), []);

  const clamped = overflowing && !expanded;

  return (
    <Box>
      <Box pos="relative">
        <Box
          ref={contentRef}
          style={{
            maxHeight: clamped ? collapsedMaxHeight : undefined,
            overflow: clamped ? 'hidden' : undefined,
          }}
        >
          {children}
        </Box>
        {clamped && (
          <Box
            pos="absolute"
            bottom={0}
            left={0}
            right={0}
            h={56}
            style={{
              background: `linear-gradient(transparent, ${fadeColor})`,
              pointerEvents: 'none',
            }}
          />
        )}
      </Box>

      {overflowing && (
        <UnstyledButton
          onClick={toggle}
          mt={6}
          c="dimmed"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
        >
          {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          <Text fz="var(--font-size-sm)" fw={500}>
            {expanded ? t('chat.collapse') : t('chat.expand')}
          </Text>
        </UnstyledButton>
      )}
    </Box>
  );
});
