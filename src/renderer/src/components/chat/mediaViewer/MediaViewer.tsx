import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ActionIcon, Box, Group, Image, Modal, Text, Tooltip, UnstyledButton } from '@mantine/core';
import { ChevronLeft, ChevronRight, ExternalLink, FolderOpen, X } from 'lucide-react';
import { fileApi } from '../../../api/electronApi';
import { useI18nStore } from '../../../store/i18nStore';
import { isMac } from '../../../utils/keyLabels';
import { turnMediaKind, turnMediaUrl } from '../../../../../shared/turnMedia';
import { noDrag } from '../../titlebar/constants';
import { STRIP_HEIGHT, ThumbStrip } from './ThumbStrip';
import { useZoomPan } from './useZoomPan';
import { viewerKeyAction, wheelSteps, type Point, type Size } from './viewerMath';
import styles from './MediaViewer.module.css';

/** Telegram's viewer backdrop: dark grey, the conversation faintly behind it. */
const BACKDROP = 'rgba(34, 34, 34, 0.92)';
/** Controls fade after the pointer rests this long (Telegram: 1100 ms). */
const IDLE_MS = 1_100;
const WAKE_DISTANCE = 5;
const MARGIN = 16;
const SEEK_SECONDS = 10;
const DRAG_THRESHOLD = 4;

function bandHeight(several: boolean): number {
  return several ? STRIP_HEIGHT + 28 : 56;
}

const ViewerButton: React.FC<{ label: string; onClick: () => void; children: React.ReactNode }> = ({ label, onClick, children }) => (
  <Tooltip label={label}>
    <ActionIcon variant="transparent" size={36} radius="xl" className={styles.control} aria-label={label} onClick={onClick}>
      {children}
    </ActionIcon>
  </Tooltip>
);

/** Controls show while the pointer moves and fade once it rests; any key brings them back. */
function useIdleChrome(): { idle: boolean; wake: () => void; onMouseMove: (event: React.MouseEvent) => void } {
  const [idle, setIdle] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const last = useRef<Point | null>(null);
  const wake = useCallback((): void => {
    setIdle(false);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setIdle(true), IDLE_MS);
  }, []);
  useEffect(() => {
    wake();
    return () => window.clearTimeout(timer.current);
  }, [wake]);
  const onMouseMove = (event: React.MouseEvent): void => {
    const at = { x: event.clientX, y: event.clientY };
    if (last.current && Math.hypot(at.x - last.current.x, at.y - last.current.y) < WAKE_DISTANCE) return;
    last.current = at;
    wake();
  };
  return { idle, wake, onMouseMove };
}

interface BodyProps {
  files: readonly string[];
  index: number;
  onIndexChange: (index: number) => void;
  onClose: () => void;
}

