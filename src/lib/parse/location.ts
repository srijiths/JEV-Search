import { kw, titleCase, type Keyword, type Span } from "./common";
import type { Location } from "../jev/types";

/**
 * Where the search is. Jev is never asked to extract this — "Cupertino" is a lookup,
 * not a judgement, and a lookup that is wrong is wrong the same way every time,
 * which is the property you want in a filter the user can see.
 */

const STATE_ABBREVS = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California",
  CO: "Colorado", CT: "Connecticut", DE: "Delaware", DC: "District of Columbia",
  FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois",
  IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana",
  ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota",
  MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada",
  NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York",
  NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon",
  PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota",
  TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia",
  WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
} as const;

export type StateAbbrev = keyof typeof STATE_ABBREVS;

const STATE_NAME_TO_ABBREV = new Map<string, StateAbbrev>(
  Object.entries(STATE_ABBREVS).map(([abbrev, name]) => [name.toLowerCase(), abbrev as StateAbbrev]),
);

/**
 * City -> state, for the cities a US property search actually names. Every entry is
 * a claim that this spelling means this state with no further qualification, so
 * ambiguous names resolve to the largest metro: Portland is OR, Springfield is MO,
 * Columbus is OH, Kansas City is MO. Anything else needs an explicit state, and the
 * unqualified-city path below still fires so the city is not simply dropped.
 */
const CITY_STATE: Record<string, StateAbbrev> = {
  // Texas
  austin: "TX", houston: "TX", dallas: "TX", "san antonio": "TX", "fort worth": "TX",
  "el paso": "TX", arlington: "TX", plano: "TX", "corpus christi": "TX", frisco: "TX",
  "round rock": "TX", irving: "TX", mckinney: "TX", lubbock: "TX",
  // California
  "los angeles": "CA", "san francisco": "CA", "san diego": "CA", "san jose": "CA",
  sacramento: "CA", oakland: "CA", fresno: "CA", "long beach": "CA", bakersfield: "CA",
  anaheim: "CA", irvine: "CA", riverside: "CA", "santa monica": "CA", pasadena: "CA",
  berkeley: "CA", "palo alto": "CA", "santa clara": "CA", sunnyvale: "CA",
  "mountain view": "CA", fremont: "CA", "santa barbara": "CA", "san mateo": "CA",
  cupertino: "CA", saratoga: "CA", "los gatos": "CA", campbell: "CA", milpitas: "CA",
  // Northeast
  "new york": "NY", brooklyn: "NY", queens: "NY", manhattan: "NY", bronx: "NY",
  buffalo: "NY", rochester: "NY", yonkers: "NY", albany: "NY", syracuse: "NY",
  boston: "MA", cambridge: "MA", worcester: "MA", somerville: "MA",
  philadelphia: "PA", pittsburgh: "PA", allentown: "PA",
  newark: "NJ", "jersey city": "NJ", hoboken: "NJ", trenton: "NJ", princeton: "NJ",
  hartford: "CT", stamford: "CT", "new haven": "CT", providence: "RI",
  // Mid-Atlantic / South
  // "Washington" on its own is far more often the state, so only the qualified
  // spellings map to DC. Bare "Washington" falls through to the state-only branch.
  "washington dc": "DC", "washington d.c.": "DC",
  baltimore: "MD", "silver spring": "MD", bethesda: "MD",
  richmond: "VA", "virginia beach": "VA", alexandria: "VA", norfolk: "VA",
  charlotte: "NC", raleigh: "NC", durham: "NC", greensboro: "NC", asheville: "NC", cary: "NC",
  charleston: "SC", columbia: "SC", greenville: "SC",
  atlanta: "GA", savannah: "GA", augusta: "GA", athens: "GA",
  miami: "FL", orlando: "FL", tampa: "FL", jacksonville: "FL", "st petersburg": "FL",
  "fort lauderdale": "FL", "west palm beach": "FL", naples: "FL", sarasota: "FL",
  nashville: "TN", memphis: "TN", knoxville: "TN", chattanooga: "TN",
  louisville: "KY", lexington: "KY", birmingham: "AL", huntsville: "AL",
  "new orleans": "LA", "baton rouge": "LA", jackson: "MS", "little rock": "AR",
  // Midwest
  chicago: "IL", naperville: "IL", evanston: "IL", aurora: "IL",
  detroit: "MI", "ann arbor": "MI", "grand rapids": "MI",
  cleveland: "OH", columbus: "OH", cincinnati: "OH", toledo: "OH", dayton: "OH",
  indianapolis: "IN", "fort wayne": "IN", milwaukee: "WI", madison: "WI",
  minneapolis: "MN", "st paul": "MN", "des moines": "IA",
  "kansas city": "MO", "st louis": "MO", springfield: "MO", omaha: "NE", wichita: "KS",
  // Mountain / West
  denver: "CO", "colorado springs": "CO", boulder: "CO", "fort collins": "CO",
  phoenix: "AZ", tucson: "AZ", mesa: "AZ", scottsdale: "AZ", chandler: "AZ", tempe: "AZ",
  "salt lake city": "UT", provo: "UT", "park city": "UT",
  "las vegas": "NV", henderson: "NV", reno: "NV", "boise": "ID",
  albuquerque: "NM", "santa fe": "NM", billings: "MT", bozeman: "MT", cheyenne: "WY",
  // Pacific Northwest / Non-contiguous
  seattle: "WA", bellevue: "WA", tacoma: "WA", spokane: "WA", redmond: "WA", kirkland: "WA",
  portland: "OR", eugene: "OR", salem: "OR", bend: "OR",
  honolulu: "HI", anchorage: "AK",
};

