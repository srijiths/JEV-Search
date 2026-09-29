export const collapse = (s: string) => s.replace(/\s+/g, " ").trim();

/**
 * A phrase a parser recognised, tagged with where it started.
 *
 * `raw_keywords` is assembled by sorting every parser's keywords by `at`, so the
 * output reads back in the order the user typed — the one ordering that stays
 * stable as parsers are added, and the only one a reader can verify by eye.
 */
export type Keyword = { text: string; at: number };

/**
 * A half-open `[start, end)` slice of the query that a parser has claimed.
 *
 * Parsers compete for the same digits — "1500" is a floor area, a rent, or a zipcode
 * depending on what is next to it — so whoever matches with a unit or a comparator
 * publishes its span and the number parsers skip it.
 */
export type Span = { start: number; end: number };

export const spanOf = (m: { index: number; 0: string }): Span => ({
  start: m.index,
  end: m.index + m[0].length,
});

export const kw = (text: string, at: number): Keyword => ({ text, at });

/** Flatten keyword groups into the `raw_keywords` array: text order, first spelling wins. */
export function mergeKeywords(...groups: readonly Keyword[][]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const k of groups.flat().sort((a, b) => a.at - b.at)) {
    const text = collapse(k.text);
    const key = text.toLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
}

export const capitalize = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

export const titleCase = (s: string) =>
  s
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => (w.length <= 2 && w === w.toUpperCase() ? w : capitalize(w.toLowerCase())))
    .join(" ");

/** Strip dangling connector words left behind after removing a phrase. */
export function tidy(s: string) {
  let out = collapse(s.replace(/[,;]+\s*$/g, "").replace(/^\s*[,;:-]+/g, ""));
  const dangling = /\s+(in|at|near|under|over|with|for|to|and|the|around|from|by|within)$/i;
  const leading = /^(in|at|near|under|over|with|for|and|the|to|a|an)\s+/i;
  for (let i = 0; i < 4; i++) {
    const next = out.replace(dangling, "").replace(leading, "");
    if (next === out) break;
    out = next;
  }
  return out.trim();
}

// ─────────────────────────────────────────────────────────────
// Money
// ─────────────────────────────────────────────────────────────

/**
 * Magnitude suffixes. `k` is unambiguous. `m` means million in a price context
 * ("$1m", "1.2 mil") — note this is why a bare "m" is not accepted as a suffix:
 * "3 m" in a property search is far more likely metres or a typo than 3 million.
 */
const SUFFIXES: Record<string, number> = {
  k: 1_000,
  K: 1_000,
  m: 1_000_000,
  M: 1_000_000,
  mm: 1_000_000,
  mil: 1_000_000,
  mill: 1_000_000,
  million: 1_000_000,
  millions: 1_000_000,
  thousand: 1_000,
  thousands: 1_000,
};

export type MoneyHit = {
  value: number;
  /** Byte offset of the whole match in the source text. */
  index: number;
  length: number;
  /** The matched substring, e.g. "$1M" or "under 500k". */
  text: string;
};

/**
 * Money with an explicit marker: a currency symbol, a magnitude suffix, or a
 * grouped-thousands form. Requiring a marker is what stops "3 bedroom" and
 * "94110" from being read as prices.
 */
const MONEY_RE =
  /(?:\$|usd\s?)\s?(\d[\d,]*(?:\.\d+)?)\s*(mm|mil{1,2}ions?|mil{1,2}|millions?|thousands?|[kKmM])?\b|(\d[\d,]*(?:\.\d+)?)\s*(mm|mil{1,2}ions?|mil{1,2}|millions?|thousands?|[kKmM])\b|(\d{1,3}(?:,\d{3})+(?:\.\d+)?)/g;

function scale(raw: string, suffix: string | undefined): number {
  const base = Number(raw.replace(/,/g, ""));
  if (!Number.isFinite(base)) return NaN;
  if (!suffix) return base;
  const key = suffix.toLowerCase();
  const factor = SUFFIXES[suffix] ?? SUFFIXES[key] ?? 1;
  return base * factor;
}

/** Every money-like amount in the text, in order of appearance. */
export function findMoney(text: string): MoneyHit[] {
  const re = new RegExp(MONEY_RE.source, "g");
  const hits: MoneyHit[] = [];
  let m: RegExpExecArray | null;

  while ((m = re.exec(text))) {
    const [raw, suffix] = m[1] !== undefined ? [m[1], m[2]] : m[3] !== undefined ? [m[3], m[4]] : [m[5], undefined];
    if (raw === undefined) continue;
    const value = scale(raw, suffix);
    if (!Number.isFinite(value) || value <= 0) continue;
    hits.push({ value, index: m.index, length: m[0].length, text: m[0] });
  }
  return hits;
}

