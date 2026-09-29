import { choice, noul, type NoulQuestion, type Question } from "./schema";

/**
 * The extra questions sent only in `mode: "jev"`.
 *
 * These cover the *closed-set* half of the filter panel — home type, listing status,
 * stories, garage size, the listing-detail toggles and the feature checkboxes. Every one
 * of them is a question with a fixed answer set, which is the only kind Jev can answer.
 *
 * They are kept out of `questions.ts` and out of the default request on purpose. In
 * `hybrid` mode these filters come from the trigger tables in `src/lib/parse/`, which are
 * exact for literal mentions, so sending 34 more questions per keystroke would cost real
 * money to re-derive things the text already says outright. Asking Jev whether "Golf
 * course view" is wanted is pure spend: those words are either in the query or they are not.
 *
 * Where a model earns its keep here is the *implied* requirement — "room for the boat"
 * meaning RV/boat parking, "somewhere my parents can visit" meaning accessibility. That is
 * what this set is for, and what the mode flag lets you measure.
 *
 * Option keys are deliberately identical to the field values they produce, so nothing has
 * to maintain a label -> value mapping that could drift.
 */

// ─────────────────────────────────────────────────────────────
// Choice questions — one value out of a fixed list
// ─────────────────────────────────────────────────────────────

export const EXTENDED_CHOICES = {
  homeType: choice("Which kind of building or property the person is looking for", {
    house: "A detached single-family house",
    condo: "A condominium or a unit in a larger building",
    townhouse: "A townhouse, townhome or row house",
    "multi-family": "A duplex, triplex or multi-unit building",
    mobile: "A mobile or manufactured home",
    land: "Vacant land, a lot or acreage with no home",
    farm: "A farm, ranch or agricultural property",
    apartment: "An apartment, specifically as a rental unit",
    any: "No particular kind of property stated",
  }),

  listingStatus: choice("What listing status the person wants to see", {
    active: "Only homes currently available and actively for sale",
    pending: "Homes under contract, pending or contingent",
    any: "No status preference stated",
  }),

  saleRecency: choice("Whether the person wants homes on the market or homes already sold", {
    for_sale: "Homes currently on the market",
    just_sold: "Homes that have already sold, or recent sale prices",
    any: "Not stated",
  }),

  stories: choice("How many floors the person wants the home to have", {
    single: "A single-storey, one-level or ranch home, or no stairs",
    multi: "Two or more storeys, or a multi-level home",
    any: "No preference about the number of floors",
  }),

  garageSize: choice("How many garage or covered parking spaces the person needs", {
    "1": "One space, or a garage with no number given",
    "2": "Two spaces, or a double garage",
    "3": "Three or more spaces",
    none: "No garage or covered parking mentioned",
  }),

  commuteMode: choice("How the person expects to travel to the place they mention", {
    driving: "By car, driving or a drive time",
    walking: "On foot, walking distance",
    cycling: "By bicycle or cycling",
    transit: "By public transport, train, subway, bus or transit",
    none: "No travel to a named place is mentioned",
  }),

  bedsBucket: choice("How many bedrooms the person needs", {
    studio: "A studio, with no separate bedroom",
    "1": "One bedroom",
    "2": "Two bedrooms",
    "3": "Three bedrooms",
    "4": "Four bedrooms",
    "5": "Five or more bedrooms",
    any: "No bedroom count stated",
  }),

  bathsBucket: choice("How many bathrooms the person needs", {
    "1": "One bathroom",
    "2": "Two bathrooms",
    "3": "Three bathrooms",
    "4": "Four bathrooms",
    "5": "Five or more bathrooms",
    any: "No bathroom count stated",
  }),
} as const;

export type ExtendedChoiceKey = keyof typeof EXTENDED_CHOICES;

/** Option labels for a choice, for narrowing the answer in `client.ts`. */
export function choiceOptions<K extends ExtendedChoiceKey>(key: K): readonly string[] {
  return Object.keys(EXTENDED_CHOICES[key].criteria);
}

/** The option every choice falls back to when Jev answers outside its own list. */
export const CHOICE_ESCAPE: Record<ExtendedChoiceKey, string> = {
  homeType: "any",
  listingStatus: "any",
  saleRecency: "any",
  stories: "any",
  garageSize: "none",
  commuteMode: "none",
  bedsBucket: "any",
  bathsBucket: "any",
};

// ─────────────────────────────────────────────────────────────
// Noul questions — an independent 0..1 truth probability each
// ─────────────────────────────────────────────────────────────

/**
 * Listing-detail toggles that contribute one entry to a list field.
 *
 * `field` names the `SearchQuery` array this feeds and `value` the entry it adds, so the
 * extractor loops the table instead of carrying a branch per signal.
 */
