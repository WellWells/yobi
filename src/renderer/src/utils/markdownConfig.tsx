import React, { createContext, useContext, useId, useMemo } from 'react';
import ReactMarkdown, { type Components, type ExtraProps, type Options } from 'react-markdown';
import { Box } from '@mantine/core';
import { Image } from 'lucide-react';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkBreaks from 'remark-breaks';
import { ShikiCodeBlock } from '../components/ShikiCodeBlock';
import { MermaidBlock } from '../components/chat/MermaidBlock';
import { isMermaidLanguage } from '../../../shared/mermaidFences';
import { repairSplitTableRows } from '../../../shared/markdownTableRepair';
import { promoteDisplayMath, promoteInlineMath } from '../../../shared/inlineMathDelimiters';
import type { MarkdownLabels } from '../../../shared/markdownLabels';
import { citationHost } from '../../../shared/citations';
import { isHttpUrl } from '../../../shared/webUrl';
import { useKatexPlugins } from './katexRuntime';
import { rehypeTightTableColumns } from './markdownTableColumns';
import { remarkHtmlTags } from './markdownHtmlTags';
import { remarkAlerts } from './markdownAlerts';

type RemarkRehypeOptions = NonNullable<Options['remarkRehypeOptions']>;

/**
 * The words the renderer adds (footnote label, callout titles) in the app language. Null where
 * no language is loaded: the footnote label is then hidden and a callout keeps only its colour.
 */
export const MarkdownLabelsContext = createContext<MarkdownLabels | null>(null);

/** `remarkAlerts` reads the callout marker before `remark-breaks` splits its line. */
function buildRemarkPlugins(labels: MarkdownLabels | null): NonNullable<Options['remarkPlugins']> {
  return [
    remarkGfm,
    [remarkAlerts, { labels }],
    [remarkMath, { singleDollarTextMath: false }],
    remarkBreaks,
    remarkHtmlTags,
  ];
}

export const remarkPlugins = buildRemarkPlugins(null);

/**
 * Footnote output for one rendered answer. Every answer numbers its notes from 1, so the ids
 * carry a prefix of their own — otherwise every `[1]` in the conversation jumps to the first
 * answer's note.
 */
function footnoteOptions(labels: MarkdownLabels | null, prefix: string): RemarkRehypeOptions {
  return {
    clobberPrefix: prefix,
    footnoteLabel: labels?.footnotes,
    footnoteLabelTagName: 'p',
    footnoteLabelProperties: { className: labels ? ['md-footnotes-label'] : ['md-footnotes-label', 'md-hidden'] },
    ...(labels && {
      footnoteBackLabel: (referenceIndex: number, rereferenceIndex: number) =>
        labels.footnoteBack.replace('{{n}}', `${referenceIndex + 1}${rereferenceIndex > 1 ? `-${rereferenceIndex}` : ''}`),
    }),
  };
}

/**
 * The single entry point for rendering an answer. Every caller shares one plugin
 * chain and one source repair, so a document cannot render one way in the app and
 * another way in an export.
 *
 * The repairs run before `useKatexPlugins`, which is what lets `hasMath` keep
 * testing for `$$` alone: by the time it is asked, every formula worth rendering
 * already carries those delimiters.
 */
export const BaseMarkdown: React.FC<{ children: string; components: Components }> = ({ children, components }) => {
  const labels = useContext(MarkdownLabelsContext);
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  const source = useMemo(
    () => promoteInlineMath(promoteDisplayMath(repairSplitTableRows(children))),
    [children],
  );
  const katexPlugins = useKatexPlugins(source);
  const remark = useMemo(() => buildRemarkPlugins(labels), [labels]);
  const remarkRehypeOptions = useMemo(() => footnoteOptions(labels, `md${id}-`), [labels, id]);
  const rehypePlugins = useMemo(() => [rehypeTightTableColumns, ...katexPlugins], [katexPlugins]);
  return (
    <ReactMarkdown
      remarkPlugins={remark}
      remarkRehypeOptions={remarkRehypeOptions}
      rehypePlugins={rehypePlugins}
      components={components}
    >
      {source}
    </ReactMarkdown>
  );
};

export const SharedCodeBlock: React.FC<{
  className?: string;
  children?: React.ReactNode;
}> = ({ className, children }) => {
  const match = /language-(\w+)/.exec(className ?? '');
  if (!match) {
    return <code className={className}>{children}</code>;
  }
  const code = String(children).replace(/\n$/, '');
  if (isMermaidLanguage(match[1])) {
    return <MermaidBlock code={code} />;
  }
  return <ShikiCodeBlock lang={match[1]} code={code} />;
};

function hasLanguageCodeClass(children?: React.ReactNode): boolean {
  const firstChild = Array.isArray(children) ? children[0] : children;
  if (!React.isValidElement<{ className?: string }>(firstChild)) return false;
  return /language-(\w+)/.test(firstChild.props.className ?? '');
}

export const SharedPreBlock: React.FC<{ children?: React.ReactNode }> = ({ children }) => {
  if (hasLanguageCodeClass(children)) {
    return <>{children}</>;
  }
  return <pre>{children}</pre>;
};

/**
 * A table in its own horizontal scroller, so columns kept on one line can never
 * stretch a chat bubble wider than the pane. The export card has no scrolling
 * and keeps the bare table; `rehypeTightTableColumns`' budget protects it.
 */
export const ScrollableTable: React.FC<React.ComponentPropsWithoutRef<'table'> & ExtraProps> = ({ node: _node, ...props }) => (
  <Box className="md-table-scroll">
    <table {...props} />
  </Box>
);

function prefersReducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

/** A link to a spot in the same answer (a footnote and its way back). It scrolls; it never opens a window. */
const InPageLink: React.FC<React.ComponentPropsWithoutRef<'a'> & { href: string }> = ({ href, onClick, ...props }) => {
  const handleClick: React.MouseEventHandler<HTMLAnchorElement> = (event) => {
    onClick?.(event);
    if (event.defaultPrevented) return;
    event.preventDefault();
    const target = document.getElementById(decodeURIComponent(href.slice(1)));
    target?.scrollIntoView({ block: 'center', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  };
  return <a {...props} href={href} onClick={handleClick} />;
};

export const ExternalLink: React.FC<React.ComponentPropsWithoutRef<'a'> & ExtraProps> = ({ node: _node, href, onClick, ...props }) => {
  if (href?.startsWith('#')) return <InPageLink {...props} href={href} onClick={onClick} />;
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

/**
 * A markdown image. The page only loads images from the app itself (CSP `img-src 'self' data:`),
 * and loading a remote one would tell its host the reader's address — an answer is untrusted, so
 * that is a tracking pixel. A remote image is shown as a link to it, anything else as its alt text
 * (react-markdown has already emptied a `data:` or `javascript:` source).
 */
export const MarkdownImage: React.FC<React.ComponentPropsWithoutRef<'img'> & ExtraProps> = ({ node: _node, src, alt, title }) => {
  const url = typeof src === 'string' ? src : '';
  const label = alt?.trim() || citationHost(url);
  if (!isHttpUrl(url)) return <>{label}</>;
  return (
    <ExternalLink href={url} title={title || url} className="md-image-link">
      <Image size="1em" aria-hidden />
      {label}
    </ExternalLink>
  );
};
