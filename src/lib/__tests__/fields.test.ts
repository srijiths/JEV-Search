import { describe, expect, it } from "vitest";
import { FIELDS, SWITCHABLE_FIELDS, baselineSources, sourceFor, specFor } from "../filters/fields";
import { EXTRACTION_MODES } from "../extraction";
import { emptySearchQuery, type SearchQuery } from "../jev/types";
import {
  CHOICE_ESCAPE,
  EXTENDED_CHOICES,
  EXTENDED_NOUL_KEYS,
  EXTENDED_QUESTION_COUNT,
  FEATURE_NOULS,
  LISTING_FLAG_NOULS,
  LISTING_TAG_NOULS,
  choiceOptions,
  extendedQuestions,
} from "../jev/extended";
import { QUESTION_COUNT, questions } from "../jev/questions";
import { DEFAULT_MODEL, decisionsRequest, questionsFor, requestChars } from "../jev/request";
import { FEATURE_TAGS } from "../parse/amenities";
import {
  LISTING_STATUSES,
  LISTING_TYPES,
  PROPERTY_TYPES,
  SALE_STATUSES,
  STORY_COUNTS,
  TOURS,
  COMMUTE_MODES,
} from "../jev/types";

/**
 * The three things that have to agree, and previously did not.
 *
 * `SearchQuery`, the field registry and the extended question set are written in three
 * different files and describe one thing between them: the filter set. Nothing in the
 * type system connects them — a question can name a feature tag the amenity table
 * dropped, and the registry can list a field a refactor renamed, and both compile.
 * These tests are the join.
 */

/** `{ location: { city } }` -> `location.city`, matching how the registry names nested keys. */
function flatKeys(query: SearchQuery): string[] {
  const out: string[] = [];
  for (const [key, value] of Object.entries(query)) {
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      for (const inner of Object.keys(value as Record<string, unknown>)) out.push(`${key}.${inner}`);
    } else {
      out.push(key);
    }
  }
  return out;
}

describe("field registry", () => {
  const queryKeys = flatKeys(emptySearchQuery());

  it("lists every field a SearchQuery carries", () => {
    const listed = new Set(FIELDS.map((f) => f.field));
    expect(queryKeys.filter((k) => !listed.has(k))).toEqual([]);
  });

  it("lists nothing a SearchQuery does not carry", () => {
    const actual = new Set(queryKeys);
    expect(FIELDS.map((f) => f.field).filter((f) => !actual.has(f))).toEqual([]);
  });

  it("names each field once", () => {
    expect(new Set(FIELDS.map((f) => f.field)).size).toBe(FIELDS.length);
  });

  it("assigns every field a source in every mode", () => {
    for (const mode of EXTRACTION_MODES) {
      const sources = baselineSources(mode);
      for (const key of queryKeys) expect(sources[key]).toBeDefined();
    }
  });

  it("moves exactly the closed-set and bucket fields between modes", () => {
    // The point of the flag, stated as a test: a field changes hands iff its kind is one
    // Jev can answer. If this ever passes for a `numeric` field, something is pretending
    // a model can return a price.
    const moved = FIELDS.filter((f) => sourceFor(f.kind, "hybrid") !== sourceFor(f.kind, "jev"));
    expect(moved.map((f) => f.field).sort()).toEqual(SWITCHABLE_FIELDS.map((f) => f.field).sort());
    for (const f of moved) expect(["closed", "bucket"]).toContain(f.kind);
  });

  it("finds a spec by field name", () => {
    expect(specFor("price_max")?.kind).toBe("numeric");
    expect(specFor("no_such_field")).toBeUndefined();
  });
});

