import * as path from 'node:path';

import { isLineError, LineError } from './errors';
import { NATIVE_CORE_UNAVAILABLE, NATIVE_CORE_UNAVAILABLE_TEXT, NATIVE_CORE_VERSION } from './nativeContract';
import type {
  NativeActionRequest,
  NativeActionResult,
  NativeDownloadRequest,
  NativeDownloadResult,
  NativeKeysRequest,
  NativeKeysResult,
  NativeSendFileRequest,
  NativeSendRequest,
  NativeSendResult,
  NativeSquareRequest,
  NativeSquareResult,
  NativeTokensResult,
} from './nativeContract';

/** The only module that touches koffi. Loads the native core in-process (win32 only). */

interface NativeCore {
  version(): string;
  send(reqJson: string): Promise<string>;
  sendFile(reqJson: string): Promise<string>;
  downloadFile(reqJson: string): Promise<string>;
  /** Scans LINE's process memory for access-token candidates (the technique lives in the DLL). */
  scanTokens(reqJson: string): Promise<string>;
  sendKeys(reqJson: string): Promise<string>;
  squareFetch(reqJson: string): Promise<string>;
  action(reqJson: string): Promise<string>;
}

type AsyncFn = { async: (...args: unknown[]) => void } & ((...args: unknown[]) => unknown);

const GET_MODULE_HANDLE_EX_FLAG_PIN = 0x1;

const unavailable = (why: string): LineError =>
  new LineError(NATIVE_CORE_UNAVAILABLE, `${NATIVE_CORE_UNAVAILABLE_TEXT}: ${why}`);

export function resolveDllPath(): string {
  const fromEnv = process.env.YOBI_LINE_CORE_DLL;
  if (fromEnv) return fromEnv;
  const proc = process as NodeJS.Process & { resourcesPath?: string; defaultApp?: boolean };
  // Started as `electron <path>` (npm run dev / npm start): resourcesPath is Electron's own folder,
  // which does not hold the core. Use the checkout's copy (the bundle sits in out/<name>/, two
  // levels below it).
  if (proc.defaultApp) return path.join(__dirname, '..', '..', 'build-native', 'line.dll');
  if (proc.resourcesPath) return path.join(proc.resourcesPath, 'line.dll');
  throw unavailable('no DLL path could be resolved');
}

/** Low-level loader. Rejects with LineError(NATIVE_CORE_UNAVAILABLE) on any failure. */
export async function loadNativeCore(explicitPath?: string): Promise<NativeCore> {
  if (process.platform !== 'win32') {
    throw new LineError('UNSUPPORTED_PLATFORM', 'Sending LINE messages is only available on Windows.');
  }
  try {
    // Lazy: mac/linux builds ship no koffi binary, so it must never load at boot.
    const koffi = (await import('koffi')).default;
    const dllPath = explicitPath ?? resolveDllPath();
    const lib = koffi.load(dllPath);
    // Go's runtime cannot be unloaded: its threads and its exception handler stay inside the DLL.
    // koffi frees the library once its handles are finalized (at quit), so pin it: FreeLibrary then
    // does nothing and the image stays mapped until the process ends.
    const getModuleHandleEx = koffi
      .load('kernel32.dll')
      .func('int __stdcall GetModuleHandleExW(uint32_t, const char16_t *, _Out_ void **)');
    if (!getModuleHandleEx(GET_MODULE_HANDLE_EX_FLAG_PIN, dllPath, [null])) throw unavailable('could not pin the native library');
    const versionFn = lib.func('void* line_core_version()');
    const freeFn = lib.func('void line_free(void*)');

    // Copy the NUL-terminated UTF-8 string out, then always release the native buffer.
    const take = (ptr: unknown, fail: (why: string) => LineError): string => {
      if (!ptr) throw fail('native call returned null');
      try {
        return koffi.decode(ptr, 'char', -1) as string;
      } finally {
        freeFn(ptr);
      }
    };
    // Before anything else is bound: an older core has only some of the functions below.
    const version = take(versionFn(), unavailable);
    if (version !== NATIVE_CORE_VERSION) throw unavailable(`this core is ${version}, this app needs ${NATIVE_CORE_VERSION}`);
    const sendFn = lib.func('void* line_send(const char*)') as unknown as AsyncFn;
    const sendFileFn = lib.func('void* line_send_file(const char*)') as unknown as AsyncFn;
    const downloadFn = lib.func('void* line_download_file(const char*)') as unknown as AsyncFn;
    const scanFn = lib.func('void* line_scan_tokens(const char*)') as unknown as AsyncFn;
    const keysFn = lib.func('void* line_send_keys(const char*)') as unknown as AsyncFn;
    const squareFn = lib.func('void* line_square_fetch(const char*)') as unknown as AsyncFn;
    const actionFn = lib.func('void* line_action(const char*)') as unknown as AsyncFn;

    // Post-load failures on the send paths are SEND_FAILED, distinct from a missing/broken DLL.
    const sendFailed = (why: string): LineError => new LineError('SEND_FAILED', `Native send call failed: ${why}`);
    const callAsync = (fn: AsyncFn, reqJson: string, fail: (why: string) => LineError = sendFailed): Promise<string> =>
      new Promise((resolve, reject) => {
        fn.async(reqJson, (err: unknown, ptr: unknown) => {
          if (err) return reject(fail(String(err)));
          try {
            resolve(take(ptr, fail));
          } catch (e) {
            reject(e);
          }
        });
      });

    return {
      version: () => version,
      send: (j) => callAsync(sendFn, j),
      sendFile: (j) => callAsync(sendFileFn, j),
      downloadFile: (j) => callAsync(downloadFn, j),
      scanTokens: (j) => callAsync(scanFn, j, unavailable),
      sendKeys: (j) => callAsync(keysFn, j, unavailable),
      squareFetch: (j) => callAsync(squareFn, j, unavailable),
      action: (j) => callAsync(actionFn, j),
    };
  } catch (err) {
    if (err instanceof LineError) throw err;
    throw unavailable('failed to load the native library');
  }
}

