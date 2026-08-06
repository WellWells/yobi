import { useCallback, useEffect, useState } from 'react';
import { shareApi } from '../../../api/electronApi';
import { DEFAULT_SHARE_INSTANCE } from '../../../../../shared/types';

export function useShareSettings() {
  const [instanceUrl, setInstanceUrl] = useState(DEFAULT_SHARE_INSTANCE);
  const [draft, setDraft] = useState(DEFAULT_SHARE_INSTANCE);

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
    void shareApi.updateSettings({ instanceUrl: next }).then((saved) => {
      setInstanceUrl(saved.instanceUrl);
      setDraft(saved.instanceUrl);
    });
  }, [draft, instanceUrl]);

  return { instanceUrl, draft, setDraft, commitInstanceUrl };
}
