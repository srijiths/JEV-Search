import { inLotContext, kw, readCount, spanOf, NUMBER_WORD_GROUP, type Keyword, type Span } from "./common";

/**
 * The "Home details" filter panel: lot size, home age, HOA fees, garage and stories.
 *
 * Five of the seven are quantities, so five of the seven could never come from Jev
 * whatever flag was set. The two that are closed sets — garage bucket and storey count —
 * are matched literally here and, in `jev` mode, also inferred from the extended question
 * set for the phrasings no literal covers ("nothing with stairs").
 */

const SQFT_PER_ACRE = 43_560;

export type HomeHit = {
  lot_size_min: number | null;
  lot_size_max: number | null;
  home_age_min: number | null;
  home_age_max: number | null;
  hoa_max: number | null;
  garage_min: number | null;
  stories: string;
  keywords: Keyword[];
  /** Spans claimed, so "$300 HOA" is not also read as the asking price. */
  spans: Span[];
};

// ─────────────────────────────────────────────────────────────
// Lot size
// ─────────────────────────────────────────────────────────────

/**
 * Lot size, always stored in square feet.
 *
 * Acres are converted on the way in rather than carried as a second unit, because a
 * backend that receives `lot_size_min` should not have to ask which unit it is in — and a
 * field whose unit depends on the phrasing is the kind of thing that stays wrong for
 * months. "Half an acre" is 21,780 sqft by arithmetic, so arithmetic does it.
 */
const ACRE_RE = new RegExp(
  String.raw`\b(\d+(?:\.\d+)?|half(?: an?)?|quarter|${NUMBER_WORD_GROUP})\s*(?:-\s*)?(?:acres?|ac)\b`,
  "i",
);

const LOT_SQFT_RE =
  /\b(\d[\d,]*)\s*(?:\+\s*)?(?:sq\.?\s*ft\.?|sqft|sq\s*feet|square\s*feet|sf)\b/i;

const MAX_WORD = /\b(?:under|below|less than|up to|at most|no more than|max|maximum|smaller than|within)\b/i;
const MIN_WORD = /\b(?:over|above|more than|at least|minimum|min|bigger than|larger than|starting (?:at|from))\b/i;

/** "half an acre" and "quarter acre" are fractions, not counts, so `readCount` cannot read them. */
const FRACTIONS: Record<string, number> = { half: 0.5, "half a": 0.5, "half an": 0.5, quarter: 0.25 };

function readAcres(raw: string): number | null {
  const key = raw.trim().toLowerCase();
  const fraction = FRACTIONS[key] ?? FRACTIONS[key.replace(/\s+an?$/, "")];
  if (fraction !== undefined) return fraction;
  return readCount(key);
}

// ─────────────────────────────────────────────────────────────
// Home age
// ─────────────────────────────────────────────────────────────

/**
 * Age is stored in years, not build years, because that is what the filter is.
 *
 * "built after 2015" and "less than 10 years old" are the same constraint said two ways,
 * and a backend should not have to normalise them. Both become `home_age_max`. Note the
 * inversion: a *later* build year is a *smaller* maximum age, which is exactly the sort of
 * sign error worth converting once, here, rather than at every call site.
 */
const YEAR = String.raw`(1[89]\d\d|20\d\d)`;
const BUILT_AFTER_RE = new RegExp(String.raw`\b(?:built|constructed|new(?:er)?)\s*(?:after|since|from|in or after|>)\s*${YEAR}\b`, "i");
const BUILT_BEFORE_RE = new RegExp(String.raw`\b(?:built|constructed)\s*(?:before|prior to|earlier than|<)\s*${YEAR}\b`, "i");
const AGE_MAX_RE = new RegExp(
  String.raw`\b(?:(?:less|fewer|no more) than|under|newer than|within|up to|at most)\s+(\d+)\s*(?:-\s*)?years?(?:\s*old)?\b`,
  "i",
);
const AGE_MIN_RE = new RegExp(
  String.raw`\b(?:(?:more|older) than|over|at least|older than)\s+(\d+)\s*(?:-\s*)?years?(?:\s*old)?\b`,
  "i",
);

