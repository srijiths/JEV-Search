import { describe, expect, it } from "vitest";
import { buildSearchQuery } from "../parse/query";
import { neutralAnswer, neutralSignals, noneResult, type IntentResult } from "../jev/types";

/**
 * The two queries in the spec, asserted field by field.
 *
 * `raw_keywords` is compared as a set. The spec's first example lists
 * ["3 bedroom", "Cupertino", "house", "backyard"], which is neither the order those
 * phrases appear in the text ("3 bedroom", "houses", "Cupertino", "backyard") nor a
 * consistent field order — the second example's list *is* text order. Since the field
 * is an unordered bag of search terms either way, this suite pins membership and
 * `mergeKeywords` pins text order, rather than encoding an ordering that the two
 * examples contradict.
 */

/** A Jev result with a known intent, for driving the fields Jev is responsible for. */
function jevSaid(intent: IntentResult["intent"]["value"], patch: Partial<IntentResult["signals"]> = {}) {
  return noneResult({
    intent: neutralAnswer(intent),
    signals: { ...neutralSignals(), ...patch },
    questionCount: 15,
    model: "typesafe/jev-1.13",
  });
}

describe("contract example 1 — buy", () => {
  const text = "Show me 3 bedroom houses to buy in Cupertino under $1M with a backyard";
  const q = buildSearchQuery(text, jevSaid("buy"));

  it("classifies the intent from Jev", () => expect(q.intent).toBe("buy"));
  it("reads the property type", () => expect(q.property_type).toEqual(["house"]));
  it("resolves the city to its state", () =>
    expect(q.location).toEqual({ city: "Cupertino", state: "CA", zipcode: "" }));
  it("reads $1M as a ceiling, not a floor", () => {
    expect(q.price_max).toBe(1_000_000);
    expect(q.price_min).toBeNull();
  });
  it("counts the bedrooms and leaves the rest unset", () => {
    expect(q.beds_min).toBe(3);
    expect(q.baths_min).toBeNull();
    expect(q.sqft_min).toBeNull();
  });
  it("tags the amenity", () => expect(q.amenities).toEqual(["backyard"]));
  it("leaves timeframe and sort empty", () => {
    expect(q.timeframe).toBe("");
    expect(q.sort_by).toBe("");
  });
  it("keeps the user's phrasing in raw_keywords", () =>
    expect(new Set(q.raw_keywords)).toEqual(new Set(["3 bedroom", "Cupertino", "house", "backyard"])));
});

describe("contract example 2 — rent", () => {
  const text = "Need a 2br apartment for rent near 94110, pets ok, budget 3k";
  const q = buildSearchQuery(text, jevSaid("rent"));

  it("classifies the intent from Jev", () => expect(q.intent).toBe("rent"));
  it("reads the property type", () => expect(q.property_type).toEqual(["apartment"]));
  it("uses the zipcode and leaves city/state empty", () =>
    expect(q.location).toEqual({ city: "", state: "", zipcode: "94110" }));
  it("reads 'budget 3k' as 3000 and not the zipcode", () => {
    expect(q.price_max).toBe(3_000);
    expect(q.price_min).toBeNull();
  });
  it("reads '2br' as two bedrooms", () => {
    expect(q.beds_min).toBe(2);
    expect(q.baths_min).toBeNull();
    expect(q.sqft_min).toBeNull();
  });
  it("canonicalises 'pets ok' to the pet-friendly tag", () =>
    expect(q.amenities).toEqual(["pet-friendly"]));
  it("leaves timeframe and sort empty", () => {
    expect(q.timeframe).toBe("");
    expect(q.sort_by).toBe("");
  });
  it("keeps the user's phrasing in raw_keywords", () =>
    expect(new Set(q.raw_keywords)).toEqual(new Set(["2br", "apartment", "94110", "pets"])));
  it("orders raw_keywords the way the user typed them", () =>
    expect(q.raw_keywords).toEqual(["2br", "apartment", "94110", "pets"]));
});
