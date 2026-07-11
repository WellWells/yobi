import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { getLanguageDir } from './files';
import type { PromptPreferences } from '../shared/types';

let langCache: Record<string, string> = {};
let enCache: Record<string, string> = {};

export function getLangCache(): Record<string, string> {
  return langCache;
}

export function setLangCache(data: Record<string, string>): void {
  langCache = data;
}

export function setEnCache(data: Record<string, string>): void {
  enCache = data;
}

export async function loadLanguageData(lang: string): Promise<Record<string, string> | null> {
  const langDir = getLanguageDir();
  const filePath = path.join(langDir, `${lang}.json`);
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function t(
  strings: Record<string, string>,
  key: string,
  vars?: Record<string, string>,
): string {
  let result = strings[key] ?? enCache[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      // Function replacement keeps `$&`/`$'`-style patterns in user-controlled
      // values (flow names, error text) literal instead of regex-expanded.
      result = result.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), () => v);
    }
  }
  return result;
}

export function localizeUserFacingError(raw: string, strings: Record<string, string>): string {
  const exactMap: Record<string, string> = {
    'ChatGPT returned empty response': t(strings, 'main.error.chatgptEmptyResponse'),
    'ChatGPT input area not found': t(strings, 'main.error.chatgptInputNotFound'),
    'ChatGPT response block not found': t(strings, 'main.error.chatgptResponseBlockNotFound'),
    'ChatGPT response is empty': t(strings, 'main.error.chatgptResponseEmpty'),
    'Gemini input area not found — is the page logged in?': t(strings, 'main.error.geminiInputNotFound'),
    'Clipboard interceptor returned empty text': t(strings, 'main.error.geminiClipboardEmpty'),
    'Gemini answer element present but its text was empty': t(strings, 'main.error.geminiCopyNoText'),
    'Perplexity returned empty response': t(strings, 'main.error.pplxEmptyResponse'),
    'Perplexity input area not found': t(strings, 'main.error.pplxInputNotFound'),
    'Perplexity response block not found': t(strings, 'main.error.pplxResponseBlockNotFound'),
    'Perplexity response is empty': t(strings, 'main.error.pplxResponseEmpty'),
    'capture renderer not ready': t(strings, 'main.error.captureRendererNotReady'),
    'webp screenshot data is empty': t(strings, 'main.error.webpDataEmpty'),
    'export failed': t(strings, 'main.error.exportFailed'),
    'Image height exceeds limits. Please use PDF format.': t(strings, 'main.error.imageTooTall'),
    'BYOK provider not found — the instance may have been deleted': t(strings, 'main.error.byokInstanceMissing'),
    'BYOK group not found — it may have been deleted': t(strings, 'main.error.byokGroupMissing'),
    'BYOK group has no usable keys — add at least one key to the group': t(strings, 'main.error.byokGroupEmpty'),
  };
  if (exactMap[raw]) return exactMap[raw];

  const prefixHandlers: [string, string][] = [
    ['ChatGPT automation failed: ', 'main.error.chatgptAutomationFailed'],
    ['Gemini automation failed: ', 'main.error.geminiAutomationFailed'],
    ['Perplexity automation failed: ', 'main.error.pplxAutomationFailed'],
    ['BYOK configuration incomplete: ', 'main.error.byokConfigIncomplete'],
    ['BYOK request failed: ', 'main.error.byokRequestFailed'],
  ];
  for (const [prefix, key] of prefixHandlers) {
    if (raw.startsWith(prefix)) {
      return t(strings, key, { error: raw.slice(prefix.length) });
    }
  }
  return raw;
}

export function buildTaskInstruction(
  customInstruction: string | undefined,
  syncEnabled: boolean,
  locale: string,
): string {
  const manualInstruction = (customInstruction ?? '').trim();
  const localeInstruction = buildLocaleSystemInstruction(syncEnabled, locale);
  const parts = [manualInstruction, localeInstruction].filter(Boolean);
  if (parts.length === 0) return '';
  return `System Instruction: ${parts.join('\n')}`;
}

export function buildCombinedPromptFromPrefs(
  prefs: PromptPreferences,
  strings: Record<string, string>,
): string {
  const parts: string[] = [];
  const nickname = (prefs.nickname ?? '').trim();
  if (nickname) {
    const nicknameTemplate = t(strings, 'settings.prompt.built.nickname');
    // Function replacer: a name carrying `$&` or `$'` must not be read as a
    // replacement pattern. Bot-sourced names make this reachable from outside.
    parts.push(nicknameTemplate.replace(/\{\{name\}\}/g, () => nickname));
  }
  if (prefs.tone !== 'default') {
    const toneText = t(strings, `settings.prompt.built.tone.${prefs.tone}`);
    if (toneText) parts.push(toneText);
  }
  if (prefs.length !== 'auto') {
    const lengthText = t(strings, `settings.prompt.built.length.${prefs.length}`);
    if (lengthText) parts.push(lengthText);
  }
  if ((prefs.customInstructions ?? '').trim()) {
    const extraLabel = t(strings, 'settings.prompt.built.extra');
    parts.push(`${extraLabel}${prefs.customInstructions.trim()}`);
  }
  return parts.filter(Boolean).join('\n');
}

export function buildLocaleSystemInstruction(syncEnabled: boolean, locale: string): string {
  if (!syncEnabled) return '';
  const localeCode = normalizeLocaleCode(locale);
  if (!localeCode) return '';
  const template = langCache['system.localeInstruction']
    ?? 'Please respond in {{locale}}.';
  return template.replace(/\{\{locale\}\}/g, localeCode);
}

export function stripSystemInstruction(rawPrompt: string): string {
  const normalized = (rawPrompt ?? '')
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n');
  const systemInstructionBlock = /^System Instruction:[^\n]*(?:\n(?!\n)[^\n]*)*(?:\n|$)/gim;
  const stripped = normalized.replace(systemInstructionBlock, '');
  return stripped.replace(/\n{3,}/g, '\n\n').trim();
}

export function normalizeLocaleCode(rawLocale: string): string {
  const trimmed = (rawLocale ?? '').trim().replace('_', '-');
  if (!trimmed) return '';
  const parts = trimmed.split('-').filter(Boolean);
  if (parts.length === 0) return '';
  const [language, ...rest] = parts;
  const normalizedRest = rest.map((part) => {
    if (/^[a-z]{2}$/i.test(part)) return part.toUpperCase();
    if (/^[a-z]{4}$/i.test(part)) return part[0].toUpperCase() + part.slice(1).toLowerCase();
    return part;
  });
  return [language.toLowerCase(), ...normalizedRest].join('-');
}