/**
 * Longest name first, so "Kansas City" is tried before "Kansas" would be and
 * "Washington DC" before a bare "Washington".
 */
const CITY_NAMES = Object.keys(CITY_STATE).sort((a, b) => b.length - a.length);

const STATE_ALTERNATION = [
  ...Object.keys(STATE_ABBREVS),
  ...Object.values(STATE_ABBREVS).map((n) => n.replace(/ /g, "\\s+")),
].join("|");

export type LocationHit = {
  location: Location;
  keywords: Keyword[];
  /** The zipcode's span, so the price parser does not read "near 94110" as a budget. */
  spans: Span[];
};

export function emptyLocation(): Location {
  return { city: "", state: "", zipcode: "" };
}

/**
 * A bare five-digit number. Three guards keep it from eating other fields: a preceding
 * `$` means it is money, a following area unit means it is floor area ("10000 sqft"),
 * and a following `.`/`,` *plus a digit* means it is part of a longer number. Prices in
 * this range are written "$45,000" or "45k", both of which fail the bare-digits test.
 *
 * Note the trailing guard is `(?![.,]\d)` and not `(?![.,])` — "near 94110, pets ok"
 * ends the zipcode on a comma, and rejecting ordinary punctuation loses the zipcode.
 *
 * The unit guard ends in `\w*`, not `\b`. With `\b` the alternative `sq` could never
 * match "sqft", because the position between "sq" and "f" is not a word boundary — so
 * "12000 sqft lot" was read as a zipcode. `\w*` swallows whatever follows the stem.
 */
const ZIP_RE =
  /(?<![$\d.,])\b(\d{5})(?:-\d{4})?\b(?!\s*(?:sq|sf|ft|feet|square|acres?)\w*)(?![.,]?\d)/g;

function findZip(text: string): { zipcode: string; at: number; span: Span } | null {
  ZIP_RE.lastIndex = 0;
  const m = ZIP_RE.exec(text);
  return m ? { zipcode: m[1], at: m.index, span: { start: m.index, end: m.index + m[0].length } } : null;
}

/** "Cupertino, CA" / "Cupertino CA" / "Cupertino, California" — an explicit pair beats the gazetteer. */
function findCityState(text: string): { city: string; state: StateAbbrev; at: number; span: string } | null {
  const re = new RegExp(
    String.raw`\b([A-Z][a-zA-Z.'\u2019-]+(?:[ ][A-Z][a-zA-Z.'\u2019-]+){0,2})\s*,?\s+(${STATE_ALTERNATION})\b`,
    "g",
  );
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const city = m[1].trim();
    const rawState = m[2].replace(/\s+/g, " ").trim();
    const state =
      rawState.length === 2
        ? (rawState.toUpperCase() as StateAbbrev)
        : STATE_NAME_TO_ABBREV.get(rawState.toLowerCase());
    if (!state) continue;
    // Guard against a sentence like "Show me IN" where the "city" is really a verb.
    if (/^(show|find|me|homes?|houses?|search|buy|rent|looking|need|want|near|around)$/i.test(city)) continue;
    return { city: titleCase(city), state, at: m.index, span: `${city}, ${state}` };
  }
  return null;
}

