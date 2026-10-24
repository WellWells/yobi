/**
 * What the PTT connector's tool descriptions cannot say on their own. Facts only: when to reach for
 * PTT is the model's call. Its tools need no contract table: all are read-only and say so in their
 * annotations. Paid for in the shared connector catalog budget, so kept short.
 */
export const PTT_NOTES = [
  'PTT NOTES:',
  '- PTT (批踢踢) is a Taiwanese forum made of boards. Use these tools when the user is talking about PTT; they are not a web search.',
  '- PTT has no site-wide search: find the board first, then list or search one board at a time. No board named yet: pick the likeliest one or two with ptt_find_board, or ask the user which board.',
  '- score is the net push count (推 minus 噓). min_score 50 = 50 or more; min_score -50 = booed to -50 or worse (爆 = 100, XX = -100).',
  '- What people said is in the pushes; only ptt_read_post returns them.',
].join('\n');
