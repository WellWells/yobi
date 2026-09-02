import React from 'react';
import ReactMarkdown from 'react-markdown';
import { useKatexPlugins } from '../../utils/katexRuntime';
import { ExternalLink, SharedCodeBlock, SharedPreBlock, remarkPlugins } from '../../utils/markdownConfig';

const mdComponents = { a: ExternalLink, pre: SharedPreBlock, code: SharedCodeBlock } as const;

export const MessageMarkdown = React.memo<{ children: string }>(({ children }) => {
  const rehypePlugins = useKatexPlugins(children);
  return (
    <ReactMarkdown
      remarkPlugins={remarkPlugins}
      rehypePlugins={rehypePlugins}
      components={mdComponents}
    >
      {children}
    </ReactMarkdown>
  );
});
