import { describe, expect, it } from "vitest";
import { parseRooms, roomSpans } from "../parse/rooms";
import { parseLocation } from "../parse/location";
import { parsePropertyType } from "../parse/propertyType";
import { parseAmenities } from "../parse/amenities";
import { parseCommute } from "../parse/commute";
import { parseHome } from "../parse/home";
import { parseListing } from "../parse/listing";
import { parsePrice } from "../parse/price";
import { parseTimeframe } from "../parse/timeframe";
import { buildSearchQuery, hasFilters } from "../parse/query";
import { findBarePrices, findMoney, readCount, wordToNumber } from "../parse/common";
import { neutralAnswer, neutralSignals, noneResult, type IntentResult, type Signals } from "../jev/types";

/**
 * Edge cases, not happy paths — `contract.test.ts` already covers the two queries the
 * output shape was specified against.
 *
 * Almost every case below is a *collision*: the same digits could be a bed count, a floor
 * area, a zip, a price or a date, and the same word could be a feature or an ordinary
 * verb. These are the ones that were actually wrong at some point while building this.
 */

const signals = (overrides: Partial<Signals> = {}): Signals => ({ ...neutralSignals(), ...overrides });

/** A classification that answered nothing except the signals under test. */
const result = (overrides: Partial<Signals> = {}): IntentResult =>
  noneResult({ signals: signals(overrides) });
const FIXED = new Date("2026-03-15T12:00:00Z");

describe("numbers in words", () => {
  it("reads spelled-out counts, including studio as zero", () => {
    expect(wordToNumber("three")).toBe(3);
    expect(wordToNumber("studio")).toBe(0);
    expect(wordToNumber("eleven")).toBeNull();
  });

  it("reads digits and words through one entry point", () => {
    expect(readCount("4")).toBe(4);
    expect(readCount("four")).toBe(4);
    expect(readCount("lots")).toBeNull();
  });
});

describe("rooms", () => {
  it("reads every common bedroom shorthand", () => {
    for (const q of ["3 bedroom", "3br", "3 bd", "3 bhk", "three bedrooms"]) {
      expect(parseRooms(q).beds_min, q).toBe(3);
    }
  });

  it("maps a studio to zero bedrooms, not to no answer", () => {
    // `null` would mean "unspecified" and would match 4-bed houses.
    expect(parseRooms("studio for rent").beds_min).toBe(0);
  });

  it("keeps half baths", () => {
    expect(parseRooms("2 bed 1.5 bath").baths_min).toBe(1.5);
  });

  it("requires a unit before reading a floor area", () => {
    expect(parseRooms("1200 sqft").sqft_min).toBe(1200);
    expect(parseRooms("at least 1200 square feet").sqft_min).toBe(1200);
    // A bare number is not a size. "1200" alone is far more likely a price or a street.
    expect(parseRooms("1200 in Cupertino").sqft_min).toBeNull();
  });

  it("claims the spans it read so later parsers skip them", () => {
    const spans = roomSpans("3 bedroom 1200 sqft");
    expect(spans.length).toBe(2);
    expect(spans.every((s) => s.end > s.start)).toBe(true);
  });
});

