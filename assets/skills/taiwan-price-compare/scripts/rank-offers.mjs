import { readFileSync } from 'node:fs';

const REQUIRED = ['sameProduct', 'verified', 'inStock', 'unconditional'];

function cents(value, allowZero) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || (!allowZero && value === 0)) {
    throw new Error('Prices and known shipping must be finite numbers; item prices must be positive.');
  }
  const rounded = Math.round(value * 100);
  if (!Number.isSafeInteger(rounded) || Math.abs(value * 100 - rounded) > 0.000001) {
    throw new Error('Amounts must have at most two decimal places and fit within safe integer cents.');
  }
  return rounded;
}

function compare(offers) {
  if (!Array.isArray(offers) || offers.length > 100) throw new Error('Expected a JSON object {"offers": [...]} with at most 100 offers.');
  const seen = new Set();
  const groups = new Map();
  const excluded = [];
  for (const offer of offers) {
    if (!offer || typeof offer !== 'object' || typeof offer.id !== 'string' || !offer.id.trim()) {
      throw new Error('Every offer must have a nonempty string id.');
    }
    const id = offer.id.trim();
    if (seen.has(id)) throw new Error(`Duplicate offer id: ${id}`);
    seen.add(id);
    const missing = REQUIRED.filter((key) => offer[key] !== true);
    if (missing.length > 0) {
      excluded.push({ id, unconfirmed: missing });
      continue;
    }
    if (typeof offer.currency !== 'string' || !/^[A-Z]{3}$/.test(offer.currency)) {
      throw new Error(`Offer ${id} needs an uppercase three-letter currency.`);
    }
    const price = cents(offer.price, false);
    const shipping = offer.shipping == null ? null : cents(offer.shipping, true);
    const total = shipping === null ? null : price + shipping;
    if (total !== null && !Number.isSafeInteger(total)) throw new Error('Total exceeds safe integer cents.');
    const entry = { id, price: price / 100, shipping: shipping === null ? null : shipping / 100, total: total === null ? null : total / 100 };
    if (!groups.has(offer.currency)) groups.set(offer.currency, []);
    groups.get(offer.currency).push(entry);
  }
  return {
    currencies: [...groups.entries()].map(([currency, entries]) => ({
      currency,
      itemPriceRanking: [...entries].sort((a, b) => a.price - b.price),
      knownTotalRanking: entries.filter((entry) => entry.total !== null).sort((a, b) => a.total - b.total),
      unknownShipping: entries.filter((entry) => entry.shipping === null).map((entry) => entry.id),
    })),
    excluded,
  };
}

try {
  const input = process.argv[2] ?? readFileSync(0, 'utf8');
  console.log(JSON.stringify(compare(JSON.parse(input)?.offers)));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
