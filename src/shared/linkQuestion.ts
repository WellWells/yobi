const LINK_IN_TEXT = /https?:\/\/[^\s<>"'，。、；！？）」』]+/gi;

/** Past this many words around it a link is part of something pasted, not the thing being asked about. */
const MAX_WORDS_AROUND_LINK = 500;

export function linksIn(text: string): string[] {
  return text.match(LINK_IN_TEXT) ?? [];
}

/** The link a message is made of and nothing else; null for anything else. */
export function singleLinkOf(text: string): string | null {
  const trimmed = text.trim();
  const links = linksIn(trimmed);
  return links.length === 1 && links[0] === trimmed ? trimmed : null;
}

/**
 * Whether a message asks something about a link it carries: a link with a few words around it. A
 * link alone is not one, it has its own way in (`resolveUrlPrompt` and the link sites' menus), and
 * neither is a long paste that happens to hold a link.
 */
export function asksAboutLink(text: string): boolean {
  if (!text.match(LINK_IN_TEXT)) return false;
  const words = text.replace(LINK_IN_TEXT, ' ').trim();
  return words.length > 0 && words.length <= MAX_WORDS_AROUND_LINK;
}
