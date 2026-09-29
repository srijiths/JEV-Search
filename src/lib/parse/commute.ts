import { kw, readCount, spanOf, tidy, NUMBER_WORD_GROUP, type Keyword, type Span } from "./common";
import { COMMUTE_MODES, type CommuteMode } from "../jev/types";

/**
 * The "Commute" and "Expanded search" filter panels: travel time to a place, how you
 * travel, and how far outside the named area to look.
 *
 * The destination is free text and is left exactly as typed. Normalising it would mean
 * guessing at an address, and a geocoder does that job with a database — we would only be
 * corrupting its input. Same reason Jev is not asked for it: the answer is a string, and
 * a `choice` cannot carry one.
 */

export type CommuteHit = {
  address: string;
  mode: string;
  max_minutes: number | null;
  radius_miles: number | null;
  include_nearby_areas: boolean;
  keywords: Keyword[];
  spans: Span[];
};

const MODE_TRIGGERS: Array<[CommuteMode, RegExp]> = [
  ["transit", /\b(?:transit|public transport\w*|subways?|metros?|trains?|buses|bus rides?|els?\b|bart|mta)\b/i],
  ["walking", /\b(?:walk(?:ing)?(?: distance)?|on foot|walkable|strolls?)\b/i],
  ["cycling", /\b(?:cycl\w+|bik(?:e|ing)(?: ride)?|bicycles?)\b/i],
  ["driving", /\b(?:driv\w+|by car|commut\w+ by car)\b/i],
];

/** The ways of travelling, as a fragment — shared by the duration and address patterns. */
const TRAVEL_WORD = String.raw`(?:commut\w+|drive|driving|walk\w*|cycl\w+|bik\w+|transit|train|bus)`;

/**
 * "30 minutes from downtown", "within a 20 min drive of the airport", "under 45 min commute".
 *
 * The unit is mandatory. A bare "30" next to a place name is a house number far more often
 * than a duration, and the address parser below wants it.
 *
 * Two tiers of unit, because "m" is not one unit. Written out, minutes are unambiguous and
 * only need a travel word somewhere in the clause. A lone "m" is also the millions suffix,
 * and reading it as minutes cost more than a stray commute filter: in "from $3M to $5M" it
 * matched "3 m(inutes)" — the `to` of "to $5M" satisfying the travel-word lookahead from 40
 * characters away — and the span this parser then claimed hid the low end of the range from
 * `price.ts`, which fell back to a single amount and returned "$5M and up". So the
 * abbreviation must be followed *immediately* by the travel word: "20m drive" is a duration,
 * "$3M to" is not.
 *
 * `(?<![$\d.,])` is the guard `ZIP_RE` uses, for the same reason: a digit reached by stepping
 * into the middle of "$1.5M" is not a quantity of its own.
 */
const MINUTES_RE = new RegExp(
  String.raw`(?<![$\d.,])\b(?:under|within|less than|no more than|up to|at most|max(?:imum)?)?\s*` +
    String.raw`(\d+|${NUMBER_WORD_GROUP})\s*(?:-\s*)?(?:` +
    // Spelled out: a travel word anywhere in the clause is enough.
    String.raw`(?:minutes?|mins?)\b(?=[^.;\n]{0,40}?\b(?:${TRAVEL_WORD}|from|to|of)\b)` +
    // Abbreviated: the travel word has to be the next thing.
    String.raw`|m\b(?=\s*(?:-\s*)?${TRAVEL_WORD}\b)` +
    String.raw`)`,
  "i",
);

/** The "N hour commute" form, for the people with long ones. */
const HOURS_RE = new RegExp(
  String.raw`\b(\d+(?:\.\d+)?|${NUMBER_WORD_GROUP})\s*(?:-\s*)?(?:hours?|hrs?)\s*(?:commut\w+|drive|driving|from|to)\b`,
  "i",
);

/**
 * The destination, as everything after a "to/from/of" that follows a travel word.
 *
 * Stops at a comma or a filter word, because "20 min from the office, 2 bedrooms" has the
 * address ending where the next filter begins. Greedy to the end of the clause otherwise —
 * "from 100 Main St Suite 4" is one address and chopping it at the first number would ruin it.
 */
