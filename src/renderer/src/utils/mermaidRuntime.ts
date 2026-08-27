import type { Mermaid, MermaidConfig } from 'mermaid';
import { themeDef } from '../../../shared/themes';
import type { Theme } from '../../../shared/themes';
import { extractMermaidFences } from '../../../shared/mermaidFences';

export type MermaidFailure = 'syntax' | 'unavailable';

export type MermaidState =
  | { status: 'ok'; svg: string }
  | { status: 'error'; failure: MermaidFailure };

const RENDER_TIMEOUT_MS = 5_000;
const PRERENDER_TIMEOUT_MS = 15_000;
const CACHE_LIMIT = 64;

let _mermaid: Mermaid | null = null;
let _loadPromise: Promise<Mermaid | null> | null = null;
let _idCounter = 0;
let _pending = 0;
let _idleWaiters: (() => void)[] = [];
let _chain: Promise<unknown> = Promise.resolve();

const _cache = new Map<string, MermaidState>();
const _inflight = new Map<string, Promise<MermaidState>>();

function resolveFontFamily(): string {
  const body = document.body;
  const declared = body ? getComputedStyle(body).fontFamily.trim() : '';
  return declared || 'system-ui, sans-serif';
}

function baseConfig(): MermaidConfig {
  return {
    startOnLoad: false,
    securityLevel: 'strict',
    suppressErrorRendering: true,
    htmlLabels: false,
    theme: 'base',
    logLevel: 'fatal',
    fontFamily: resolveFontFamily(),
  };
}

export function mermaidThemeVariables(theme: Theme): Record<string, string | boolean> {
  const { colors, light } = themeDef(theme);
  return {
    darkMode: !light,
    background: colors.bgSurface,
    mainBkg: colors.bgElevated,
    primaryColor: colors.bgElevated,
    primaryTextColor: colors.textPrimary,
    primaryBorderColor: colors.accent,
    secondaryColor: colors.bgPrimary,
    secondaryTextColor: colors.textPrimary,
    secondaryBorderColor: colors.border,
    tertiaryColor: colors.bgSurface,
    tertiaryTextColor: colors.textSecondary,
    tertiaryBorderColor: colors.border,
    lineColor: colors.textMuted,
    textColor: colors.textPrimary,
    titleColor: colors.textPrimary,
    nodeBorder: colors.accent,
    nodeTextColor: colors.textPrimary,
    clusterBkg: colors.bgPrimary,
    clusterBorder: colors.border,
    edgeLabelBackground: colors.bgSurface,
    noteBkgColor: colors.bgElevated,
    noteTextColor: colors.textPrimary,
    noteBorderColor: colors.border,
    errorBkgColor: colors.error,
    errorTextColor: colors.textPrimary,
  };
}

export function loadMermaid(): Promise<Mermaid | null> {
  if (_loadPromise) return _loadPromise;
  _loadPromise = (async (): Promise<Mermaid | null> => {
    try {
      const module = await import('mermaid');
      const instance = module.default;
      instance.initialize(baseConfig());
      _mermaid = instance;
    } catch {
    }
    return _mermaid;
  })();
  return _loadPromise;
}

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = _chain.then(task, task);
  _chain = run.catch(() => undefined);
  return run;
}

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      () => { clearTimeout(timer); resolve(fallback); },
    );
  });
}

function fitSvg(svg: string): string {
  return svg.replace(
    /max-width:\s*([\d.]+)(px|rem|em|ch)/,
    (_match, size: string, unit: string) => `max-width: min(100%, ${size}${unit})`,
  );
}

async function renderOnce(code: string, theme: Theme): Promise<MermaidState> {
  const mermaid = await loadMermaid();
  if (!mermaid) return { status: 'error', failure: 'unavailable' };
  mermaid.initialize({ ...baseConfig(), themeVariables: mermaidThemeVariables(theme) });
  const parsed = await mermaid.parse(code, { suppressErrors: true });
  if (!parsed) return { status: 'error', failure: 'syntax' };
  _idCounter += 1;
  const { svg } = await mermaid.render(`yobi-mermaid-${_idCounter}`, code);
  return { status: 'ok', svg: fitSvg(svg) };
}

export type MermaidRenderer = (code: string, theme: Theme) => Promise<MermaidState>;
let _renderer: MermaidRenderer = renderOnce;

export function setMermaidRenderer(renderer: MermaidRenderer | null): void {
  _renderer = renderer ?? renderOnce;
}

export function resetMermaidRuntime(): void {
  _cache.clear();
  _inflight.clear();
  _pending = 0;
  _idleWaiters = [];
  _chain = Promise.resolve();
}

function cacheKey(code: string, theme: Theme): string {
  return `${theme}::${code}`;
}

export function getCachedMermaid(code: string, theme: Theme): MermaidState | undefined {
  return _cache.get(cacheKey(code, theme));
}

function remember(key: string, state: MermaidState): void {
  if (state.status === 'error' && state.failure !== 'syntax') return;
  _cache.set(key, state);
  while (_cache.size > CACHE_LIMIT) {
    const oldest = _cache.keys().next();
    if (oldest.done) break;
    _cache.delete(oldest.value);
  }
}

function settlePending(): void {
  if (_pending > 0) _pending -= 1;
  if (_pending > 0) return;
  const waiters = _idleWaiters;
  _idleWaiters = [];
  for (const resolve of waiters) resolve();
}

export function renderMermaid(code: string, theme: Theme): Promise<MermaidState> {
  const key = cacheKey(code, theme);
  const cached = _cache.get(key);
  if (cached) return Promise.resolve(cached);
  const existing = _inflight.get(key);
  if (existing) return existing;

  const failure: MermaidState = { status: 'error', failure: 'unavailable' };
  _pending += 1;
  const job = enqueue(() => withTimeout(_renderer(code, theme), RENDER_TIMEOUT_MS, failure))
    .then((state) => {
      remember(key, state);
      return state;
    })
    .finally(() => {
      _inflight.delete(key);
      settlePending();
    });
  _inflight.set(key, job);
  return job;
}

export function whenMermaidIdle(timeoutMs?: number): Promise<void> {
  if (_pending === 0) return Promise.resolve();
  const idle = new Promise<void>((resolve) => { _idleWaiters.push(resolve); });
  return timeoutMs === undefined ? idle : withTimeout(idle, timeoutMs, undefined);
}

export function prerenderMermaid(sources: string[], theme: Theme): Promise<void> {
  const codes = new Set<string>();
  for (const source of sources) {
    for (const code of extractMermaidFences(source)) codes.add(code);
  }
  if (codes.size === 0) return Promise.resolve();
  const jobs = [...codes].map((code) => renderMermaid(code, theme));
  return withTimeout(Promise.all(jobs).then(() => undefined), PRERENDER_TIMEOUT_MS, undefined);
}
