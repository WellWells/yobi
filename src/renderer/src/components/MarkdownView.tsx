import React, { useDeferredValue, useMemo } from 'react';
import { Box } from '@mantine/core';
import { stripConversationMarkers } from '../../../shared/conversationDoc';
import type { MarkdownBlocks } from '../utils/parseMarkdownBlocks';
import { useAppStore } from '../store/appStore';
import { useI18nStore } from '../store/i18nStore';
import { ExtraBlock, PromptBlock, ResponseBlock, TimeBlock } from './MarkdownBlocks';
import { MessageMarkdown as MD } from './chat/MessageMarkdown';

interface MarkdownViewProps {
  content: string;
  blocks: MarkdownBlocks;
}

function MarkdownViewInner({ content, blocks }: MarkdownViewProps) {
  const { t } = useI18nStore();
  const layoutMode = useAppStore((state) => state.layoutMode);
  const markdownZoom = useAppStore((state) => state.markdownZoom);
  const deferredBlocks = useDeferredValue(blocks);
  const deferredContent = useDeferredValue(content);
  const isStale = deferredBlocks !== blocks;
  const plainContent = useMemo(() => stripConversationMarkers(deferredContent), [deferredContent]);
  const isSideBySide = layoutMode === 'side-by-side';
  const zoomStyle = markdownZoom === 100 ? undefined : { zoom: markdownZoom / 100 };
  const STACKED_MAX_WIDTH = 720;

  const hasMetaContent = Boolean(
    deferredBlocks.title ||
    deferredBlocks.provider ||
    deferredBlocks.time ||
    deferredBlocks.prompt ||
    Object.keys(deferredBlocks.extra).length > 0,
  );
  const showMetaColumn = !isSideBySide || hasMetaContent;

  const MetaColumn = (
    <Box style={{
      display: 'flex',
      flexDirection: 'column',
      gap: 0,
      flexShrink: isSideBySide ? 0 : undefined,
      width: isSideBySide ? '30%' : '100%',
      minWidth: isSideBySide ? 220 : undefined,
      height: isSideBySide ? '100%' : undefined,
      minHeight: isSideBySide ? 0 : undefined,
      overflowY: isSideBySide ? 'auto' : undefined,
      padding: isSideBySide ? '20px 16px 20px 20px' : '20px 28px 0',
    }}>
      {deferredBlocks.title && (
        <h1 style={{
          fontSize: 'var(--font-size-3xl)',
          fontWeight: 700,
          color: 'var(--text-primary)',
          marginBottom: 6,
          lineHeight: isSideBySide ? 1.35 : 1.4,
          whiteSpace: 'normal',
          wordBreak: 'break-word',
          overflowWrap: 'anywhere',
        }}>
          {deferredBlocks.title}
        </h1>
      )}

      {(deferredBlocks.time || deferredBlocks.provider) && (
        <TimeBlock
          time={deferredBlocks.time ?? ''}
          provider={deferredBlocks.provider}
        />
      )}

      {deferredBlocks.prompt && (
        <PromptBlock
          prompt={deferredBlocks.prompt}
          isSideBySide={isSideBySide}
          label={t('markdown.prompt.label')}
          expandText={t('markdown.prompt.expand')}
          collapseText={t('markdown.prompt.collapse')}
          truncatedHint={t('markdown.prompt.truncated')}
        />
      )}

      {Object.entries(deferredBlocks.extra).map(([heading, body]) => (
        <ExtraBlock key={heading} heading={heading} content={body} MarkdownRenderer={MD} />
      ))}
    </Box>
  );

  const ResponseColumn = (
    <Box style={{
      flex: 1,
      minHeight: 0,
      overflowY: isSideBySide ? 'auto' : undefined,
      padding: isSideBySide ? '20px 20px 20px 16px' : '0 28px 20px',
      borderLeft: isSideBySide && showMetaColumn ? '1px solid var(--border)' : 'none',
    }}>
      {deferredBlocks.response ? (
        <ResponseBlock response={deferredBlocks.response} MarkdownRenderer={MD} />
      ) : (
        <Box className="md-content" style={{ fontSize: 'var(--font-size-md)', lineHeight: 1.75 }}>
          <MD>{plainContent}</MD>
        </Box>
      )}
    </Box>
  );

  if (isSideBySide) {
    return (
      <Box style={{
        display: 'flex',
        flexDirection: 'row',
        height: '100%',
        overflow: 'hidden',
        opacity: isStale ? 0.6 : 1,
        transition: 'opacity 0.15s ease',
      }}>
        <Box style={{
          display: 'flex',
          flexDirection: 'row',
          flexShrink: 0,
          width: '100%',
          height: '100%',
          ...zoomStyle,
        }}>
          {showMetaColumn && MetaColumn}
          {ResponseColumn}
        </Box>
      </Box>
    );
  }

  return (
    <Box style={{
      minHeight: '100%',
      overflow: 'hidden',
      opacity: isStale ? 0.6 : 1,
      transition: 'opacity 0.15s ease',
    }}>
      <Box style={zoomStyle}>
        <Box style={{ width: '100%', maxWidth: STACKED_MAX_WIDTH, margin: '0 auto' }}>
          {showMetaColumn && MetaColumn}
          {ResponseColumn}
        </Box>
      </Box>
    </Box>
  );
}

export const MarkdownView = React.memo(MarkdownViewInner);

