import React, { useMemo } from 'react';
import ReactMarkdown, { type Components, type Options } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkBreaks from 'remark-breaks';
import type { Parent, Root, RootContent } from 'mdast';
import { ShikiCodeBlock } from '../components/ShikiCodeBlock';
import { MermaidBlock } from '../components/chat/MermaidBlock';
import { isMermaidLanguage } from '../../../shared/mermaidFences';
import { repairSplitTableRows } from '../../../shared/markdownTableRepair';
import { promoteDisplayMath, promoteInlineMath } from '../../../shared/inlineMathDelimiters';
import { useKatexPlugins } from './katexRuntime';

const BR_TAG = /^<br\s*\/?>$/i;

function replaceBrNodes(node: Parent): void {
  for (let i = 0; i < node.children.length; i++) {
    const child = node.children[i] as RootContent;
    if (child.type === 'html' && BR_TAG.test(child.value.trim())) {
      node.children[i] = { type: 'break', position: child.position };
      continue;
    }
    if ('children' in child) replaceBrNodes(child);
  }
}

/**
 * Turns a bare `<br>` into a real line break.
 *
 * Raw HTML is deliberately not rendered — provider answers are untrusted, so
 * `rehype-raw` would hand them the whole DOM. Without it every `<br>` came out as
 * the literal text `<br>`, and `<br>` is exactly how every AI web UI serialises a
 * multi-line table cell. Promoting just this one tag to a `break` node restores
 * those cells while the rest of the HTML stays inert text.
 */
function remarkHtmlBreaks() {
  return (tree: Root): void => { replaceBrNodes(tree); };
}

export const remarkPlugins: NonNullable<Options['remarkPlugins']> = [
  remarkGfm,
  [remarkMath, { singleDollarTextMath: false }],
  remarkBreaks,
  remarkHtmlBreaks,
];

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
  const source = useMemo(
    () => promoteInlineMath(promoteDisplayMath(repairSplitTableRows(children))),
    [children],
  );
  const rehypePlugins = useKatexPlugins(source);
  return (
    <ReactMarkdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins} components={components}>
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

function isHttpUrl(href?: string): boolean {
  if (!href) return false;
  try {
    const parsed = new URL(href);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export const ExternalLink: React.FC<React.ComponentPropsWithoutRef<'a'>> = ({ href, onClick, ...props }) => {
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
