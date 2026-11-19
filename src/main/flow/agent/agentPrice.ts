import { sendLog } from '../../helpers';
import { execPriceSearch } from '../skills/priceSearch';
import { FlowAbortError } from '../runtime';
import { FlowUserError } from '../userError';

/*
 * `price_search` for `/agent`: the flow step's search, called as a tool. The shops are read in
 * code and the model gets one JSON document; it never reads a shop page for a price.
 *
 * Not in the catalog: the Taiwan price skill names it, and `use_skill` hands this line over, so
 * the catalog every run pays for stays the same (on Gemini signed out a tier-1 line for it left
 * the connectors 281 characters short) and only the interface language the skill
 * ships for ever hears of it.
 */

export const PRICE_SEARCH_LINE = '- "price_search": Prices of ONE product across Taiwan online shops, read now in code: PChome, momo, Yahoo, Ruten, Rakuten, Costco online, Costco warehouse sightings, Wanjiafu (ex-Carrefour), Watsons, Cosmed, Poya, Senao, TR Plus, HOLA, plus Shopee Mall / Coupang / friDay through a comparison site. A broad name also returns accessories: read "bands", then call again with "exclude" and "minPrice". config keys: "query" (brand and model, 1-3 words as shops write it; REQUIRED), "exclude" (comma-separated words; a title holding any is dropped), "minPrice", "maxPrice" (TWD), "sort" ("price" default | "unit" per 100 g / 100 ml / piece | "relevance"), "limit" (offers listed, default "20", max "60"), "stores" (blank = all | some of pchome, momo, yahoo, ruten, rakuten, costco, daybuy, wanjiafu, watsons, cosmed, poya, senao, trplus, hola, feebee) → returns: a JSON object {typed (only when the name given was one character off how the shops spell it: "query" is then their spelling), query, checkedAt, stats {count, lowest, highest, average, median} over every in-stock match, bands [[from, to, offers]], unitStats, stores [{store, status, count, lowest}], offers [{store, via, title, price, priceMax, listPrice, inStock, asOf, about, history, per, unitPrice, url}], notes}. A store whose status is not ok or empty was skipped. Quote prices as given, with the shop; link only the lowest and the recommended offer.';

/** The bundled skill that is the guide to this tool: how to choose the query and present the result. */
export const PRICE_SKILL = 'taiwan-price-compare';

/**
 * The catalog line, sent only where that skill is offered (so it is charged with the SKILLS section
 * and no other interface language pays for it). A tool named only inside a skill's instructions is
 * one the model never sees unless it loads the skill first, and it does not.
 */
export const PRICE_SEARCH_BRIEF = `- "price_search": What a product, or a kind of product (tissue, coffee beans), costs in Taiwan's shops and where it is cheapest or best bought, read from the shops now: PChome, momo, Yahoo, Ruten, Rakuten, Costco, the hypermarket, drugstore and home-improvement chains (Wanjiafu, Watsons, Cosmed, Poya, TR Plus, HOLA), plus Shopee Mall / Coupang. Use it, not research or search, whenever the user asks a price, the cheapest or a recommended shop or channel ("通路", "渠道"), or where to buy something; the "${PRICE_SKILL}" skill says how to read and present it. config: "query" (the product as shops write it, 1-3 words; REQUIRED). [+opts]`;

/** What the model may set; `track` is a scheduled flow's business. */
const TOOL_FIELDS = ['query', 'exclude', 'minPrice', 'maxPrice', 'sort', 'limit', 'stores'] as const;

export interface PriceToolOutcome {
  observation: string;
  status: 'ok' | 'error';
}

export type PriceStep = (config: Record<string, string>, stepId: string, signal?: AbortSignal) => Promise<string>;

/** One `price_search` call: the JSON document, or why there is none. */
export async function runPriceSearchTool(config: Record<string, string>, signal?: AbortSignal, step: PriceStep = execPriceSearch): Promise<PriceToolOutcome> {
  if (signal?.aborted) throw new FlowAbortError();
  const asked = Object.fromEntries(TOOL_FIELDS.map((key) => [key, config[key] ?? '']));
  try {
    const envelope = JSON.parse(await step(asked, 'agent', signal)) as { output?: unknown };
    return { observation: typeof envelope.output === 'string' ? envelope.output : '', status: 'ok' };
  } catch (err) {
    if (signal?.aborted) throw new FlowAbortError();
    const detail = err instanceof Error ? err.message : String(err);
    sendLog(`🛒 [Agent] price_search failed: ${detail}`);
    // A field the model can fix says which; anything else sends it to the pages instead.
    return {
      observation: err instanceof FlowUserError
        ? `ERROR: ${detail}`
        : 'ERROR: The shops could not be read right now. Say so, or read comparison pages with "research".',
      status: 'error',
    };
  }
}