// ─────────────────────────────────────────────────────────────
// HOA, garage, stories
// ─────────────────────────────────────────────────────────────

/**
 * HOA ceiling. Requires the letters "HOA" (or the spelled-out phrase) next to the amount:
 * an unqualified "$300" in a property search is a great many things, and the price parser
 * has the better claim on it.
 */
const HOA_RE =
  /\b(?:hoa|h\.o\.a\.|association (?:fees?|dues?)|condo fees?|maintenance fees?)\b[^.;\n]{0,24}?\$?\s?(\d[\d,]*)|\$\s?(\d[\d,]*)\s*(?:\/\s*mo(?:nth)?|per month|a month|monthly)?\s*(?:hoa|association (?:fees?|dues?)|condo fees?)\b/i;

const NO_HOA_RE = /\bno (?:hoa|h\.o\.a\.|association fees?|condo fees?)\b/i;

/** "2 car garage", "three-car garage", "2+ garage spaces", or a bare "garage" meaning one. */
const GARAGE_COUNT_RE = new RegExp(
  String.raw`\b(\d+|${NUMBER_WORD_GROUP})\s*(\+)?\s*(?:-\s*)?car\s*(?:garages?|carports?|ports?)\b|\b(\d+)\s*(\+)?\s*garage\s*(?:spaces?|bays?)\b`,
  "i",
);
const GARAGE_ANY_RE = /\b(?:garages?|carports?|covered parking)\b/i;

const SINGLE_STORY_RE =
  /\b(?:single[-\s]?(?:story|storey|level)|one[-\s]?(?:story|storey|level)|1[-\s]?(?:story|storey)|ranch(?:[-\s]?style)?|no stairs|all on one (?:floor|level)|step[-\s]?free)\b/i;
const MULTI_STORY_RE =
  /\b(?:multi[-\s]?(?:story|storey|level)|two[-\s]?(?:story|storey)|2[-\s]?(?:story|storey)|three[-\s]?(?:story|storey)|3[-\s]?(?:story|storey)|split[-\s]?level|\d+\s*stories)\b/i;

