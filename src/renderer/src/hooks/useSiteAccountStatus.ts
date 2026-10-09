import { useEffect, useState } from 'react';
import { siteAccountApi } from '../api/electronApi';
import type { SiteAccount } from '../../../shared/types';

/** Signed in to `site` in Yobi's own session; null until the first answer arrives. */
export function useSiteAccountStatus(site: SiteAccount): boolean | null {
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null);

  useEffect(() => {
    let alive = true;
    void siteAccountApi.getStatuses().then((statuses) => {
      if (alive) setLoggedIn(statuses.find((s) => s.site === site)?.loggedIn ?? false);
    });
    const unsubscribe = siteAccountApi.onStatusChanged((status) => {
      if (status.site === site) setLoggedIn(status.loggedIn);
    });
    return () => {
      alive = false;
      unsubscribe();
    };
  }, [site]);

  return loggedIn;
}
