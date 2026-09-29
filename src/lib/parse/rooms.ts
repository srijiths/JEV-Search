import { inLotContext, kw, readCount, spanOf, NUMBER_WORD_GROUP, type Keyword, type Span } from "./common";

/**
 * Beds, baths and floor area. All three are counting problems, which is exactly the
 * kind of thing Jev is not asked to do — "2br" means 2 every time, and a regex that
 * says so is auditable in a way a probability is not.
 */

export type RoomsHit = {
  beds_min: number | null;
  baths_min: number | null;
  sqft_min: number | null;
  sqft_max: number | null;
  keywords: Keyword[];
};

const NUM = String.raw`(\d+(?:\.\d+)?|${NUMBER_WORD_GROUP})`;

/**
 * Bedrooms. Covers "3 bedroom", "3br", "3 bd", "3-bedroom", "three bed" and the
 * compact "2bd/2ba" form. `studio` resolves to 0 through `readCount`.
 */
const BEDS_RE = new RegExp(String.raw`\b${NUM}\s*[-\s]?\s*(?:bedrooms?|bedrms?|beds?|br|bds?|bhk)\b`, "i");
const STUDIO_RE = /\bstudios?\b/i;

/** Bathrooms, including the half-bath decimal form "1.5 bath". */
const BATHS_RE = new RegExp(String.raw`\b${NUM}\s*[-\s]?\s*(?:bathrooms?|bathrms?|baths?|ba)\b`, "i");

/**
 * Floor area. The unit is mandatory — a bare "1500" is more likely a rent than a
 * square footage, and `findMoney`/`findBarePrice` have first claim on bare numbers.
 */
const SQFT_UNIT = String.raw`(?:sq\.?\s*ft\.?|sqft|sq\s*feet|square\s*feet|square\s*foot|sf)`;
const SQFT_RE = new RegExp(String.raw`\b(\d[\d,]*(?:\.\d+)?)\s*(\+\s*)?${SQFT_UNIT}\b`, "i");

/** "1500-2500 sqft", "between 1200 and 1800 square feet". */
const SQFT_RANGE_RE = new RegExp(
  String.raw`\b(?:between\s+)?(\d[\d,]*)\s*(?:-|–|—|to|and)\s*(\d[\d,]*)\s*${SQFT_UNIT}\b`,
  "i",
);

/**
 * Comparators, tested against the ~24 characters leading up to the figure.
 *
 * Deliberately a separate pair from the ones in `price.ts`: the vocabularies only look
 * alike. "budget" bounds a price and never an area, and "no bigger than" bounds an area
 * and reads oddly about money. Sharing one list would mean every new price word silently
 * became a floor-area word too.
 */
const AREA_MAX_WORD = /\b(?:under|below|less than|up to|at most|no (?:more|bigger|larger) than|max|maximum|smaller than|within)\b/i;
const AREA_MIN_WORD = /\b(?:over|above|more than|at least|minimum|min|bigger than|larger than|starting (?:at|from)|no (?:less|smaller) than)\b/i;

export function parseRooms(text: string): RoomsHit {
  const keywords: Keyword[] = [];
  let beds_min: number | null = null;
  let baths_min: number | null = null;
  let sqft_min: number | null = null;
  let sqft_max: number | null = null;

  const beds = BEDS_RE.exec(text);
  if (beds) {
    const n = readCount(beds[1]);
    if (n !== null) {
      beds_min = n;
      keywords.push(kw(beds[0], beds.index));
    }
  } else {
    const studio = STUDIO_RE.exec(text);
    if (studio) {
      beds_min = 0;
      keywords.push(kw(studio[0], studio.index));
    }
  }

  const baths = BATHS_RE.exec(text);
  if (baths) {
    const n = readCount(baths[1]);
    if (n !== null) {
      baths_min = n;
      keywords.push(kw(baths[0], baths.index));
    }
  }

  const area = floorArea(text);
  sqft_min = area.min;
  sqft_max = area.max;
  if (area.keyword) keywords.push(area.keyword);

  return { beds_min, baths_min, sqft_min, sqft_max, keywords };
}

type Area = { min: number | null; max: number | null; keyword: Keyword | null };

const digits = (s: string) => {
  const n = Number(s.replace(/,/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
};

/**
 * Floor area, as a bound rather than a bare number.
 *
 * A bare "1200 sqft" stays a *minimum*, which is what it meant before this function
 * existed and what people mean by it — "I want 1200 square feet" is a floor, not a
 * ceiling. Only an explicit comparator or a range produces a maximum.
 */
function floorArea(text: string): Area {
  const range = SQFT_RANGE_RE.exec(text);
  if (range && !inLotContext(text, range)) {
    const a = digits(range[1]);
    const b = digits(range[2]);
    if (a !== null && b !== null) {
      const [lo, hi] = [a, b].sort((x, y) => x - y);
      return { min: lo, max: hi, keyword: kw(range[0], range.index) };
    }
  }

  const m = SQFT_RE.exec(text);
  // A lot size. `home.ts` owns it; claiming it here would report a quarter-acre garden
  // as the size of the house.
  if (!m || inLotContext(text, m)) return { min: null, max: null, keyword: null };

  const n = digits(m[1]);
  if (n === null) return { min: null, max: null, keyword: null };

  const lead = text.slice(Math.max(0, m.index - 24), m.index);
  // A trailing "+" ("1500+ sqft") is a floor stated without a word for it.
  const isMax = AREA_MAX_WORD.test(lead) && !m[2] && !AREA_MIN_WORD.test(lead);

  return { min: isMax ? null : n, max: isMax ? n : null, keyword: kw(m[0], m.index) };
}

/** Spans this parser claimed, so the price parser does not read "3 bedroom" as $3. */
export function roomSpans(text: string): Span[] {
  const spans: Span[] = [];
  for (const re of [BEDS_RE, BATHS_RE, SQFT_RANGE_RE, SQFT_RE]) {
    const m = re.exec(text);
    if (m) spans.push(spanOf(m));
  }
  return spans;
}

/** "3 bd" / "Studio" / "" — the label a card shows. */
export function formatBeds(beds: number | null): string {
  if (beds === null) return "";
  return beds === 0 ? "Studio" : `${beds} bd`;
}

export function formatBaths(baths: number | null): string {
  return baths === null ? "" : `${baths} ba`;
}

/** "1,200+ sqft" / "Under 2,000 sqft" / "1,200 – 1,800 sqft" / "" — the label a chip shows. */
export function formatSqft(min: number | null, max: number | null): string {
  const n = (v: number) => v.toLocaleString("en-US");
  if (min !== null && max !== null) return `${n(min)} – ${n(max)} sqft`;
  if (max !== null) return `Under ${n(max)} sqft`;
  if (min !== null) return `${n(min)}+ sqft`;
  return "";
}
