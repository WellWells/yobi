import React from 'react';
import { BaseMarkdown, ExternalLink, MarkdownImage, ScrollableTable, SharedCodeBlock, SharedPreBlock } from '../../utils/markdownConfig';

const mdComponents = { a: ExternalLink, img: MarkdownImage, pre: SharedPreBlock, code: SharedCodeBlock, table: ScrollableTable } as const;

export const MessageMarkdown = React.memo<{ children: string }>(({ children }) => (
  <BaseMarkdown components={mdComponents}>{children}</BaseMarkdown>
));
