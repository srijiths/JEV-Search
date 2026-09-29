import { mergeKeywords } from "./common";
import { parseAmenities } from "./amenities";
import { parseCommute } from "./commute";
import { parseHome } from "./home";
import { parseListing } from "./listing";
import { parseLocation } from "./location";
import { parsePrice } from "./price";
import { parsePropertyType } from "./propertyType";
import { parseRooms, roomSpans } from "./rooms";
import { parseTimeframe } from "./timeframe";
import { SIGNAL_THRESHOLDS } from "../signals";
import { DEFAULT_MODE, type ExtractionMode, type FieldSource, type FieldSources } from "../extraction";
import { baselineSources } from "../filters/fields";
import {
  CHOICE_ESCAPE,
  choiceOptions,
  FEATURE_NOULS,
  LISTING_FLAG_NOULS,
  LISTING_TAG_NOULS,
  type ExtendedChoiceKey,
} from "../jev/extended";
import {
  emptySearchQuery,
  LISTING_TYPES,
  PROPERTY_TYPES,
  TOURS,
  type ExtendedAnswers,
  type IntentResult,
  type SearchQuery,
  type Signals,
} from "../jev/types";

/**
 * Assemble the `SearchQuery` — the one object this whole app exists to produce.
 *
 * Division of labour, restated once more because it is the entire design:
 *
 *   Jev supplies  `intent`, `sort_by`, and how to read an ambiguous amount.
 *   Code supplies every value: prices, counts, places, types, amenities, dates.
 *
 * In `jev` mode Jev additionally supplies the *closed-set* filters — home type, listing
 * status, stories, garage bucket, bed and bath buckets, the listing toggles and the
 * feature checkboxes — for the phrasings no literal covers. It still supplies no numbers
 * and no free text, because it cannot: see `src/lib/filters/fields.ts`.
 *
 * Passing `result` is optional. Without it the parsers still fill every field they can
 * from the text alone — which is how the unit tests pin the deterministic half of the
 * pipeline without a network call, and the only place that omission is intended. In
 * the app, `result` is always present, because there is no offline classifier: if Jev
 * cannot be reached the UI shows an error rather than a half-classified query.
 */

export type Extraction = {
  query: SearchQuery;
  /** Who actually produced each field's value on this run. `none` means it came out empty. */
  sources: FieldSources;
  mode: ExtractionMode;
};

export function extract(text: string, result?: IntentResult, mode: ExtractionMode = DEFAULT_MODE): Extraction {
  const signals = result?.signals;
  // Only trusted in `jev` mode. A result carrying extended answers is not on its own
  // permission to use them — the caller decides which mode this extraction is.
  const extended = mode === "jev" ? result?.extended : undefined;

  const rooms = parseRooms(text);
  const location = parseLocation(text);
  const propertyType = parsePropertyType(text);
  const listing = parseListing(text);
  const home = parseHome(text);
  const commute = parseCommute(text);

  // Order matters here, and only here: the number parsers run most-specific-first and
  // hand their spans down, so each number is claimed once. Rooms and zipcodes are pinned
  // by a unit or a length, HOA fees and travel times by the word beside them; the price
  // parser skips all of those and pins its amount; the timeframe parser skips the lot.
  // Run in any other order and "under $1M" becomes a one-month move-in date, or a "$300
  // HOA" becomes the asking price — both of which it did before this.
  const claimed = [...roomSpans(text), ...location.spans, ...listing.spans, ...home.spans, ...commute.spans];
  const price = parsePrice(text, signals, claimed);
  const timeframe = parseTimeframe(text, new Date(), [...claimed, ...price.spans]);

  const featureTags = extended ? inferredFeatureTags(extended) : [];
  const amenities = parseAmenities(text, signals, featureTags);

  const query: SearchQuery = {
    ...emptySearchQuery(intentOf(result)),
    property_type: [...propertyType.property_type],
    location: location.location,

    price_min: price.price_min,
    price_max: price.price_max,
    price_cadence: price.cadence,
    price_reduced: listing.price_reduced,
    builder_promotions: listing.builder_promotions,

    beds_min: rooms.beds_min,
    baths_min: rooms.baths_min,

    sale_status: listing.sale_status,
    listing_status: listing.listing_status,
    listing_types: [...listing.listing_types],
    tours: [...listing.tours],
    days_on_market: listing.days_on_market,

    sqft_min: rooms.sqft_min,
    sqft_max: rooms.sqft_max,
    lot_size_min: home.lot_size_min,
    lot_size_max: home.lot_size_max,
    home_age_min: home.home_age_min,
    home_age_max: home.home_age_max,
    hoa_max: home.hoa_max,
    garage_min: home.garage_min,
    stories: home.stories,

    amenities: amenities.amenities,
    excluded: amenities.excluded,

    commute: { address: commute.address, mode: commute.mode, max_minutes: commute.max_minutes },
    radius_miles: commute.radius_miles,
    include_nearby_areas: commute.include_nearby_areas,

    timeframe: timeframe.timeframe,
    sort_by: sortOf(signals),
    // Price is excluded on purpose: it is already carried structurally in
    // `price_min`/`price_max`, and a keyword search for "$1M" matches listing prose,
    // not listing prices. Everything else appears in the order the user typed it.
    raw_keywords: mergeKeywords(
      rooms.keywords,
      location.keywords,
      propertyType.keywords,
      listing.keywords,
      home.keywords,
      commute.keywords,
      amenities.keywords,
      timeframe.keywords,
    ),
  };

  const sources = baselineSources(mode);

  // Jev fills the closed-set filters the text left empty. It never overwrites one the
  // text stated: "townhome" is not a probabilistic question, and deferring to the model
  // where the text is explicit would make the output less predictable for no gain. Each
  // gap it fills is recorded in `sources`, so the panel shows which half decided what.
  // `wantsNewConstruction` is a *core* question, asked in both modes, and what it means is
  // a listing type rather than an amenity — the filter panel has it under "Type", next to
  // foreclosures. Applied here rather than inside `listing.ts` so that parser stays purely
  // literal and every model overlay is visible in one place.
  if (signals && on(signals.wantsNewConstruction) && !query.listing_types.includes("new-construction")) {
    query.listing_types.push("new-construction");
    if (query.listing_types.length === 1) sources.listing_types = "jev";
  }

  if (extended) applyExtended(query, extended, sources, signals);

  // The overlays above push; the vocabulary decides the order. Without this a list Jev
  // contributed to would order by question declaration, and two equivalent queries would
  // stop comparing equal — which is the one property these arrays are supposed to have.
  query.listing_types = LISTING_TYPES.filter((t) => query.listing_types.includes(t));
  query.tours = TOURS.filter((t) => query.tours.includes(t));

  // Everything still empty came from nobody. Distinguished from `parser`/`jev` because
  // "asked and got nothing" and "never asked" are different bugs.
  for (const [field, value] of Object.entries(flatten(query))) {
    if (isEmpty(value) && sources[field] !== undefined) sources[field] = "none";
  }

  return { query, sources, mode };
}

