import { findBuiltinConnector } from './builtinConnectors';
import { findCatalogEntry } from './mcpCatalog';

/**
 * What the composer needs to know about one connector to decide whether a sentence named it.
 * `connected` is part of the decision, not a filter applied afterwards: matching escalates an
 * ordinary chat turn into an agent run, and a run aimed at a server it cannot reach spends the
 * whole turn arriving at "connect this first".
 */
export interface KeywordCandidate {
  id: string;
  name: string;
  url: string;
  connected: boolean;
}

/** A one-character name would answer for half the alphabet, so it never becomes a keyword. */
const MIN_KEYWORD_LENGTH = 2;

const ASCII_ONLY = /^[\x20-\x7E]+$/;
const REGEX_META = /[.*+?^${}()|[\]\\]/g;

/**
 * Drop the regions of the message that are material rather than intent. Pasted code and a
 * quoted line are things the user wants looked at; letting either reach for a server is the
 * same mistake the prompt fencing rules exist to prevent, one surface earlier.
 */
export function stripUnreadableRegions(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    // An unclosed fence, i.e. a block the user is still pasting into.
    .replace(/```[\s\S]*$/g, ' ')
    .replace(/`[^`\n]*`/g, ' ')
    .replace(/^\s*>.*$/gm, ' ');
}

/**
 * An ASCII keyword is fenced by non-alphanumerics so `line` cannot answer for `deadline`,
 * `online` or `linear`. A CJK name has no word boundaries to anchor to, so it is matched as
 * written — which is also why the punctuation around it never has to be guessed at.
 */
function keywordPattern(keyword: string): RegExp {
  const escaped = keyword.replace(REGEX_META, '\\$&');
  return ASCII_ONLY.test(keyword)
    ? new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`, 'i')
    : new RegExp(escaped, 'i');
}

/**
 * The display name plus, for a catalog connector, the brand's own name and its sub-services.
 * Reading the catalog name is what keeps the match alive after the user renames the connector
 * to "工作筆記" — the same reason the slash command resolves through the catalog id. A built-in
 * connector has no catalog entry, so its extra names come from the built-in table instead.
 */
function keywordsFor(candidate: KeywordCandidate): string[] {
  const entry = findCatalogEntry(candidate.url);
  const words = [
    candidate.name,
    ...(entry ? [entry.name, ...(entry.keywords ?? [])] : []),
    ...(findBuiltinConnector(candidate.id)?.keywords ?? []),
  ];
  const seen = new Set<string>();
  for (const word of words) {
    const folded = word.trim().toLowerCase();
    if (folded.length >= MIN_KEYWORD_LENGTH) seen.add(folded);
  }
  return [...seen];
}

/**
 * Which of the offered connectors this message names. Ids come back in the order the candidates
 * were offered, each at most once however many times the message mentions it.
 */
export function matchConnectorKeywords(
  text: string,
  candidates: readonly KeywordCandidate[],
): string[] {
  const haystack = stripUnreadableRegions(text);
  if (!haystack.trim()) return [];
  const matched: string[] = [];
  for (const candidate of candidates) {
    if (!candidate.connected) continue;
    if (keywordsFor(candidate).some((keyword) => keywordPattern(keyword).test(haystack))) {
      matched.push(candidate.id);
    }
  }
  return matched;
}
