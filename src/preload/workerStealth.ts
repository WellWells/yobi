import { withChromeBrand, type UserAgentBrand } from '../shared/clientHintBrands';

export type { UserAgentBrand };

export interface NavigatorUAData {
  readonly brands: UserAgentBrand[];
  readonly mobile: boolean;
  readonly platform: string;
  getHighEntropyValues(hints: string[]): Promise<Record<string, unknown>>;
}

export type NavigatorWithUAData = Navigator & { userAgentData?: NavigatorUAData };

type AnyFunction = (...args: never[]) => unknown;

const installed = new WeakSet<object>();

function claimsFirefox(userAgent: string): boolean {
  return /Firefox\//.test(userAgent);
}

function nativeStub(name: string, impl: (...args: unknown[]) => unknown): AnyFunction {
  const stub = new Proxy(Object.prototype.hasOwnProperty as unknown as AnyFunction, {
    apply: (_target, thisArg, args: unknown[]) => impl.apply(thisArg, args),
    get: (target, key, receiver) => (key === 'name' ? name : Reflect.get(target, key, receiver)),
  });
  installed.add(stub);
  return stub;
}

function overrideNative<T extends AnyFunction>(original: T, impl: (...args: unknown[]) => unknown): T {
  const wrapper = new Proxy(original, {
    apply: (_target, thisArg, args: unknown[]) => impl.apply(thisArg, args),
  });
  installed.add(wrapper);
  return wrapper;
}

function findOwner(start: object, key: string): { owner: object; descriptor: PropertyDescriptor } | null {
  let cursor: object | null = start;
  while (cursor) {
    const descriptor = Object.getOwnPropertyDescriptor(cursor, key);
    if (descriptor) return { owner: cursor, descriptor };
    cursor = Object.getPrototypeOf(cursor) as object | null;
  }
  return null;
}

function clearInstanceCopy(instance: object, key: string): void {
  try {
    delete (instance as Record<string, unknown>)[key];
  } catch {
  }
}

function overrideGetter(instance: object, key: string, produce: (original: unknown) => unknown): void {
  clearInstanceCopy(instance, key);
  const found = findOwner(Object.getPrototypeOf(instance) as object, key);
  const originalGet = found?.descriptor.get;
  if (!found || !originalGet || installed.has(originalGet)) return;
  Object.defineProperty(found.owner, key, {
    ...found.descriptor,
    get: overrideNative(originalGet as AnyFunction, function (this: unknown) {
      return produce(originalGet.call(this));
    }),
  });
}

function overrideMethod(instance: object, key: string, impl: (...args: unknown[]) => unknown): void {
  clearInstanceCopy(instance, key);
  const found = findOwner(Object.getPrototypeOf(instance) as object, key);
  const original = found?.descriptor.value as AnyFunction | undefined;
  if (!found || typeof original !== 'function' || installed.has(original)) return;
  Object.defineProperty(found.owner, key, {
    ...found.descriptor,
    value: overrideNative(original, impl),
  });
}

function swallowVisibilityChange(event: Event): void {
  event.stopImmediatePropagation();
}

export function installVisibilityPatches(doc: Document): void {
  overrideGetter(doc, 'visibilityState', () => 'visible');
  overrideGetter(doc, 'hidden', () => false);
  overrideMethod(doc, 'hasFocus', () => true);
  doc.addEventListener('visibilitychange', swallowVisibilityChange, true);
}

function buildChromeRuntime(): Record<string, unknown> {
  const noopListener = (): Record<string, unknown> => ({
    addListener: nativeStub('addListener', () => undefined),
    removeListener: nativeStub('removeListener', () => undefined),
  });
  return {
    id: undefined,
    connect: nativeStub('connect', () => ({
      disconnect: nativeStub('disconnect', () => undefined),
      postMessage: nativeStub('postMessage', () => undefined),
      onMessage: noopListener(),
    })),
    sendMessage: nativeStub('sendMessage', () => undefined),
    getURL: nativeStub('getURL', (path) => String(path ?? '')),
    reload: nativeStub('reload', () => undefined),
    onMessage: noopListener(),
    onConnect: noopListener(),
  };
}

function defineMissing(host: Record<string, unknown>, key: string, value: unknown): void {
  if (host[key] !== undefined) return;
  Object.defineProperty(host, key, { value, writable: true, configurable: true });
}

export function installChromeSurface(win: Window, _userAgent: string): void {
  const host = win as unknown as Record<string, unknown>;
  defineMissing(host, 'chrome', {});
  const chrome = host['chrome'] as Record<string, unknown>;
  defineMissing(chrome, 'runtime', buildChromeRuntime());
  defineMissing(chrome, 'loadTimes', nativeStub('loadTimes', () => ({
    requestTime: 0,
    startLoadTime: 0,
    commitLoadTime: 0,
    finishLoadTime: 0,
    firstPaintTime: 0,
    navigationType: 'Other',
    wasNpnNegotiated: true,
    npnNegotiatedProtocol: 'h2',
    wasAlternateProtocolAvailable: false,
    connectionInfo: 'h2',
  })));
  defineMissing(chrome, 'csi', nativeStub('csi', () => ({ startE: 0, onloadT: 0, pageT: 0, tran: 15 })));
  defineMissing(chrome, 'app', {
    isInstalled: false,
    InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' },
    RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' },
    getDetails: nativeStub('getDetails', () => null),
    getIsInstalled: nativeStub('getIsInstalled', () => false),
  });
}

function wrapUserAgentData(data: NavigatorUAData): NavigatorUAData {
  return new Proxy(data, {
    get(target, key) {
      if (key === 'brands') return withChromeBrand(target.brands);
      const value = Reflect.get(target, key, target) as unknown;
      if (typeof value !== 'function') return value;
      const method = value as AnyFunction;
      return overrideNative(method, (...args: unknown[]) =>
        (method as (...a: unknown[]) => unknown).apply(target, args));
    },
  });
}

export function installChromeBrands(nav: Navigator): void {
  overrideGetter(nav, 'userAgentData', (original) =>
    original == null ? original : wrapUserAgentData(original as NavigatorUAData));
}

export function applyWorkerStealth(win: Window, userAgent: string = win.navigator.userAgent): void {
  installVisibilityPatches(win.document);
  installChromeSurface(win, userAgent);
  if (!claimsFirefox(userAgent)) installChromeBrands(win.navigator);
}
