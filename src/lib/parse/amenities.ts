import { kw, type Keyword } from "./common";
import type { Signals } from "../jev/types";
import { SIGNAL_THRESHOLDS } from "../signals";

/**
 * Feature tags — the Interior, Exterior, Views and Community checkboxes of a listings
 * filter panel, plus its quick filters, in one flat vocabulary.
 *
 * One list rather than four, because the grouping is a property of the *panel* and not of
 * the filter: "pool" appears under both Exterior and Community there, and a backend
 * receiving `amenities: ["pool"]` does not care which box was ticked. `FEATURE_GROUPS`
 * below records the grouping for the UI, so the split exists where it is needed and
 * nowhere else.
 *
 * This is the one parser that reads Jev's answers, and the split is worth being precise
 * about:
 *
 *   - The **tag** always comes from the trigger table. A tag is a filter value, and a
 *     filter value invented by a model is a filter that silently matches nothing.
 *   - Jev's `wants*` nouls can only *add* a tag the table already knows about, for
 *     phrasings the table has no literal for ("somewhere the dog can run" -> pet-friendly).
 *   - Jev's `hasNegation` noul is never used to remove a tag. Negation scope is a
 *     per-phrase question and `hasNegation` is a whole-text answer, so "pets ok but
 *     no garage" would strip the wrong tag. Negation is handled literally below.
 */

/**
 * Canonical tag -> the phrasings that mean it.
 *
 * Where a pattern has a capture group, that group is the keyword; otherwise the whole
 * match is. This is what keeps `raw_keywords` reading like the user's own words: "pets
 * ok" contributes "pets", because "ok" is grammar, not a search term.
 *
 * Deliberately absent: a `garage` tag. Garage count is its own filter with its own
 * buckets (`garage_min`, in `home.ts`), and emitting both would have a backend filter
 * twice on one word. `carport` stays, because the filter panel lists it as a feature and it
 * carries no count.
 */
