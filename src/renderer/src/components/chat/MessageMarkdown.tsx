import React, { useMemo } from 'react';
import { notionToDisplay } from '../../../../shared/notion/notionDisplay';
import { useI18nStore } from '../../store/i18nStore';
import { BaseMarkdown, ExternalLink, MarkdownImage, ScrollableTable, SharedCodeBlock, SharedPreBlock } from '../../utils/markdownConfig';

const mdComponents = { a: ExternalLink, img: MarkdownImage, pre: SharedPreBlock, code: SharedCodeBlock, table: ScrollableTable } as const;

/** A Notion document's text is shown through `notionToDisplay`; the text itself stays Notion's. */
const NotionMarkdown: React.FC<{ children: string }> = ({ children }) => {
  const t = useI18nStore((s) => s.t);
  const unsupported = t('notion.block.unsupported');
  const shown = useMemo(() => notionToDisplay(children, { unsupported }), [children, unsupported]);
  return <BaseMarkdown components={mdComponents}>{shown}</BaseMarkdown>;
};

export const MessageMarkdown = React.memo<{ children: string; notion?: boolean }>(({ children, notion = false }) => (
  notion
    ? <NotionMarkdown>{children}</NotionMarkdown>
    : <BaseMarkdown components={mdComponents}>{children}</BaseMarkdown>
));