export function parseHome(text: string): HomeHit {
  const keywords: Keyword[] = [];
  const spans: Span[] = [];
  const take = (m: RegExpExecArray) => {
    keywords.push(kw(m[0].trim(), m.index));
    spans.push(spanOf(m));
  };

  // ── Lot size ────────────────────────────────────────────────
  let lot_size_min: number | null = null;
  let lot_size_max: number | null = null;

  const acres = ACRE_RE.exec(text);
  const lotSqft = LOT_SQFT_RE.exec(text);

  if (acres) {
    const n = readAcres(acres[1]);
    if (n !== null && n > 0) {
      const sqft = Math.round(n * SQFT_PER_ACRE);
      if (bounded(text, acres.index) === "max") lot_size_max = sqft;
      else lot_size_min = sqft;
      take(acres);
    }
  } else if (lotSqft && inLotContext(text, lotSqft)) {
    // Only claimed when a lot word is adjacent — otherwise it is floor area and
    // `rooms.ts` owns it. The two parsers share `inLotContext` so they cannot both claim it.
    const n = Number(lotSqft[1].replace(/,/g, ""));
    if (Number.isFinite(n) && n > 0) {
      if (bounded(text, lotSqft.index) === "max") lot_size_max = n;
      else lot_size_min = n;
      take(lotSqft);
    }
  }

  // ── Home age ────────────────────────────────────────────────
  let home_age_min: number | null = null;
  let home_age_max: number | null = null;
  const thisYear = new Date().getFullYear();

  const after = BUILT_AFTER_RE.exec(text);
  const before = BUILT_BEFORE_RE.exec(text);
  const ageMax = AGE_MAX_RE.exec(text);
  const ageMin = AGE_MIN_RE.exec(text);

  if (after) {
    home_age_max = Math.max(0, thisYear - Number(after[1]));
    take(after);
  } else if (ageMax) {
    home_age_max = Number(ageMax[1]);
    take(ageMax);
  }

  if (before) {
    home_age_min = Math.max(0, thisYear - Number(before[1]));
    take(before);
  } else if (ageMin) {
    home_age_min = Number(ageMin[1]);
    take(ageMin);
  }

  // ── HOA ─────────────────────────────────────────────────────
  let hoa_max: number | null = null;
  const noHoa = NO_HOA_RE.exec(text);
  if (noHoa) {
    // "no HOA" is a ceiling of zero, not an absent filter. Saying it as 0 means one
    // field expresses the whole constraint, instead of a flag a consumer has to know about.
    hoa_max = 0;
    take(noHoa);
  } else {
    const hoa = HOA_RE.exec(text);
    const raw = hoa?.[1] ?? hoa?.[2];
    if (hoa && raw !== undefined) {
      const n = Number(raw.replace(/,/g, ""));
      if (Number.isFinite(n) && n > 0) {
        hoa_max = n;
        take(hoa);
      }
    }
  }

  // ── Garage ──────────────────────────────────────────────────
  let garage_min: number | null = null;
  const garageCount = GARAGE_COUNT_RE.exec(text);
  if (garageCount) {
    const n = readCount(garageCount[1] ?? garageCount[3] ?? "");
    if (n !== null && n > 0) {
      // The filter buckets stop at 3+, so anything larger clamps there rather than
      // producing a filter the UI has no checkbox for.
      garage_min = Math.min(3, n);
      take(garageCount);
    }
  } else {
    const any = GARAGE_ANY_RE.exec(text);
    if (any) {
      // A garage with no number is one space. "Any" is the absence of the filter, not this.
      garage_min = 1;
      // Keyword but no span: the phrase carries no number, so there is nothing for the
      // price or timeframe parser to mistake it for.
      keywords.push(kw(any[0].trim(), any.index));
    }
  }

  // ── Stories ─────────────────────────────────────────────────
  let stories = "";
  const single = SINGLE_STORY_RE.exec(text);
  const multi = MULTI_STORY_RE.exec(text);
  // Single wins a tie: "single story" contains no multi words, but "2 story ranch" does
  // contain both, and there the storey count is the explicit number.
  if (multi) {
    stories = "multi";
    take(multi);
  } else if (single) {
    stories = "single";
    take(single);
  }

  return {
    lot_size_min,
    lot_size_max,
    home_age_min,
    home_age_max,
    hoa_max,
    garage_min,
    stories,
    keywords,
    spans,
  };
}

/** Which end of the range the figure at `at` bounds, from the words leading up to it. */
function bounded(text: string, at: number): "min" | "max" {
  const lead = text.slice(Math.max(0, at - 24), at);
  if (MAX_WORD.test(lead) && !MIN_WORD.test(lead)) return "max";
  return "min";
}

/** Spans this parser claimed, so the price parser does not read "$300 HOA" as the price. */
export function homeSpans(text: string): Span[] {
  return parseHome(text).spans;
}

// ─────────────────────────────────────────────────────────────
// Labels
// ─────────────────────────────────────────────────────────────

/** Back to acres above a third of one, because "0.5 acres" reads and "21,780 sqft" does not. */
export function formatLotSize(sqft: number | null): string {
  if (sqft === null) return "";
  if (sqft >= SQFT_PER_ACRE / 3) {
    const acres = Math.round((sqft / SQFT_PER_ACRE) * 100) / 100;
    return `${acres} ac`;
  }
  return `${sqft.toLocaleString("en-US")} sqft lot`;
}

export function formatHomeAge(min: number | null, max: number | null): string {
  if (min !== null && max !== null) return `${min}–${max} yrs old`;
  if (max !== null) return `Under ${max} yrs old`;
  if (min !== null) return `Over ${min} yrs old`;
  return "";
}

export function formatHoa(max: number | null): string {
  if (max === null) return "";
  return max === 0 ? "No HOA" : `HOA under $${max.toLocaleString("en-US")}/mo`;
}

export function formatGarage(min: number | null): string {
  return min === null ? "" : `${min}+ garage`;
}

export function formatStories(stories: string): string {
  return stories === "single" ? "Single story" : stories === "multi" ? "Multi story" : "";
}
