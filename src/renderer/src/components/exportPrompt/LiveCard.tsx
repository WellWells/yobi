import React, { useEffect, useRef } from 'react';
import { Box } from '@mantine/core';
import type { MarkdownCaptureRequest } from '../../../../shared/types';
import { CaptureCard } from '../capture/CaptureCard';
import '../../styles/captureCard.css';
import '../capture/scaledCard.css';

interface Props {
  request: MarkdownCaptureRequest;
  boxWidth: number;
  /** The card's height at its real width, as the capture window will measure it. */
  onMeasure: (logicalHeight: number) => void;
}

/** The preview box's own border, which the scaled card sits inside. */
const FRAME_BORDER = 1;

/**
 * The real card the quick export renders, scaled to the preview box and cut off at its bottom, so
 * the top of the export is what the panel shows. Its own chunk: the panel opens on the schematic
 * and swaps this in once it has loaded.
 */
const LiveCard: React.FC<Props> = ({ request, boxWidth, onMeasure }) => {
  const cardRef = useRef<HTMLDivElement>(null);
  const onMeasureRef = useRef(onMeasure);
  onMeasureRef.current = onMeasure;

  useEffect(() => {
    const card = cardRef.current;
    if (!card) return undefined;
    // offsetHeight ignores the transform: this is the card's real, unscaled height.
    const observer = new ResizeObserver(() => onMeasureRef.current(Math.ceil(card.offsetHeight)));
    observer.observe(card);
    return () => observer.disconnect();
  }, []);

  const width = request.options.width;
  const scale = (boxWidth - FRAME_BORDER * 2) / width;

  return (
    <Box
      aria-hidden
      style={{
        position: 'relative',
        height: '100%',
        borderRadius: 'var(--mantine-radius-sm)',
        border: `${FRAME_BORDER}px solid var(--border)`,
        overflow: 'hidden',
      }}
    >
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
    </Box>
  );
};

export default LiveCard;