describe("location", () => {
  it("resolves a known city to its state", () => {
    expect(parseLocation("houses in Cupertino").location).toEqual({ city: "Cupertino", state: "CA", zipcode: "" });
  });

  it("prefers an explicit city, state pair over the gazetteer", () => {
    expect(parseLocation("Portland, ME").location).toMatchObject({ city: "Portland", state: "ME" });
    // Bare "Portland" is ambiguous; the larger metro wins rather than nothing at all.
    expect(parseLocation("condos in Portland").location).toMatchObject({ city: "Portland", state: "OR" });
  });

  it("prefers the longest matching city name", () => {
    expect(parseLocation("rentals in Kansas City").location.city).toBe("Kansas City");
    expect(parseLocation("homes in Fort Wayne").location.city).toBe("Fort Wayne");
  });

  it("handles Washington DC, where a word boundary cannot follow the dot", () => {
    expect(parseLocation("lofts in washington d.c.").location).toMatchObject({ state: "DC" });
    expect(parseLocation("washington dc").location).toMatchObject({ state: "DC" });
  });

  it("reads a zip followed by a comma", () => {
    // The original guard rejected "94110," because a comma follows. Only a comma or dot
    // followed by a *digit* means the number continues.
    expect(parseLocation("near 94110, pets ok").location.zipcode).toBe("94110");
    expect(parseLocation("94110-1234").location.zipcode).toBe("94110");
  });

  it("does not read a price or a floor area as a zip", () => {
    expect(parseLocation("under $95000").location.zipcode).toBe("");
    expect(parseLocation("12000 sqft lot").location.zipcode).toBe("");
  });

  it("falls back to a bare state", () => {
    expect(parseLocation("land in Montana").location).toEqual({ city: "", state: "MT", zipcode: "" });
  });

  it("accepts an unknown city after a preposition, leaving the state blank", () => {
    // Guessing a state for a city we do not know would be fabricating a filter.
    const hit = parseLocation("houses in Leander");
    expect(hit.location.city).toBe("Leander");
    expect(hit.location.state).toBe("");
  });
});

describe("property type", () => {
  it("canonicalises the surface form", () => {
    expect(parsePropertyType("3 bedroom houses").property_type).toEqual(["house"]);
    expect(parsePropertyType("condos and townhomes").property_type).toEqual(["condo", "townhouse"]);
  });

  it("does not read a bare 'home' as a house", () => {
    // "homes for sale" is the standard phrase for listings of every type. Narrowing it to
    // detached houses would silently hide every condo.
    expect(parsePropertyType("homes for sale").property_type).toEqual([]);
  });

  it("does not let 'town house' also register a house", () => {
    expect(parsePropertyType("town houses in Cupertino").property_type).toEqual(["townhouse"]);
  });
});

describe("amenities", () => {
  it("canonicalises the tag while keeping the user's words as the keyword", () => {
    const hit = parseAmenities("pets ok");
    expect(hit.amenities).toEqual(["pet-friendly"]);
    expect(hit.keywords.map((k) => k.text)).toEqual(["pets"]);
  });

  it("removes a literally negated feature", () => {
    const hit = parseAmenities("house with a yard but no pool");
    expect(hit.amenities).toContain("backyard");
    expect(hit.amenities).not.toContain("pool");
    expect(hit.excluded).toContain("pool");
  });

  it("never lets the whole-text negation signal remove a tag", () => {
    // `hasNegation` is true for the sentence, but it cannot say *which* phrase was
    // negated — and "no HOA, must have a pool" negates one feature and demands another.
    const hit = parseAmenities("no HOA but must have a pool", signals({ hasNegation: 0.98 }));
    expect(hit.amenities).toContain("pool");
  });

  it("lets a Jev signal add a tag it can name unambiguously", () => {
    const hit = parseAmenities("somewhere my dog can live", signals({ wantsPetFriendly: 0.95 }));
    expect(hit.amenities).toContain("pet-friendly");
  });

  it("does not read the verb 'view' as a feature", () => {
    expect(parseAmenities("I want to view homes this weekend").amenities).not.toContain("view");
    // A named view resolves to the specific tag and drops the generic one: the filter panel has
    // "Ocean view" as its own checkbox, and emitting both would filter on the same thing
    // twice with the weaker of the two constraints doing nothing.
    expect(parseAmenities("condo with an ocean view").amenities).toEqual(["ocean-view"]);
    expect(parseAmenities("house with a view").amenities).toContain("view");
  });

  it("does not read the acres abbreviation as air conditioning", () => {
    expect(parseAmenities("5 ac lot in Montana").amenities).not.toContain("air-conditioning");
    expect(parseAmenities("apartment with a/c").amenities).toContain("air-conditioning");
  });
});