/**
 * The original entry point, unchanged in behaviour for the default mode.
 *
 * Kept because most callers want the query and not the provenance, and because every
 * existing test is written against this signature — a provenance map is a debugging
 * affordance and should not have become everyone's problem.
 */
export function buildSearchQuery(text: string, result?: IntentResult, mode?: ExtractionMode): SearchQuery {
  return extract(text, result, mode).query;
}

// ─────────────────────────────────────────────────────────────
// The Jev half
// ─────────────────────────────────────────────────────────────

/**
 * `intent` is Jev's call and nothing else's — it is the one field that is a reading of
 * what the person wants rather than a fact about the string. An unclassified query gets
 * "" rather than a guessed "buy".
 */
function intentOf(result: IntentResult | undefined): string {
  if (!result) return "";
  return result.intent.value === "none" ? "" : result.intent.value;
}

/** Also Jev's call, gated: a weakly-held ordering preference is no preference. */
function sortOf(signals: Signals | undefined): string {
  if (!signals) return "";
  const { sortPreference } = signals;
  if (sortPreference.value === "unspecified") return "";
  return sortPreference.confidence >= SIGNAL_THRESHOLDS.choiceMin ? sortPreference.value : "";
}

/** Feature tags implied by the extended nouls, for `parseAmenities` to merge and order. */
function inferredFeatureTags(extended: ExtendedAnswers): string[] {
  return FEATURE_NOULS.filter((n) => on(extended.nouls[n.key])).map((n) => n.tag);
}

const on = (value: number | undefined) => typeof value === "number" && value >= SIGNAL_THRESHOLDS.noulOn;

/**
 * A gated choice answer, or `undefined`.
 *
 * Three ways to get nothing, and all three matter: the question was not answered, the
 * answer was its own escape option ("any"), or the confidence was below the bar. A
 * low-confidence guess at "condo" is worse than no home-type filter, because it hides
 * every house the person would have looked at.
 */
function pickChoice(extended: ExtendedAnswers, key: ExtendedChoiceKey): string | undefined {
  const answer = extended.choices[key];
  if (!answer) return undefined;
  if (answer.value === CHOICE_ESCAPE[key]) return undefined;
  if (!choiceOptions(key).includes(answer.value)) return undefined;
  if (answer.confidence < SIGNAL_THRESHOLDS.choiceMin) return undefined;
  return answer.value;
}

