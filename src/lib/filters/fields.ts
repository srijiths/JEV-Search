import type { ExtractionMode, FieldSource } from "../extraction";

/**
 * Every filter the app can produce, and who is allowed to produce it.
 *
 * This table exists because the answer to "where did this value come from" was previously
 * spread across eight parsers, one question file and a README paragraph, and those three
 * drift. It is the single source of truth: the debug panel renders from it, the README
 * table is generated from it, and `fields.test.ts` fails if a `SearchQuery` key is missing
 * from it or a listed field does not exist on the query.
 *
 * ## Why `kind` decides the source, and not a per-field flag
 *
 * Jev answers in exactly three shapes — one label from a closed list, a truth
 * probability, or a fractional score on an ordered rubric. None of them can carry a
 * number or a string of free text. So for `price_max` there is nothing to flag: there is
 * no request we could send that would come back with `850000` in it. The mode flag is
 * meaningful only where a field's value is one of a fixed set of labels, which is exactly
 * what `closed` marks.
 */

export const FIELD_KINDS = ["numeric", "bucket", "text", "closed", "judgement"] as const;
export type FieldKind = (typeof FIELD_KINDS)[number];

/**
 * How each kind resolves per mode.
 *
 * `numeric` and `text` are identical in both modes on purpose, and that is the honest
 * shape of the constraint rather than an unfinished feature.
 */
const SOURCES: Record<FieldKind, Record<ExtractionMode, FieldSource>> = {
  // An open quantity. Parser in both modes — Jev cannot return one.
  numeric: { hybrid: "parser", jev: "parser" },
  // A number, but drawn from a fixed list of buckets (Any / Studio / 1 / 2 / 3 / 4 / 5+).
  // The *label* is a closed set, so Jev can pick one and code maps it to the number —
  // which is why the flag moves these and not `numeric`.
  bucket: { hybrid: "parser", jev: "jev" },
  // A place name, address or free-text keyword. Parser in both modes, same reason as numeric.
  text: { hybrid: "parser", jev: "parser" },
  // One or more labels from a fixed list.
  closed: { hybrid: "parser", jev: "jev" },
  // A reading of what the person wants, with no literal in the text to parse. Always Jev.
  judgement: { hybrid: "jev", jev: "jev" },
};

export function sourceFor(kind: FieldKind, mode: ExtractionMode): FieldSource {
  return SOURCES[kind][mode];
}

export type FieldSpec = {
  /** Key on `SearchQuery`. Dotted for nested objects, e.g. `location.city`. */
  field: string;
  /** What the filter panel calls it, so the two can be compared by eye. */
  label: string;
  kind: FieldKind;
  /** Which parser or question owns it. A file name, or `jev:<question>`. */
  owner: string;
};