const ViewerBody: React.FC<BodyProps> = ({ files, index, onIndexChange, onClose }) => {
  const t = useI18nStore((s) => s.t);
  const file = files[index];
  const video = turnMediaKind(file) === 'video';
  const several = files.length > 1;
  const band = bandHeight(several);
  const stageRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [room, setRoom] = useState<Size>({ w: 0, h: 0 });
  const view = useZoomPan(file, room);
  const { idle, wake, onMouseMove } = useIdleChrome();
  const drag = useRef<{ pointer: Point; offset: Point; moved: boolean } | null>(null);
  const dragged = useRef(false);

  const go = (step: -1 | 1): void => {
    const next = index + step;
    if (next >= 0 && next < files.length) onIndexChange(next);
  };

  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const measure = (): void => setRoom({
      w: Math.max(0, stage.clientWidth - MARGIN * 2),
      h: Math.max(0, stage.clientHeight - MARGIN * 2),
    });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  // The wheel walks the items, Ctrl+wheel (and a touchpad pinch) zooms at the pointer. React's
  // wheel listener is passive, so it could not stop Chromium zooming the whole window.
  const latest = useRef({ go, view, wake });
  latest.current = { go, view, wake };
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const totals = { walk: 0, zoom: 0 };
    const onWheel = (event: WheelEvent): void => {
      event.preventDefault();
      latest.current.wake();
      const kind = event.ctrlKey ? 'zoom' : 'walk';
      const { total, step } = wheelSteps(totals[kind], event.deltaX, event.deltaY);
      totals[kind] = total;
      if (step === 0) return;
      if (kind === 'walk') {
        latest.current.go(step);
        return;
      }
      const rect = stageRef.current?.getBoundingClientRect();
      const anchor = rect ? { x: event.clientX - (rect.left + rect.width / 2), y: event.clientY - (rect.top + rect.height / 2) } : { x: 0, y: 0 };
      latest.current.view.zoomBy(step > 0 ? -1 : 1, anchor);
    };
    root.addEventListener('wheel', onWheel, { passive: false });
    return () => root.removeEventListener('wheel', onWheel);
  }, []);

  const onKeyDown = (event: React.KeyboardEvent): void => {
    wake();
    const action = viewerKeyAction(event, video);
    if (!action) return;
    event.preventDefault();
    const player = videoRef.current;
    if (action === 'previous') go(-1);
    else if (action === 'next') go(1);
    else if (!player) return;
    else if (action === 'playPause') {
      if (player.paused) void player.play().catch(() => undefined);
      else player.pause();
    } else {
      const to = player.currentTime + (action === 'forward' ? SEEK_SECONDS : -SEEK_SECONDS);
      player.currentTime = Math.max(0, Number.isFinite(player.duration) ? Math.min(player.duration, to) : to);
    }
  };

  const placed: React.CSSProperties = view.shown
    ? {
      position: 'absolute',
      left: `calc(50% + ${view.offset.x}px)`,
      top: `calc(50% + ${view.offset.y}px)`,
      width: view.shown.w,
      height: view.shown.h,
      maxWidth: 'none',
      maxHeight: 'none',
      transform: 'translate(-50%, -50%)',
    }
    : { position: 'absolute', visibility: 'hidden' };

  return (
    <Box
      ref={rootRef}
      pos="relative"
      h="100%"
      tabIndex={-1}
      data-idle={idle || undefined}
      className={styles.root}
      style={{ ...noDrag, outline: 'none' }}
      onKeyDown={onKeyDown}
      onMouseMove={onMouseMove}
    >
      <Box
        ref={stageRef}
        data-viewer-stage=""
        pos="absolute"
        top={0}
        left={0}
        right={0}
        bottom={band}
        style={{ overflow: 'hidden' }}
        onMouseDown={(event) => {
          if (event.button === 0 && event.target === event.currentTarget) dragged.current = false;
          if (event.button !== 1) return;
          event.preventDefault();
          view.toggle();
        }}
        onClick={(event) => {
          if (event.target === event.currentTarget && !dragged.current) onClose();
        }}
      >
        {video ? (
          <Box
            key={file}
            component="video"
            ref={videoRef}
            src={turnMediaUrl(file)}
            controls
            autoPlay
            playsInline
            onLoadedMetadata={(event: React.SyntheticEvent<HTMLVideoElement>) => view.setNatural({ w: event.currentTarget.videoWidth, h: event.currentTarget.videoHeight })}
            style={{ ...placed, background: '#000' }}
          />
        ) : (
          <Image
            key={file}
            src={turnMediaUrl(file)}
            alt=""
            draggable={false}
            onLoad={(event) => view.setNatural({ w: event.currentTarget.naturalWidth, h: event.currentTarget.naturalHeight })}
            onPointerDown={(event) => {
              dragged.current = false;
              if (event.button !== 0 || !view.canPan) return;
              event.currentTarget.setPointerCapture(event.pointerId);
              drag.current = { pointer: { x: event.clientX, y: event.clientY }, offset: view.offset, moved: false };
            }}
            onPointerMove={(event) => {
              const start = drag.current;
              if (!start) return;
              const dx = event.clientX - start.pointer.x;
              const dy = event.clientY - start.pointer.y;
              if (!start.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
              start.moved = true;
              dragged.current = true;
              view.panTo({ x: start.offset.x + dx, y: start.offset.y + dy });
            }}
            onPointerUp={() => { drag.current = null; }}
            onPointerCancel={() => { drag.current = null; }}
            style={{ ...placed, cursor: view.canPan ? 'grab' : 'default', userSelect: 'none' }}
          />
        )}
      </Box>

      {index > 0 && (
        <UnstyledButton aria-label={t('chat.mediaViewer.previous')} className={`${styles.chrome} ${styles.nav}`} style={{ left: 20 }} onClick={() => go(-1)}>
          <ChevronLeft size={24} />
        </UnstyledButton>
      )}
      {index < files.length - 1 && (
        <UnstyledButton aria-label={t('chat.mediaViewer.next')} className={`${styles.chrome} ${styles.nav}`} style={{ right: 20 }} onClick={() => go(1)}>
          <ChevronRight size={24} />
        </UnstyledButton>
      )}

      <Box className={styles.chrome} pos="absolute" top={10} right={10}>
        <ViewerButton label={t('chat.mediaViewer.close')} onClick={onClose}>
          <X size={20} />
        </ViewerButton>
      </Box>

      <Box className={styles.chrome} pos="absolute" left={0} right={0} bottom={0} h={band}>
        {several && (
          <Text pos="absolute" left={20} top="50%" fz="sm" className={styles.counter} style={{ transform: 'translateY(-50%)' }}>
            {`${index + 1} / ${files.length}`}
          </Text>
        )}
        {several && (
          <Box pos="absolute" top={14} left={120} right={120}>
            <ThumbStrip files={files} index={index} onPick={onIndexChange} />
          </Box>
        )}
        <Group gap={4} wrap="nowrap" pos="absolute" right={10} top="50%" style={{ transform: 'translateY(-50%)' }}>
          <ViewerButton label={t('chat.mediaViewer.openExternal')} onClick={() => { void fileApi.openPath(file); }}>
            <ExternalLink size={18} />
          </ViewerButton>
          <ViewerButton label={t(isMac ? 'context.showInFolder.mac' : 'context.showInFolder')} onClick={() => { void fileApi.showInFolder(file); }}>
            <FolderOpen size={18} />
          </ViewerButton>
        </Group>
      </Box>
    </Box>
  );
};

/**
 * Yobi's own viewer for the photos and videos of a turn, over the whole window and modelled on
 * Telegram Desktop's: each item opens at its best size, the wheel walks the items and Ctrl+wheel
 * zooms, videos play on open, and an album strip runs along the bottom.
 */
export const MediaViewer: React.FC<{
  files: readonly string[];
  index: number | null;
  onIndexChange: (index: number) => void;
  onClose: () => void;
}> = ({ files, index, onIndexChange, onClose }) => {
  const opened = index !== null && files[index] !== undefined;
  // Esc in a full-screen video leaves full screen first, as it does everywhere else.
  const close = (): void => {
    if (!document.fullscreenElement) onClose();
  };
  return (
    <Modal
      opened={opened}
      onClose={close}
      fullScreen
      withCloseButton={false}
      padding={0}
      styles={{ content: { background: BACKDROP }, body: { padding: 0, height: '100%' } }}
    >
      {opened && <ViewerBody files={files} index={index} onIndexChange={onIndexChange} onClose={onClose} />}
    </Modal>
  );
};
