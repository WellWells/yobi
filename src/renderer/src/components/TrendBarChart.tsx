import React, { useCallback, useState } from 'react';
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
  viewWidth?: number;
  axisMax?: number;
  formatValue?: (value: number) => string;
}

const PAD_LEFT = 24;
const PAD_RIGHT = 10;
const PAD_TOP = 12;
const PAD_BOTTOM = 22;

function formatTick(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export const TrendBarChart: React.FC<Props> = ({
  labels,
  series,
  height = 150,
  viewWidth = 520,
  axisMax,
  formatValue = formatTick,
}) => {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const count = labels.length;

  const VIEW_W = viewWidth;
  const innerW = VIEW_W - PAD_LEFT - PAD_RIGHT;
  const innerH = height - PAD_TOP - PAD_BOTTOM;
  const maxValue = Math.max(1, axisMax ?? Math.max(1, ...series.flatMap((s) => s.values)));

  const slotW = count > 0 ? innerW / count : innerW;
  const baseY = PAD_TOP + innerH;
  const slotCenter = (index: number): number => PAD_LEFT + slotW * (index + 0.5);
  const y = (value: number): number => baseY - (innerH * value) / maxValue;

  const seriesCount = Math.max(1, series.length);
  const groupW = slotW * 0.62;
  const barW = groupW / seriesCount;

  const handleMouseMove = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width === 0 || count === 0) return;
    const viewX = ((event.clientX - rect.left) / rect.width) * VIEW_W;
    const index = Math.floor((viewX - PAD_LEFT) / slotW);
    setHoverIndex(Math.max(0, Math.min(count - 1, index)));
  }, [count, slotW, VIEW_W]);

  if (count === 0) return null;

  const labelIndexes = [...new Set([0, Math.floor((count - 1) / 2), count - 1])];
  const tooltipOnLeft = hoverIndex !== null && hoverIndex > (count - 1) / 2;

  return (
    <Box
      w="100%"
      pos="relative"
      onMouseMove={handleMouseMove}
      onMouseLeave={() => setHoverIndex(null)}
    >
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
        {series.map((s, si) => (
          <g key={s.id}>
            {s.values.map((value, index) => {
              if (value <= 0) return null;
              const bx = PAD_LEFT + slotW * index + (slotW - groupW) / 2 + barW * si;
              const barH = Math.max(baseY - y(value), 1.5);
              return (
                <rect
                  key={index}
                  x={bx}
                  y={baseY - barH}
                  width={Math.max(1, barW - 1.5)}
                  height={barH}
                  rx={1.5}
                  fill={s.color}
                />
              );
            })}
          </g>
        ))}
        {[maxValue, maxValue / 2, 0].map((tickValue, tickIndex) => (
          <text
            key={tickIndex}
            x={PAD_LEFT - 4}
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
          miw={120}
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
          <Text fz="var(--font-size-sm)" fw={700} mb={5} c="var(--mantine-color-text)">
            {labels[hoverIndex]}
          </Text>
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
