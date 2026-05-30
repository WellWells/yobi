import React, { useMemo, useState } from 'react';
import { PencilLine } from 'lucide-react';

interface PromptBlockProps {
  prompt: string;
  isSideBySide?: boolean;
  label: string;
  expandText: string;
  collapseText: string;
  truncatedHint: string;
}

function buildPromptPreview(prompt: string, maxLines: number, maxChars: number): string {
  const lines = prompt.split('\n');
  const sliced = lines.slice(0, maxLines).join('\n');
  const limited = sliced.length > maxChars ? sliced.slice(0, maxChars) : sliced;
  if (limited.length >= prompt.length) return limited;
  return `${limited}…`;
}

export const PromptBlock = React.memo<PromptBlockProps>(({
  prompt,
  isSideBySide = false,
  label,
  expandText,
  collapseText,
  truncatedHint,
}) => {
  const [expanded, setExpanded] = useState(false);
  const normalizedPrompt = useMemo(() => prompt.replace(/\r\n?/g, '\n'), [prompt]);
  const lineCount = useMemo(() => {
    if (!normalizedPrompt) return 0;
    return normalizedPrompt.split('\n').length;
  }, [normalizedPrompt]);
  const previewPrompt = useMemo(
    () => buildPromptPreview(normalizedPrompt, 3, 1_200),
    [normalizedPrompt],
  );

  const needsClamp = lineCount > 3 || normalizedPrompt.length > 180;
  const displayPrompt = needsClamp && !expanded ? previewPrompt : normalizedPrompt;

  return (
    <div style={{
      background: 'var(--bg-tertiary)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius)',
      padding: '10px 14px',
      marginBottom: 12,
      position: 'relative',
    }}>
      <div style={{
        fontSize: 'var(--font-size-xs)',
        fontWeight: 700,
        color: 'var(--text-muted)',
        textTransform: 'uppercase',
        letterSpacing: '0.8px',
        marginBottom: 6,
        display: 'flex',
        alignItems: 'center',
        gap: 5,
      }}>
        <PencilLine size={12} />
        {label}
      </div>

      <div
        className="md-content md-prompt"
        style={{
          overflow: expanded ? 'auto' : 'hidden',
          userSelect: 'text',
          fontSize: 'var(--font-size-md)',
          lineHeight: 1.6,
          color: 'var(--text-secondary)',
          whiteSpace: 'pre-wrap',
          overflowWrap: isSideBySide ? 'anywhere' : undefined,
          wordBreak: isSideBySide ? 'break-word' : undefined,
          maxHeight: expanded ? (isSideBySide ? '40vh' : '32vh') : undefined,
        } as React.CSSProperties}
      >
        {displayPrompt}
      </div>

      {needsClamp && !expanded && (
        <div style={{
          marginTop: 6,
          fontSize: 'var(--font-size-sm)',
          color: 'var(--text-muted)',
          fontStyle: 'italic',
        }}>
          {truncatedHint}
        </div>
      )}

      {needsClamp && (
        <button
          onClick={() => setExpanded((value) => !value)}
          style={{
            marginTop: 6,
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            fontSize: 'var(--font-size-sm)',
            color: 'var(--accent)',
            padding: '2px 0',
            fontWeight: 600,
          }}
        >
          {expanded ? collapseText : expandText}
        </button>
      )}
    </div>
  );
});

