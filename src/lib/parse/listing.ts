import { kw, spanOf, type Keyword, type Span } from "./common";
import { LISTING_TYPES, TOURS, type ListingType, type Tour } from "../jev/types";

/**
 * The "Listing details" filter panel: the for-sale/just-sold tab, the status row, the
 * listing-type row, the tour toggles, and how long a listing has been up.
 *
 * All of it is vocabulary matching, which is why it is here rather than in a question.
 * "foreclosures in Phoenix" contains the word "foreclosures"; there is nothing to infer,
 * and a regex that says so can be read and argued with, which a probability cannot.
 *
 * The one genuinely numeric field, `days_on_market`, is a duration phrase turned into a
 * day count — "listed this week" -> 7. Jev could not return 7 if we asked it to.
 */

export type ListingHit = {
  sale_status: string;
  listing_status: string;
  listing_types: ListingType[];
  tours: Tour[];
  days_on_market: number | null;
  price_reduced: boolean;
  builder_promotions: boolean;
  keywords: Keyword[];
  /** Spans claimed, so "last 7 days" is not also read as a price or a move-in date. */
  spans: Span[];
};

/**
 * "Just sold" has to beat "for sale", because a query about sold homes routinely mentions
 * both ("what did houses sell for, not what's for sale"). Tested first for that reason.
 */
const SOLD_RE =
  /\b(?:just sold|recently sold|already sold|sold (?:homes?|houses?|prices?|for)|(?:sell|sells|selling|went) for|sold comps?|comparable sales|last sold)\b/i;
const FOR_SALE_RE = /\b(?:for sale|on the market|currently listed|available now)\b/i;

const PENDING_RE = /\b(?:pending|contingent|under contract|in escrow|accepting backups?)\b/i;
/**
 * "Active" needs a listing word next to it. On its own the word belongs to "active adult
 * community", which is the 55+ filter and the opposite of a status.
 */
const ACTIVE_RE = /\b(?:active (?:listings?|homes?|properties|on the market)|still (?:available|active|on the market)|not (?:pending|under contract))\b/i;

