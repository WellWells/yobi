import { useCallback, useEffect, useRef, useState } from 'react';
import { shareApi } from '../../../api/electronApi';
import { DEFAULT_SHARE_INSTANCE } from '../../../../../shared/types';

export function useShareSettings() {
  const [instanceUrl, setInstanceUrl] = useState(DEFAULT_SHARE_INSTANCE);
  const [draft, setDraft] = useState(DEFAULT_SHARE_INSTANCE);
  const saveSeq = useRef(0);

  useEffect(() => {
    void shareApi.getSettings().then((settings) => {
      setInstanceUrl(settings.instanceUrl);
      setDraft(settings.instanceUrl);
    });
  }, []);

  const commitInstanceUrl = useCallback((): void => {
    const next = draft.trim() || DEFAULT_SHARE_INSTANCE;
    if (next === instanceUrl) {
      setDraft(instanceUrl);
      return;
    }
    const seq = ++saveSeq.current;
    const sent = draft;
    void shareApi.updateSettings({ instanceUrl: next }).then((saved) => {
      if (seq !== saveSeq.current) return;
      setInstanceUrl(saved.instanceUrl);
      // Show the normalised URL only if the field still holds what was sent; a newer edit stays.
      setDraft((current) => (current === sent ? saved.instanceUrl : current));
    });
  }, [draft, instanceUrl]);

  return { instanceUrl, draft, setDraft, commitInstanceUrl };
}
