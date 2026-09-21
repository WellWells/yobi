import React, { useCallback, useMemo, useState } from 'react';
import { Box, Group, Stack, Text } from '@mantine/core';

export interface TrendBarSeries {
  id: string;
  label: string;
  color: string;
  values: number[];
}

interface Props {
  labels: string[];
  series: TrendBarSeries[];
  height?: number;
  totalLabel?: string;
  formatValue?: (value: number) => string;
}

const PAD_LEFT = 30;
const PAD_RIGHT = 10;
const PAD_TOP = 12;
const PAD_BOTTOM = 22;
const VIEW_W = 520;

/** A rare failure is 0.02% of a busy day. Without a floor its segment never draws at all. */
const MIN_SEGMENT_H = 2.5;
const SEGMENT_GAP = 1;

function formatTick(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function niceAxisMax(value: number): number {
  if (value <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(value));
  const norm = value / pow;
  const nice = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  return nice * pow;
}

/**
 * Stacked day columns. Stacked rather than grouped on purpose: these series are parts of one
 * day's total, and side-by-side bars make the smaller series unreadable whenever one dominates
 * — which is the normal case for both outcomes (successes swamp failures) and tokens (input
 * swamps output).
 */
export const TrendBarChart: React.FC<Props> = ({
  labels,
  series,
  height = 150,
  totalLabel,
  formatValue = formatTick,
}) => {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const count = labels.length;

  const innerW = VIEW_W - PAD_LEFT - PAD_RIGHT;
  const innerH = height - PAD_TOP - PAD_BOTTOM;

  const totals = useMemo(
    () => labels.map((_, index) => series.reduce((sum, s) => sum + (s.values[index] ?? 0), 0)),
    [labels, series],
  );
  const maxValue = niceAxisMax(Math.max(0, ...totals));

  const slotW = count > 0 ? innerW / count : innerW;
  const baseY = PAD_TOP + innerH;
  const slotCenter = (index: number): number => PAD_LEFT + slotW * (index + 0.5);
  const y = (value: number): number => baseY - (innerH * value) / maxValue;
  const barW = Math.min(slotW * 0.62, 34);

  const handleMouseMove = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width === 0 || count === 0) return;
    const viewX = ((event.clientX - rect.left) / rect.width) * VIEW_W;
    setHoverIndex(Math.max(0, Math.min(count - 1, Math.floor((viewX - PAD_LEFT) / slotW))));
  }, [count, slotW]);

  if (count === 0) return null;

  const labelIndexes = [...new Set([0, Math.floor((count - 1) / 2), count - 1])];
  const tooltipOnLeft = hoverIndex !== null && hoverIndex > (count - 1) / 2;

  return (
    <Box w="100%" pos="relative" onMouseMove={handleMouseMove} onMouseLeave={() => setHoverIndex(null)}>
      <svg viewBox={`0 0 ${VIEW_W} ${height}`} width="100%" role="img" style={{ display: 'block' }}>
        {[1, 0.5, 0].map((fraction) => (
          <line
            key={fraction}
            x1={PAD_LEFT}
            x2={VIEW_W - PAD_RIGHT}
            y1={y(maxValue * fraction)}
            y2={y(maxValue * fraction)}
            stroke="var(--mantine-color-default-border)"
            strokeWidth={fraction === 0 ? 1 : 0.6}
            strokeDasharray={fraction === 0 ? undefined : '3 4'}
          />
        ))}
        {hoverIndex !== null && (
          <rect
            x={PAD_LEFT + slotW * hoverIndex}
            y={PAD_TOP}
            width={slotW}
            height={innerH}
            fill="var(--mantine-color-default-border)"
            opacity={0.25}
          />
        )}
        {labels.map((label, index) => {
          let top = baseY;
          return (
            <g key={label}>
              {series.map((s) => {
                const value = s.values[index] ?? 0;
                if (value <= 0) return null;
                const segH = Math.max(innerH * (value / maxValue), MIN_SEGMENT_H);
                const bottom = top;
                top -= segH + SEGMENT_GAP;
                return (
                  <rect
                    key={s.id}
                    x={PAD_LEFT + slotW * index + (slotW - barW) / 2}
                    y={bottom - segH}
                    width={barW}
                    height={segH}
                    rx={1.5}
                    fill={s.color}
                  />
                );
              })}
            </g>
          );
        })}
        {[maxValue, maxValue / 2, 0].map((tickValue, tickIndex) => (
          <text
            key={tickIndex}
            x={PAD_LEFT - 5}
            y={y(tickValue) + 3}
            fontSize={9}
            fill="var(--mantine-color-dimmed)"
            textAnchor="end"
          >
            {formatValue(tickValue)}
          </text>
        ))}
        {labelIndexes.map((index) => (
          <text
            key={index}
            x={slotCenter(index)}
            y={height - 6}
            fontSize={9}
            fill="var(--mantine-color-dimmed)"
            textAnchor="middle"
          >
            {labels[index]}
          </text>
        ))}
      </svg>
      {hoverIndex !== null && (
        <Box
          pos="absolute"
          top={2}
          left={`${(slotCenter(hoverIndex) / VIEW_W) * 100}%`}
          miw={128}
          p="8px 10px"
          style={{
            transform: tooltipOnLeft ? 'translateX(calc(-100% - 12px))' : 'translateX(12px)',
            pointerEvents: 'none',
            zIndex: 10,
            background: 'var(--mantine-color-default)',
            border: '1px solid var(--mantine-color-default-border)',
            borderRadius: 'var(--mantine-radius-sm)',
            boxShadow: 'var(--shadow-md)',
          }}
        >
          <Group justify="space-between" gap={16} wrap="nowrap" mb={5}>
            <Text fz="var(--font-size-sm)" fw={700} c="var(--mantine-color-text)">
              {labels[hoverIndex]}
            </Text>
            {totalLabel !== undefined && (
              <Text fz="var(--font-size-sm)" fw={700} style={{ fontVariantNumeric: 'tabular-nums' }}>
                {formatValue(totals[hoverIndex] ?? 0)}
              </Text>
            )}
          </Group>
          <Stack gap={3}>
            {series.map((s) => (
              <Group key={s.id} justify="space-between" gap={16} wrap="nowrap">
                <Group gap={5} wrap="nowrap">
                  <Box w={7} h={7} style={{ borderRadius: '50%', background: s.color, flexShrink: 0 }} />
                  <Text fz="var(--font-size-sm)" c="dimmed">{s.label}</Text>
                </Group>
                <Text fz="var(--font-size-sm)" fw={600} style={{ fontVariantNumeric: 'tabular-nums' }}>
                  {formatValue(s.values[hoverIndex] ?? 0)}
                </Text>
              </Group>
            ))}
          </Stack>
        </Box>
      )}
    </Box>
  );
};
