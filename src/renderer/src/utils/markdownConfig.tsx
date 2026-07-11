import React from 'react';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import { ShikiCodeBlock } from '../components/ShikiCodeBlock';

export const remarkPlugins = [remarkGfm, remarkMath];

export const SharedCodeBlock: React.FC<{
  className?: string;
  children?: React.ReactNode;
}> = ({ className, children }) => {
  const match = /language-(\w+)/.exec(className ?? '');
  if (!match) {
    return <code className={className}>{children}</code>;
  }
  return <ShikiCodeBlock lang={match[1]} code={String(children).replace(/\n$/, '')} />;
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

// Route every markdown link through the OS browser instead of the app's own
// BrowserWindow. A remote- or AI-authored href must never navigate the renderer
// top-level frame: that would hand the full electronAPI bridge to the loaded
// page. Shared by every markdown surface (chat view, export preview) so none of
// them can regress into default same-window navigation.
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
