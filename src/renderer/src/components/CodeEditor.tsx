import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Box } from '@mantine/core';
import Editor from 'react-simple-code-editor';
import type { Plugin } from 'prettier';
import { getHighlighterSync, loadShiki, appThemeToShikiTheme } from '../utils/shikiPlugins';
import { useThemeStore } from '../store/themeStore';

interface CodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  ariaLabel?: string;
  lang?: string;
  parser?: string;
  minHeight?: number;
  maxHeight?: number;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export const CodeEditor: React.FC<CodeEditorProps> = ({
  value,
  onChange,
  placeholder,
  ariaLabel,
  lang = 'javascript',
  parser = 'babel',
  minHeight = 132,
  maxHeight = 360,
}) => {
  const theme = useThemeStore((s) => s.theme);
  const [ready, setReady] = useState(() => getHighlighterSync() !== null);
  const shikiTheme = appThemeToShikiTheme[theme] ?? 'github-dark';

  useEffect(() => {
    if (ready) return;
    let cancelled = false;
    void loadShiki().then(() => {
      if (!cancelled) setReady(getHighlighterSync() !== null);
    });
    return () => { cancelled = true; };
  }, [ready]);

  const highlight = useCallback((code: string): string => {
    const hl = getHighlighterSync();
    if (!hl) return escapeHtml(code);
    try {
      return hl.codeToHtml(code, { lang, theme: shikiTheme })
        .replace(/^<pre[^>]*>/, '')
        .replace(/<\/pre>\s*$/, '')
        .replace(/^<code[^>]*>/, '')
        .replace(/<\/code>\s*$/, '');
    } catch {
      return escapeHtml(code);
    }
  }, [lang, shikiTheme, ready]);

  const bg = useMemo(() => {
    const hl = getHighlighterSync();
    if (!hl) return 'var(--code-bg)';
    try {
      const m = hl.codeToHtml('', { lang, theme: shikiTheme }).match(/background-color:\s*([^;"']+)/i);
      return m ? m[1] : 'var(--code-bg)';
    } catch {
      return 'var(--code-bg)';
    }
  }, [lang, shikiTheme, ready]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!(e.altKey && e.shiftKey && (e.code === 'KeyF' || e.key.toLowerCase() === 'f'))) return;
    e.preventDefault();
    if (!value.trim()) return;
    void (async () => {
      try {
        const [prettier, babel, estree] = await Promise.all([
          import('prettier/standalone'),
          import('prettier/plugins/babel'),
          import('prettier/plugins/estree'),
        ]);
        const wrapped = `async function __fmt__() {\n${value}\n}`;
        const out = await prettier.format(wrapped, {
          parser,
          plugins: [babel as unknown as Plugin, estree as unknown as Plugin],
          semi: true,
          singleQuote: true,
          tabWidth: 2,
          printWidth: 100,
        });
        const lines = out.replace(/\n+$/, '').split('\n');
        if (lines.length < 3) return;
        const body = lines.slice(1, -1).map((l) => (l.startsWith('  ') ? l.slice(2) : l)).join('\n');
        onChange(body);
      } catch {
      }
    })();
  }, [value, parser, onChange]);

  return (
    <Box
      onKeyDown={handleKeyDown}
      style={{
        background: bg,
        border: '1px solid var(--mantine-color-default-border)',
        borderRadius: 'var(--mantine-radius-sm)',
        overflow: 'auto',
        maxHeight,
      }}
    >
      <Editor
        value={value}
        onValueChange={onChange}
        highlight={highlight}
        padding={10}
        placeholder={placeholder}
        aria-label={ariaLabel}
        spellCheck={false}
        style={{
          fontFamily: 'var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace)',
          fontSize: 13,
          lineHeight: 1.6,
          minHeight,
          color: 'var(--text-primary, #e1e4e8)',
        }}
      />
    </Box>
  );
};
