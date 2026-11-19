/**
 * `yobi_test_api_keys`: whether the user's saved API keys (Settings › AI models › API keys) still
 * answer. One short request per key through `byokKeyTest.ts`, the same check as the Settings page's
 * "Test all". Changes nothing, so it is a read; the key itself never appears in the result.
 */
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { ToolError } from '../mcp/inProcessServer';
import { ALSO_NAMED } from '../mcp/schemaAliases';

export interface YobiApiKey {
  id: string;
  name: string;
  model: string;
}

export interface YobiApiKeyTest extends YobiApiKey {
  ok: boolean;
  /** Why it failed, as the provider said it. */
  error?: string;
}

export interface YobiApiKeyDeps {
  apiKeys: () => YobiApiKey[];
  testApiKeys: (ids: readonly string[]) => Promise<YobiApiKeyTest[]>;
}

export const YOBI_API_KEY_TOOLS: Tool[] = [
  {
    name: 'yobi_test_api_keys',
    description: 'Test whether the user\'s saved API keys in Yobi still work: sends each a one-word request and reports which answer and why the others fail. keys = names to test; leave out to test all.',
    inputSchema: {
      type: 'object',
      properties: {
        keys: {
          type: 'array',
          items: { type: 'string' },
          description: 'Key names as Yobi lists them (or their ids); empty = every key',
          [ALSO_NAMED]: ['names', 'ids', 'key', 'name', 'api_keys'],
        },
      },
    },
    annotations: { title: 'Test API keys', readOnlyHint: true, destructiveHint: false, openWorldHint: true, idempotentHint: true },
  },
];

function namesOf(raw: unknown): string[] {
  if (typeof raw === 'string') return raw.split(/[,，、\n]/).map((part) => part.trim()).filter(Boolean);
  if (Array.isArray(raw)) return raw.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean);
  return [];
}

export async function testApiKeys(deps: YobiApiKeyDeps, args: Record<string, unknown>): Promise<unknown> {
  const all = deps.apiKeys();
  if (all.length === 0) {
    return { keys: [], note: 'No API keys are saved in Yobi. The user adds them in Settings › AI models › API keys.' };
  }
  const asked = namesOf(args.keys);
  const unknown: string[] = [];
  const ids = new Set<string>();
  for (const name of asked) {
    const lower = name.toLowerCase();
    const match = all.find((key) => key.id === name) ?? all.find((key) => key.name.toLowerCase() === lower);
    if (match) ids.add(match.id);
    else unknown.push(name);
  }
  if (asked.length > 0 && ids.size === 0) {
    throw new ToolError('not_found', `None of these is a saved API key: ${unknown.join(', ').slice(0, 200)}.`, {
      keys: all.map((key) => key.name),
    });
  }
  const results = await deps.testApiKeys([...ids]);
  const working = results.filter((result) => result.ok).length;
  return {
    summary: `${working} of ${results.length} working`,
    keys: results.map(({ name, model, ok, error }) => ({ name, model, status: ok ? 'working' : 'failing', ...(error ? { error: error.slice(0, 300) } : {}) })),
    ...(unknown.length > 0 ? { not_found: unknown } : {}),
  };
}