/** The filter panel's bed/bath/garage bucket labels, as the numbers the filter actually carries. */
function bucketToNumber(label: string): number | null {
  if (label === "studio") return 0;
  const n = Number(label);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

function applyExtended(
  query: SearchQuery,
  extended: ExtendedAnswers,
  sources: FieldSources,
  signals: Signals | undefined,
) {
  const note = (field: string, source: FieldSource) => {
    sources[field] = source;
  };

  // ── Single-valued closed sets ───────────────────────────────
  const homeType = pickChoice(extended, "homeType");
  if (!query.property_type.length && homeType && (PROPERTY_TYPES as readonly string[]).includes(homeType)) {
    query.property_type = [homeType];
    note("property_type", "jev");
  } else if (query.property_type.length) {
    note("property_type", "parser");
  }

  assignString(query, "listing_status", pickChoice(extended, "listingStatus"), sources);
  assignString(query, "sale_status", pickChoice(extended, "saleRecency"), sources);
  assignString(query, "stories", pickChoice(extended, "stories"), sources);

  const commuteMode = pickChoice(extended, "commuteMode");
  if (!query.commute.mode && commuteMode) {
    query.commute.mode = commuteMode;
    note("commute.mode", "jev");
  } else if (query.commute.mode) {
    note("commute.mode", "parser");
  }

  // Cadence is the one place a *core* answer fills a closed field, so it is applied here
  // with the rest rather than hidden inside `price.ts`.
  if (!query.price_cadence && signals) {
    const { priceCadence } = signals;
    if (priceCadence.value !== "unspecified" && priceCadence.confidence >= SIGNAL_THRESHOLDS.choiceMin) {
      query.price_cadence = priceCadence.value;
      note("price_cadence", "jev");
    }
  } else if (query.price_cadence) {
    note("price_cadence", "parser");
  }

  // ── Buckets ─────────────────────────────────────────────────
  assignBucket(query, "beds_min", pickChoice(extended, "bedsBucket"), sources);
  assignBucket(query, "baths_min", pickChoice(extended, "bathsBucket"), sources);
  assignBucket(query, "garage_min", pickChoice(extended, "garageSize"), sources);

  // ── Multi-valued lists ──────────────────────────────────────
  for (const { key, field, value } of LISTING_TAG_NOULS) {
    if (!on(extended.nouls[key])) continue;
    const list = query[field];
    if (!list.includes(value)) {
      list.push(value);
      // The parser may have contributed other entries to the same list, so the field is
      // marked `jev` only when Jev is the reason there is anything in it at all.
      if (list.length === 1) note(field, "jev");
    }
  }

  for (const { key, field } of LISTING_FLAG_NOULS) {
    if (!query[field] && on(extended.nouls[key])) {
      query[field] = true;
      note(field, "jev");
    } else if (query[field]) {
      note(field, "parser");
    }
  }

  // `amenities` was assembled with the inferred tags already merged in, so there is
  // nothing to apply — only the provenance to record, and only when Jev is the whole
  // reason the list is non-empty.
  if (query.amenities.length && FEATURE_NOULS.every((n) => !on(extended.nouls[n.key]))) {
    note("amenities", "parser");
  }
}

/** Fill a `""`-defaulted string field from Jev, and record who won. */
function assignString(
  query: SearchQuery,
  field: "listing_status" | "sale_status" | "stories",
  value: string | undefined,
  sources: FieldSources,
) {
  if (query[field]) {
    sources[field] = "parser";
    return;
  }
  if (value === undefined) return;
  query[field] = value;
  sources[field] = "jev";
}

function assignBucket(
  query: SearchQuery,
  field: "beds_min" | "baths_min" | "garage_min",
  label: string | undefined,
  sources: FieldSources,
) {
  if (query[field] !== null) {
    sources[field] = "parser";
    return;
  }
  if (label === undefined) return;
  const n = bucketToNumber(label);
  if (n === null) return;
  query[field] = n;
  sources[field] = "jev";
}

// ─────────────────────────────────────────────────────────────
// Provenance bookkeeping
// ─────────────────────────────────────────────────────────────

/** `{ location: { city } }` -> `{ "location.city": ... }`, to match the field registry's keys. */
function flatten(query: SearchQuery): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(query)) {
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      for (const [inner, v] of Object.entries(value as Record<string, unknown>)) out[`${key}.${inner}`] = v;
    } else {
      out[key] = value;
    }
  }
  return out;
}

const isEmpty = (v: unknown) =>
  v === null || v === "" || v === false || (Array.isArray(v) && v.length === 0);

/**
 * Is this query worth running? A search with nothing but an intent matches the whole
 * market, so the UI keeps the submit button off until at least one real filter exists.
 *
 * Driven off `emptySearchQuery()` rather than a hand-written list of fields: the list
 * went stale the first time a filter was added, leaving the button dark for a query that
 * had a perfectly good lot-size constraint on it.
 */
export function hasFilters(q: SearchQuery): boolean {
  const empty = flatten(emptySearchQuery());
  const actual = flatten(q);
  for (const [field, value] of Object.entries(actual)) {
    // Not filters: `intent` chooses the card, `sort_by` the ordering, `raw_keywords`
    // restates what the other fields already say, and `timeframe` is when the person
    // wants to move — a date on its own still matches every home on the market.
    if (field === "intent" || field === "sort_by" || field === "raw_keywords" || field === "timeframe") continue;
    if (JSON.stringify(value) !== JSON.stringify(empty[field])) return true;
  }
  return false;
}
