import { sendLog, sendWebNotification, setWorkerAttention } from '../helpers';
import { getLangCache, t } from '../i18n';

export const VERIFICATION_CHALLENGE_ERROR_NAME = 'VerificationChallengeError';

export interface VerificationChallengeKeys {
  titleKey: string;
  bodyKey: string;
  actionKey: string;
  errorKey: string;
  logMessage: string;
}

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
