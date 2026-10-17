import React, { useState } from 'react';
import { Box, Image, UnstyledButton } from '@mantine/core';
import { turnMediaKind, turnMediaUrl } from '../../../../../shared/turnMedia';
import styles from './MediaViewer.module.css';

export const STRIP_HEIGHT = 80;
const NARROW = 56;
const WIDE_MAX = 160;
const GAP = 3;
const CURRENT_MARGIN = 9;

/** The current thumbnail keeps its own shape, between the narrow width and `WIDE_MAX`. */
export function currentThumbWidth(aspect: number | undefined): number {
  return Math.min(WIDE_MAX, Math.max(NARROW, Math.round(STRIP_HEIGHT * (aspect ?? 1))));
}

/** How far the row slides so the current thumbnail sits in the middle. */
export function stripShift(index: number, currentWidth: number): number {
  return index * (NARROW + GAP) + CURRENT_MARGIN + currentWidth / 2;
}

/**
 * Every item of the turn along the bottom, as Telegram shows an album: the others as narrow
 * dimmed slices, the current one at its own shape in the middle; a click goes to that item.
 */
export const ThumbStrip: React.FC<{
  files: readonly string[];
  index: number;
  onPick: (index: number) => void;
}> = ({ files, index, onPick }) => {
  const [aspects, setAspects] = useState<Readonly<Record<string, number>>>({});
  const remember = (file: string, w: number, h: number): void => {
    if (w > 0 && h > 0) setAspects((prev) => ({ ...prev, [file]: w / h }));
  };
  const width = currentThumbWidth(aspects[files[index]]);

  return (
    <Box pos="relative" h={STRIP_HEIGHT} w="100%" style={{ overflow: 'hidden' }}>
      <Box
        pos="absolute"
        top={0}
        left="50%"
        display="flex"
        className={styles.stripRow}
        style={{ gap: GAP, transform: `translateX(${-stripShift(index, width)}px)` }}
      >
        {files.map((file, at) => {
          const current = at === index;
          const fill: React.CSSProperties = { display: 'block', width: '100%', height: '100%', objectFit: 'cover', pointerEvents: 'none' };
          return (
            <UnstyledButton
              key={file}
              aria-label={`${at + 1} / ${files.length}`}
              aria-current={current || undefined}
              className={styles.thumb}
              data-current={current || undefined}
              onClick={() => onPick(at)}
              style={{ width: current ? width : NARROW, height: STRIP_HEIGHT, marginInline: current ? CURRENT_MARGIN : 0 }}
            >
              {turnMediaKind(file) === 'video' ? (
                <Box
                  component="video"
                  src={`${turnMediaUrl(file)}#t=0.1`}
                  preload="metadata"
                  muted
                  tabIndex={-1}
                  onLoadedMetadata={(event: React.SyntheticEvent<HTMLVideoElement>) => remember(file, event.currentTarget.videoWidth, event.currentTarget.videoHeight)}
                  style={fill}
                />
              ) : (
                <Image
                  src={turnMediaUrl(file)}
                  draggable={false}
                  onLoad={(event) => remember(file, event.currentTarget.naturalWidth, event.currentTarget.naturalHeight)}
                  style={fill}
                />
              )}
            </UnstyledButton>
          );
        })}
      </Box>
    </Box>
  );
};
