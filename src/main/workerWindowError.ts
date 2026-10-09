/**
 * Thrown wherever a send needs the browser window and cannot get one. One message for every
 * call site, so `localizeUserFacingError` can translate it. A leaf module on purpose: i18n imports
 * it, and the worker window code imports i18n.
 */
export const WORKER_WINDOW_UNAVAILABLE = 'Worker window unavailable';

export function workerWindowUnavailable(): Error {
  return new Error(WORKER_WINDOW_UNAVAILABLE);
}