export const LISTING_TAG_NOULS = [
  {
    key: "wantsForeclosure",
    field: "listing_types",
    value: "foreclosure",
    q: noul("The person wants foreclosures, bank-owned homes or distressed sales", {
      true: "Asks for foreclosures, REO, bank-owned, short sales or distressed property",
      false: "No mention of foreclosure or distressed sales",
    }),
  },
  {
    key: "wants55Plus",
    field: "listing_types",
    value: "55-plus",
    q: noul("The person wants an age-restricted or 55+ community", {
      true: "Mentions 55+, over-55, active adult, retirement or senior community",
      false: "No mention of an age-restricted community",
    }),
  },
  {
    key: "wantsAuction",
    field: "listing_types",
    value: "auction",
    q: noul("The person wants homes sold at auction", {
      true: "Mentions auction, bidding or a courthouse sale",
      false: "No mention of an auction",
    }),
  },
  {
    key: "wantsExistingHome",
    field: "listing_types",
    value: "existing-homes",
    q: noul("The person specifically wants an existing, previously owned home", {
      true: "Asks for an existing, resale, previously owned, older or historic home",
      false: "No preference stated, or wants new construction",
    }),
  },
  {
    key: "wantsOpenHouse",
    field: "tours",
    value: "open-house",
    q: noul("The person wants homes holding an open house", {
      true: "Mentions an open house, or viewing homes in person this weekend",
      false: "No mention of an open house",
    }),
  },
  {
    key: "wants3dTour",
    field: "tours",
    value: "3d-tour",
    q: noul("The person wants a 3D walkthrough of the home", {
      true: "Mentions a 3D tour, 3D walkthrough, Matterport or a virtual walkthrough",
      false: "No mention of a 3D tour",
    }),
  },
  {
    key: "wantsVirtualTour",
    field: "tours",
    value: "virtual-tour",
    q: noul("The person wants to tour the home remotely rather than in person", {
      true: "Mentions a virtual tour, video tour, remote viewing or touring online",
      false: "No mention of touring remotely",
    }),
  },
] as const satisfies readonly { key: string; field: "listing_types" | "tours"; value: string; q: NoulQuestion }[];

/** Listing-detail toggles that set a boolean field rather than adding to a list. */
export const LISTING_FLAG_NOULS = [
  {
    key: "wantsPriceReduced",
    field: "price_reduced",
    q: noul("The person wants homes whose price has been cut", {
      true: "Mentions price reduced, price drop, price cut, reduced or a motivated seller",
      false: "No mention of a price reduction",
    }),
  },
  {
    key: "wantsBuilderPromotion",
    field: "builder_promotions",
    q: noul("The person wants builder incentives or promotions on a new home", {
      true: "Mentions builder incentives, promotions, closing-cost help or rate buy-downs",
      false: "No mention of builder incentives",
    }),
  },
] as const satisfies readonly { key: string; field: "price_reduced" | "builder_promotions"; q: NoulQuestion }[];

/**
 * Feature checkboxes, as one noul each contributing one amenity tag.
 *
 * Curated, not exhaustive: these are the features people routinely *imply* rather than
 * name. The long tail of the panel ("Cul-de-sac", "Golf course view") is left to the
 * trigger table, because a query either contains those words or it does not, and a noul
 * for each would add tokens to every keystroke in exchange for nothing.
 *
 * Every `tag` here must exist in the trigger table in `src/lib/parse/amenities.ts`, so
 * the two modes cannot produce filter values that differ in spelling. A test asserts it —
 * a tag only one of the two modes can emit is a filter that silently matches nothing.
 */