/** A known city with no state attached — the gazetteer supplies the state. */
function findKnownCity(text: string): { city: string; state: StateAbbrev; at: number } | null {
  const lower = text.toLowerCase();
  for (const name of CITY_NAMES) {
    // Longest name wins: CITY_NAMES is length-sorted, so the first hit is the most
    // specific one, and there is no better match left to look for.
    const m = cityPattern(name).exec(lower);
    if (m) return { city: titleCase(name), state: CITY_STATE[name], at: m.index };
  }
  return null;
}

/**
 * `(?!\w)` rather than a trailing `\b`, because `\b` does not fire after the "." in
 * "washington d.c." — a word boundary needs a word character on one side.
 */
function cityPattern(name: string): RegExp {
  const body = name
    .split(/\s+/)
    .map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("\\s+");
  return new RegExp(String.raw`(?<!\w)${body}(?!\w)`, "i");
}

/**
 * A place name introduced by a preposition, for cities not in the gazetteer:
 * "in Chapel Hill", "near Wicker Park". The state stays empty rather than guessed.
 */
const PREP_CITY_RE =
  /\b(?:in|near|around|within|by|at|close to|nearby)\s+((?:[A-Z][a-zA-Z.'\u2019-]+)(?:\s+(?:[A-Z][a-zA-Z.'\u2019-]+)){0,2})/g;

const NOT_A_PLACE =
  /^(?:the|a|an|i|my|me|under|over|budget|price|with|and|or|but|show|find|need|want|looking|home|homes|house|houses|condo|condos|apartment|apartments|bed|beds|bedroom|bedrooms|bath|baths|month|months|week|weeks|day|days|year|years|sqft|today|tomorrow|asap|now|soon|next|last)$/i;

function findPrepCity(text: string): { city: string; at: number } | null {
  PREP_CITY_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = PREP_CITY_RE.exec(text))) {
    const words = m[1].split(/\s+/).filter((w) => !NOT_A_PLACE.test(w));
    if (!words.length) continue;
    const city = words.join(" ");
    return { city: titleCase(city), at: m.index + m[0].indexOf(m[1]) };
  }
  return null;
}

/**
 * A zipcode and a city can both be present ("Cupertino 95014"), so this fills whatever
 * it finds rather than returning the first hit and stopping.
 */
export function parseLocation(text: string): LocationHit {
  const location = emptyLocation();
  const keywords: Keyword[] = [];
  const spans: Span[] = [];

  const zip = findZip(text);
  if (zip) {
    location.zipcode = zip.zipcode;
    keywords.push(kw(zip.zipcode, zip.at));
    spans.push(zip.span);
  }

  const pair = findCityState(text);
  if (pair) {
    location.city = pair.city;
    location.state = pair.state;
    keywords.push(kw(pair.city, pair.at));
    return { location, keywords, spans };
  }

  const known = findKnownCity(text);
  if (known) {
    location.city = known.city;
    location.state = known.state;
    keywords.push(kw(known.city, known.at));
    return { location, keywords, spans };
  }

  // A standalone state with no city: "houses in California".
  const stateOnly = new RegExp(String.raw`\b(?:in|near|around|across)\s+(${STATE_ALTERNATION})\b`, "i").exec(text);
  if (stateOnly) {
    const raw = stateOnly[1].replace(/\s+/g, " ").trim();
    const abbrev =
      raw.length === 2 ? (raw.toUpperCase() as StateAbbrev) : STATE_NAME_TO_ABBREV.get(raw.toLowerCase());
    if (abbrev) {
      location.state = abbrev;
      keywords.push(kw(STATE_ABBREVS[abbrev], stateOnly.index));
      return { location, keywords, spans };
    }
  }

  const prep = findPrepCity(text);
  if (prep && !location.zipcode) {
    location.city = prep.city;
    keywords.push(kw(prep.city, prep.at));
  }

  return { location, keywords, spans };
}

/** "Cupertino, CA" / "Cupertino" / "94110" / "" — the label a card shows. */
export function formatLocation(loc: Location): string {
  if (loc.city && loc.state) return `${loc.city}, ${loc.state}`;
  if (loc.city) return loc.city;
  if (loc.zipcode) return loc.zipcode;
  if (loc.state) return STATE_ABBREVS[loc.state as StateAbbrev] ?? loc.state;
  return "";
}

export { STATE_ABBREVS };