/**
 * A bare number that looks like a rent or price even without a marker, e.g.
 * "budget 3000" or "rent 2500". Only consulted when `findMoney` found nothing,
 * and only when a price word sits nearby.
 */
/**
 * Cadence terms are included because "3000 monthly" and "2500 a month" name a rent with
 * no comparator anywhere in the sentence, and without them the amount was not read at
 * all. "a month" is the loose one — it also appears in "moving in a month" — but this is
 * only a gate on the text, and each candidate still has to survive the guards below and
 * the span reservation in `price.ts`, which is where a date or a zipcode gets rejected.
 */
const PRICE_WORD =
  /\b(budget|price|priced|rent|rents|renting|costs?|asking|under|below|over|above|max|maximum|min|minimum|up to|at most|at least|around|about|roughly|monthly|a month|per month|pcm|\/mo)\b/i;

/**
 * Returns *every* candidate, in text order, rather than just the first.
 *
 * The caller discards the ones another field already claimed, and it can only do that if
 * it gets to see the alternatives. Returning a single hit lost the price outright in
 * "near 94110 … under 2500 a month": the zipcode matched first, the caller correctly
 * rejected it as already claimed by the location parser, and there was nothing left to
 * fall back to — so `price_max` came out null.
 */
export function findBarePrices(text: string): MoneyHit[] {
  if (!PRICE_WORD.test(text)) return [];
  const re = /\b(\d{3,7})\b/g;
  const hits: MoneyHit[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const value = Number(m[1]);
    // Skip things that are obviously not prices: zipcodes are handled by the
    // location parser and years read as years.
    if (m[1].length === 5 && /\b(zip|zipcode|postal)\b/i.test(text)) continue;
    if (value >= 1900 && value <= 2100 && /\b(built|year|since)\b/i.test(text)) continue;
    if (value < 100) continue;
    hits.push({ value, index: m.index, length: m[0].length, text: m[0] });
  }
  return hits;
}

export function formatMoney(n: number, opts: { compact?: boolean } = {}): string {
  if (opts.compact) {
    if (n >= 1_000_000) return `$${trimZeros(n / 1_000_000)}M`;
    if (n >= 1_000) return `$${trimZeros(n / 1_000)}K`;
  }
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

function trimZeros(n: number): string {
  return String(Math.round(n * 100) / 100);
}

// ─────────────────────────────────────────────────────────────
// Plain numbers
// ─────────────────────────────────────────────────────────────

const WORD_NUMBERS: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  studio: 0,
};

export function wordToNumber(w: string): number | null {
  const n = WORD_NUMBERS[w.toLowerCase()];
  return n === undefined ? null : n;
}

export const NUMBER_WORD_GROUP = Object.keys(WORD_NUMBERS).join("|");

/** Parse "3", "1.5", "three" into a number. */
export function readCount(raw: string): number | null {
  const trimmed = raw.trim();
  if (/^\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  return wordToNumber(trimmed);
}

// ─────────────────────────────────────────────────────────────
// Floor area vs land area
// ─────────────────────────────────────────────────────────────

/**
 * Words that turn a square-footage figure into a *land* measurement.
 *
 * "1200 sqft" is a floor area and "12000 sqft lot" is a lot size, and the only thing that
 * distinguishes them is this word. Both parsers that care — `rooms.ts` for floor area and
 * `home.ts` for lot size — test against this one regex, so they cannot disagree about
 * which of them owns a given number. Kept here rather than in either file because
 * importing one from the other would make the pair circular.
 */
const LOT_WORD = /\b(?:lots?|land|parcels?|acreage|yards?|grounds?|plots?)\b/i;

/** How far either side of a match to look for a lot word. Long enough for "lot of 2 acres". */
const LOT_WINDOW = 18;

/** Does a lot word sit close enough to this match to claim it as land rather than floor area? */
export function inLotContext(text: string, m: { index: number; 0: string }): boolean {
  const before = text.slice(Math.max(0, m.index - LOT_WINDOW), m.index);
  const after = text.slice(m.index + m[0].length, m.index + m[0].length + LOT_WINDOW);
  return LOT_WORD.test(before) || LOT_WORD.test(after);
}
