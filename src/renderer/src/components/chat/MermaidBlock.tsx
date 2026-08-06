import React, { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { ActionIcon, Group, Text, Tooltip } from '@mantine/core';
import { Check, Code2, Copy, Workflow } from 'lucide-react';
import { ShikiCodeBlock } from '../ShikiCodeBlock';
import { CaptureDiagramThemeContext, ForcedCodeThemeContext } from '../../utils/forcedCodeTheme';
import { getCachedMermaid, renderMermaid } from '../../utils/mermaidRuntime';
import type { MermaidState } from '../../utils/mermaidRuntime';
import { useThemeStore } from '../../store/themeStore';
import { useI18nStore } from '../../store/i18nStore';

interface MermaidBlockProps {
  code: string;
}

export const MermaidBlock = React.memo<MermaidBlockProps>(({ code }) => {
  const storeTheme = useThemeStore((state) => state.theme);
  const forcedCodeTheme = useContext(ForcedCodeThemeContext);
  // Diagrams follow the export's card theme, not the fixed dark code-panel theme.
  const forcedDiagramTheme = useContext(CaptureDiagramThemeContext);
  const theme = forcedDiagramTheme ?? storeTheme;
  /*
   * A forced theme means this block is rendering for an export (capture window
   * or export preview). That tree has no MantineProvider, so any Mantine
   * component would throw and take the whole card down — see ShikiCodeBlock.
   */
  const staticRender = forcedCodeTheme !== null;
  const { t } = useI18nStore();

  const [state, setState] = useState<MermaidState | null>(() => getCachedMermaid(code, theme) ?? null);
  const [showSource, setShowSource] = useState(false);
  const [copied, setCopied] = useState(false);

  const drawnCode = useRef(code);

  useEffect(() => {
    const cached = getCachedMermaid(code, theme);
    if (cached) {
      drawnCode.current = code;
      setState(cached);
      return;
    }
    let cancelled = false;
    /*
     * A theme switch redraws the same diagram, so leave the old colours up for
     * the few hundred ms it takes rather than flashing the source back. A new
     * diagram does have to clear — otherwise it shows the previous one's picture.
     */
    if (drawnCode.current !== code) setState(null);
    void renderMermaid(code, theme).then((next) => {
      if (cancelled) return;
      drawnCode.current = code;
      setState(next);
    });
    return () => { cancelled = true; };
  }, [code, theme]);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2_000);
    } catch {
    }
  }, [code]);

  const source = <ShikiCodeBlock lang="mermaid" code={code} />;

  // Still rendering, or mermaid could not be loaded at all: show the source.
  if (state === null || (state.status === 'error' && state.failure !== 'syntax')) {
    return source;
  }

  if (state.status === 'error') {
    if (staticRender) return source;
    return (
      <>
        {source}
        <Text fz="var(--font-size-sm)" c="var(--text-muted)" mt={-4} mb={8}>
          {t('mermaid.invalidSyntax')}
        </Text>
      </>
    );
  }

  const toolbar = staticRender ? null : (
    <Group
      gap={4}
      style={{ position: 'absolute', top: 6, right: 6, zIndex: 2 }}
    >
      <Tooltip label={showSource ? t('mermaid.showDiagram') : t('mermaid.showSource')}>
        <ActionIcon
          variant="default"
          size={26}
          onClick={() => setShowSource((previous) => !previous)}
          aria-label={showSource ? t('mermaid.showDiagram') : t('mermaid.showSource')}
        >
          {showSource ? <Workflow size={12} /> : <Code2 size={12} />}
        </ActionIcon>
      </Tooltip>
      <Tooltip label={copied ? t('mermaid.copied') : t('mermaid.copySource')}>
        <ActionIcon
          variant="default"
          size={26}
          onClick={handleCopy}
          aria-label={copied ? t('mermaid.copied') : t('mermaid.copySource')}
          style={{ color: copied ? 'var(--success)' : 'var(--text-muted)' }}
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
        </ActionIcon>
      </Tooltip>
    </Group>
  );

  /*
   * Plain elements on purpose: this subtree also renders inside the export
   * window, which has no MantineProvider. The SVG comes from mermaid with
   * securityLevel 'strict', so it is already DOMPurify-sanitised.
   */
  return (
    <div className="mermaid-block">
      {toolbar}
      {showSource
        ? source
        : <div className="mermaid-figure" dangerouslySetInnerHTML={{ __html: state.svg }} />}
    </div>
  );
});
