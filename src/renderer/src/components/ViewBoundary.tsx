import React, { Suspense } from 'react';
import { Button, Code, Flex, Loader, Stack, Text } from '@mantine/core';
import { RotateCcw } from 'lucide-react';
import { useI18nStore } from '../store/i18nStore';

/**
 * Catches what the view lifecycle otherwise swallows.
 *
 * The four non-chat views are `React.lazy` chunks behind `<Suspense fallback={null}>`, and
 * nothing in the app was an error boundary — so a render crash or a chunk that failed to load
 * (a stale asset after an update, a disk hiccup) left the pane simply blank, with the title bar
 * still offering the tab. There was no way to tell "still loading" from "broken" from "empty",
 * and no way back short of restarting the app.
 *
 * Retry reloads the window rather than re-rendering: `React.lazy` caches the rejected promise,
 * so re-rendering the same lazy component would fail again without ever re-fetching the chunk.
 */

interface ViewBoundaryProps {
  children: React.ReactNode;
}

interface ViewBoundaryState {
  error: Error | null;
}

function BoundaryFallback({ error }: { error: Error }): React.ReactElement {
  const { t } = useI18nStore();
  return (
    <Flex flex={1} align="center" justify="center" p={24}>
      <Stack align="center" gap={12} maw={420}>
        <Text fz="var(--font-size-md)" fw={600}>{t('error.view.title')}</Text>
        <Text fz="var(--font-size-sm)" c="dimmed" ta="center">{t('error.view.body')}</Text>
        <Code block fz="var(--font-size-xs)" style={{ maxWidth: '100%', whiteSpace: 'pre-wrap' }}>
          {error.message || String(error)}
        </Code>
        <Button
          variant="default"
          size="xs"
          leftSection={<RotateCcw size={14} />}
          onClick={() => window.location.reload()}
        >
          {t('error.view.retry')}
        </Button>
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
    // The renderer has no write channel to the log file (`onLog` is main → renderer only), so
    // this is the console and the panel above. Worth a real channel if crashes ever show up.
    console.error('[ViewBoundary]', error, info.componentStack);
  }

  render(): React.ReactNode {
    if (this.state.error) return <BoundaryFallback error={this.state.error} />;
    return <Suspense fallback={<BoundaryPending />}>{this.props.children}</Suspense>;
  }
}
