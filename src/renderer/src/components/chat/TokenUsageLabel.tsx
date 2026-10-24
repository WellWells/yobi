import React from 'react';
import { Text, Tooltip } from '@mantine/core';
import { formatTokenCount, type TokenUsage } from '../../../../shared/tokenEstimate';
import { fillTemplate } from '../../../../shared/fillTemplate';

interface TokenUsageLabelProps {
  usage: TokenUsage;
  labelKey: string;
  t: (key: string) => string;
  detail?: string;
}

export const TokenUsageLabel: React.FC<TokenUsageLabelProps> = ({ usage, labelKey, t, detail }) => {
  const total = usage.input + usage.output;
  const tooltip = [
    fillTemplate(t(usage.exact ? 'chat.tokens.tooltip.exact' : 'chat.tokens.tooltip.estimated'), { input: formatTokenCount(usage.input), output: formatTokenCount(usage.output) }),
    detail,
  ].filter(Boolean).join('\n\n');

  return (
    <Tooltip label={tooltip} position="top" maw={340} multiline>
      <Text
        fz="var(--font-size-sm)"
        c="dimmed"
        style={{ cursor: 'help', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}
      >
        {`${usage.exact ? '' : '~'}${fillTemplate(t(labelKey), { total: formatTokenCount(total) })}`}
      </Text>
    </Tooltip>
  );
};
