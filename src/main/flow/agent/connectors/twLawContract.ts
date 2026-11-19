/**
 * What the Taiwan law connector's tool descriptions cannot say on their own. Its tools need no
 * contract table: all are read-only and say so in their annotations. Paid for in the shared
 * connector catalog budget, so kept short.
 */
export const TW_LAW_NOTES = [
  'TAIWAN LAW NOTES:',
  "- The text of Taiwan's laws and regulations from the official database, kept on this computer. Quote articles word for word from these tools, with the law name, article number and link; never write an article from memory.",
  '- tw_law_search matches literal words: use the wording a statute would use (延長工作時間, not 加班), and try other forms when nothing matches. Read a hit in full with tw_law_articles before quoting it.',
  "- Say the date of the data (source). Call an abolished law abolished; an effective_note can say a provision is not in force yet.",
  '- This is the text of the law, not advice on a case: for a dispute, point to a lawyer or the competent authority.',
].join('\n');