const ADDRESS_RE = new RegExp(
  String.raw`\b(?:${TRAVEL_WORD}|minutes?|mins?|hours?|hrs?)\b[^,.;\n]*?\b(?:to|from|of)\s+(?:the\s+)?([^,.;\n]+)`,
  "i",
);

/** Words that end an address: whatever follows is another filter, not more of the place. */
const ADDRESS_STOP =
  /\b(?:under|below|over|above|with|without|near|budget|max|min|\d+\s*(?:bed|bd|br|bath|ba|sqft)|for (?:sale|rent))\b/i;

const RADIUS_RE = new RegExp(
  String.raw`\b(?:within|inside|up to)?\s*(\d+(?:\.\d+)?|${NUMBER_WORD_GROUP})\s*(?:-\s*)?(?:miles?|mi)\b(?!\s*(?:commut|drive))`,
  "i",
);

const NEARBY_RE =
  /\b(?:nearby (?:areas?|towns?|cit(?:y|ies)|neighbo(?:u)?rhoods?)|surrounding (?:areas?|towns?)|and around|or nearby|nearby)\b/i;

export function parseCommute(text: string): CommuteHit {
  const keywords: Keyword[] = [];
  const spans: Span[] = [];
  const take = (m: RegExpExecArray, surface = m[0]) => {
    keywords.push(kw(surface.trim(), m.index + m[0].indexOf(surface)));
    spans.push(spanOf(m));
  };

  // ── How long ────────────────────────────────────────────────
  let max_minutes: number | null = null;
  const minutes = MINUTES_RE.exec(text);
  const hours = HOURS_RE.exec(text);
  if (minutes) {
    const n = readCount(minutes[1]);
    if (n !== null && n > 0) {
      max_minutes = n;
      take(minutes);
    }
  } else if (hours) {
    const n = readCount(hours[1]);
    if (n !== null && n > 0) {
      max_minutes = Math.round(n * 60);
      take(hours);
    }
  }

  // ── How ─────────────────────────────────────────────────────
  let mode = "";
  for (const [candidate, re] of MODE_TRIGGERS) {
    const m = re.exec(text);
    if (!m) continue;
    mode = candidate;
    take(m);
    break;
  }
  // A stated travel time with no stated mode is a drive. That is the usual default
  // ("Max driving time"), and it is the only mode where the number means anything without
  // a transit schedule behind it.
  if (!mode && max_minutes !== null) mode = "driving";

  // ── Where to ────────────────────────────────────────────────
  let address = "";
  const addr = ADDRESS_RE.exec(text);
  if (addr) {
    const stop = ADDRESS_STOP.exec(addr[1]);
    address = tidy(stop ? addr[1].slice(0, stop.index) : addr[1]);
    // A one-character remainder is punctuation, not a place.
    if (address.length < 2) address = "";
    else keywords.push(kw(address, addr.index + addr[0].lastIndexOf(addr[1])));
  }

  // ── How far out ─────────────────────────────────────────────
  let radius_miles: number | null = null;
  const radius = RADIUS_RE.exec(text);
  if (radius) {
    const n = readCount(radius[1]);
    if (n !== null && n > 0) {
      radius_miles = n;
      take(radius);
    }
  }

  const nearby = NEARBY_RE.exec(text);
  if (nearby) take(nearby);

  return {
    address,
    mode: (COMMUTE_MODES as readonly string[]).includes(mode) ? mode : "",
    max_minutes,
    radius_miles,
    include_nearby_areas: nearby !== null,
    keywords,
    spans,
  };
}

/** Spans this parser claimed, so "30 minutes" is not also read as a move-in date. */
export function commuteSpans(text: string): Span[] {
  return parseCommute(text).spans;
}

const MODE_LABELS: Record<CommuteMode, string> = {
  driving: "Driving",
  walking: "Walking",
  cycling: "Cycling",
  transit: "Transit",
};

export const formatCommuteMode = (m: string) => MODE_LABELS[m as CommuteMode] ?? "";

/** "30 min drive to the office" / "20 min walk" / "" — the label a card shows. */
export function formatCommute(mode: string, minutes: number | null, address: string): string {
  if (minutes === null && !address) return "";
  const verb = mode === "walking" ? "walk" : mode === "cycling" ? "ride" : mode === "transit" ? "by transit" : "drive";
  const time = minutes === null ? "" : `${minutes} min `;
  const to = address ? ` to ${address}` : "";
  return `${time}${verb}${to}`.trim();
}
