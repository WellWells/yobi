import { useEffect, useRef } from 'react';
import { attachmentApi } from '../api/electronApi';
import { useAppStore } from '../store/appStore';
import type { StashedAttachment } from '../../../shared/types';

interface RegionCaptureIntakeOptions {
  /** The composer's own intake (`usePromptAttachments`), so a provider that takes no files says so. */
  addStashed: (stashed: StashedAttachment) => void;
  /** True while a Notion document hides the chat composer: a new chat brings it back. */
  composerHidden: boolean;
  onNewConversation: () => void;
  focusComposer: () => void;
}

/**
 * The region hotkey's picture lands in the chat composer like a pasted image, and the caret goes
 * to the input so the user types the question. Main holds the picture until it is collected: once
 * when this mounts (a window created for the capture misses the event) and on every ready event.
 */
export function useRegionCaptureIntake(options: RegionCaptureIntakeOptions): void {
  const latest = useRef(options);
  latest.current = options;

  useEffect(() => {
    let alive = true;
    const collect = (): void => {
      void attachmentApi.takeRegionCapture().then((stashed) => {
        if (!alive || !stashed) return;
        const { addStashed, composerHidden, onNewConversation } = latest.current;
        useAppStore.getState().setView('chat');
        if (composerHidden) onNewConversation();
        addStashed(stashed);
        // After the view switch has rendered: a hidden input cannot take focus.
        window.requestAnimationFrame(() => {
          if (alive) latest.current.focusComposer();
        });
      }, () => {});
    };
    collect();
    const unsubscribe = attachmentApi.onRegionCaptureReady(collect);
    return () => {
      alive = false;
      unsubscribe();
    };
  }, []);
}
