import React from 'react';
import type { Options } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkBreaks from 'remark-breaks';
import { ShikiCodeBlock } from '../components/ShikiCodeBlock';
import { MermaidBlock } from '../components/chat/MermaidBlock';
import { isMermaidLanguage } from '../../../shared/mermaidFences';

export const remarkPlugins: NonNullable<Options['remarkPlugins']> = [
  remarkGfm,
  [remarkMath, { singleDollarTextMath: false }],
  remarkBreaks,
];

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
