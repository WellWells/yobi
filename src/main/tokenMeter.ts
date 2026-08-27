import { AsyncLocalStorage } from 'node:async_hooks';
import { estimateTokens } from '../shared/tokenEstimate';
import type { TokenUsage } from '../shared/tokenEstimate';

type TokenSink = (input: number, output: number) => void;

let sink: TokenSink | null = null;

interface Scope {
  input: number;
  output: number;
  exact: boolean;
}

const scopes = new AsyncLocalStorage<Scope>();

export function setTokenSink(next: TokenSink | null): void {
  sink = next;
}

function report(input: number, output: number, exact: boolean): void {
  const scope = scopes.getStore();
  if (scope) {
    scope.input += input;
    scope.output += output;
    if (!exact) scope.exact = false;
  }
  sink?.(input, output);
}

export function meterReported(input: number, output: number): void {
  report(input, output, true);
}

export function meterText(prompt: string, response: string): void {
  if (!sink && !scopes.getStore()) return;
  report(estimateTokens(prompt), estimateTokens(response), false);
}

export function currentScopeTokens(): { input: number; output: number } | null {
  const scope = scopes.getStore();
  return scope ? { input: scope.input, output: scope.output } : null;
}

export async function measureTokens<T>(fn: () => Promise<T>): Promise<{ result: T; usage: TokenUsage }> {
  const scope: Scope = { input: 0, output: 0, exact: true };
  const result = await scopes.run(scope, fn);
  return { result, usage: { input: scope.input, output: scope.output, exact: scope.exact } };
}