describe("extended question set", () => {
  it("asks each question once, under its own key", () => {
    const keys = Object.keys(extendedQuestions());
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.length).toBe(EXTENDED_QUESTION_COUNT);
  });

  it("names every noul in EXTENDED_NOUL_KEYS", () => {
    const declared = [...LISTING_TAG_NOULS, ...LISTING_FLAG_NOULS, ...FEATURE_NOULS].map((n) => n.key);
    expect([...EXTENDED_NOUL_KEYS].sort()).toEqual(declared.sort());
  });

  it("only infers feature tags the amenity vocabulary actually has", () => {
    // The failure this catches is silent: `query.ts` drops unknown tags, so a typo here
    // would cost a filter with nothing anywhere reporting it.
    const known = new Set<string>(FEATURE_TAGS);
    expect(FEATURE_NOULS.map((n) => n.tag).filter((t) => !known.has(t))).toEqual([]);
  });

  it("gives every choice question an escape option inside its own option set", () => {
    for (const key of Object.keys(EXTENDED_CHOICES) as (keyof typeof EXTENDED_CHOICES)[]) {
      expect(choiceOptions(key)).toContain(CHOICE_ESCAPE[key]);
    }
  });

  it("offers only option labels that are legal field values", () => {
    // Option keys double as the values they produce, so an option outside the vocabulary
    // would be dropped by `pickChoice` and the question would cost money for nothing.
    const legal: Record<string, readonly string[]> = {
      homeType: PROPERTY_TYPES,
      listingStatus: LISTING_STATUSES,
      saleRecency: SALE_STATUSES,
      stories: STORY_COUNTS,
      commuteMode: COMMUTE_MODES,
    };
    for (const [key, values] of Object.entries(legal)) {
      const options = choiceOptions(key as keyof typeof EXTENDED_CHOICES).filter(
        (o) => o !== CHOICE_ESCAPE[key as keyof typeof EXTENDED_CHOICES],
      );
      expect(options.filter((o) => !values.includes(o))).toEqual([]);
    }
  });

  it("produces only legal list values from the listing nouls", () => {
    for (const { field, value } of LISTING_TAG_NOULS) {
      const vocabulary = field === "tours" ? TOURS : LISTING_TYPES;
      expect(vocabulary).toContain(value);
    }
  });

  it("keeps bucket options numeric, or the one label that is not", () => {
    for (const key of ["bedsBucket", "bathsBucket", "garageSize"] as const) {
      for (const option of choiceOptions(key)) {
        if (option === CHOICE_ESCAPE[key] || option === "studio") continue;
        expect(Number.isInteger(Number(option))).toBe(true);
      }
    }
  });
});

/**
 * The request body, which two callers now depend on being the same object.
 *
 * `client.ts` sends it and the debug panel renders it. The whole point of building it in one
 * place is that the panel cannot lie about what was posted — so these tests guard the
 * properties the panel asserts on screen, not the ones a caller happens to read.
 */
describe("decisions request", () => {
  it("sends the core set in hybrid and both sets in jev", () => {
    // Also the collision test: the two sets are merged by spread, so a shared key would
    // silently drop a question and the count is the only thing that notices.
    expect(Object.keys(questionsFor("hybrid")).length).toBe(QUESTION_COUNT);
    expect(Object.keys(questionsFor("jev")).length).toBe(QUESTION_COUNT + EXTENDED_QUESTION_COUNT);
  });

  it("asks everything hybrid asks when in jev mode", () => {
    const extra = questionsFor("jev");
    for (const [key, question] of Object.entries(questions)) expect(extra[key]).toBe(question);
  });

  it("hands Jev the query and nothing else", () => {
    // The panel says so in as many words. If `state` ever grows a field, that sentence
    // becomes false and someone has to decide what the UI should claim instead.
    expect(decisionsRequest("3 bed in Cupertino").state).toEqual({ query: "3 bed in Cupertino" });
  });

  it("copies the question set, so a caller cannot mutate the shared one", () => {
    const set = questionsFor("hybrid");
    delete set[Object.keys(set)[0]];
    expect(Object.keys(questionsFor("hybrid")).length).toBe(QUESTION_COUNT);
  });

  it("pins a routable model by default and lets the server override it", () => {
    expect(decisionsRequest("x").model).toBe(DEFAULT_MODEL);
    expect(decisionsRequest("x", "hybrid", "typesafe/jev-9").model).toBe("typesafe/jev-9");
  });

  it("costs more in jev mode, which is the only reason the flag exists", () => {
    expect(requestChars(decisionsRequest("x", "jev"))).toBeGreaterThan(
      requestChars(decisionsRequest("x", "hybrid")),
    );
  });
});
