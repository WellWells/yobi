import React from 'react';
import ReactMarkdown from 'react-markdown';
import 'katex/dist/katex.min.css';
import { REHYPE_PLUGINS } from '../../utils/shikiPlugins';
import { ExternalLink, SharedCodeBlock, SharedPreBlock, remarkPlugins } from '../../utils/markdownConfig';

const mdComponents = { a: ExternalLink, pre: SharedPreBlock, code: SharedCodeBlock } as const;

export const MessageMarkdown = React.memo<{ children: string }>(({ children }) => (
  <ReactMarkdown
    remarkPlugins={remarkPlugins}
    rehypePlugins={REHYPE_PLUGINS}
    components={mdComponents}
  >
    {children}
  </ReactMarkdown>
));
