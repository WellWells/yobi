import type { SkillType } from '../../../../../../../shared/types';
import { useI18nStore } from '../../../../../store/i18nStore';

export interface StepLabelParts {
  /** What the row leads with. */
  title: string;
  /** The skill's name beside it, or null when it would only repeat the title. */
  skill: string | null;
}

/**
 * A step keeps the name its skill had when it was added, in whatever language the app ran in
 * then — a flow built in English carries "Loop Array" forever. Such a label says nothing the
 * skill's name does not, so it is shown as the skill's name in the current language; a label the
 * user (or a template) actually wrote leads, with the skill's name after it.
 */
export function stepLabelParts(
  label: string,
  skill: string,
  defaultNames: ReadonlyArray<string | undefined>,
): StepLabelParts {
  const own = label.trim();
  const folded = own.toLowerCase();
  const isDefault = !own
    || folded === skill.trim().toLowerCase()
    || defaultNames.some((name) => (name ?? '').trim().toLowerCase() === folded);
  if (isDefault) return { title: skill, skill: null };
  // "Telegram Bot" already names its "Bot" skill; repeating it reads as "Telegram Bot Bot".
  const named = namesWord(folded, skill.trim().toLowerCase());
  return { title: own, skill: named ? null : skill };
}

/** A letter or digit of a script that puts spaces between words; CJK text runs words together. */
function isSpacedWordChar(char: string | undefined): boolean {
  if (!char) return false;
  return /[\p{L}\p{N}]/u.test(char) && !/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(char);
}

/**
 * Whether `text` holds `word` as a word of its own: "Check difference" does not name "if", but
 * "Telegram Bot" names "bot". Where either side of an edge is CJK there is no space to look for, so
 * 「擷取網頁內文」 still names 「擷取網頁」.
 */
function namesWord(text: string, word: string): boolean {
  if (!word) return false;
  const first = word[0];
  const last = word[word.length - 1];
  for (let at = text.indexOf(word); at !== -1; at = text.indexOf(word, at + 1)) {
    const before = text[at - 1];
    const after = text[at + word.length];
    const startsWord = !(isSpacedWordChar(before) && isSpacedWordChar(first));
    const endsWord = !(isSpacedWordChar(after) && isSpacedWordChar(last));
    if (startsWord && endsWord) return true;
  }
  return false;
}

/** `stepLabelParts` with the skill's name in the app language and in English, the fallback pack. */
export function useStepLabelParts(label: string, type: SkillType, t: (key: string) => string): StepLabelParts {
  const key = `flow.skill.${type}`;
  const english = useI18nStore((state) => state.enTranslations[key]);
  return stepLabelParts(label, t(key), [english]);
}
