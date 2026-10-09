import React, { Suspense, useState } from 'react';
import { Code, Collapse, Flex, Loader, Stack, Text } from '@mantine/core';
import { ChevronDown, ChevronRight, RotateCcw } from 'lucide-react';
import { useI18nStore } from '../store/i18nStore';
import { AppButton } from './AppButton';

/**
 * Error boundary for the lazily loaded views, so a render crash or a chunk that fails to load
 * (a stale asset after an update) shows a recovery panel instead of a blank pane.
 *
 * Retry reloads the window rather than re-rendering: `React.lazy` caches the rejected promise,
 * so re-rendering the same lazy component would fail again without re-fetching the chunk.
 */

interface ViewBoundaryProps {
  children: React.ReactNode;
}

interface ViewBoundaryState {
  error: Error | null;
}

export function BoundaryFallback({ error }: { error: Error }): React.ReactElement {
  const { t } = useI18nStore();
  const [detailsOpen, setDetailsOpen] = useState(false);
  return (
    <Flex flex={1} align="center" justify="center" p={24}>
      <Stack align="center" gap={12} maw={420}>
        <Text fz="var(--font-size-md)" fw={600}>{t('error.view.title')}</Text>
        <Text fz="var(--font-size-sm)" c="dimmed" ta="center">{t('error.view.body')}</Text>
        <AppButton
          variant="default"
          size="xs"
          leftSection={<RotateCcw size={14} />}
          onClick={() => window.location.reload()}
        >
          {t('error.view.retry')}
        </AppButton>
        <AppButton
          variant="subtle"
          size="compact-xs"
          c="var(--text-muted)"
          leftSection={detailsOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          onClick={() => setDetailsOpen((open) => !open)}
        >
          {t('error.view.details')}
        </AppButton>
        <Collapse expanded={detailsOpen} w="100%">
          <Code block fz="var(--font-size-xs)" style={{ maxWidth: '100%', whiteSpace: 'pre-wrap' }}>
            {error.message || String(error)}
          </Code>
        </Collapse>
      </Stack>
    </Flex>
  );
}

function BoundaryPending(): React.ReactElement {
  return (
    <Flex flex={1} align="center" justify="center">
      <Loader size="sm" color="var(--mantine-color-accent)" />
    </Flex>
  );
}

export class ViewBoundary extends React.Component<ViewBoundaryProps, ViewBoundaryState> {
  state: ViewBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ViewBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    // The renderer cannot write to the log file (`onLog` is main → renderer only), so log to the console.
    console.error('[ViewBoundary]', error, info.componentStack);
  }

  render(): React.ReactNode {
    if (this.state.error) return <BoundaryFallback error={this.state.error} />;
    return <Suspense fallback={<BoundaryPending />}>{this.props.children}</Suspense>;
  }
}
