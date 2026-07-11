import { useCallback, useEffect, useState } from 'react';
import { settingsApi, ipcEvents } from '../../../api/electronApi';
import type { NotifyEventPrefs } from '../../../../../shared/types';

export const MIN_RESPONSE_TIMEOUT_SEC = 15;
export const MAX_RESPONSE_TIMEOUT_SEC = 300;
const DEFAULT_RESPONSE_TIMEOUT_SEC = 120;

const DEFAULT_NOTIFY_EVENTS: NotifyEventPrefs = {
  chatComplete: true,
  chatFailure: true,
  flowSuccess: false,
  flowFailure: true,
};

export function useSystemSettings() {

  const [notifyOnComplete, setNotifyOnComplete] = useState(true);
  const [notifyEvents, setNotifyEvents] = useState<NotifyEventPrefs>(DEFAULT_NOTIFY_EVENTS);
  const [closeToTray, setCloseToTray] = useState(false);
  const [launchAtStartup, setLaunchAtStartup] = useState(false);
  const [responseTimeoutSec, setResponseTimeoutSec] = useState(DEFAULT_RESPONSE_TIMEOUT_SEC);
  const [responseTimeoutInput, setResponseTimeoutInput] = useState(`${DEFAULT_RESPONSE_TIMEOUT_SEC}`);

  useEffect(() => {
    void settingsApi.getNotifyOnComplete().then(setNotifyOnComplete);
    void settingsApi.getNotifyEvents().then(setNotifyEvents);
    void settingsApi.getCloseToTray().then(setCloseToTray);
    void settingsApi.getLaunchAtStartup().then(setLaunchAtStartup);
    void settingsApi.getResponseTimeout().then((ms) => {
      const sec = Math.max(
        MIN_RESPONSE_TIMEOUT_SEC,
        Math.min(MAX_RESPONSE_TIMEOUT_SEC, Math.round(ms / 1_000)),
      );
      setResponseTimeoutSec(sec);
      setResponseTimeoutInput(`${sec}`);
    });

    const unsubs = [
      ipcEvents.onNotifyOnCompleteChanged(setNotifyOnComplete),
      ipcEvents.onLaunchAtStartupChanged(setLaunchAtStartup),
      ipcEvents.onCloseToTrayChanged(setCloseToTray),
    ];
    return () => unsubs.forEach((fn) => fn());
  }, []);

  const handleToggleNotification = useCallback(async () => {
    const next = !notifyOnComplete;
    await settingsApi.updateNotifyOnComplete(next);
    setNotifyOnComplete(next);
  }, [notifyOnComplete]);

  const handleToggleNotifyEvent = useCallback(async (key: keyof NotifyEventPrefs) => {
    const next = { ...notifyEvents, [key]: !notifyEvents[key] };
    await settingsApi.updateNotifyEvents(next);
    setNotifyEvents(next);
  }, [notifyEvents]);

  const handleToggleCloseToTray = useCallback(async () => {
    const next = !closeToTray;
    await settingsApi.updateCloseToTray(next);
    setCloseToTray(next);
  }, [closeToTray]);

  const handleToggleLaunchAtStartup = useCallback(async () => {
    const next = !launchAtStartup;
    await settingsApi.updateLaunchAtStartup(next);
    setLaunchAtStartup(next);
  }, [launchAtStartup]);

  const persistResponseTimeoutSec = useCallback(async (rawValue: number) => {
    const nextSec = Math.max(
      MIN_RESPONSE_TIMEOUT_SEC,
      Math.min(MAX_RESPONSE_TIMEOUT_SEC, Math.round(rawValue) || DEFAULT_RESPONSE_TIMEOUT_SEC),
    );
    if (nextSec === responseTimeoutSec) {
      setResponseTimeoutInput(`${nextSec}`);
      return;
    }
    setResponseTimeoutSec(nextSec);
    setResponseTimeoutInput(`${nextSec}`);
    await settingsApi.updateResponseTimeout(nextSec * 1_000);
  }, [responseTimeoutSec]);

  const timeoutParsed = Number(responseTimeoutInput);
  const timeoutInputEmpty = responseTimeoutInput.trim() === '';
  const timeoutInputIsInteger = /^\d+$/.test(responseTimeoutInput.trim());
  const timeoutOutOfRange = timeoutInputIsInteger
    && (timeoutParsed < MIN_RESPONSE_TIMEOUT_SEC || timeoutParsed > MAX_RESPONSE_TIMEOUT_SEC);
  const timeoutInvalid = !timeoutInputEmpty && (!timeoutInputIsInteger || timeoutOutOfRange);

  const applySystemReset = useCallback(
    (
      notify: boolean,
      timeoutMs: number,
      closeToTrayValue: boolean,
      launchAtStartupValue: boolean,
      notifyEventsValue: NotifyEventPrefs = DEFAULT_NOTIFY_EVENTS,
    ) => {
      const sec = Math.max(
        MIN_RESPONSE_TIMEOUT_SEC,
        Math.min(MAX_RESPONSE_TIMEOUT_SEC, Math.round(timeoutMs / 1_000)),
      );
      setNotifyOnComplete(notify);
      setNotifyEvents(notifyEventsValue);
      setCloseToTray(closeToTrayValue);
      setLaunchAtStartup(launchAtStartupValue);
      setResponseTimeoutSec(sec);
      setResponseTimeoutInput(`${sec}`);
    },
    [],
  );

  return {
    notifyOnComplete,
    notifyEvents,
    closeToTray,
    launchAtStartup,
    responseTimeoutSec,
    responseTimeoutInput,
    setResponseTimeoutInput,
    timeoutParsed,
    timeoutInputIsInteger,
    timeoutInvalid,
    handleToggleNotification,
    handleToggleNotifyEvent,
    handleToggleCloseToTray,
    handleToggleLaunchAtStartup,
    persistResponseTimeoutSec,
    applySystemReset,
  };
}
