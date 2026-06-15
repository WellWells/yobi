import React, { useEffect, useState, useCallback, useContext } from 'react';
import { ActionIcon, Badge } from '@mantine/core';
import { Copy, Check } from 'lucide-react';
import { getHighlighterSync, loadShiki, appThemeToShikiTheme } from '../utils/shikiPlugins';
import { useThemeStore } from '../store/themeStore';
import { useI18nStore } from '../store/i18nStore';
import { ForcedCodeThemeContext } from '../utils/forcedCodeTheme';

interface ShikiCodeBlockProps {
  lang: string;
  code: string;
}

export const ShikiCodeBlock = React.memo<ShikiCodeBlockProps>(({ lang, code }) => {
  const [html, setHtml] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const storeTheme = useThemeStore((state) => state.theme);
  const forcedTheme = useContext(ForcedCodeThemeContext);
  const theme = forcedTheme ?? storeTheme;
  const { t } = useI18nStore();

  useEffect(() => {
    let cancelled = false;

    const highlight = async () => {
      let highlighter = getHighlighterSync();
      if (!highlighter) {
        highlighter = await loadShiki();
      }
      if (cancelled || !highlighter) return;

      const shikiTheme = appThemeToShikiTheme[theme] ?? 'github-dark';
      try {
        const result = await highlighter.codeToHtml(code, {
          lang: lang || 'text',
          theme: shikiTheme,
        });
        if (!cancelled) setHtml(result);
      } catch {
        try {
          const result = await highlighter.codeToHtml(code, { lang: 'text', theme: shikiTheme });
          if (!cancelled) setHtml(result);
        } catch {
        }
      }
    };

    void highlight();
    return () => { cancelled = true; };
  }, [code, lang, theme]);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2_000);
    } catch {
    }
  }, [code]);

  const displayLang = lang || 'text';
  const copyLabel = copied
    ? t('codeBlock.copied')
    : t('codeBlock.copy');

  const wrapperStyle: React.CSSProperties = {
    position: 'relative',
    margin: '0.75em 0',
    borderRadius: 'var(--radius-lg)',
    overflow: 'clip' as React.CSSProperties['overflow'],
    background: 'var(--code-bg)',
    boxShadow: '0 0 0 1px var(--border), 0 2px 10px rgba(0,0,0,0.15)',
  };

  const langBadge = (
    <Badge
      variant="filled"
      size="xs"
      radius="sm"
      aria-label={`Language: ${displayLang}`}
      style={{
        position: 'absolute',
        top: 8,
        left: 14,
        zIndex: 3,
        textTransform: 'lowercase',
        letterSpacing: '0.06em',
        background: 'var(--bg-tertiary)',
        color: 'var(--text-muted)',
        userSelect: 'none',
        pointerEvents: 'none',
      }}
    >
      {displayLang}
    </Badge>
  );

  const copyButton = (
    <div
      style={{
        position: 'sticky',
        top: 8,
        zIndex: 5,
        height: 0,
        overflow: 'visible',
        display: 'flex',
        justifyContent: 'flex-end',
        pointerEvents: 'none',
      }}
    >
      <ActionIcon
        variant="default"
        size={26}
        onClick={handleCopy}
        aria-label={copyLabel}
        title={copyLabel}
        style={{
          marginRight: 10,
          color: copied ? 'var(--success)' : 'var(--text-muted)',
          pointerEvents: 'auto',
        }}
      >
        {copied ? <Check size={12} /> : <Copy size={12} />}
      </ActionIcon>
    </div>
  );

  if (html !== null) {
    return (
      <div className="code-block-wrapper" style={wrapperStyle}>
        {langBadge}
        {copyButton}
        <div dangerouslySetInnerHTML={{ __html: html }} />
      </div>
    );
  }

  return (
    <div className="code-block-wrapper" style={wrapperStyle}>
      {langBadge}
      {copyButton}
      <pre style={{
        margin: 0,
        background: 'transparent',
        color: 'var(--text-primary)',
        padding: '36px 1rem 1rem',
        fontSize: 'var(--font-size-md)',
        lineHeight: 1.6,
        fontFamily: 'var(--font-mono)',
      }}>
        <code className={lang ? `language-${lang}` : ''}>{code}</code>
      </pre>
    </div>
  );
});