describe("money", () => {
  it("requires a marker so counts are never read as amounts", () => {
    expect(findMoney("3 bedroom")).toHaveLength(0);
    expect(findMoney("94110")).toHaveLength(0);
    expect(findMoney("$1M")[0]?.value).toBe(1_000_000);
    expect(findMoney("budget 3k")[0]?.value).toBe(3000);
  });

  it("only reads a bare number as a price next to a price word", () => {
    expect(findBarePrices("budget 850000")[0]?.value).toBe(850_000);
    expect(findBarePrices("850000")).toEqual([]);
  });

  it("returns every candidate so the caller can reject the claimed ones", () => {
    // Returning only the first lost the price entirely in this query: the zipcode came
    // first, the price parser rightly rejected it, and nothing was left.
    expect(findBarePrices("near 94110 under 2500 a month").map((h) => h.value)).toEqual([94110, 2500]);
  });
});

describe("price", () => {
  it("reads a comparator literally", () => {
    expect(parsePrice("under $1M")).toMatchObject({ price_min: null, price_max: 1_000_000 });
    expect(parsePrice("over $500k")).toMatchObject({ price_min: 500_000, price_max: null });
  });

  it("reads a two-ended range without consulting Jev", () => {
    expect(parsePrice("$400k-$600k")).toMatchObject({ price_min: 400_000, price_max: 600_000 });
  });

  it("keeps both ends of a range written in millions", () => {
    // End to end rather than through `parsePrice`, because the bug was not in this parser:
    // `commute.ts` read the "3M" of "from $3M to $5M" as 3 minutes and claimed its span,
    // so the range lost its low end here and came back as "$5M and up".
    expect(buildSearchQuery("luxury homes in Cupertino from $3M to $5M")).toMatchObject({
      price_min: 3_000_000,
      price_max: 5_000_000,
      commute: { max_minutes: null, mode: "" },
    });
  });

  it("lets a literal comparator beat Jev's reading of the bound", () => {
    // Jev says "minimum"; the sentence says "under". The sentence wins — this is the
    // clearest case of "Jev decides, code computes": a stated bound is not a judgement.
    const hit = parsePrice("under $1M", signals({ priceBound: neutralAnswer("minimum") }));
    expect(hit).toMatchObject({ price_min: null, price_max: 1_000_000 });
  });

  it("uses Jev's bound only when the text states none", () => {
    const around = parsePrice("$500k", signals({ priceBound: neutralAnswer("around") }));
    expect(around.price_min).toBe(450_000);
    expect(around.price_max).toBe(550_000);

    // An unconfident answer is ignored and the safe default — a ceiling — applies.
    const weak = parsePrice("$500k", signals({ priceBound: { value: "around", confidence: 0.2, probabilities: {} } }));
    expect(weak).toMatchObject({ price_min: null, price_max: 500_000 });
  });

  it("skips numbers another parser already claimed", () => {
    const reserved = roomSpans("1200 sqft under 600k");
    expect(parsePrice("1200 sqft under 600k", undefined, reserved).price_max).toBe(600_000);
  });

  it("looks past a claimed number to the real amount", () => {
    const zip = parseLocation("studio near 94110 under 2500 a month").spans;
    const hit = parsePrice("studio near 94110 under 2500 a month", undefined, zip);
    expect(hit.price_max).toBe(2500);
  });

  it("claims a trailing cadence phrase as part of the price", () => {
    const hit = parsePrice("under 2500 a month");
    expect(hit.price_max).toBe(2500);
    // The span must cover "a month" too, or the timeframe parser reads it as a date.
    expect(hit.spans[0].end).toBe("under 2500 a month".length);
  });

  it("claims the common cadence spellings", () => {
    for (const q of ["$3000/mo", "$3000 per month", "3000 monthly", "budget 3000 pcm"]) {
      expect(parsePrice(q).spans[0].end, q).toBe(q.length);
    }
  });
});

