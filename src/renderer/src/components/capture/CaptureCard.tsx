import React, { useContext } from 'react';
import type { ExtraProps } from 'react-markdown';
import type { MarkdownCaptureRequest } from '../../../../shared/types';
import { cardTurns } from '../../../../shared/captureCard';
import {
  BaseMarkdown,
  MarkdownImage,
  MarkdownLabelsContext,
  SharedCodeBlock,
  SharedPreBlock,
} from '../../utils/markdownConfig';
import { captureCardCssVars, cardReadingVars } from '../../hooks/captureTheme';
import { CaptureContentThemeContext, captureContentTheme } from '../../utils/forcedCodeTheme';

/** An image or PDF cannot be clicked open, so a collapsible section is exported expanded. */
const ExpandedDetails: React.FC<React.ComponentPropsWithoutRef<'details'> & ExtraProps> = ({ node: _node, ...props }) => (
  <details {...props} open />
);

const mdComponents = { pre: SharedPreBlock, code: SharedCodeBlock, img: MarkdownImage, details: ExpandedDetails };

const MarkdownBlock: React.FC<{ children: string }> = ({ children }) => (
  // In the capture window `capture-main` has already awaited loadKatex(), so the
  // hook inside BaseMarkdown resolves synchronously and the screenshot never
  // catches a pre-KaTeX frame.
  <div className="capture-md-content">
    <BaseMarkdown components={mdComponents}>{children}</BaseMarkdown>
  </div>
);

const MetaRow: React.FC<{ provider?: string; time?: string; tokens?: string }> = ({ provider, time, tokens }) => (
  provider || time || tokens ? (
    <div className="capture-meta">
      {provider && <span className="capture-chip">{provider}</span>}
      {time && <span className="capture-time">{time}</span>}
      {tokens && <span className="capture-tokens">{tokens}</span>}
    </div>
  ) : null
);

const DocumentTurns: React.FC<{ request: MarkdownCaptureRequest }> = ({ request: { payload, options } }) => (
  <div className="capture-doc">
    {cardTurns(payload).map((turn, index) => (
      <section className="capture-doc-turn" key={`turn-${index}`}>
        {options.showPrompt && turn.prompt && (
          <div className="capture-prompt">
            <MarkdownBlock>{turn.prompt}</MarkdownBlock>
          </div>
        )}
        {turn.response && <MarkdownBlock>{turn.response}</MarkdownBlock>}
      </section>
    ))}
  </div>
);

const DocumentBody: React.FC<{ request: MarkdownCaptureRequest }> = ({ request }) => (
  <>
    <MetaRow
      provider={request.options.showProvider ? request.payload.provider : ''}
      time={request.options.showTimestamp ? request.payload.timestamp : ''}
    />
    <DocumentTurns request={request} />
  </>
);

const BubbleBody: React.FC<{ request: MarkdownCaptureRequest }> = ({ request: { payload, options } }) => (
  <div className="capture-thread">
    {cardTurns(payload).map((turn, index) => (
      <div className="capture-turn" key={`turn-${index}`}>
        {turn.prompt && (
          <div className="capture-bubble-row">
            <div className="capture-bubble-user">
              <MarkdownBlock>{turn.prompt}</MarkdownBlock>
            </div>
          </div>
        )}
        {turn.response && (
          <div className="capture-bubble-ai">
            <MetaRow
              provider={options.showProvider ? turn.provider : ''}
              time={options.showTimestamp ? turn.timestamp : ''}
              tokens={options.showTokens ? turn.tokens : ''}
            />
            <MarkdownBlock>{turn.response}</MarkdownBlock>
          </div>
        )}
      </div>
    ))}
  </div>
);

/** Only what changes the words on the card; the look (background, opacity, margin, width) does not. */
function sameContent(prev: { request: MarkdownCaptureRequest }, next: { request: MarkdownCaptureRequest }): boolean {
  const [a, b] = [prev.request, next.request];
  return a.payload === b.payload
    && a.options.cardLayout === b.options.cardLayout
    && a.options.showPrompt === b.options.showPrompt
    && a.options.showProvider === b.options.showProvider
    && a.options.showTimestamp === b.options.showTimestamp
    && a.options.showTokens === b.options.showTokens;
}

/**
 * The markdown, parsed and highlighted, kept across look changes: a preview re-renders on every
 * swatch hover and slider step, and re-parsing a long document each time is what made it lag.
 * The code theme still follows the card through its context.
 */
const CardContent = React.memo<{ request: MarkdownCaptureRequest }>(({ request }) => (
  request.options.cardLayout === 'bubble' ? <BubbleBody request={request} /> : <DocumentBody request={request} />
), sameContent);

interface CaptureCardProps {
  request: MarkdownCaptureRequest;
  rootId?: string;
}

export const CaptureCard: React.FC<CaptureCardProps> = ({ request, rootId }) => {
  const { payload, options } = request;
  const bubble = options.cardLayout === 'bubble';
  // The export preview sits inside the app and inherits its labels; the capture window gets them from main.
  const inheritedLabels = useContext(MarkdownLabelsContext);

  return (
    <MarkdownLabelsContext.Provider value={request.markdownLabels ?? inheritedLabels}>
    <CaptureContentThemeContext.Provider value={captureContentTheme(options.cardTheme)}>
        <div
          {...(rootId ? { id: rootId } : {})}
          className="capture-card-root"
          style={{
            ...captureCardCssVars(options.cardTheme, { opacity: options.cardOpacity, background: options.background }),
            ...cardReadingVars(request.readingFont),
            width: options.width,
            background: options.background,
          } as React.CSSProperties}
        >
          <div
            className="capture-scene"
            style={{ background: options.background, ...(options.margin === undefined ? {} : { padding: options.margin }) }}
          >
            <article className={bubble ? 'capture-card capture-card-bubble' : 'capture-card'}>
              {payload.title && <h1 className="capture-title">{payload.title}</h1>}
              {options.showTokens && payload.tokensTotal && (
                <div className="capture-total-tokens">{payload.tokensTotal}</div>
              )}
              <CardContent request={request} />
            </article>
          </div>
        </div>
    </CaptureContentThemeContext.Provider>
    </MarkdownLabelsContext.Provider>
  );
};