let cached: Promise<NativeCore> | undefined;
function core(): Promise<NativeCore> {
  cached ??= loadNativeCore().catch((err) => {
    cached = undefined;
    throw err;
  });
  return cached;
}

export async function nativeCoreVersion(): Promise<string> {
  return (await core()).version();
}

/** The LineError code saying why the core cannot be used, '' when it can. Loads the library, reaches no server. */
export async function nativeCoreProblem(): Promise<string> {
  try {
    await core();
    return '';
  } catch (err) {
    return isLineError(err) ? err.code : NATIVE_CORE_UNAVAILABLE;
  }
}

/** Parses a core reply; a bad one is named by length only, since these replies hold keys and message text. */
function parseReply<T>(raw: string, what: string): T {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') return parsed as T;
  } catch {
    // fall through to the error below
  }
  throw unavailable(`native ${what} returned malformed output (${raw.length} bytes, redacted)`);
}

/** Picks the keys to seal to a chat from its stored columns. Key material: never log it. */
export async function nativeSendKeys(req: NativeKeysRequest): Promise<NativeKeysResult> {
  return parseReply(await (await core()).sendKeys(JSON.stringify(req)), 'key pick');
}

/** One read of LINE's server. */
export async function nativeSquareFetch(req: NativeSquareRequest): Promise<NativeSquareResult> {
  return parseReply(await (await core()).squareFetch(JSON.stringify(req)), 'server read');
}

/** One react, remove_reaction or unsend. */
export async function nativeAction(req: NativeActionRequest): Promise<NativeActionResult> {
  return parseReply(await (await core()).action(JSON.stringify(req)), 'action');
}

function parseResult(raw: string): NativeSendResult {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') return parsed as NativeSendResult;
  } catch {
    // fall through to the SEND_FAILED below
  }
  throw new LineError('SEND_FAILED', `Native send core returned malformed output: ${raw.slice(0, 200)}`);
}

export async function nativeSend(req: NativeSendRequest): Promise<NativeSendResult> {
  return parseResult(await (await core()).send(JSON.stringify(req)));
}

export async function nativeSendFile(req: NativeSendFileRequest): Promise<NativeSendResult> {
  return parseResult(await (await core()).sendFile(JSON.stringify(req)));
}

/**
 * Scans LINE's process memory for access-token candidates (most-frequent first). The scan
 * runs inside the native core (koffi async, off the main thread); this returns the candidates or
 * throws the LineError the core reported (LINE_NOT_RUNNING / MEMORY_READ_FAILED / TOKEN_NOT_FOUND).
 * The tokens are secret: callers put them only into an outgoing request, never a log.
 */
export async function nativeScanTokens(): Promise<string[]> {
  const raw = await (await core()).scanTokens('{}');
  let parsed: NativeTokensResult;
  try {
    const obj: unknown = JSON.parse(raw);
    if (!obj || typeof obj !== 'object') throw new Error('not an object');
    parsed = obj as NativeTokensResult;
  } catch {
    // Never put raw into the message: a scan result is a list of access tokens, and errors reach
    // logs. Report only the length so a malformed core is still diagnosable without leaking a token.
    throw unavailable(`native token scan returned malformed JSON (${raw.length} bytes, redacted)`);
  }
  if (parsed.code) throw new LineError(parsed.code as LineError['code'], parsed.reason || parsed.code);
  return parsed.tokens ?? [];
}

export async function nativeDownloadFile(req: NativeDownloadRequest): Promise<NativeDownloadResult> {
  const raw = await (await core()).downloadFile(JSON.stringify(req));
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') return parsed as NativeDownloadResult;
  } catch {
    // fall through to the error below
  }
  // Per-job failure (like malformed send output): must not skip the rest of the run.
  throw new LineError('SEND_FAILED', `Native download core returned malformed output: ${raw.slice(0, 200)}`);
}
