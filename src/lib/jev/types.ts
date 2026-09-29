import { z } from "zod";

// ─────────────────────────────────────────────────────────────
// Intents — each one is a card the search box can morph into.
// ─────────────────────────────────────────────────────────────

export const INTENT_KEYS = [
  "buy",
  "rent",
  "sold",
  "mortgage",
  "valuation",
  "commute",
  "agent",
  "none",
] as const;
export type IntentKey = (typeof INTENT_KEYS)[number];
/** Every intent that renders a card. `none` renders the plain input. */
export type CardIntent = Exclude<IntentKey, "none">;

export const PRICE_BOUNDS = ["maximum", "minimum", "range", "around", "none"] as const;
export const PRICE_CADENCES = ["total", "monthly", "unspecified"] as const;
export const SORT_PREFERENCES = ["price_asc", "price_desc", "newest", "largest", "unspecified"] as const;

export type PriceBound = (typeof PRICE_BOUNDS)[number];
export type PriceCadence = (typeof PRICE_CADENCES)[number];
export type SortPreference = (typeof SORT_PREFERENCES)[number];

// ─────────────────────────────────────────────────────────────
// Jev answer envelope
// ─────────────────────────────────────────────────────────────

/**
 * A normalised choice answer.
 *
 * On the wire `confidence` and `probabilities` are both optional, and `choice` is
 * an unconstrained string. `src/lib/jev/client.ts` is the only place that widens
 * the wire shape into this one: it validates `choice` against the known option
 * list and falls back to the escape option, and it fills a missing `confidence`
 * from `probabilities[choice]`, or 0 when there is nothing to fill it from.
 *
 * Zero is deliberate. Every threshold in `decide.ts` and `signals.ts` is a floor,
 * so an answer that arrived without calibration keeps the UI in its neutral state
 * instead of driving a morph on a confidence we made up.
 */
export type Answer<T extends string> = {
  value: T;
  confidence: number;
  probabilities: Partial<Record<T, number>>;
};

/**
 * `z.record(z.string(), z.number())` rather than a keyed record: providers are free to
 * omit zero-probability options, and this stays portable across zod 3 and 4.
 */
function answerSchema<const T extends readonly [string, ...string[]]>(values: T) {
  return z.object({
    value: z.enum(values),
    confidence: z.number(),
    probabilities: z.record(z.string(), z.number()),
  });
}

export const signalsSchema = z.object({
  priceBound: answerSchema(PRICE_BOUNDS),
  priceCadence: answerSchema(PRICE_CADENCES),
  sortPreference: answerSchema(SORT_PREFERENCES),
  urgency: z.object({ score: z.number(), confidence: z.number() }),
  wantsNewConstruction: z.number(),
  wantsOutdoorSpace: z.number(),
  wantsParking: z.number(),
  wantsPetFriendly: z.number(),
  wantsFurnished: z.number(),
  wantsLuxury: z.number(),
  wantsInvestment: z.number(),
  isFamilyOriented: z.number(),
  isQuestion: z.number(),
  hasNegation: z.number(),
  isAddressLookup: z.number(),
});
export type Signals = z.infer<typeof signalsSchema>;
export type SignalKey = keyof Signals;

/**
 * Answers to the extended question set (`src/lib/jev/extended.ts`), present only when the
 * request ran in `jev` mode. Absent means "not asked", which is not the same as "no" —
 * `hybrid` mode never sends these questions at all.
 *
 * Keyed loosely by string rather than by the literal key unions, because the wire shape is
 * whatever came back and the reader's job is to look up the keys it knows. The typed key
 * unions live next to the question tables in `extended.ts`, where the lookups happen.
 */
export const extendedAnswersSchema = z.object({
  choices: z.record(z.string(), z.object({ value: z.string(), confidence: z.number() })),
  nouls: z.record(z.string(), z.number()),
});
export type ExtendedAnswers = z.infer<typeof extendedAnswersSchema>;

export function emptyExtendedAnswers(): ExtendedAnswers {
  return { choices: {}, nouls: {} };
}

