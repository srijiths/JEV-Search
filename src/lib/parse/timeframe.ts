import * as chrono from "chrono-node";
import { collapse, kw, type Keyword, type Span } from "./common";

/**
 * When the user wants to move. `timeframe` in the output contract is a string rather
 * than a date, so this returns the phrase the user typed, normalised — "asap", "next
 * month", "by June". A listing backend that wants a date can parse `resolved`.
 *
 * chrono does the calendar work. Jev's `urgency` score is *not* used here: urgency is
 * how badly they need it, timeframe is when, and a query can be urgent with no date
 * ("need something asap") or dated with no urgency ("looking at spring 2027").
 */

export type TimeframeHit = {
  /** The user's own phrasing, e.g. "next month". Empty when nothing was said. */
  timeframe: string;
  /** ISO date when the phrase names a resolvable point in time, else "". */
  resolved: string;
  keywords: Keyword[];
};

/** Phrases chrono does not handle, but that renters and buyers use constantly. */
const RELATIVE: Array<[RegExp, string]> = [
  [/\b(?:asap|as soon as possible|immediately|right away|urgently)\b/i, "asap"],
  [/\bmove[-\s]?in ready\b/i, "immediate"],
  [/\bthis (?:month|week)\b/i, "this month"],
  [/\bnext (?:month|week)\b/i, "next month"],
  [/\bwithin (?:a|1|one) month\b/i, "within a month"],
  [/\bwithin (\d+|a few) (?:weeks?|months?)\b/i, ""],
  [/\bin (\d+|a few) (?:weeks?|months?)\b/i, ""],
  [/\b(?:by|before) (?:end of )?(?:the )?(?:year|month)\b/i, ""],
  [/\b(?:spring|summer|fall|autumn|winter)(?:\s+\d{4})?\b/i, ""],
  [/\bno rush\b/i, "flexible"],
  [/\bjust (?:looking|browsing)\b/i, "flexible"],
  [/\bflexible\b/i, "flexible"],
];

const EMPTY: TimeframeHit = { timeframe: "", resolved: "", keywords: [] };

/**
 * Money shorthand, which chrono reads as a duration: it parses "1M" as one month and
 * "3k" as a year. Nobody writing about property says "1m" to mean one month — they write
 * "1 month" — so a bare amount-with-suffix is never a timeframe here, with or without the
 * dollar sign. Rejecting the shape directly means `parseTimeframe` is right on its own
 * rather than only when a caller remembers to reserve the price span.
 */
const MONEY_SHORTHAND = /^\$?\s*\d+(?:[.,]\d+)?\s*[kmb]$/i;

/**
 * `reserved` holds the spans other parsers already claimed, and it is not optional in
 * practice: chrono reads "$1M" as "1 month" and "2br" as the 2nd of the month, so
 * without it a price or a bed count becomes a move-in date. The concrete case that
 * caught this was "under $1M", which produced `timeframe: "1m"`.
 */
export function parseTimeframe(text: string, reference = new Date(), reserved: readonly Span[] = []): TimeframeHit {
  const free = (index: number, length: number) =>
    !reserved.some((s) => index < s.end && index + length > s.start);

  for (const [re, canonical] of RELATIVE) {
    const m = re.exec(text);
    if (!m || !free(m.index, m[0].length)) continue;
    // An empty canonical means "the phrase is already the best label for itself".
    const timeframe = canonical || collapse(m[0]).toLowerCase();
    return { timeframe, resolved: resolve(m[0], reference), keywords: [kw(m[0].trim(), m.index)] };
  }

  for (const hit of chrono.parse(text, reference, { forwardDate: true })) {
    if (!free(hit.index, hit.text.length)) continue;
    if (MONEY_SHORTHAND.test(hit.text.trim())) continue;

    // chrono will also read a bare "3" as a day of the month. `isCertain` is true only
    // for components the text actually stated, so requiring a stated month, weekday or
    // year keeps a loose number from being promoted to a timeframe.
    const stated = (["month", "weekday", "year"] as const).some((c) => hit.start.isCertain(c));
    if (!stated) continue;

    return {
      timeframe: collapse(hit.text).toLowerCase(),
      resolved: hit.start.date().toISOString().slice(0, 10),
      keywords: [kw(hit.text.trim(), hit.index)],
    };
  }

  return EMPTY;
}

function resolve(phrase: string, reference: Date): string {
  const [hit] = chrono.parse(phrase, reference, { forwardDate: true });
  return hit ? hit.start.date().toISOString().slice(0, 10) : "";
}
