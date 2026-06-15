import React from 'react';
import ReactMarkdown from 'react-markdown';
import 'katex/dist/katex.min.css';
import type { MarkdownCaptureRequest } from '../../shared/types';
import { REHYPE_PLUGINS } from './utils/shikiPlugins';
import { SharedCodeBlock, SharedPreBlock, remarkPlugins } from './utils/markdownConfig';
import { captureCardCssVars } from './hooks/captureTheme';
import { ForcedCodeThemeContext } from './utils/forcedCodeTheme';

const mdComponents = { pre: SharedPreBlock, code: SharedCodeBlock };

const MarkdownBlock: React.FC<{ children: string }> = ({ children }) => (
  <div className="capture-md-content">
    <ReactMarkdown remarkPlugins={remarkPlugins} rehypePlugins={REHYPE_PLUGINS} components={mdComponents}>
      {children}
    </ReactMarkdown>
  </div>
);

interface CapturePageProps {
  request: MarkdownCaptureRequest;
}

export const CapturePage: React.FC<CapturePageProps> = ({ request }) => {
  const { payload, options } = request;

  return (
    <ForcedCodeThemeContext.Provider value="dark">
    <div
      id="capture-logical-root"
      style={{
        ...captureCardCssVars(options.cardTheme),
        width: options.width,
        background: options.background,
      } as React.CSSProperties}
    >
      <div
        className="capture-scene"
        style={{
          background: options.background,
        }}
      >
        <article className="capture-card">
          <h1 className="capture-title">{payload.title || 'Untitled'}</h1>

          {(options.showProvider || options.showTimestamp) && (
            <div className="capture-meta">
              {options.showProvider && payload.provider && (
                <span className="capture-chip">{payload.provider}</span>
              )}
              {options.showTimestamp && payload.timestamp && (
                <span className="capture-time">{payload.timestamp}</span>
              )}
            </div>
          )}

          {options.showPrompt && payload.prompt && (
            <section className="capture-section">
              <div className="capture-section-title">Prompt</div>
              <div className="capture-prompt">
                <MarkdownBlock>{payload.prompt}</MarkdownBlock>
              </div>
            </section>
          )}

          {options.showContent ? (
            <section className="capture-section">
              <div className="capture-section-title">Content</div>
              <MarkdownBlock>{payload.content || payload.summary || '(empty)'}</MarkdownBlock>
            </section>
          ) : (
            <section className="capture-section">
              <div className="capture-section-title">Summary</div>
              <p className="capture-summary">{payload.summary || '(content hidden)'}</p>
            </section>
          )}
        </article>
      </div>
    </div>
    </ForcedCodeThemeContext.Provider>
  );
};
