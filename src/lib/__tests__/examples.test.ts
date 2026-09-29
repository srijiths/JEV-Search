import { describe, expect, it } from "vitest";
import { EXAMPLES, EXAMPLE_GROUPS } from "../examples";
import { FIELDS } from "../filters/fields";
import { buildSearchQuery, hasFilters } from "../parse/query";
import { emptySearchQuery, type SearchQuery } from "../jev/types";
import { PALETTE_ORDER } from "../../components/cards/intentSpecs";

/**
 * The example queries are the app's only documentation of what the box understands, so
 * "they cover every filter" has to be enforced rather than asserted in a comment. Add a
 * field to `FIELDS` without a query that fills it and the first test here fails with the
 * field's name.
 *
 * Everything is checked against the *parser* alone — `buildSearchQuery(text)` with no Jev
 * result — because a test that needed a network call to Jev would be a test nobody runs.
 * That is also why `intent` and `sort_by` are excluded: they are Jev's two fields and no
 * amount of parsing produces them.
 */

/** Dotted keys, so `location.city` and `commute.address` can be compared field by field. */
function flatten(query: SearchQuery): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(query)) {
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      for (const [inner, v] of Object.entries(value as Record<string, unknown>)) out[`${key}.${inner}`] = v;
    } else {
      out[key] = value;
    }
  }
  return out;
}

/** Fields no parser can fill — Jev's own two. See the module docs. */
const JEV_ONLY = new Set(["intent", "sort_by"]);

const EMPTY = flatten(emptySearchQuery());

/** Which fields this text actually filled, by differing from the empty query. */
function filledBy(text: string): Set<string> {
  const actual = flatten(buildSearchQuery(text));
  const filled = new Set<string>();
  for (const [field, value] of Object.entries(actual)) {
    if (JSON.stringify(value) !== JSON.stringify(EMPTY[field])) filled.add(field);
  }
  return filled;
}

describe("example queries", () => {
  it("between them, fill every field a parser owns", () => {
    const covered = new Set<string>();
    for (const example of EXAMPLES) for (const field of filledBy(example.text)) covered.add(field);

    const missing = FIELDS.map((f) => f.field)
      .filter((field) => !JEV_ONLY.has(field))
      .filter((field) => !covered.has(field));

    expect(missing).toEqual([]);
  });

  it("each one parses into something, so no example is decorative", () => {
    for (const example of EXAMPLES) {
      // `hasFilters` is what lights the submit button, so an example that fails this is one
      // a visitor could click and get nothing from.
      expect(hasFilters(buildSearchQuery(example.text)), example.text).toBe(true);
    }
  });

  it("groups every example exactly once, so none is unreachable in the UI", () => {
    const grouped = EXAMPLE_GROUPS.flatMap((g) => g.examples);
    expect(grouped.length).toBe(EXAMPLES.length);
    expect(new Set(grouped.map((e) => e.text)).size).toBe(EXAMPLES.length);
    for (const group of EXAMPLE_GROUPS) {
      // An empty group renders as a label with nothing beside it, which reads as a bug.
      expect(group.examples.length, group.intent).toBeGreaterThan(0);
      for (const example of group.examples) expect(example.intent).toBe(group.intent);
    }
  });

  it("groups in the same order the intent palette uses", () => {
    // `ExampleQueries` labels each group with that intent's palette colour and icon, so a
    // reader compares the two lists side by side. Two orders that drift apart would make
    // the empty state disagree with the row of buttons directly below it.
    expect(EXAMPLE_GROUPS.map((g) => g.intent)).toEqual(PALETTE_ORDER);
  });

  it("names Cupertino rather than any other city, so the demo reads consistently", () => {
    // Not every example needs a city — but any that names one should name this one.
    for (const example of EXAMPLES) {
      const { city } = buildSearchQuery(example.text).location;
      if (city) expect(city, example.text).toBe("Cupertino");
    }
  });
});