export const FEATURE_NOULS = [
  {
    key: "wantsPool",
    tag: "pool",
    q: noul("The person wants a swimming pool", {
      true: "Asks for a pool, or somewhere to swim or do laps at home",
      false: "No pool mentioned, or explicitly does not want one",
    }),
  },
  {
    key: "wantsWaterfront",
    tag: "waterfront",
    q: noul("The person wants the property to be on the water", {
      true: "Asks for waterfront, lakefront, beachfront, oceanfront, or a dock",
      false: "No mention of being on the water",
    }),
  },
  {
    key: "wantsBasement",
    tag: "basement",
    q: noul("The person wants a basement or cellar", {
      true: "Asks for a basement, cellar, lower level or below-grade space",
      false: "No basement mentioned",
    }),
  },
  {
    key: "wantsGated",
    tag: "gated",
    q: noul("The person wants a gated community or gated entry", {
      true: "Asks for gated, a gated community, or a guarded or private entrance",
      false: "No mention of a gate",
    }),
  },
  {
    key: "wantsView",
    tag: "view",
    q: noul("The person wants a scenic outlook from the property", {
      true: "Asks for a view, an outlook, or to look out over water, hills or a skyline",
      false: "No view mentioned, or 'view' is used as the verb for seeing homes",
    }),
  },
  {
    key: "wantsCentralAir",
    tag: "air-conditioning",
    q: noul("The person wants central air conditioning", {
      true: "Asks for central air, air conditioning, or to stay cool in summer",
      false: "No cooling mentioned",
    }),
  },
  {
    key: "wantsFireplace",
    tag: "fireplace",
    q: noul("The person wants a fireplace", {
      true: "Asks for a fireplace, wood stove or hearth",
      false: "No fireplace mentioned",
    }),
  },
  {
    key: "wantsHomeOffice",
    tag: "den-office",
    q: noul("The person needs a room to work or study in", {
      true: "Asks for an office, den, study, or a room to work from home in",
      false: "No work or study space mentioned",
    }),
  },
  {
    key: "wantsRvBoatParking",
    tag: "rv-boat-parking",
    q: noul("The person needs somewhere to keep an RV, boat or trailer", {
      true: "Mentions an RV, boat, camper, trailer or somewhere to park a large vehicle",
      false: "No large vehicle mentioned",
    }),
  },
  {
    key: "wantsHorseFacility",
    tag: "horse-facility",
    q: noul("The person needs facilities for horses or livestock", {
      true: "Mentions horses, stables, a barn, paddocks, or land for livestock",
      false: "No animals or stabling mentioned",
    }),
  },
  {
    key: "wantsGolfCourse",
    tag: "golf-course",
    q: noul("The person wants a property on or near a golf course", {
      true: "Mentions golf, a golf course, a fairway or a country club",
      false: "No golf mentioned",
    }),
  },
  {
    key: "wantsClubhouse",
    tag: "clubhouse",
    q: noul("The person wants shared community amenities such as a clubhouse", {
      true: "Mentions a clubhouse, community centre, recreation facility or shared amenities",
      false: "No shared community facilities mentioned",
    }),
  },
  {
    key: "wantsAccessibility",
    tag: "accessibility",
    q: noul("The person needs the home to be accessible for limited mobility", {
      true: "Mentions wheelchair access, no stairs, step-free, grab rails, or ageing parents",
      false: "No accessibility need mentioned",
    }),
  },
  {
    key: "wantsEnergyEfficient",
    tag: "energy-efficient",
    q: noul("The person wants an energy-efficient home", {
      true: "Mentions energy efficiency, low bills, insulation, solar or green building",
      false: "No mention of energy use",
    }),
  },
  {
    key: "wantsSpa",
    tag: "spa",
    q: noul("The person wants a spa or hot tub", {
      true: "Mentions a spa, hot tub or jacuzzi",
      false: "No spa or hot tub mentioned",
    }),
  },
  {
    key: "wantsInHomeLaundry",
    tag: "in-unit-laundry",
    q: noul("The person wants laundry inside the home rather than shared", {
      true: "Asks for in-unit laundry, a washer and dryer, or a laundry room",
      false: "No laundry mentioned",
    }),
  },
  {
    key: "wantsElevator",
    tag: "elevator",
    q: noul("The person wants a building with an elevator", {
      true: "Asks for an elevator or a lift, or rules out walking up stairs to the unit",
      false: "No elevator mentioned",
    }),
  },
] as const;

export type ExtendedNoulKey =
  | (typeof LISTING_TAG_NOULS)[number]["key"]
  | (typeof LISTING_FLAG_NOULS)[number]["key"]
  | (typeof FEATURE_NOULS)[number]["key"];

/** Every noul in the extended set, for narrowing the wire answers in one loop. */
export const EXTENDED_NOUL_KEYS: readonly ExtendedNoulKey[] = [
  ...LISTING_TAG_NOULS.map((n) => n.key),
  ...LISTING_FLAG_NOULS.map((n) => n.key),
  ...FEATURE_NOULS.map((n) => n.key),
];

/** Every extra question, assembled for the request. Built fresh so callers cannot mutate it. */
export function extendedQuestions(): Record<string, Question> {
  const out: Record<string, Question> = {};
  for (const [key, q] of Object.entries(EXTENDED_CHOICES)) out[key] = q as Question;
  for (const { key, q } of LISTING_TAG_NOULS) out[key] = q;
  for (const { key, q } of LISTING_FLAG_NOULS) out[key] = q;
  for (const { key, q } of FEATURE_NOULS) out[key] = q;
  return out;
}

export const EXTENDED_QUESTION_COUNT = Object.keys(extendedQuestions()).length;

/**
 * What the extended set costs to send. Jev bills per prompt token and the schema is
 * resent on every keystroke, so this — not the query — is the bill. Exported so the debug
 * HUD can show the two modes side by side rather than leaving the cost of the flag implicit.
 */
export const EXTENDED_SCHEMA_CHARS = JSON.stringify(extendedQuestions()).length;
