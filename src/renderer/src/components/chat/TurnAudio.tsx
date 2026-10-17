import React, { useEffect, useRef, useState } from 'react';
import { ActionIcon, Box, Group, Slider, Stack, Text } from '@mantine/core';
import { Pause, Play } from 'lucide-react';
import { turnMediaUrl } from '../../../../shared/turnMedia';
import { formatDuration } from '../../../../shared/ytdl';
import { useI18nStore } from '../../store/i18nStore';

const PLAYER_MAX_WIDTH = 480;

/** The one player sounding: starting another pauses it, as a music app does. */
let sounding: HTMLAudioElement | null = null;

/** `0:00` at the start, where `formatDuration` gives nothing. */
export function playerClock(seconds: number): string {
  return formatDuration(seconds) || '0:00';
}

/** The file's name without its folder or extension — what Yobi named the download (`Title.mp3`). */
export function audioTitle(file: string): string {
  const name = file.split(/[\\/]/).pop() ?? file;
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
}

/**
 * A downloaded MP3 or M4A, played right in the conversation: play/pause, the title, a seek bar
 * and the time. `onError` fires when the file is gone (moved or deleted), so the turn drops it.
 */
export const TurnAudio: React.FC<{ file: string; onError: () => void }> = ({ file, onError }) => {
  const t = useI18nStore((s) => s.t);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [position, setPosition] = useState(0);
  // The slider's value while it is dragged; the audio seeks once it is let go.
  const [dragging, setDragging] = useState<number | null>(null);

  useEffect(() => {
    // Held here: React has cleared the ref by the time the cleanup runs.
    const audio = audioRef.current;
    return () => {
      audio?.pause();
      if (sounding === audio) sounding = null;
    };
  }, []);

  const toggle = (): void => {
    const audio = audioRef.current;
    if (!audio) return;
    if (!audio.paused) {
      audio.pause();
      return;
    }
    if (sounding && sounding !== audio && !sounding.paused) sounding.pause();
    sounding = audio;
    void audio.play().catch(() => setPlaying(false));
  };

  const seek = (value: number): void => {
    setDragging(null);
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = value;
    setPosition(value);
  };

  const shown = dragging ?? position;
  const title = audioTitle(file);

  return (
    <Group
      gap="sm"
      wrap="nowrap"
      px="sm"
      py={8}
      maw={PLAYER_MAX_WIDTH}
      style={{ border: '1px solid var(--border)', borderRadius: 'var(--mantine-radius-md)', background: 'var(--bg-secondary)' }}
    >
      <Box
        component="audio"
        ref={audioRef}
        src={turnMediaUrl(file)}
        preload="metadata"
        onLoadedMetadata={(event: React.SyntheticEvent<HTMLAudioElement>) => setDuration(event.currentTarget.duration)}
        onTimeUpdate={(event: React.SyntheticEvent<HTMLAudioElement>) => setPosition(event.currentTarget.currentTime)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={(event: React.SyntheticEvent<HTMLAudioElement>) => {
          event.currentTarget.currentTime = 0;
          setPosition(0);
        }}
        onError={onError}
      />
      <ActionIcon
        variant="light"
        size={36}
        radius="xl"
        aria-label={t(playing ? 'chat.audio.pause' : 'chat.audio.play')}
        onClick={toggle}
      >
        {playing ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" />}
      </ActionIcon>
      <Stack gap={2} flex={1} miw={0}>
        <Text size="sm" truncate title={title}>{title}</Text>
        <Group gap="sm" wrap="nowrap">
          <Slider
            flex={1}
            size="xs"
            color="brand"
            min={0}
            max={duration > 0 ? duration : 1}
            step={0.1}
            value={duration > 0 ? Math.min(shown, duration) : 0}
            disabled={duration <= 0}
            label={(value) => playerClock(value)}
            aria-label={t('chat.audio.position')}
            onChange={setDragging}
            onChangeEnd={seek}
            styles={{ track: { '--slider-track-bg': 'var(--bg-tertiary)' } as React.CSSProperties }}
          />
          <Text size="xs" c="var(--text-muted)" style={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
            {playerClock(shown)} / {playerClock(duration)}
          </Text>
        </Group>
      </Stack>
    </Group>
  );
};
