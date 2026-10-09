/**
 * The words the markdown renderer itself adds to an answer: the footnote section's label and the
 * callout titles. They live in the language files like every other string; the capture window
 * has no language loaded, so main resolves them and sends them along with the request.
 */

export const ALERT_KINDS = ['note', 'tip', 'important', 'warning', 'caution'] as const;
export type AlertKind = typeof ALERT_KINDS[number];

export interface MarkdownLabels {
  footnotes: string;
  /** Accessible name of a footnote's back link; `{{n}}` is the reference number. */
  footnoteBack: string;
  alerts: Record<AlertKind, string>;
}

export function buildMarkdownLabels(t: (key: string) => string): MarkdownLabels {
  return {
    footnotes: t('markdown.footnotes'),
    footnoteBack: t('markdown.footnoteBack'),
    alerts: {
      note: t('markdown.alert.note'),
      tip: t('markdown.alert.tip'),
      important: t('markdown.alert.important'),
      warning: t('markdown.alert.warning'),
      caution: t('markdown.alert.caution'),
    },
  };
}
