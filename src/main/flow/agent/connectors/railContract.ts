/**
 * What the Taiwan rail connector's tool descriptions cannot say on their own. Its tools need no
 * contract table: both are read-only and say so in their annotations.
 */
export const RAIL_NOTES = [
  'TAIWAN RAIL NOTES:',
  '- Train times, delays and fares come only from these tools, never from memory.',
  '- 火車 or 台鐵 alone means TRA: pass modes "tra"; 高鐵 alone means modes "thsr". Compare both only when neither is named or the user asks which.',
  '- A TRA-only plan is one ticket (its ticket.fare_ntd); never add up its legs. For "how much is the train", answer from tra_fares, every class.',
  '- When the question is about now, state query_time from the result in the answer.',
  '- A bare 4-digit number before a trip ("1016 左營到南港") is a date (October 16); a number with 次 or 車次 is a train. Ask only when both readings fit.',
  '- End with the official_links as Markdown links and say the operators\' own pages are authoritative; when live says data is unavailable or old, say so.',
].join('\n');