const TRIGGERS: Array<[string, RegExp]> = [
  // ── Outdoor space ───────────────────────────────────────────
  ["backyard", /\b(?:back\s?yard|backyard|fenced yard|yards?)\b/i],
  ["garden", /\bgardens?\b/i],
  ["patio", /\b(?:patios?|decks?)\b/i],
  ["balcony", /\b(?:balcon(?:y|ies)|terraces?)\b/i],
  ["pool", /\b(?:pools?|swimming pool)\b/i],
  ["spa", /\b(?:spas?|hot tubs?|jacuzzis?)\b/i],
  ["pond", /\bponds?\b/i],

  // ── Parking (other than the garage count) ───────────────────
  ["carport", /\bcarports?\b/i],
  ["parking", /\b(?:parking|driveways?|off[-\s]?street parking)\b/i],
  ["rv-boat-parking", /\b(?:rv\/?boat parking|rv parking|boat parking|room for (?:an? )?(?:rv|boat|camper|trailer))\b/i],

  // ── Lifestyle ───────────────────────────────────────────────
  ["pet-friendly", /\b(pets?|dogs?|cats?)\b(?:\s*(?:ok|okay|allowed|friendly|welcome))?|\bpet[-\s]?friendly\b/i],
  ["furnished", /\bfurnished\b/i],
  ["gated", /\b(?:gated(?: communit(?:y|ies))?|guard(?:ed)? gate|private entrance)\b/i],
  ["security", /\b(?:security systems?|alarm systems?|security features?|24\/?7 security)\b/i],

  // ── Interior ────────────────────────────────────────────────
  ["accessibility", /\b(?:wheelchair(?: accessible)?|accessib(?:le|ility)|ada[-\s]?compliant|grab bars?|roll[-\s]?in shower)\b/i],
  ["basement", /\b(?:basements?|cellars?|lower level)\b/i],
  // No bare "ac": on land listings it is the abbreviation for acres ("1 ac lot").
  ["air-conditioning", /\b(?:air[-\s]?conditioning|central air|aircon)\b|\ba\/c\b/i],
  ["central-heating", /\b(?:central heat\w*|forced air)\b/i],
  ["den-office", /\b(?:dens?|home offices?|offices?|stud(?:y|ies)|work[-\s]?from[-\s]?home space)\b/i],
  ["dining-room", /\b(?:dining rooms?|formal dining)\b/i],
  ["family-room", /\b(?:family rooms?|great rooms?|dens? and family rooms?)\b/i],
  ["game-room", /\b(?:game rooms?|bonus rooms?|rec rooms?|media rooms?)\b/i],
  ["elevator", /\b(?:elevators?|lifts?)\b/i],
  ["energy-efficient", /\b(?:energy[-\s]?efficient|energy efficiency|low energy bills?|double[-\s]?glaz\w+|well insulated)\b/i],
  ["fireplace", /\b(?:fireplaces?|wood stoves?|hearths?)\b/i],
  ["hardwood-floors", /\b(?:hardwood|wood floors?)\b/i],
  ["in-unit-laundry", /\b(?:in[-\s]?unit laundry|in[-\s]?home laundry|washer(?:\s?\/?\s?(?:and|&)?\s?dryer)?|w\/?d\b|laundry)\b/i],
  ["dishwasher", /\bdishwashers?\b/i],
  ["walk-in-closet", /\bwalk[-\s]?in closets?\b/i],
  ["open-floor-plan", /\bopen (?:floor ?plan|concept|plan)\b/i],
  ["updated-kitchen", /\b(?:updated|renovated|remodeled|modern|new) kitchen\b/i],

  // ── Lot ─────────────────────────────────────────────────────
  ["corner-lot", /\bcorner lots?\b/i],
  ["cul-de-sac", /\bcul[-\s]?de[-\s]?sacs?\b/i],
  ["horse-facility", /\b(?:horse (?:facilit(?:y|ies)|propert(?:y|ies))|stables?|equestrian|paddocks?|barns?)\b/i],

  // ── Views. Specific first; the generic tag is dropped below when one of these fires ──
  ["waterfront", /\b(?:waterfront|lakefront|beachfront|oceanfront|on the water|docks?)\b/i],
  ["city-view", /\b(?:city|skyline|downtown)\s+views?\b/i],
  ["ocean-view", /\b(?:ocean|sea|beach)\s+views?\b/i],
  ["lake-view", /\b(?:lake|bay)\s+views?\b/i],
  ["river-view", /\b(?:river|creek)\s+views?\b/i],
  ["hill-view", /\b(?:hill|mountain|mtn|valley)\s+views?\b/i],
  ["golf-course-view", /\b(?:golf(?: course)?)\s+views?\b/i],
  // Singular "view" needs a descriptor, because on its own it is usually the verb:
  // "I want to view homes in Cupertino" is not a request for a scenic outlook. "with a view"
  // is the exception — the preposition settles it — so it is matched with the noun alone
  // captured, keeping "with" out of the keyword a listing search would run.
  ["view", /\b(?:(?:water|park|scenic)\s+views?|views|with\s+(?:an?\s+)?(view)\b)/i],

  // ── Community ───────────────────────────────────────────────
  ["golf-course", /\b(?:golf courses?|on the (?:golf )?fairway|country clubs?|golf communit(?:y|ies))\b/i],
  ["clubhouse", /\b(?:club\s?houses?|community cent(?:er|re)s?|recreation facilit(?:y|ies)|rec cent(?:er|re)s?)\b/i],
  ["tennis-court", /\b(?:tennis courts?|pickleball courts?)\b/i],
  ["boat-facility", /\b(?:boat (?:facilit(?:y|ies)|slips?|ramps?)|marinas?|boat launch)\b/i],
  ["gym", /\b(?:gyms?|fitness cent(?:er|re)s?|workout rooms?)\b/i],
  ["doorman", /\b(?:doorman|concierge)\b/i],
  // A bare "park" is a place name as often as an amenity ("Park Slope"), so it needs a
  // word that makes it a facility rather than a neighbourhood.
  ["park", /\b(?:near (?:a |the )?parks?|parks? nearby|community parks?|playgrounds?|walking trails?)\b/i],

  // ── Misc ────────────────────────────────────────────────────
  // Deliberately absent, for the same reason `garage` is: each is now a field of its own,
  // and a tag saying the same thing would have a listing filtered twice on one constraint.
  //   new construction -> `listing_types: ["new-construction"]` (parse/listing.ts)
  //   no HOA           -> `hoa_max: 0`                          (parse/home.ts)
  // Both keep their keyword, so a text search still sees the user's words.
  ["solar", /\bsolar(?: panels?)?\b/i],
  ["ev-charging", /\b(?:ev charg\w*|charging station|tesla charger)\b/i],
];

/** Every tag the table can produce. The extended question set is checked against this. */
export const FEATURE_TAGS: readonly string[] = TRIGGERS.map(([tag]) => tag);

/**
 * Which section of the filter panel each tag belongs under. For rendering only — the
 * filter value does not change with the grouping. Tags with no entry are quick filters.
 */
