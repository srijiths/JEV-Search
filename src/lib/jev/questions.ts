import { choice, noul, score } from "./schema";

/**
 * The full Jev question schema for real-estate search.
 *
 * Jev evaluates every question in parallel against the same state, so we ask every
 * signal on every keystroke (speculative fan-out) and let code decide which ones
 * matter for the chosen intent.
 *
 * Criteria rules, which follow from how Jev evaluates a question:
 *   - self-contained: a question never refers to another question's answer
 *   - non-overlapping: options are mutually exclusive
 *   - every signal has an escape option ("unspecified" / "any" / "none")
 *   - never ask Jev to extract values, count, or do math
 *
 * "Jev decides, code computes." Jev says *this is a rental search with a hard ceiling
 * and a pet requirement*; `src/lib/parse/` is what turns "budget 3k" into 3000.
 *
 * The `noul` questions all carry explicit true/false criteria. They are optional on
 * the wire, but spelling out both poles is what keeps a partially-typed query from
 * drifting — without them "no yard" and "big yard" both look yard-ish.
 */
export const questions = {
  // ── Which search UI ─────────────────────────────────────────
  intent: choice("What is the person trying to do with this real-estate text", {
    buy: "Looking for a home to purchase or own",
    rent: "Looking for a place to rent or lease, or a roommate situation",
    sold: "Asking about homes that already sold, recent sale prices or comparable sales",
    mortgage: "Working out affordability, a monthly payment, a down payment or loan numbers",
    valuation: "Asking what a specific property they refer to is worth or would sell for",
    commute: "Searching by travel time or distance to a place of work, school or transit",
    agent: "Looking for a real-estate agent, realtor, broker or property manager",
    none: "Too short, unclear or unfinished to tell yet",
  }),

  readiness: score("How complete is this input as a property search", [
    "Just started, no location or property details yet",
    "Partially specified, some criteria present",
    "Fully specified, ready to run as a search",
  ]),

  // ── How to read the money in the text ───────────────────────
  priceBound: choice("How the money amount in the text constrains the price", {
    maximum: "An upper limit: under, below, up to, less than, at most, a budget or a max",
    minimum: "A lower limit: over, above, starting at, at least, from, a minimum",
    range: "Both ends are given, such as between two amounts or one amount to another",
    around: "An approximate target: about, around, roughly, near, in the region of",
    none: "No money amount, or the amount is not a price constraint",
  }),

  priceCadence: choice("Whether the money amount is a one-off price or a recurring payment", {
    total: "A whole purchase price or sale price",
    monthly: "A per-month rent, payment or instalment",
    unspecified: "No money amount, or it is unclear which",
  }),

  // ── Search shape ────────────────────────────────────────────
  sortPreference: choice("How the person wants results ordered", {
    price_asc: "Cheapest, lowest price or best value first",
    price_desc: "Most expensive, highest end or luxury first",
    newest: "Newest listings, just listed or most recently added first",
    largest: "Biggest, most space or most square footage first",
    unspecified: "No ordering preference expressed",
  }),

  urgency: score("How urgently the person needs to move or act", [
    "No time pressure, browsing",
    "Has a timeframe in mind",
    "Needs it immediately, moving now",
  ]),

  // ── Requirement signals (noul: 0..1 truth probability) ──────
  wantsNewConstruction: noul("The person specifically wants a newly built or new-construction home", {
    true: "Asks for new construction, newly built, brand new, or a recent build year",
    false: "No preference stated about the age of the building, or wants an older or historic home",
  }),

  wantsOutdoorSpace: noul("The person wants private outdoor space such as a yard, garden, patio, balcony or terrace", {
    true: "Asks for a yard, backyard, garden, patio, balcony, terrace, deck or outdoor space",
    false: "No outdoor space mentioned, or explicitly does not want one",
  }),

  wantsParking: noul("The person wants parking, a garage, a carport or a driveway", {
    true: "Asks for a garage, parking space, carport, driveway or off-street parking",
    false: "No parking mentioned, or explicitly does not need parking",
  }),

  wantsPetFriendly: noul("The person needs the place to allow pets, or mentions having a pet", {
    true: "Says pets ok, pet friendly, dog or cat allowed, or mentions owning a pet that must be housed",
    false: "No pets mentioned, or explicitly wants a place with no pets",
  }),

  wantsFurnished: noul("The person wants the place to come furnished", {
    true: "Asks for furnished, fully furnished, or move-in with furniture included",
    false: "No mention of furniture, or explicitly wants unfurnished",
  }),

  wantsLuxury: noul("The person is describing a high-end, luxury or premium property", {
    true: "Uses words like luxury, high-end, premium, upscale, executive, penthouse or estate",
    false: "No quality tier mentioned, or is looking for affordable, budget or starter homes",
  }),

  wantsInvestment: noul("The person is buying to rent out or as an investment rather than to live in", {
    true: "Mentions investment, rental income, cash flow, cap rate, ROI or a rental portfolio",
    false: "Buying or renting a home to live in themselves, or purpose not stated",
  }),

  isFamilyOriented: noul("The person mentions family, children, schools or needing room for kids", {
    true: "Mentions family, kids, children, schools, a school district, or a nursery",
    false: "No mention of family or children",
  }),

  isQuestion: noul("The text is a question rather than a search or an instruction", {
    true: "Phrased as a question asking for information, such as how much, what is or can I",
    false: "Phrased as a search, a list of criteria, or an instruction to find something",
  }),

  hasNegation: noul("The text rules something out, such as no HOA, not a condo or without stairs", {
    true: "Contains an exclusion: no, not, without, avoid, excluding or anything but",
    false: "Only states what is wanted, with nothing ruled out",
  }),

  isAddressLookup: noul("The text names one specific street address rather than describing a search", {
    true: "Contains a street number and street name identifying a single property",
    false: "Describes a category of properties, or names only a city, neighbourhood or zipcode",
  }),
} as const;

export const QUESTION_COUNT = Object.keys(questions).length;

/**
 * Jev bills per prompt token and the question schema is resent on every keystroke,
 * so the schema itself is the dominant cost. Exported for the debug HUD.
 */
export const QUESTION_SCHEMA_CHARS = JSON.stringify(questions).length;