describe("timeframe", () => {
  it("reads relative phrases chrono misses", () => {
    expect(parseTimeframe("sold last year", FIXED).timeframe).toBeTruthy();
    expect(parseTimeframe("moving next month", FIXED).timeframe).toBeTruthy();
  });

  it("stays empty when no date is stated", () => {
    expect(parseTimeframe("3 bedroom house in Cupertino", FIXED).timeframe).toBe("");
  });

  it("does not read a price as a date", () => {
    // chrono reads "$1M" as "1 month". The span the price parser claimed is skipped, and
    // the certainty guard rejects it anyway.
    expect(parseTimeframe("houses under $1M", FIXED).timeframe).toBe("");
  });
});

describe("buildSearchQuery", () => {
  it("leaves intent empty rather than guessing when nothing classified it", () => {
    expect(buildSearchQuery("3 bedroom in Cupertino").intent).toBe("");
  });

  it("keeps filters flowing while the intent is still unknown", () => {
    // This is what lets the card fill in as the user types instead of waiting on Jev.
    const q = buildSearchQuery("3 bed condo in Denver under 700k");
    expect(q).toMatchObject({
      intent: "",
      property_type: ["condo"],
      beds_min: 3,
      price_max: 700_000,
    });
    expect(q.location).toMatchObject({ city: "Denver", state: "CO" });
  });

  it("excludes price wording from raw_keywords", () => {
    // Deliberate: "under $1M" is already expressed exactly by price_max, and repeating it
    // as a free-text keyword would make a downstream text search double-filter on it.
    const q = buildSearchQuery("3 bedroom house in Cupertino under $1M");
    expect(q.raw_keywords.some((k) => /\$|1m|under/i.test(k))).toBe(false);
  });

  it("reads a monthly rent budget without inventing a move-in date", () => {
    // The live smoke test that caught both bugs at once: the price was dropped because a
    // zipcode matched first, and "a month" became a timeframe.
    const q = buildSearchQuery("studio apartment near 94110 pets ok under 2500 a month");
    expect(q).toMatchObject({
      property_type: ["apartment"],
      beds_min: 0,
      price_max: 2500,
      amenities: ["pet-friendly"],
      timeframe: "",
    });
    expect(q.location.zipcode).toBe("94110");
    expect(q.raw_keywords).not.toContain("a month");
  });

  it("reports whether anything at all was extracted", () => {
    expect(hasFilters(buildSearchQuery(""))).toBe(false);
    expect(hasFilters(buildSearchQuery("hello there"))).toBe(false);
    expect(hasFilters(buildSearchQuery("2br in 94110"))).toBe(true);
  });

  it("counts a lot-size constraint on its own as a runnable search", () => {
    // The registry-driven `hasFilters` exists for this: the hand-written field list it
    // replaced left the submit button dark for queries like this one.
    expect(hasFilters(buildSearchQuery("half an acre in Montana"))).toBe(true);
  });
});

describe("floor area vs lot area", () => {
  it("reads a bare figure as a minimum floor area", () => {
    expect(parseRooms("1200 sqft house")).toMatchObject({ sqft_min: 1200, sqft_max: null });
  });

  it("reads a comparator as a maximum, and a trailing plus as a minimum", () => {
    expect(parseRooms("under 1200 sqft")).toMatchObject({ sqft_min: null, sqft_max: 1200 });
    expect(parseRooms("1500+ sqft")).toMatchObject({ sqft_min: 1500, sqft_max: null });
  });

  it("reads a two-ended range", () => {
    expect(parseRooms("2,000 to 3,000 sq ft")).toMatchObject({ sqft_min: 2000, sqft_max: 3000 });
  });

  it("does not read a lot size as floor area, or the reverse", () => {
    // The collision this pair pins: the same unit on both fields, told apart only by an
    // adjacent lot word. Before `inLotContext` both parsers claimed both figures.
    expect(parseRooms("12000 sqft lot").sqft_min).toBeNull();
    expect(parseHome("12000 sqft lot").lot_size_min).toBe(12000);
    expect(parseHome("1200 sqft house").lot_size_min).toBeNull();
  });

  it("converts acres to square feet so one unit reaches the backend", () => {
    expect(parseHome("half an acre").lot_size_min).toBe(21780);
    expect(parseHome("under 2 acres").lot_size_max).toBe(87120);
  });
});