const TYPE_TRIGGERS: Array<[ListingType, RegExp]> = [
  ["foreclosure", /\b(?:foreclosures?|foreclosed|bank[-\s]?owned|reo\b|short sales?|distressed|pre[-\s]?foreclosures?)\b/i],
  ["new-construction", /\b(?:new construction|newly built|brand[-\s]?new|new builds?|to be built|under construction)\b/i],
  ["55-plus", /\b(?:55\s*\+|55\s*(?:and|or)\s*(?:over|older|up)|over[-\s]?55|active adult|retirement communit(?:y|ies)|senior living)\b/i],
  ["auction", /\b(?:auctions?|auctioned|sheriff'?s sale|courthouse sale)\b/i],
  ["existing-homes", /\b(?:existing homes?|resales?|previously owned|pre[-\s]?owned|older homes?|not new construction)\b/i],
];

const TOUR_TRIGGERS: Array<[Tour, RegExp]> = [
  ["open-house", /\b(?:open houses?|open this (?:weekend|saturday|sunday))\b/i],
  ["3d-tour", /\b(?:3d tours?|3d walk\s?throughs?|matterport|virtual walk\s?throughs?)\b/i],
  ["virtual-tour", /\b(?:virtual tours?|video tours?|tour(?:ing)? (?:online|remotely)|remote (?:tours?|viewings?))\b/i],
];

const PRICE_REDUCED_RE =
  /\b(?:price (?:reduced|reductions?|drops?|cuts?|improvements?)|reduced price|just reduced|price slashed|motivated sellers?)\b/i;

const BUILDER_PROMO_RE =
  /\b(?:builder (?:promotions?|incentives?|credits?)|closing cost (?:help|credits?|assistance)|rate buy[-\s]?downs?|seller concessions?)\b/i;

/**
 * How long on the market, as an upper bound in days.
 *
 * Only ever an upper bound: every natural phrasing of this filter is "recent" ("listed
 * this week", "new in the last 3 days"). Nobody searches for listings that have been
 * sitting for *at least* a month — and if they did, the filter panel itself could not express
 * it either, so inventing a `days_on_market_min` would be a field no UI could show.
 */
const DAYS_UNITS: Record<string, number> = { day: 1, days: 1, week: 7, weeks: 7, month: 30, months: 30 };

const DAYS_RE =
  /\b(?:(?:in|within|over) the (?:last|past)\s+(\d+)?\s*(days?|weeks?|months?)|(?:last|past)\s+(\d+)\s*(days?|weeks?|months?)|listed (?:today|yesterday)|new (?:listings?|today|this week))\b/i;

/** "listed today" and friends carry no number; these are their day counts. */
const DAYS_LITERALS: Array<[RegExp, number]> = [
  [/\blisted today\b/i, 1],
  [/\bnew today\b/i, 1],
  [/\blisted yesterday\b/i, 2],
  [/\bnew this week\b/i, 7],
  [/\bnew listings?\b/i, 7],
];

export function parseListing(text: string): ListingHit {
  const keywords: Keyword[] = [];
  const spans: Span[] = [];

  const take = (m: RegExpExecArray, surface = m[0]) => {
    keywords.push(kw(surface.trim(), m.index + m[0].indexOf(surface)));
    spans.push(spanOf(m));
  };

  // ── For sale vs just sold ───────────────────────────────────
  let sale_status = "";
  const sold = SOLD_RE.exec(text);
  if (sold) {
    sale_status = "just_sold";
    take(sold);
  } else {
    const forSale = FOR_SALE_RE.exec(text);
    if (forSale) {
      sale_status = "for_sale";
      take(forSale);
    }
  }

  // ── Status ──────────────────────────────────────────────────
  let listing_status = "";
  const pending = PENDING_RE.exec(text);
  const active = ACTIVE_RE.exec(text);
  if (pending) {
    listing_status = "pending";
    take(pending);
  } else if (active) {
    listing_status = "active";
    take(active);
  }

  // ── Type and tours ──────────────────────────────────────────
  const types = new Map<ListingType, number>();
  for (const [type, re] of TYPE_TRIGGERS) {
    const m = re.exec(text);
    if (!m) continue;
    types.set(type, m.index);
    take(m);
  }

  const tours = new Map<Tour, number>();
  for (const [tour, re] of TOUR_TRIGGERS) {
    const m = re.exec(text);
    if (!m) continue;
    tours.set(tour, m.index);
    take(m);
  }

  // "virtual walkthrough" matches both 3d-tour and virtual-tour. The 3D filter is the
  // narrower claim, so when both fired on overlapping text, keep only that one.
  if (tours.has("3d-tour") && tours.has("virtual-tour") && tours.get("3d-tour") === tours.get("virtual-tour")) {
    tours.delete("virtual-tour");
  }

  // ── Flags ───────────────────────────────────────────────────
  const reduced = PRICE_REDUCED_RE.exec(text);
  if (reduced) take(reduced);
  const promo = BUILDER_PROMO_RE.exec(text);
  if (promo) take(promo);

  return {
    sale_status,
    listing_status,
    // Ordered by the vocabulary, not the text, so two equivalent queries compare equal.
    listing_types: LISTING_TYPES.filter((t) => types.has(t)),
    tours: TOURS.filter((t) => tours.has(t)),
    days_on_market: parseDaysOnMarket(text, spans),
    price_reduced: reduced !== null,
    builder_promotions: promo !== null,
    keywords,
    spans,
  };
}

function parseDaysOnMarket(text: string, spans: Span[]): number | null {
  for (const [re, days] of DAYS_LITERALS) {
    const m = re.exec(text);
    if (m) {
      spans.push(spanOf(m));
      return days;
    }
  }

  const m = DAYS_RE.exec(text);
  if (!m) return null;

  // Either the "(in|within|over) the last N unit" branch or the "last N unit" branch fired.
  const count = m[1] ?? m[3];
  const unit = (m[2] ?? m[4] ?? "").toLowerCase();
  const per = DAYS_UNITS[unit] ?? DAYS_UNITS[`${unit}s`];
  if (per === undefined) return null;

  // "in the last week" with no number means one of that unit.
  const n = count === undefined ? 1 : Number(count);
  if (!Number.isFinite(n) || n <= 0) return null;

  spans.push(spanOf(m));
  return Math.round(n * per);
}

// ─────────────────────────────────────────────────────────────
// Labels
// ─────────────────────────────────────────────────────────────

const TYPE_LABELS: Record<ListingType, string> = {
  "existing-homes": "Existing homes",
  foreclosure: "Foreclosures",
  "new-construction": "New construction",
  "55-plus": "55+ community",
  auction: "Auction",
};

const TOUR_LABELS: Record<Tour, string> = {
  "open-house": "Open house",
  "3d-tour": "3D tour",
  "virtual-tour": "Virtual tour",
};

export const formatListingType = (t: string) => TYPE_LABELS[t as ListingType] ?? t;
export const formatTour = (t: string) => TOUR_LABELS[t as Tour] ?? t;

export function formatSaleStatus(s: string): string {
  return s === "just_sold" ? "Just sold" : s === "for_sale" ? "For sale" : "";
}

export function formatListingStatus(s: string): string {
  return s === "active" ? "Active" : s === "pending" ? "Pending / contingent" : "";
}

/** "Last 7 days" / "Last 30 days" / "" — the label a chip shows. */
export function formatDaysOnMarket(days: number | null): string {
  if (days === null) return "";
  if (days === 1) return "Listed today";
  if (days % 30 === 0) return `Last ${days / 30} month${days === 30 ? "" : "s"}`;
  if (days % 7 === 0) return `Last ${days / 7} week${days === 7 ? "" : "s"}`;
  return `Last ${days} days`;
}
