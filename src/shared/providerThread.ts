import { PROVIDER_URLS, PROVIDERS, type Provider } from './types';

/** Hosts a provider served conversations from before its current address. */
const LEGACY_THREAD_HOSTS: Partial<Record<Provider, readonly string[]>> = {
  chatgpt: ['chat.openai.com'],
};

/** A provider's own hosts: the one in `PROVIDER_URLS` without `www.`, plus legacy ones. */
function threadHosts(provider: Provider): readonly string[] {
  const host = new URL(PROVIDER_URLS[provider]).hostname.toLowerCase().replace(/^www\./, '');
  return [host, ...(LEGACY_THREAD_HOSTS[provider] ?? [])];
}

/**
 * The provider whose website a saved thread address is on, or `null`. Only an https address on a
 * provider's own host (or a subdomain of it) counts: a hand-edited or imported file can carry any
 * address, and the menu must not label a foreign site with a provider's name.
 */
export function providerOfThreadUrl(url: string): Provider | null {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:') return null;
  const host = parsed.hostname.toLowerCase();
  return PROVIDERS.find((provider) =>
    threadHosts(provider).some((known) => host === known || host.endsWith(`.${known}`))) ?? null;
}
