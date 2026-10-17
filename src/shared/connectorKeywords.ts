import { findBuiltinConnector } from './builtinConnectors';
import { findCatalogEntry } from './mcpCatalog';
import { escapeRegExp } from './regex';

/**
 * What the composer needs to know about one connector to decide whether a sentence named it.
 * `connected` is part of the decision, not a filter applied afterwards: matching escalates an
 * ordinary chat turn into an agent run, and a run aimed at a server it cannot reach spends the
 * whole turn arriving at "connect this first". An open connector that the send itself would
 * connect counts as connected (`reachableOnSend`).
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

const ALNUM_EDGE = /[a-z0-9]/i;

/**
 * An ASCII keyword is fenced by non-alphanumerics so `line` cannot answer for `deadline`,
 * `online` or `linear`. A CJK name has no word boundaries to anchor to, so it is matched as
 * written. A mixed Latin/CJK keyword is fenced only on its Latin end, so `X` followed by a CJK
 * suffix cannot match inside `max` followed by the same suffix.
 */
function keywordPattern(keyword: string): RegExp {
  const escaped = escapeRegExp(keyword);
  if (!ASCII_ONLY.test(keyword) && !ALNUM_EDGE.test(keyword[0]) && !ALNUM_EDGE.test(keyword[keyword.length - 1])) {
    return new RegExp(escaped, 'i');
  }
  const before = ALNUM_EDGE.test(keyword[0]) ? '(?<![a-z0-9])' : '';
  const after = ALNUM_EDGE.test(keyword[keyword.length - 1]) ? '(?![a-z0-9])' : '';
  return new RegExp(`${before}${escaped}${after}`, 'i');
}

/**
 * The display name plus, for a catalog connector, the brand's own name and its sub-services.
 * Reading the catalog name keeps the match alive after the user renames the connector (say, to
 * "Work notes"), the same reason the slash command resolves through the catalog id. A built-in
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
    if (
      keywordsFor(candidate).some((keyword) => keywordPattern(keyword).test(haystack))
      || findBuiltinConnector(candidate.id)?.mentionedIn?.(haystack) === true
    ) {
      matched.push(candidate.id);
    }
  }
  return matched;
}