export const intentResultSchema = z.object({
  intent: answerSchema(INTENT_KEYS),
  readiness: z.number(),
  signals: signalsSchema,
  /** Only in `jev` mode. See `extendedAnswersSchema`. */
  extended: extendedAnswersSchema.optional(),
  /** Which extraction mode produced this result, so the debug panel can label it. */
  mode: z.enum(["hybrid", "jev"]).optional(),
  latencyMs: z.number(),
  questionCount: z.number(),
  model: z.string(),
  cached: z.boolean().optional(),
  /** Which upstream served the decision, e.g. "typesafe" or "chutes". Debug HUD only. */
  provider: z.string().optional(),
  /** USD for this single call, when the Decisions response reports it. */
  costUsd: z.number().optional(),
  /**
   * Tokens billed for this call.
   *
   * Required in the Decisions response but optional here, because two of the three ways an
   * `IntentResult` comes into existence never touch the wire: `noneResult()` builds one for
   * the tests and the error path, and a cache hit replays one whose tokens were paid for by
   * an earlier keystroke. Zero would be a lie in the first case and double-counting in the
   * second, so both leave it absent and the HUD shows nothing.
   */
  inputTokens: z.number().optional(),
  outputTokens: z.number().optional(),
});
export type IntentResult = z.infer<typeof intentResultSchema>;

/**
 * `mode` is optional and per-request on purpose. The server has a default from
 * `EXTRACTION_MODE`, but letting a single request override it is what makes the two
 * modes comparable on the same text without a redeploy — which is the only way to find
 * out whether the extra questions are worth their tokens.
 */
export const intentRequestSchema = z.object({
  text: z.string().max(2000),
  mode: z.enum(["hybrid", "jev"]).optional(),
});

// ─────────────────────────────────────────────────────────────
// SearchQuery — the structured filter set the whole app exists to produce.
// This shape is the public contract of POST /api/search-intent.
// ─────────────────────────────────────────────────────────────

export const PROPERTY_TYPES = [
  "house",
  "condo",
  "townhouse",
  "apartment",
  "multi-family",
  "land",
  "mobile",
  "farm",
] as const;
export type PropertyType = (typeof PROPERTY_TYPES)[number];

// ─────────────────────────────────────────────────────────────
// Closed-set filter vocabularies.
//
// Each of these is a fixed list of labels, which is the *only* kind of filter the mode
// flag can move: Jev can pick a label out of a list, and cannot return a number or a
// string of free text. See `src/lib/filters/fields.ts` for the full split.
//
// `""` is the absent value for the single-valued ones, matching `timeframe` and
// `sort_by` — a filter nobody asked for is empty, not "any".
// ─────────────────────────────────────────────────────────────

/** The filter panel's "For sale / Just sold" tab. */
export const SALE_STATUSES = ["for_sale", "just_sold"] as const;
export type SaleStatus = (typeof SALE_STATUSES)[number];

/** The filter panel's "Status" row: Any / Active / Pending & contingent. */
export const LISTING_STATUSES = ["active", "pending"] as const;
export type ListingStatus = (typeof LISTING_STATUSES)[number];

/** The filter panel's "Type" row. Multi-valued: "new construction or foreclosures" is one search. */
export const LISTING_TYPES = ["existing-homes", "foreclosure", "new-construction", "55-plus", "auction"] as const;
export type ListingType = (typeof LISTING_TYPES)[number];

/** The filter panel's "Open houses & tours" row. */
export const TOURS = ["open-house", "3d-tour", "virtual-tour"] as const;
export type Tour = (typeof TOURS)[number];

/** The filter panel's "Stories" row: Any / Single story / Multi story. */
export const STORY_COUNTS = ["single", "multi"] as const;
export type StoryCount = (typeof STORY_COUNTS)[number];

/** The filter panel's travel-mode row under "Commute". */
export const COMMUTE_MODES = ["driving", "walking", "cycling", "transit"] as const;
export type CommuteMode = (typeof COMMUTE_MODES)[number];

/** Whether the money in the query is a purchase price or a monthly payment. */
export const PRICE_CADENCE_VALUES = ["total", "monthly"] as const;

export const locationSchema = z.object({
  city: z.string(),
  state: z.string(),
  zipcode: z.string(),
});
export type Location = z.infer<typeof locationSchema>;

/**
 * Travel-time search. The filter panel calls it "Commute"; it is a location constraint expressed
 * as a duration rather than a place, so it sits apart from `location`.
 */
export const commuteSchema = z.object({
  /** Free text, exactly as typed. A geocoder's input, not ours to normalise. */
  address: z.string(),
  mode: z.string(),
  max_minutes: z.number().nullable(),
});
export type Commute = z.infer<typeof commuteSchema>;

/**
 * The full filter set, covering a listings site's filter panel.
 *
 * Every field is always present, and absent means empty (`""`, `[]`, `null`, `false`)
 * rather than missing. A consumer can therefore read any field without a guard, and
 * adding a filter never breaks one — which is why `emptySearchQuery()` below is the only
 * place a default is written down.
 */