describe("one constraint, one field", () => {
  it("does not read a lot size as a request for vacant land", () => {
    // A parcel with nothing on it has no bedrooms, so `land` beside a bed count is wrong —
    // and leaving it set would filter out every house the person just described.
    const q = buildSearchQuery("3 bed single story house, half an acre");
    expect(q.property_type).toEqual(["house"]);
    expect(q.lot_size_min).toBe(21780);
  });

  it("still reads an unqualified parcel as land", () => {
    expect(parsePropertyType("2 acres of vacant land in Montana").property_type).toEqual(["land"]);
  });

  it("carries 'no HOA' as a ceiling and not also as an amenity", () => {
    const q = buildSearchQuery("condo with no HOA");
    expect(q.hoa_max).toBe(0);
    expect(q.amenities).not.toContain("no-hoa");
    // The words survive for a text search even though the tag is gone.
    expect(q.raw_keywords.some((k) => /hoa/i.test(k))).toBe(true);
  });

  it("carries new construction as a listing type and not also as an amenity", () => {
    const q = buildSearchQuery("newly built homes in Cupertino");
    expect(q.listing_types).toEqual(["new-construction"]);
    expect(q.amenities).not.toContain("new-construction");
  });

  it("folds the core new-construction signal into the listing type in either mode", () => {
    // `wantsNewConstruction` is asked in both modes, and what it means is a filter-panel
    // "Type" checkbox — so the overlay applies with no extended answers in hand.
    const q = buildSearchQuery(
      "somewhere nobody has lived in before",
      result({ wantsNewConstruction: 0.93 }),
    );
    expect(q.listing_types).toEqual(["new-construction"]);
  });

  it("orders a list the vocabulary's way even when Jev contributed to it", () => {
    // "foreclosure" precedes "new-construction" in LISTING_TYPES, so the signal-added
    // entry has to sort in rather than land wherever it was pushed.
    const q = buildSearchQuery("foreclosures in Cupertino", result({ wantsNewConstruction: 0.93 }));
    expect(q.listing_types).toEqual(["foreclosure", "new-construction"]);
  });
});

describe("home details", () => {
  it("stores home age in years, inverting a build year once", () => {
    const year = new Date().getFullYear();
    expect(parseHome("built after 2015").home_age_max).toBe(year - 2015);
    expect(parseHome("less than 10 years old").home_age_max).toBe(10);
    expect(parseHome("built before 1950").home_age_min).toBe(year - 1950);
  });

  it("needs the letters HOA before claiming an amount", () => {
    expect(parseHome("condo with $300 HOA").hoa_max).toBe(300);
    // An unqualified amount belongs to the price parser, which has the better claim.
    expect(parseHome("condo for $300,000").hoa_max).toBeNull();
  });

  it("reads 'no HOA' as a ceiling of zero rather than an absent filter", () => {
    expect(parseHome("house with no HOA").hoa_max).toBe(0);
  });

  it("reserves the HOA amount so it is not also read as the asking price", () => {
    const q = buildSearchQuery("condo in Cupertino under $400k with $300 HOA");
    expect(q.price_max).toBe(400000);
    expect(q.hoa_max).toBe(300);
  });

  it("clamps the garage bucket at the panel maximum of 3+, and reads a bare garage as one", () => {
    expect(parseHome("3 car garage").garage_min).toBe(3);
    expect(parseHome("5 car garage").garage_min).toBe(3);
    expect(parseHome("house with a garage").garage_min).toBe(1);
  });

  it("keeps a bare garage in the keywords now that the amenity tag is gone", () => {
    const q = buildSearchQuery("house with a garage");
    expect(q.amenities).not.toContain("garage");
    expect(q.raw_keywords.some((k) => /garage/i.test(k))).toBe(true);
  });

  it("lets an explicit storey count beat a single-storey house style", () => {
    expect(parseHome("single story home").stories).toBe("single");
    expect(parseHome("no stairs").stories).toBe("single");
    expect(parseHome("2 story ranch").stories).toBe("multi");
  });
});

