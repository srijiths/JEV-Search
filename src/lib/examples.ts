import type { CardIntent } from "./jev/types";

/**
 * Sample queries, chosen so that between them they exercise every filter in `FIELDS`.
 *
 * Two jobs, and the second is the reason this is a module rather than an array literal
 * inside the component:
 *
 *   1. A visitor with an empty input has no idea what this box understands. A 36-field
 *      filter set is invisible until something fills it, so the examples are the
 *      documentation — one click puts a fully-specified query on screen.
 *   2. `examples.test.ts` runs every one of these through the parser and fails if any
 *      parser-owned field is left uncovered. That is what stops this list from rotting:
 *      add a filter without a query that produces it and the suite tells you.
 *
 * Each entry names the intent it should morph into, so the list doubles as a manual
 * check on `decide.ts` — click through the seven groups and any card that comes up wrong
 * is a criteria or threshold bug you can see immediately.
 *
 * `intent` and `sort_by` are Jev's calls and cannot be asserted offline, so the coverage
 * test excludes them; the `shows` note is where a reviewer sees they were considered.
 */

export type Example = {
  /** Typed into the box verbatim when clicked. */
  text: string;
  /** The card this should become. */
  intent: CardIntent;
  /** What this query is here to demonstrate, for the UI's hover title and the reader. */
  shows: string;
};

export const EXAMPLES: readonly Example[] = [
  // ── buy ─────────────────────────────────────────────────────
  {
    text: "3 bedroom house to buy in Cupertino under $2M with a backyard and a 2 car garage",
    intent: "buy",
    shows: "Bedrooms, home type, location, max price, features, garage",
  },
  {
    text: "single story homes in Cupertino, California between 2000 and 3000 sqft, at least half an acre, built after 2015, no HOA",
    intent: "buy",
    shows: "Stories, square feet range, lot size, home age, no HOA",
  },
  {
    text: "luxury homes for sale in Cupertino from $3M to $5M with a pool and a view, cheapest first",
    intent: "buy",
    shows: "For sale, price range, features, sort order",
  },

  // ── rent ────────────────────────────────────────────────────
  {
    text: "2br 2 bath furnished apartment for rent near 95014, pets ok, under $4500 a month, move in next month",
    intent: "rent",
    shows: "Beds and baths, zipcode, monthly price, pet and furnished tags, move-in date",
  },

  // ── sold ────────────────────────────────────────────────────
  {
    text: "what did 3 bedroom homes in Cupertino sell for in the last 6 months",
    intent: "sold",
    shows: "Just sold, days on market",
  },

  // ── mortgage ────────────────────────────────────────────────
  {
    text: "can I afford an $850k house in Cupertino on a $200k salary with 20% down",
    intent: "mortgage",
    shows: "Affordability question rather than a listing search",
  },

  // ── valuation ───────────────────────────────────────────────
  {
    text: "what is 10600 North Tantau Avenue, Cupertino worth today",
    intent: "valuation",
    shows: "A single street address, not a category of homes",
  },

  // ── commute ─────────────────────────────────────────────────
  {
    text: "condos within 25 minutes drive of Apple Park under $1.5M",
    intent: "commute",
    shows: "Commute address, travel mode and max minutes",
  },

  // ── agent ───────────────────────────────────────────────────
  {
    text: "find a real estate agent in Cupertino who works with first time buyers",
    intent: "agent",
    shows: "Looking for a person, not a property",
  },

  // ── Listing-detail filters, which no natural first query reaches ──
  {
    text: "new construction condos in Cupertino with an open house this weekend and builder incentives",
    intent: "buy",
    shows: "New construction, open house, builder promotions",
  },
  {
    text: "pending foreclosures within 5 miles of Cupertino and nearby areas, price reduced, listed in the last week, 3d tour",
    intent: "buy",
    shows: "Pending status, foreclosures, radius, nearby areas, price reduced, 3D tour",
  },
  {
    text: "55+ single level condos in Cupertino under $1M on a lot under 1 acre, no pool",
    intent: "buy",
    shows: "55+ community, max lot size, a ruled-out feature",
  },
  {
    text: "active listings of older homes in Cupertino built before 1980, more than 30 years old, with a fireplace",
    intent: "buy",
    shows: "Active status, existing homes, minimum home age",
  },
  {
    text: "auction properties in Cupertino with a virtual tour, at least 4 bathrooms, over 4000 sqft",
    intent: "buy",
    shows: "Auction, virtual tour, bathrooms, minimum square feet",
  },
];

/** Grouped for display, in the order the cards are introduced. */
export const EXAMPLE_GROUPS: ReadonlyArray<{ intent: CardIntent; examples: readonly Example[] }> = (
  ["buy", "rent", "sold", "mortgage", "valuation", "commute", "agent"] as const
).map((intent) => ({ intent, examples: EXAMPLES.filter((e) => e.intent === intent) }));
