import React from 'react';
import { BaseMarkdown, ExternalLink, SharedCodeBlock, SharedPreBlock } from '../../utils/markdownConfig';

const mdComponents = { a: ExternalLink, pre: SharedPreBlock, code: SharedCodeBlock } as const;

export const MessageMarkdown = React.memo<{ children: string }>(({ children }) => (
  <BaseMarkdown components={mdComponents}>{children}</BaseMarkdown>
));