describe("listing details", () => {
  it("lets 'sold' beat 'for sale', because sold queries mention both", () => {
    expect(parseListing("what did houses sell for, not what's for sale").sale_status).toBe("just_sold");
    expect(parseListing("homes for sale in Cupertino").sale_status).toBe("for_sale");
  });

  it("requires a listing word before reading 'active' as a status", () => {
    // A bare "active" belongs to "active adult community", which is the 55+ filter.
    expect(parseListing("active adult community").listing_status).toBe("");
    expect(parseListing("active adult community").listing_types).toContain("55-plus");
    expect(parseListing("active listings only").listing_status).toBe("active");
  });

  it("orders listing types by the vocabulary so equivalent queries compare equal", () => {
    const a = parseListing("foreclosures and new construction");
    const b = parseListing("new construction and foreclosures");
    expect(a.listing_types).toEqual(b.listing_types);
  });

  it("keeps only the narrower tour claim when one phrase matches two", () => {
    expect(parseListing("virtual walkthrough").tours).toEqual(["3d-tour"]);
    expect(parseListing("virtual tours").tours).toEqual(["virtual-tour"]);
  });

  it("reads days on market as an upper bound in days", () => {
    expect(parseListing("listed in the last 3 days").days_on_market).toBe(3);
    expect(parseListing("in the last week").days_on_market).toBe(7);
    expect(parseListing("listed today").days_on_market).toBe(1);
    expect(parseListing("houses in Cupertino").days_on_market).toBeNull();
  });

  it("reads the two listing flags", () => {
    expect(parseListing("price reduced homes").price_reduced).toBe(true);
    expect(parseListing("with closing cost help").builder_promotions).toBe(true);
    expect(parseListing("homes in Cupertino").price_reduced).toBe(false);
  });
});

describe("commute and expanded search", () => {
  it("defaults an unqualified travel time to driving, as the filter panel does", () => {
    expect(parseCommute("30 minutes from downtown")).toMatchObject({ max_minutes: 30, mode: "driving" });
  });

  it("reads the stated mode when there is one", () => {
    expect(parseCommute("20 min walk to the train").mode).toBe("transit");
    expect(parseCommute("within a 15 minute bike ride of campus").mode).toBe("cycling");
  });

  it("converts hours to minutes", () => {
    expect(parseCommute("under a 2 hour commute").max_minutes).toBe(120);
  });

  it("leaves the destination exactly as typed", () => {
    // Normalising it would corrupt a geocoder's input, which is the one consumer of it.
    expect(parseCommute("20 minutes from 100 Main St").address).toBe("100 Main St");
  });

  it("stops the address where the next filter begins", () => {
    expect(parseCommute("20 min from the office with 3 bedrooms").address).toBe("office");
  });

  it("requires a unit before reading a duration", () => {
    // A bare number beside a place name is a house number far more often than a duration.
    expect(parseCommute("30 Main Street").max_minutes).toBeNull();
  });

  it("accepts the abbreviated unit when a travel word follows it", () => {
    expect(parseCommute("condos 20m drive from the office").max_minutes).toBe(20);
    expect(parseCommute("15m walk to campus").max_minutes).toBe(15);
  });

  it("does not read the millions suffix as minutes", () => {
    // "from $3M to $5M" matched "3 m(inutes)", with the "to" of "to $5M" satisfying the
    // travel-word lookahead from 40 characters away.
    expect(parseCommute("homes from $3M to $5M")).toMatchObject({ max_minutes: null, mode: "" });
    expect(parseCommute("$1.5M to $2M with a pool").max_minutes).toBeNull();
  });

  it("reads a radius and the nearby-areas toggle", () => {
    expect(parseCommute("within 5 miles of Cupertino").radius_miles).toBe(5);
    expect(parseCommute("Cupertino and nearby areas").include_nearby_areas).toBe(true);
    expect(parseCommute("Cupertino").include_nearby_areas).toBe(false);
  });
});