export const FIELDS: readonly FieldSpec[] = [
  // ── What kind of search ─────────────────────────────────────
  { field: "intent", label: "(which card)", kind: "judgement", owner: "jev:intent" },
  { field: "sort_by", label: "Sort", kind: "judgement", owner: "jev:sortPreference" },

  // ── Price ───────────────────────────────────────────────────
  { field: "price_min", label: "Min price", kind: "numeric", owner: "parse/price.ts" },
  { field: "price_max", label: "Max price", kind: "numeric", owner: "parse/price.ts" },
  { field: "price_cadence", label: "List price / Monthly payment", kind: "closed", owner: "parse/price.ts" },
  { field: "price_reduced", label: "Price reduced", kind: "closed", owner: "parse/listing.ts" },
  { field: "builder_promotions", label: "Builder promotions", kind: "closed", owner: "parse/listing.ts" },

  // ── Rooms ───────────────────────────────────────────────────
  { field: "beds_min", label: "Bedrooms", kind: "bucket", owner: "parse/rooms.ts" },
  { field: "baths_min", label: "Bathrooms", kind: "bucket", owner: "parse/rooms.ts" },

  // ── Home type ───────────────────────────────────────────────
  { field: "property_type", label: "Home type", kind: "closed", owner: "parse/propertyType.ts" },

  // ── Listing details ─────────────────────────────────────────
  { field: "sale_status", label: "For sale / Just sold", kind: "closed", owner: "parse/listing.ts" },
  { field: "listing_status", label: "Status", kind: "closed", owner: "parse/listing.ts" },
  { field: "listing_types", label: "Type", kind: "closed", owner: "parse/listing.ts" },
  { field: "tours", label: "Open houses & tours", kind: "closed", owner: "parse/listing.ts" },
  { field: "days_on_market", label: "Days on market", kind: "numeric", owner: "parse/listing.ts" },

  // ── Home details ────────────────────────────────────────────
  { field: "sqft_min", label: "Square feet (min)", kind: "numeric", owner: "parse/rooms.ts" },
  { field: "sqft_max", label: "Square feet (max)", kind: "numeric", owner: "parse/rooms.ts" },
  { field: "lot_size_min", label: "Lot size (min)", kind: "numeric", owner: "parse/home.ts" },
  { field: "lot_size_max", label: "Lot size (max)", kind: "numeric", owner: "parse/home.ts" },
  { field: "home_age_min", label: "Home age (min)", kind: "numeric", owner: "parse/home.ts" },
  { field: "home_age_max", label: "Home age (max)", kind: "numeric", owner: "parse/home.ts" },
  { field: "hoa_max", label: "Max HOA fees per month", kind: "numeric", owner: "parse/home.ts" },
  { field: "garage_min", label: "Garage", kind: "bucket", owner: "parse/home.ts" },
  { field: "stories", label: "Stories", kind: "closed", owner: "parse/home.ts" },

  // ── Home features ───────────────────────────────────────────
  { field: "amenities", label: "Interior / exterior / views / community", kind: "closed", owner: "parse/amenities.ts" },
  { field: "excluded", label: "(ruled out)", kind: "closed", owner: "parse/amenities.ts" },
  { field: "raw_keywords", label: "Keyword search", kind: "text", owner: "parse/query.ts" },

  // ── Location, commute, expanded search ──────────────────────
  { field: "location.city", label: "Location", kind: "text", owner: "parse/location.ts" },
  { field: "location.state", label: "Location", kind: "text", owner: "parse/location.ts" },
  { field: "location.zipcode", label: "Location", kind: "text", owner: "parse/location.ts" },
  { field: "commute.address", label: "Enter an address", kind: "text", owner: "parse/commute.ts" },
  { field: "commute.mode", label: "Driving / Walking / Cycling / Transit", kind: "closed", owner: "parse/commute.ts" },
  { field: "commute.max_minutes", label: "Max driving time", kind: "numeric", owner: "parse/commute.ts" },
  { field: "radius_miles", label: "Search by mile radius", kind: "numeric", owner: "parse/commute.ts" },
  { field: "include_nearby_areas", label: "Search by nearby areas", kind: "closed", owner: "parse/commute.ts" },

  // ── Timeframe (not a filter-panel field; drives the cards) ──────
  // An ISO date string, so `text` rather than `numeric` — the distinction does not change
  // the source (both are parser-only in both modes) but the panel shows the kind.
  { field: "timeframe", label: "(move-in date)", kind: "text", owner: "parse/timeframe.ts" },
] as const;

/** Fields the mode flag actually moves — the answer to "what does `jev` mode buy me". */
export const SWITCHABLE_FIELDS = FIELDS.filter((f) => f.kind === "closed" || f.kind === "bucket");

const BY_FIELD = new Map(FIELDS.map((f) => [f.field, f]));

export function specFor(field: string): FieldSpec | undefined {
  return BY_FIELD.get(field);
}

/**
 * The provenance map for a mode, before any extraction runs.
 *
 * Every field starts at the source its kind assigns it. The extractor downgrades to
 * `none` whatever came out empty, so the panel distinguishes "Jev was asked and said no"
 * from "nobody could tell" — which are different bugs.
 */
export function baselineSources(mode: ExtractionMode): Record<string, FieldSource> {
  const out: Record<string, FieldSource> = {};
  for (const f of FIELDS) out[f.field] = sourceFor(f.kind, mode);
  return out;
}