export const searchQuerySchema = z.object({
  intent: z.string(),
  property_type: z.array(z.string()),
  location: locationSchema,

  // ── Price ─────────────────────────────────────────────────
  price_min: z.number().nullable(),
  price_max: z.number().nullable(),
  /** "" | "total" | "monthly" — the filter panel's List price / Monthly payment toggle. */
  price_cadence: z.string(),
  price_reduced: z.boolean(),
  builder_promotions: z.boolean(),

  // ── Rooms ─────────────────────────────────────────────────
  beds_min: z.number().nullable(),
  baths_min: z.number().nullable(),

  // ── Listing details ───────────────────────────────────────
  /** "" | "for_sale" | "just_sold" */
  sale_status: z.string(),
  /** "" | "active" | "pending" */
  listing_status: z.string(),
  listing_types: z.array(z.string()),
  tours: z.array(z.string()),
  /** Upper bound in days, from "listed in the last week". */
  days_on_market: z.number().nullable(),

  // ── Home details ──────────────────────────────────────────
  sqft_min: z.number().nullable(),
  sqft_max: z.number().nullable(),
  /** Always square feet. Acres are converted on the way in, so one unit reaches the backend. */
  lot_size_min: z.number().nullable(),
  lot_size_max: z.number().nullable(),
  /** Years. "newer than 10 years" is `home_age_max: 10`. */
  home_age_min: z.number().nullable(),
  home_age_max: z.number().nullable(),
  /** Monthly, in dollars. */
  hoa_max: z.number().nullable(),
  /** The filter panel's 1+/2+/3+ buckets, as the minimum space count. */
  garage_min: z.number().nullable(),
  /** "" | "single" | "multi" */
  stories: z.string(),

  // ── Features ──────────────────────────────────────────────
  amenities: z.array(z.string()),
  /** Tags the text ruled out — "no HOA", "not a condo". Previously computed and discarded. */
  excluded: z.array(z.string()),

  // ── Commute and expanded search ───────────────────────────
  commute: commuteSchema,
  radius_miles: z.number().nullable(),
  include_nearby_areas: z.boolean(),

  // ── Everything else ───────────────────────────────────────
  timeframe: z.string(),
  sort_by: z.string(),
  raw_keywords: z.array(z.string()),
});
export type SearchQuery = z.infer<typeof searchQuerySchema>;

export function emptySearchQuery(intent: string = ""): SearchQuery {
  return {
    intent,
    property_type: [],
    location: { city: "", state: "", zipcode: "" },
    price_min: null,
    price_max: null,
    price_cadence: "",
    price_reduced: false,
    builder_promotions: false,
    beds_min: null,
    baths_min: null,
    sale_status: "",
    listing_status: "",
    listing_types: [],
    tours: [],
    days_on_market: null,
    sqft_min: null,
    sqft_max: null,
    lot_size_min: null,
    lot_size_max: null,
    home_age_min: null,
    home_age_max: null,
    hoa_max: null,
    garage_min: null,
    stories: "",
    amenities: [],
    excluded: [],
    commute: { address: "", mode: "", max_minutes: null },
    radius_miles: null,
    include_nearby_areas: false,
    timeframe: "",
    sort_by: "",
    raw_keywords: [],
  };
}

// ─────────────────────────────────────────────────────────────
// Neutral / empty results
// ─────────────────────────────────────────────────────────────

export function neutralAnswer<T extends string>(value: T): Answer<T> {
  return { value, confidence: 1, probabilities: { [value]: 1 } as Partial<Record<T, number>> };
}

export function neutralSignals(): Signals {
  return {
    priceBound: neutralAnswer("none"),
    priceCadence: neutralAnswer("unspecified"),
    sortPreference: neutralAnswer("unspecified"),
    urgency: { score: 0, confidence: 1 },
    wantsNewConstruction: 0,
    wantsOutdoorSpace: 0,
    wantsParking: 0,
    wantsPetFriendly: 0,
    wantsFurnished: 0,
    wantsLuxury: 0,
    wantsInvestment: 0,
    isFamilyOriented: 0,
    isQuestion: 0,
    hasNegation: 0,
    isAddressLookup: 0,
  };
}

export function noneResult(extra: Partial<IntentResult> = {}): IntentResult {
  return {
    intent: neutralAnswer("none"),
    readiness: 0,
    signals: neutralSignals(),
    latencyMs: 0,
    questionCount: 0,
    model: "none",
    ...extra,
  };
}
