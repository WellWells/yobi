import React, { useDeferredValue, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import 'katex/dist/katex.min.css';
import type { MarkdownBlocks } from '../utils/parseMarkdownBlocks';
import { REHYPE_PLUGINS } from '../utils/shikiPlugins';
import { SharedCodeBlock, SharedPreBlock, remarkPlugins } from '../utils/markdownConfig';
import { useAppStore } from '../store/appStore';
import { useI18nStore } from '../store/i18nStore';
import { useElementSize } from '../hooks/useElementSize';
import { ExtraBlock, PromptBlock, ResponseBlock, TimeBlock } from './MarkdownBlocks';

interface MarkdownViewProps {
  content: string;
  blocks: MarkdownBlocks;
  headerAction?: React.ReactNode;
}

function isHttpUrl(href?: string): boolean {
  if (!href) return false;
  try {
    const parsed = new URL(href);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

const ExternalLink: React.FC<React.ComponentPropsWithoutRef<'a'>> = ({ href, onClick, ...props }) => {
  const handleClick: React.MouseEventHandler<HTMLAnchorElement> = (event) => {
    onClick?.(event);
    if (event.defaultPrevented || !href || !isHttpUrl(href)) return;
    event.preventDefault();
    void window.electronAPI.openExternalUrl(href);
  };

  return (
    <a
      {...props}
      href={href}
      onClick={handleClick}
      target="_blank"
      rel="noopener noreferrer"
    />
  );
};

const mdComponents = { a: ExternalLink, pre: SharedPreBlock, code: SharedCodeBlock } as const;

const MD = React.memo<{ children: string }>(({ children }) => (
  <ReactMarkdown
    remarkPlugins={remarkPlugins}
    rehypePlugins={REHYPE_PLUGINS}
    components={mdComponents}
  >
    {children}
  </ReactMarkdown>
));

function MarkdownViewInner({ content, blocks, headerAction }: MarkdownViewProps) {
  const { t } = useI18nStore();
  const layoutMode = useAppStore((state) => state.layoutMode);
  const markdownZoom = useAppStore((state) => state.markdownZoom);
  const deferredBlocks = useDeferredValue(blocks);
  const deferredContent = useDeferredValue(content);
  const isStale = deferredBlocks !== blocks;
  const isSideBySide = layoutMode === 'side-by-side';
  const zoomScale = markdownZoom / 100;
  const STACKED_MAX_WIDTH = 720;

  const innerRef = useRef<HTMLDivElement>(null);
  const { height: innerNaturalHeight } = useElementSize(innerRef, !isSideBySide);
  const spacerHeight = Math.max(0, innerNaturalHeight * (zoomScale - 1));

  const hasMetaContent = Boolean(
    deferredBlocks.title ||
    deferredBlocks.provider ||
    deferredBlocks.time ||
    deferredBlocks.prompt ||
    Object.keys(deferredBlocks.extra).length > 0,
  );
  const showMetaColumn = !isSideBySide || hasMetaContent;

  const MetaColumn = (
    <div style={{
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
          action={headerAction}
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
    </div>
  );

  const ResponseColumn = (
    <div style={{
      flex: 1,
      minHeight: 0,
      overflowY: isSideBySide ? 'auto' : undefined,
      padding: isSideBySide ? '20px 20px 20px 16px' : '0 28px 20px',
      borderLeft: isSideBySide && showMetaColumn ? '1px solid var(--border)' : 'none',
    }}>
      {deferredBlocks.response ? (
        <ResponseBlock response={deferredBlocks.response} MarkdownRenderer={MD} />
      ) : (
        <div className="md-content" style={{ userSelect: 'text', fontSize: 'var(--font-size-md)', lineHeight: 1.75 }}>
          <MD>{deferredContent}</MD>
        </div>
      )}
    </div>
  );

  if (isSideBySide) {
    return (
      <div style={{
        display: 'flex',
        flexDirection: 'row',
        height: '100%',
        overflow: 'hidden',
        opacity: isStale ? 0.6 : 1,
        transition: 'opacity 0.15s ease',
      }}>
        <div style={{
          display: 'flex',
          flexDirection: 'row',
          flexShrink: 0,
          width: `${(1 / zoomScale) * 100}%`,
          height: `${(1 / zoomScale) * 100}%`,
          transform: `scale(${zoomScale})`,
          transformOrigin: 'top left',
        }}>
          {showMetaColumn && MetaColumn}
          {ResponseColumn}
        </div>
      </div>
    );
  }

  return (
    <div style={{
      minHeight: '100%',
      overflow: 'hidden',
      opacity: isStale ? 0.6 : 1,
      transition: 'opacity 0.15s ease',
    }}>
      <div
        ref={innerRef}
        style={{
          width: `${(1 / zoomScale) * 100}%`,
          transform: `scale(${zoomScale})`,
          transformOrigin: 'top left',
        }}
      >
        <div style={{ width: '100%', maxWidth: STACKED_MAX_WIDTH, margin: '0 auto' }}>
          {showMetaColumn && MetaColumn}
          {ResponseColumn}
        </div>
      </div>
      {spacerHeight > 0 && <div style={{ height: spacerHeight, flexShrink: 0 }} />}
    </div>
  );
}

export const MarkdownView = React.memo(MarkdownViewInner);

