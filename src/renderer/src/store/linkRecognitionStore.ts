import { create } from 'zustand';
import { settingsApi } from '../api/electronApi';
import { LINK_SITE_ROWS } from '../../../shared/linkSites/rows';
import { linkSiteFilter } from '../../../shared/linkRecognition';
import type { LinkRecognitionState, LinkRecognitionTarget, LinkSiteFilter } from '../../../shared/linkRecognition';

/**
 * Until main answers, every site stays recognised — what Yobi did before these switches. The card
 * is not drawn until then, so which sites it shows is main's to say.
 */
const BEFORE_LOAD: LinkRecognitionState = {
  maps: true,
  sites: LINK_SITE_ROWS.map((row) => ({ site: row.id, on: true })),
};

interface LinkRecognitionStore {
  state: LinkRecognitionState;
  loaded: boolean;
  apply: (state: LinkRecognitionState) => void;
  toggle: (target: LinkRecognitionTarget, on: boolean) => Promise<void>;
}

export const useLinkRecognitionStore = create<LinkRecognitionStore>((set) => ({
  state: BEFORE_LOAD,
  loaded: false,
  apply: (state) => set({ state, loaded: true }),
  toggle: async (target, on) => {
    const state = await settingsApi.setLinkRecognition(target, on);
    set({ state, loaded: true });
  },
}));

/** Read the switches from config: at startup, and after a restore or reset replaced them. */
export function initLinkRecognitionFromConfig(): void {
  void settingsApi.getLinkRecognition().then(useLinkRecognitionStore.getState().apply);
}

/** Which sites a desktop message's link runs the built-in for, as the switches stand now. */
export function currentLinkSiteFilter(): LinkSiteFilter {
  return linkSiteFilter(useLinkRecognitionStore.getState().state);
}
