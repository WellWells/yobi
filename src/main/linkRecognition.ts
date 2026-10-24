/**
 * The "Recognize links" switches as they apply right now. Read at every message (the desktop
 * composer keeps the renderer's copy current through `LINK_RECOGNITION_CHANGED`), so a switch or a
 * language change takes effect on the next pasted link without a restart.
 */
import { app } from 'electron';
import { IPC } from '../shared/types';
import { linkSiteFilter, resolveLinkRecognition } from '../shared/linkRecognition';
import type { LinkRecognitionState, LinkSiteFilter } from '../shared/linkRecognition';
import { config } from './config';
import { sendToRenderer } from './helpers';
import { userRegion } from './userRegion';

/** Maps is on for everyone until switched off, so it needs no region. */
export function mapsLinksRecognized(): boolean {
  return config.linkRecognition?.maps !== false;
}

export function currentLinkRecognition(): LinkRecognitionState {
  return resolveLinkRecognition(config.linkRecognition ?? {}, userRegion(app.getPreferredSystemLanguages(), config));
}

/** Which sites' pasted links run their built-in now; read once per message. */
export function currentLinkSiteFilter(): LinkSiteFilter {
  return linkSiteFilter(currentLinkRecognition());
}

/** Tells the renderer after anything that can change the switches: a switch, the language. */
export function broadcastLinkRecognition(): void {
  sendToRenderer(IPC.LINK_RECOGNITION_CHANGED, currentLinkRecognition());
}
