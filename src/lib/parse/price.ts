import { findBarePrices, findMoney, formatMoney, kw, type Keyword, type MoneyHit, type Span } from "./common";
import { roomSpans } from "./rooms";
import type { PriceBound, Signals } from "../jev/types";
import { SIGNAL_THRESHOLDS } from "../signals";

/**
 * Price bounds. This is the clearest example of the division of labour:
 *
 *   Jev decides   "under $1M"  -> priceBound = maximum
 *   Code computes "$1M"        -> 1000000
 *
 * Jev is asked which *end* of the range the amount constrains, because that is a
 * reading of intent and the phrasings are endless ("nothing north of", "topping out
 * at"). Jev is never asked for the number, because "$1M" is 1000000 by arithmetic and
 * a model that returns 100000 once in a thousand calls is a filter nobody can trust.
 *
 * A literal comparator in the text always wins over Jev's answer: "over $500k" is not
 * a probabilistic question, and deferring to the model where the text is explicit
 * would make the output less predictable for no gain.
 */

export type PriceHit = {
  price_min: number | null;
  price_max: number | null;
  /**
   * `""` | `"total"` | `"monthly"` — the filter panel's List price / Monthly payment toggle.
   *
   * Set only from a literal cadence phrase ("/mo", "per month"). Jev's `priceCadence`
   * answer is a better guess than nothing where the text says nothing, but consulting it
   * here would bury a model answer inside a parser; `query.ts` does that overlay where it
   * can be seen and recorded in the provenance map.
   */
  cadence: string;
  /**
   * The matched amount, for highlighting. Deliberately *not* merged into
   * `raw_keywords`: the price is already carried structurally in `price_min` /
   * `price_max`, and repeating it as a free-text keyword would have a listing
   * search match the literal string "$1M" against descriptions.
   */
  keywords: Keyword[];
  /** The amount's span, so the timeframe parser does not read "$1M" as "1 month". */
  spans: Span[];
};

/** An explicit two-ended range: "between 500k and 800k", "800k-1.2m", "500k to 1m". */
const AMOUNT = String.raw`\$?\s?\d[\d,]*(?:\.\d+)?\s*(?:mm|mil{1,2}ions?|mil{1,2}|millions?|thousands?|[kKmM])?`;
const RANGE_RE = new RegExp(String.raw`(?:between\s+)?(${AMOUNT})\s*(?:-|–|—|to|and|\.\.\.?)\s*(${AMOUNT})`, "i");

const MAX_WORD =
  /\b(?:under|below|less than|lower than|up to|at most|no more than|max|maximum|budget of|budget|within|cheaper than|beneath|not (?:more|over))\b/i;
const MIN_WORD =
  /\b(?:over|above|more than|greater than|at least|starting (?:at|from)|from|min|minimum|north of|upwards of|plus)\b/i;

const overlaps = (hit: { index: number; length: number }, spans: readonly Span[]) =>
  spans.some((s) => hit.index < s.end && hit.index + hit.length > s.start);

/**
 * A cadence phrase trailing an amount — "/mo", "per month", "a month", "pcm".
 *
 * It is part of the price, not a separate fact, so the price span is extended to cover it.
 * Two things go wrong otherwise, and both did: chrono reads the "a month" in "under 2500 a
 * month" as a move-in date, giving `timeframe: "a month"`, and the phrase leaks into
 * `raw_keywords` where a listing search would match it against descriptions.
 *
 * Anchored with `^` because it is tested against the slice that starts where the amount
 * ends — only a phrase directly after the number belongs to it.
 */
const CADENCE_RE =
  /^\s*(?:\/\s*(?:mo|month|m)\b|per\s+(?:month|mo|year|yr|annum)\b|a\s+(?:month|year)\b|monthly\b|pcm\b|yearly\b|annually\b)/i;

/**
 * Which of those phrases means a *monthly* figure.
 *
 * The yearly ones are matched above but not classified here: they belong to the span (so
 * chrono does not read "a year" as a move-in date) without being either of the filter panel's two
 * options. Calling an annual rent "monthly" would divide the user's budget by twelve
 * somewhere downstream, and calling it "total" would read it as a purchase price.
 */
const MONTHLY_RE = /^\s*(?:\/\s*(?:mo|month|m)\b|per\s+(?:month|mo)\b|a\s+month\b|monthly\b|pcm\b)/i;

