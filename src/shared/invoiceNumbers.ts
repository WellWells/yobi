/**
 * Receipt numbers as the receipt-lottery step reads them. One copy for the executor and the step
 * editor, so the editor's "N receipts read" / "not a receipt number" is what the run will say.
 */

export interface TicketNumber {
  /** As the receipt prints it, normalised: "AB-12345678", "12345678", or a tail "111". */
  display: string;
  /** 3-8 digits; fewer than 8 = only the last digits are known. */
  digits: string;
}

/** Most numbers one request can check. */
export const MAX_TICKET_NUMBERS = 200;

/**
 * Receipt numbers in whatever the user or the model typed: several separated by spaces, commas,
 * 、 or lines; full-width digits; a two-letter track prefix ("AB-12345678", "ab12345678") kept for
 * display only; or just the last 3 (up to 7) digits. Words between them are ignored; a digit run
 * that is not 3-8 long (a phone number, a date) is returned in `bad` instead of being guessed at.
 */
export function parseTicketNumbers(raw: string): { numbers: TicketNumber[]; bad: string[] } {
  const text = raw.normalize('NFKC').toUpperCase();
  const numbers: TicketNumber[] = [];
  const bad: string[] = [];
  const seen = new Set<string>();
  for (const m of text.matchAll(/(?:(?<![A-Z])([A-Z]{2})\s*[-–—]?\s*)?(\d+)/g)) {
    const [whole, track, digits] = m;
    if (digits.length < 3 || digits.length > 8 || (track && digits.length !== 8)) {
      bad.push(whole.trim());
      continue;
    }
    const display = track ? `${track}-${digits}` : digits;
    if (seen.has(digits)) continue;
    seen.add(digits);
    numbers.push({ display, digits });
  }
  return { numbers: numbers.slice(0, MAX_TICKET_NUMBERS), bad };
}

/**
 * What the run refuses in the numbers field, as the `flow.error.invoiceNumbers` value; null when
 * it reads (blank, a variable, or only receipt numbers).
 */
export function ticketNumbersRefusal(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.includes('{{')) return null;
  const { numbers, bad } = parseTicketNumbers(trimmed);
  if (bad.length > 0) return bad.join(', ');
  return numbers.length === 0 ? trimmed : null;
}
