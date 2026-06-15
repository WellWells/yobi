export function telegramFetchCompat(
  input: Parameters<typeof fetch>[0],
  init?: Parameters<typeof fetch>[1],
): ReturnType<typeof fetch> {
  const patchedInit = init?.body != null
    ? ({ ...init, duplex: 'half' } as Parameters<typeof fetch>[1])
    : init;

  const signal = patchedInit?.signal;
  if (!signal || isNativeAbortSignal(signal)) return fetch(input, patchedInit);

  const source = signal as {
    aborted?: boolean;
    addEventListener?: (type: 'abort', listener: () => void) => void;
    removeEventListener?: (type: 'abort', listener: () => void) => void;
  };
  const controller = new AbortController();

  const relayAbort = (): void => {
    controller.abort();
    source.removeEventListener?.('abort', relayAbort);
  };
  if (source.aborted) relayAbort();
  else source.addEventListener?.('abort', relayAbort);

  const result = fetch(input, { ...patchedInit, signal: controller.signal });
  result.finally(() => {
    source.removeEventListener?.('abort', relayAbort);
  });
  return result;
}

function isNativeAbortSignal(value: unknown): value is AbortSignal {
  if (typeof AbortSignal === 'undefined') return false;
  return value instanceof AbortSignal;
}