export function parsePrice(text: string, signals?: Signals, reserved: readonly Span[] = []): PriceHit {
  /**
   * Amounts that belong to another field. Bed counts and floor areas are matched by
   * `rooms.ts` and zipcodes by `location.ts`; without this, "1500 sqft under 400k"
   * would read 1500 as the price simply because it comes first, and "near 94110 …
   * budget" would read the zipcode as a budget.
   */
  const claimed: Span[] = [...roomSpans(text), ...reserved];
  const free = <T extends MoneyHit>(hits: T[]) => hits.filter((h) => !overlaps(h, claimed));

  // ── An explicit range short-circuits everything ──────────────
  const range = RANGE_RE.exec(text);
  if (range) {
    const pair = free(findMoney(range[0]).map((h) => ({ ...h, index: h.index + range.index })));
    if (pair.length >= 2) {
      const [lo, hi] = [pair[0].value, pair[1].value].sort((a, b) => a - b);
      const end = range.index + range[0].length;
      const trailing = CADENCE_RE.exec(text.slice(end));
      return {
        price_min: lo,
        price_max: hi,
        cadence: cadenceOf(text.slice(end)),
        keywords: [kw(range[0].trim(), range.index)],
        spans: [{ start: range.index, end: end + (trailing?.[0].length ?? 0) }],
      };
    }
  }

  const hit = free(findMoney(text))[0] ?? free(findBarePrices(text))[0];
  if (!hit) return { price_min: null, price_max: null, cadence: "", keywords: [], spans: [] };

  const keywords = [kw(hit.text.trim(), hit.index)];
  const end = hit.index + hit.length;
  const trail = text.slice(end);
  const cadenceMatch = CADENCE_RE.exec(trail);
  const cadence = cadenceOf(trail);
  const spans: Span[] = [{ start: hit.index, end: end + (cadenceMatch?.[0].length ?? 0) }];

  // ── Which end does it bound? ─────────────────────────────────
  // Look only at the words leading up to the amount: in "3 bed under 400k with a pool"
  // the comparator is "under", and scanning the whole string would also find "with".
  const lead = text.slice(Math.max(0, hit.index - 32), hit.index);
  const bound: PriceBound = MAX_WORD.test(lead) ? "maximum" : MIN_WORD.test(lead) ? "minimum" : jevBound(signals);

  if (bound === "minimum") return { price_min: hit.value, price_max: null, cadence, keywords, spans };

  if (bound === "around") {
    // A ±10% band. Narrower and "around 500k" excludes the 540k listings the user
    // would happily look at; wider and it stops meaning "around".
    const pad = Math.round(hit.value * 0.1);
    return { price_min: hit.value - pad, price_max: hit.value + pad, cadence, keywords, spans };
  }

  // `maximum`, `none`, and a `range` whose second amount did not survive parsing all
  // land here. A ceiling is the safe default: an unqualified "$800k house" is a budget
  // far more often than a floor, and a too-high ceiling shows extra results rather
  // than hiding every result the user wanted.
  return { price_min: null, price_max: hit.value, cadence, keywords, spans };
}

/** `"monthly"` for a per-month phrase directly after the amount, `""` for anything else. */
function cadenceOf(trailing: string): string {
  return MONTHLY_RE.test(trailing) ? "monthly" : "";
}

/** Jev's reading, consulted only where the text has no literal comparator. */
function jevBound(signals: Signals | undefined): PriceBound {
  if (!signals) return "maximum";
  const { priceBound } = signals;
  return priceBound.confidence >= SIGNAL_THRESHOLDS.choiceMin ? priceBound.value : "maximum";
}

/** "Under $1M" / "$500K – $800K" / "$3,000/mo+" / "" — the label a card shows. */
export function formatPriceRange(min: number | null, max: number | null, monthly = false): string {
  const suffix = monthly ? "/mo" : "";
  // Rents read as exact figures ("$3,000"); sale prices read compactly ("$1M").
  const fmt = (n: number) => formatMoney(n, { compact: !monthly });
  if (min !== null && max !== null) return `${fmt(min)} – ${fmt(max)}${suffix}`;
  if (max !== null) return `Under ${fmt(max)}${suffix}`;
  if (min !== null) return `${fmt(min)}${suffix}+`;
  return "";
}
