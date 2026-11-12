import React, { useMemo } from 'react';
import { notionToDisplay } from '../../../../shared/notion/notionDisplay';
import { useI18nStore } from '../../store/i18nStore';
import { BaseMarkdown, ExternalLink, MarkdownImage, ScrollableTable, SharedCodeBlock, SharedPreBlock } from '../../utils/markdownConfig';
import { CitationRun, CitationTitlesContext, citationTitles } from './CitationChip';

const mdComponents = { a: ExternalLink, img: MarkdownImage, pre: SharedPreBlock, code: SharedCodeBlock, table: ScrollableTable } as const;
const mdChipComponents = { ...mdComponents, cite: CitationRun } as const;

/** A Notion document's text is shown through `notionToDisplay`; the text itself stays Notion's. */
const NotionMarkdown: React.FC<{ children: string }> = ({ children }) => {
  const t = useI18nStore((s) => s.t);
  const unsupported = t('notion.block.unsupported');
  const shown = useMemo(() => notionToDisplay(children, { unsupported }), [children, unsupported]);
  return <BaseMarkdown components={mdComponents}>{shown}</BaseMarkdown>;
};

/** A chat answer: its `[1]` markers show as site chips titled from its own source list. */
const ChipMarkdown: React.FC<{ children: string }> = ({ children }) => {
  const titles = useMemo(() => citationTitles(children), [children]);
  return (
    <CitationTitlesContext.Provider value={titles}>
      <BaseMarkdown components={mdChipComponents} citationChips>{children}</BaseMarkdown>
    </CitationTitlesContext.Provider>
  );
};

export const MessageMarkdown = React.memo<{ children: string; notion?: boolean; citationChips?: boolean }>(({ children, notion = false, citationChips = false }) => {
  if (notion) return <NotionMarkdown>{children}</NotionMarkdown>;
  if (citationChips) return <ChipMarkdown>{children}</ChipMarkdown>;
  return <BaseMarkdown components={mdComponents}>{children}</BaseMarkdown>;
});
