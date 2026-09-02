import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { secretApi } from '../api/electronApi';
import type { SecretFailure, SecretKeyState, SecretScope } from '../../../shared/types';

interface SecretHealthState {
  keyState: SecretKeyState;
  encryptionAvailable: boolean;
  failures: SecretFailure[];
  initialize: () => void;
}

let listenersInitialized = false;
let listenerCleanup: (() => void) | null = null;

export const useSecretHealthStore = create<SecretHealthState>((set) => ({
  keyState: 'unknown',
  encryptionAvailable: true,
  failures: [],

  initialize: () => {
    if (listenersInitialized) return;
    listenersInitialized = true;

    listenerCleanup = secretApi.onChanged((health) => set(health));
    void secretApi.getHealth().then(set).catch(() => {});
  },
}));

/**
 * Callers pass one scope or several — a settings section usually owns more than one.
 * useShallow because the filter builds a fresh array on every store write.
 */
export function useSecretFailures(...scopes: SecretScope[]): SecretFailure[] {
  return useSecretHealthStore(
    useShallow((state) => state.failures.filter((failure) => scopes.includes(failure.scope))),
  );
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    listenerCleanup?.();
    listenerCleanup = null;
    listenersInitialized = false;
  });
}
