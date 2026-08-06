import React, { useEffect, useRef, useState } from 'react';
import { Box } from '@mantine/core';
import { DEFAULT_CAPTURE_WIDTH } from '../../../../shared/types';
import type { MarkdownCaptureRequest } from '../../../../shared/types';
import { CaptureCard } from './CaptureCard';
import '../../styles/captureCard.css';
import './scaledCard.css';

export interface ScaledCardFrameProps {
  request: MarkdownCaptureRequest | null;
  onMeasure?: (logicalHeight: number) => void;
}

export const ScaledCardFrame: React.FC<ScaledCardFrameProps> = ({ request, onMeasure }) => {
  const frameRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [scaledHeight, setScaledHeight] = useState(0);
  const width = request?.options.width ?? DEFAULT_CAPTURE_WIDTH;

  const onMeasureRef = useRef(onMeasure);
  onMeasureRef.current = onMeasure;

  useEffect(() => {
    const frame = frameRef.current;
    const card = cardRef.current;
    if (!frame || !card) {
      setScaledHeight(0);
      onMeasureRef.current?.(0);
      return;
    }
    const measure = (): void => {
      const next = frame.clientWidth / width;
      setScale(next);
      setScaledHeight(card.offsetHeight * next);
      onMeasureRef.current?.(card.offsetHeight);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(frame);
    observer.observe(card);
    return () => observer.disconnect();
  }, [width, request]);

  return (
    <Box
      ref={frameRef}
      style={{
        position: 'relative',
        borderRadius: 'var(--radius-sm)',
        overflow: 'hidden',
        border: '1px solid var(--border)',
        flexShrink: 0,
        height: scaledHeight || undefined,
      }}
    >
      {request && (
        <Box
          ref={cardRef}
          className="scaled-capture-card"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width,
            transform: `scale(${scale})`,
            transformOrigin: 'top left',
          }}
        >
          <CaptureCard request={request} />
        </Box>
      )}
    </Box>
  );
};
