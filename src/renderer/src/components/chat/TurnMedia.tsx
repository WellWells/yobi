import React, { useEffect, useRef, useState } from 'react';
import { Box, Group, Image, Stack, Text, UnstyledButton } from '@mantine/core';
import { Play } from 'lucide-react';
import { turnMediaKind, turnMediaUrl } from '../../../../shared/turnMedia';
import { formatDuration } from '../../../../shared/ytdl';
import { MediaViewer } from './mediaViewer/MediaViewer';
import { TurnAudio } from './TurnAudio';
import styles from './TurnMedia.module.css';

const SINGLE_MAX_HEIGHT = 360;
const TILE = 150;
const GAP = 6;

/** How many square tiles fit on one row; all of them while the width is not known yet. */
export function stripFit(count: number, width: number): number {
  if (width <= 0) return count;
  return Math.max(1, Math.min(count, Math.floor((width + GAP) / (TILE + GAP))));
}

/** A video's first frame — `#t` makes Chromium paint one instead of a black box. */
function posterUrl(file: string): string {
  return `${turnMediaUrl(file)}#t=0.1`;
}

const MediaTile: React.FC<{
  file: string;
  single: boolean;
  more: number;
  onOpen: () => void;
  onError: () => void;
}> = ({ file, single, more, onOpen, onError }) => {
  const [duration, setDuration] = useState('');
  const video = turnMediaKind(file) === 'video';
  const fill: React.CSSProperties = single
    ? { display: 'block', maxWidth: '100%', maxHeight: SINGLE_MAX_HEIGHT, width: 'auto', height: 'auto' }
    : { display: 'block', width: '100%', height: '100%', objectFit: 'cover' };

  return (
    <UnstyledButton
      onClick={onOpen}
      className={styles.tile}
      style={single ? { maxWidth: '100%' } : { width: TILE, height: TILE, flexShrink: 0 }}
    >
      {video ? (
        <Box
          component="video"
          src={posterUrl(file)}
          preload="metadata"
          muted
          playsInline
          tabIndex={-1}
          onLoadedMetadata={(event: React.SyntheticEvent<HTMLVideoElement>) => setDuration(formatDuration(event.currentTarget.duration))}
          onError={onError}
          style={{ ...fill, pointerEvents: 'none', background: 'var(--bg-secondary)' }}
        />
      ) : (
        <Image src={turnMediaUrl(file)} onError={onError} draggable={false} style={fill} />
      )}
      {video && more === 0 && (
        <>
          <Box className={styles.play}><Play size={single ? 26 : 20} fill="currentColor" /></Box>
          {duration && <Text component="span" className={styles.duration}>{duration}</Text>}
        </>
      )}
      {more > 0 && <Box className={styles.more}>+{more}</Box>}
    </UnstyledButton>
  );
};

/**
 * The photos and videos a turn saved on this computer (a forwarded post), shown under the
 * answer: one alone at a readable size, several as one row of square tiles whose last tile
 * says how many more there are. Any of them opens Yobi's viewer, which walks all of them.
 * Audio (a downloaded MP3) is a player of its own under them, not a tile.
 * A file that is gone since — moved or deleted — is left out rather than shown broken.
 */
export const TurnMedia: React.FC<{ files: readonly string[] }> = ({ files }) => {
  const [missing, setMissing] = useState<ReadonlySet<string>>(() => new Set());
  const [viewing, setViewing] = useState<number | null>(null);
  const [width, setWidth] = useState(0);
  const rowRef = useRef<HTMLDivElement>(null);
  const present = files.filter((file) => !missing.has(file));
  const shown = present.filter((file) => {
    const kind = turnMediaKind(file);
    return kind === 'image' || kind === 'video';
  });
  const sounds = present.filter((file) => turnMediaKind(file) === 'audio');
  const several = shown.length > 1;

  useEffect(() => {
    const row = rowRef.current;
    if (!row || !several) return;
    const measure = (): void => setWidth(row.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(row);
    return () => observer.disconnect();
  }, [several]);

  if (shown.length === 0 && sounds.length === 0) return null;
  const drop = (file: string): void => setMissing((prev) => new Set(prev).add(file));
  const fit = stripFit(shown.length, width);
  const hidden = shown.length - fit;

  return (
    <>
      {shown.length > 0 && (
        <Group ref={rowRef} gap={GAP} mt={10} wrap="nowrap" style={{ overflow: 'hidden' }}>
          {shown.slice(0, fit).map((file, index) => (
            <MediaTile
              key={file}
              file={file}
              single={!several}
              more={index === fit - 1 ? hidden : 0}
              onOpen={() => setViewing(index)}
              onError={() => drop(file)}
            />
          ))}
        </Group>
      )}
      {sounds.length > 0 && (
        <Stack gap={GAP} mt={10}>
          {sounds.map((file) => <TurnAudio key={file} file={file} onError={() => drop(file)} />)}
        </Stack>
      )}
      <MediaViewer files={shown} index={viewing} onIndexChange={setViewing} onClose={() => setViewing(null)} />
    </>
  );
};
