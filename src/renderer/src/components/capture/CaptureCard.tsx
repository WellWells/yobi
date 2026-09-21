import React from 'react';
import type { MarkdownCaptureRequest } from '../../../../shared/types';
import { BaseMarkdown, SharedCodeBlock, SharedPreBlock } from '../../utils/markdownConfig';
import { captureCardCssVars } from '../../hooks/captureTheme';
import {
  CAPTURE_CODE_THEME,
  CaptureDiagramThemeContext,
  ForcedCodeThemeContext,
  captureDiagramTheme,
} from '../../utils/forcedCodeTheme';

const mdComponents = { pre: SharedPreBlock, code: SharedCodeBlock };

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
    {(payload.turns ?? []).map((turn, index) => (
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

const DocumentSingle: React.FC<{ request: MarkdownCaptureRequest }> = ({ request: { payload, options } }) => (
  <>
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
  </>
);

const DocumentBody: React.FC<{ request: MarkdownCaptureRequest }> = ({ request }) => (
  <>
    {}
    <MetaRow
      provider={request.options.showProvider ? request.payload.provider : ''}
      time={request.options.showTimestamp ? request.payload.timestamp : ''}
    />
    {(request.payload.turns?.length ?? 0) > 0
      ? <DocumentTurns request={request} />
      : <DocumentSingle request={request} />}
  </>
);

const BubbleBody: React.FC<{ request: MarkdownCaptureRequest }> = ({ request: { payload, options } }) => (
  <div className="capture-thread">
    {(payload.turns ?? []).map((turn, index) => (
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

interface CaptureCardProps {
  request: MarkdownCaptureRequest;
  rootId?: string;
}

export const CaptureCard: React.FC<CaptureCardProps> = ({ request, rootId }) => {
  const { payload, options } = request;
  const bubble = options.cardLayout === 'bubble';

  return (
    <ForcedCodeThemeContext.Provider value={CAPTURE_CODE_THEME}>
      <CaptureDiagramThemeContext.Provider value={captureDiagramTheme(options.cardTheme)}>
        <div
          {...(rootId ? { id: rootId } : {})}
          className="capture-card-root"
          style={{
            ...captureCardCssVars(options.cardTheme),
            width: options.width,
            background: options.background,
          } as React.CSSProperties}
        >
          {}
          <div
            className="capture-scene"
            style={{ background: options.background, ...(options.margin === undefined ? {} : { padding: options.margin }) }}
          >
            <article className={bubble ? 'capture-card capture-card-bubble' : 'capture-card'}>
              {payload.title && <h1 className="capture-title">{payload.title}</h1>}
              {options.showTokens && payload.tokensTotal && (
                <div className="capture-total-tokens">{payload.tokensTotal}</div>
              )}
              {bubble ? <BubbleBody request={request} /> : <DocumentBody request={request} />}
            </article>
          </div>
        </div>
      </CaptureDiagramThemeContext.Provider>
    </ForcedCodeThemeContext.Provider>
  );
};
