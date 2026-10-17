import React, { useMemo, useState } from 'react';
import { Box, UnstyledButton } from '@mantine/core';
import { ChevronDown, ChevronUp, PencilLine } from 'lucide-react';
import { GroupHeader } from '../GroupHeader';
import { READING_TEXT_STYLE } from '../../styles/readingText';

interface PromptBlockProps {
  prompt: string;
  isSideBySide?: boolean;
  label: string;
  expandText: string;
  collapseText: string;
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
}) => {
  const [expanded, setExpanded] = useState(false);
  const normalizedPrompt = useMemo(() => prompt.replace(/\r\n?/g, '\n'), [prompt]);
  const previewPrompt = useMemo(
    () => buildPromptPreview(normalizedPrompt, 3, 1_200),
    [normalizedPrompt],
  );

  // Only a preview that actually cut text gets the toggle: one that fits shows in full.
  const needsClamp = previewPrompt !== normalizedPrompt;
  const displayPrompt = needsClamp && !expanded ? previewPrompt : normalizedPrompt;

  return (
    <Box style={{
      background: 'var(--bg-tertiary)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius)',
      padding: '10px 14px',
      marginBottom: 12,
      position: 'relative',
    }}>
      <GroupHeader variant="plain" icon={<PencilLine size={12} />} label={label} mb={6} />

      {/* Expanded shows the whole prompt inline, with no nested scroll container; the collapse
          button below is the way back. */}
      <Box
        className="md-content md-prompt"
        style={{
          overflow: 'hidden',
          ...READING_TEXT_STYLE,
          lineHeight: 1.6,
          color: 'var(--text-secondary)',
          whiteSpace: 'pre-wrap',
          overflowWrap: isSideBySide ? 'anywhere' : undefined,
          wordBreak: isSideBySide ? 'break-word' : undefined,
        } as React.CSSProperties}
      >
        {displayPrompt}
      </Box>

      {needsClamp && (
        <UnstyledButton
          onClick={() => setExpanded((value) => !value)}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            marginTop: 6,
            fontSize: 'var(--font-size-sm)',
            color: 'var(--accent)',
            padding: '2px 0',
            fontWeight: 600,
          }}
        >
          {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          {expanded ? collapseText : expandText}
        </UnstyledButton>
      )}
    </Box>
  );
});

