import { sendLog, sendWebNotification, setWorkerAttention } from '../helpers';
import { getLangCache, t } from '../i18n';

// Marks an error as "a human-verification challenge is now showing in the worker
// window". taskProcessor and the flow executor recognise this name so the task
// fails without retry and the worker is NOT re-navigated (which would wipe the
// in-progress challenge). Shared by every provider that can hit such a challenge
// (Perplexity/Cloudflare, Duck AI/DuckDuckGo).
export const VERIFICATION_CHALLENGE_ERROR_NAME = 'VerificationChallengeError';

export interface VerificationChallengeKeys {
  titleKey: string;
  bodyKey: string;
  actionKey: string;
  errorKey: string;
  logMessage: string;
}

// Sets worker attention, fires the notification with an "open worker" action,
// logs, and returns the named error for the caller to throw. The caller MUST
// reveal the worker window BEFORE calling this, because revealing the window
// resets worker attention to 'idle'.
export function raiseVerificationChallenge(keys: VerificationChallengeKeys): Error {
  const strings = getLangCache();
  setWorkerAttention('verification');
  sendWebNotification(
    t(strings, keys.titleKey),
    t(strings, keys.bodyKey),
    'error',
    {
      id: 'open-worker-window',
      label: t(strings, keys.actionKey),
    },
  );
  sendLog(keys.logMessage);
  const error = new Error(t(strings, keys.errorKey));
  error.name = VERIFICATION_CHALLENGE_ERROR_NAME;
  return error;
}