export const FEATURE_GROUPS: Record<string, "interior" | "exterior" | "view" | "community"> = {
  accessibility: "interior",
  basement: "interior",
  "air-conditioning": "interior",
  "central-heating": "interior",
  "den-office": "interior",
  "dining-room": "interior",
  "family-room": "interior",
  "game-room": "interior",
  elevator: "interior",
  "energy-efficient": "interior",
  fireplace: "interior",
  "hardwood-floors": "interior",
  "in-unit-laundry": "interior",
  dishwasher: "interior",
  "walk-in-closet": "interior",
  "open-floor-plan": "interior",
  "updated-kitchen": "interior",

  carport: "exterior",
  "corner-lot": "exterior",
  "cul-de-sac": "exterior",
  "horse-facility": "exterior",
  pool: "exterior",
  "rv-boat-parking": "exterior",
  spa: "exterior",
  backyard: "exterior",
  garden: "exterior",
  patio: "exterior",
  balcony: "exterior",
  pond: "exterior",
  solar: "exterior",
  "ev-charging": "exterior",

  "city-view": "view",
  "golf-course-view": "view",
  "hill-view": "view",
  "lake-view": "view",
  "ocean-view": "view",
  "river-view": "view",
  waterfront: "view",
  view: "view",

  "boat-facility": "community",
  clubhouse: "community",
  "golf-course": "community",
  park: "community",
  security: "community",
  "tennis-court": "community",
  gym: "community",
  doorman: "community",
  gated: "community",
};

/**
 * Jev noul -> the tag it may add. Only signals whose meaning is a single tag appear
 * here; `wantsOutdoorSpace` is deliberately absent because it spans backyard, patio,
 * balcony and garden, and picking one of four on the user's behalf is a guess.
 *
 * These four are from the *core* question set, so they apply in both modes. The larger
 * feature set in `src/lib/jev/extended.ts` is asked only in `jev` mode and arrives here
 * through `extraTags`.
 */
const SIGNAL_TAGS: Array<[keyof Signals, string]> = [
  ["wantsPetFriendly", "pet-friendly"],
  ["wantsParking", "parking"],
  ["wantsFurnished", "furnished"],
  // `wantsNewConstruction` is not here: what it means is a listing type, not a feature, so
  // `query.ts` folds it into `listing_types` — in both modes, since it is a core question.
];

/** Words that, sitting immediately before a trigger, invert it. */
const NEGATORS = /\b(?:no|not|non|without|avoid|excluding|except|don'?t (?:want|need)|doesn'?t need)\s+(?:a |an |the )?$/i;

/** The specific view tags. When one of these fires, the generic `view` tag is redundant. */
const SPECIFIC_VIEWS = FEATURE_TAGS.filter((t) => t.endsWith("-view"));

export type AmenitiesHit = {
  amenities: string[];
  keywords: Keyword[];
  /** Tags the text explicitly ruled out, e.g. "no garage". Rendered as exclusions. */
  excluded: string[];
};

/**
 * `extraTags` are tags inferred elsewhere — in practice the extended feature nouls in
 * `jev` mode. They are merged here rather than at the call site so that one place owns
 * exclusion handling and tag ordering, and an inferred tag can never contradict an
 * explicit "no pool".
 */
export function parseAmenities(text: string, signals?: Signals, extraTags: readonly string[] = []): AmenitiesHit {
  const hits = new Map<string, Keyword>();
  const excluded = new Set<string>();

  for (const [tag, re] of TRIGGERS) {
    const m = new RegExp(re.source, "i").exec(text);
    if (!m) continue;
    if (NEGATORS.test(text.slice(Math.max(0, m.index - 24), m.index))) {
      excluded.add(tag);
      continue;
    }
    const surface = (m[1] ?? m[0]).trim();
    hits.set(tag, kw(surface, m.index + m[0].indexOf(surface)));
  }

  // Jev fills gaps the literal table missed, but never overrides an explicit exclusion.
  // `at: text.length` parks inferred tags at the end of the keyword order: they have no
  // span in the text, and pretending they start at 0 would reorder keywords the user
  // can actually see.
  const infer = (tag: string) => {
    if (hits.has(tag) || excluded.has(tag)) return;
    hits.set(tag, kw(tag, text.length));
  };

  if (signals) {
    for (const [signal, tag] of SIGNAL_TAGS) {
      const value = signals[signal];
      if (typeof value !== "number" || value < SIGNAL_THRESHOLDS.noulOn) continue;
      infer(tag);
    }
  }

  for (const tag of extraTags) {
    // An unknown tag here would be a filter value no listing carries, so it is dropped
    // rather than passed through. The sync test in `extended.test.ts` stops it happening.
    if (FEATURE_TAGS.includes(tag)) infer(tag);
  }

  // "ocean views" matches both `ocean-view` and the generic `view`. Keep the specific one.
  if (SPECIFIC_VIEWS.some((t) => hits.has(t))) hits.delete("view");

  // Tag order follows the trigger table so two equivalent queries compare equal.
  const amenities = FEATURE_TAGS.filter((tag) => hits.has(tag));
  const keywords = amenities.map((tag) => hits.get(tag)!);

  return { amenities, keywords, excluded: [...excluded] };
}

/** "backyard" -> "Backyard", "pet-friendly" -> "Pet friendly" — the label a chip shows. */
export function formatAmenity(tag: string): string {
  const words = tag.replace(/-/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}
