import { useCallback, useEffect, useRef, useState } from 'react';
import { knowledgeApi } from '../../api/electronApi';
import { useKnowledgeStore } from '../../store/useKnowledgeStore';
import type { KnowledgeFile } from '../../../../shared/knowledgeStatus';
import { keepUnchanged } from '../../utils/keepUnchanged';
import { applyAnalysisEvent } from './knowledgeFileRows';
import type { KnowledgeRowAnalysis } from './knowledgeFileRows';

/** Status events come per file while a folder is read: the list is re-read at most this often. */
const RELOAD_THROTTLE_MS = 600;

export interface KnowledgeFilesState {
  files: KnowledgeFile[];
  loaded: boolean;
  analysis: Record<string, KnowledgeRowAnalysis>;
  reload: () => void;
}

/**
 * One base's files for its page: disk joined with the index (`KB_FILES`), re-read when the base's
 * status changes (the watcher read a new file, a description was stored) and when an analysis ends;
 * the analysis queue's state per file from its events.
 */
export function useKnowledgeFiles(kbId: string): KnowledgeFilesState {
  const [files, setFiles] = useState<KnowledgeFile[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [analysis, setAnalysis] = useState<Record<string, KnowledgeRowAnalysis>>({});
  const status = useKnowledgeStore((s) => s.statuses[kbId]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const live = useRef(true);

  const load = useCallback(() => {
    void knowledgeApi.files(kbId).then((result) => {
      if (!live.current) return;
      // Re-read while the folder is indexed: unchanged files keep their objects, and an unchanged
      // list keeps the list, so the page neither re-sorts nor redraws for a file it already shows.
      setFiles((held) => keepUnchanged(held, result.files, (file) => file.path));
      setLoaded(true);
      // A page opened mid-queue picks up what is waiting; later events keep it current.
      setAnalysis((current) => result.analysis.reduce(applyAnalysisEvent, current));
    }, () => undefined);
  }, [kbId]);

  const reload = useCallback(() => {
    if (timer.current) return;
    timer.current = setTimeout(() => {
      timer.current = null;
      load();
    }, RELOAD_THROTTLE_MS);
  }, [load]);

  useEffect(() => {
    live.current = true;
    load();
    return () => {
      live.current = false;
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
    };
  }, [load]);

  // The status object is replaced on every change of the base's index or sync progress.
  useEffect(() => {
    if (status) reload();
  }, [status, reload]);

  useEffect(() => knowledgeApi.onAnalysis((event) => {
    if (event.kbId !== kbId) return;
    setAnalysis((current) => applyAnalysisEvent(current, event));
    if (event.state === 'done') reload();
  }), [kbId, reload]);

  return { files, loaded, analysis, reload };
}
