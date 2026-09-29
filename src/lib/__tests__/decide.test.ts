import { describe, expect, it } from "vitest";
import {
  THRESHOLDS,
  activeIntent,
  changedSubstantially,
  decide,
  force,
  initialMemory,
  isRefinement,
  levenshtein,
  promote,
  ranked,
  rawState,
  reset,
  type Memory,
} from "../decide";
import { neutralAnswer, neutralSignals, type IntentKey, type IntentResult } from "../jev/types";

/**
 * These tests exist because the state machine's whole job is *not* doing the obvious
 * thing. Every assertion below is a case where rendering the raw argmax would have been
 * simpler and wrong: a card that flips mid-word, or one that refuses to flip when the
 * user has clearly changed their mind.
 */

function resultWith(probabilities: Partial<Record<IntentKey, number>>): IntentResult {
  const entries = Object.entries(probabilities) as Array<[IntentKey, number]>;
  const top = entries.reduce((best, e) => (e[1] > best[1] ? e : best), entries[0]!);
  return {
    intent: { value: top[0], confidence: top[1], probabilities },
    readiness: 1,
    signals: neutralSignals(),
    latencyMs: 10,
    questionCount: 15,
    model: "test",
  };
}

const committed = (intent: "buy" | "rent", lockedText: string): Memory => ({
  state: { kind: "committed", intent },
  lockedText,
  challenger: null,
});

describe("levenshtein", () => {
  it("is zero for identical strings and handles empties", () => {
    expect(levenshtein("cupertino", "cupertino")).toBe(0);
    expect(levenshtein("", "abc")).toBe(3);
    expect(levenshtein("abc", "")).toBe(3);
  });

  it("counts single-character edits", () => {
    expect(levenshtein("kitten", "sitting")).toBe(3);
    expect(levenshtein("3br", "3bd")).toBe(1);
  });
});

describe("changedSubstantially", () => {
  it("treats an unlocked memory as always changed", () => {
    expect(changedSubstantially("", "anything")).toBe(true);
  });

  it("ignores a one-word edit inside a long query", () => {
    const locked = "3 bedroom house to buy in Cupertino under $1M with a backyard";
    expect(changedSubstantially(locked, `${locked} and a pool`)).toBe(false);
  });

  it("recognises a pure append as a refinement", () => {
    expect(isRefinement("3 bed in Cupertino", "3 bed in Cupertino with a pool")).toBe(true);
    expect(isRefinement("3 BED in Cupertino", "3 bed in cupertino with a pool")).toBe(true);
    // An edit inside the query is not a refinement, even though it is small.
    expect(isRefinement("3 bed in Cupertino", "4 bed in Cupertino")).toBe(false);
    expect(isRefinement("", "anything")).toBe(false);
  });

  it("treats clearing a long query as a change", () => {
    // Scaled by the *locked* length, so deleting almost everything counts even though
    // the remaining text is short. Scaling by max() would have made this false.
    expect(changedSubstantially("3 bedroom house to buy in Cupertino", "condo")).toBe(true);
  });
});

describe("ranked", () => {
  it("drops `none` rather than ranking it", () => {
    const order = ranked(resultWith({ none: 0.8, buy: 0.15, rent: 0.05 }));
    expect(order.map((r) => r.intent)).toEqual(["buy", "rent"]);
  });

  it("falls back to the chosen value when probabilities are absent", () => {
    const result: IntentResult = {
      ...resultWith({ buy: 1 }),
      intent: { value: "buy", confidence: 0.9, probabilities: {} },
    };
    expect(ranked(result)).toEqual([{ intent: "buy", p: 0.9 }]);
  });
});

describe("rawState", () => {
  it("stays on the plain input below the floor", () => {
    expect(rawState(resultWith({ buy: 0.3, rent: 0.2 })).kind).toBe("input");
  });

  it("previews as a ghost between the floor and the commit line", () => {
    expect(rawState(resultWith({ buy: 0.6, rent: 0.1 }))).toEqual({ kind: "ghost", intent: "buy" });
  });

  it("commits at or above the commit line", () => {
    expect(rawState(resultWith({ buy: 0.8, rent: 0.1 }))).toEqual({ kind: "committed", intent: "buy" });
  });

  it("asks when two intents are genuinely close", () => {
    // "3 bedroom in Cupertino" — nothing in it says buy or rent. Guessing is a coin flip.
    expect(rawState(resultWith({ buy: 0.45, rent: 0.4 }))).toEqual({
      kind: "choose",
      options: ["buy", "rent"],
    });
  });

  it("does not ask when the runner-up is below the floor", () => {
    // A close second that is itself unlikely is noise, not a tie worth a click.
    expect(rawState(resultWith({ buy: 0.42, rent: 0.2 }))).toEqual({ kind: "ghost", intent: "buy" });
  });

  it("prefers committing over asking once the leader clears the commit line", () => {
    const state = rawState(resultWith({ buy: 0.75, rent: 0.7 }));
    expect(state).toEqual({ kind: "committed", intent: "buy" });
  });
});

describe("decide — holding a committed card", () => {
  const text = "3 bedroom house to buy in Cupertino";

  it("holds while its intent is still the top answer", () => {
    const next = decide(committed("buy", text), resultWith({ buy: 0.72, rent: 0.2 }), text);
    expect(next.state).toEqual({ kind: "committed", intent: "buy" });
  });

  it("holds through a single strong challenger keystroke", () => {
    // This is the flicker case. One round of rent leading is not enough to tear the
    // buy card down, because the next keystroke often puts buy back in front.
    const next = decide(committed("buy", text), resultWith({ rent: 0.7, buy: 0.3 }), text);
    expect(next.state).toEqual({ kind: "committed", intent: "buy" });
    expect(next.challenger).toEqual({ intent: "rent", wins: 1 });
  });

  it("hands over once a challenger leads for two consecutive rounds", () => {
    const challenge = resultWith({ rent: 0.7, buy: 0.3 });
    const once = decide(committed("buy", text), challenge, text);
    const twice = decide(once, challenge, text);
    expect(twice.state).toEqual({ kind: "committed", intent: "rent" });
    expect(twice.challenger).toBeNull();
  });

  it("resets the win counter when the challenger changes", () => {
    const a = decide(committed("buy", text), resultWith({ rent: 0.7, buy: 0.3 }), text);
    const b = decide(a, resultWith({ sold: 0.65, buy: 0.35 }), text);
    expect(b.challenger).toEqual({ intent: "sold", wins: 1 });
    expect(b.state).toEqual({ kind: "committed", intent: "buy" });
  });

  it("hands over immediately when a challenger is overwhelming", () => {
    const next = decide(committed("buy", text), resultWith({ rent: 0.9, buy: 0.35 }), text);
    expect(next.state).toEqual({ kind: "committed", intent: "rent" });
  });

  it("falls back to a preview when its own intent collapses", () => {
    const next = decide(committed("buy", text), resultWith({ rent: 0.55, buy: 0.1 }), text);
    expect(next.state).toEqual({ kind: "ghost", intent: "rent" });
  });

  it("drops the lock when the query is rewritten", () => {
    const next = decide(committed("buy", text), resultWith({ rent: 0.62, buy: 0.1 }), "studio in 94110");
    expect(next.state).toEqual({ kind: "ghost", intent: "rent" });
    expect(next.lockedText).toBe("");
  });
});

describe("decide — a user-forced intent", () => {
  const text = "3 bedroom house in Cupertino under $1M";

  it("outranks the model on the same query", () => {
    const memory = force("rent", text);
    expect(decide(memory, resultWith({ buy: 0.8, rent: 0.05 }), text)).toBe(memory);
  });

  it("survives the query being refined, however long the addition", () => {
    // By edit distance, appending this is a third of the original query — a "substantial
    // change". But the user's question is still there in full, so throwing away their
    // explicit pick because they added an amenity would be obnoxious.
    const memory = force("rent", text);
    const next = decide(memory, resultWith({ buy: 0.7, rent: 0.1 }), `${text} with a backyard`);
    expect(next).toBe(memory); // same object: nothing to re-render
  });

  it("still yields mid-refinement when the added words contradict the pick", () => {
    const next = decide(force("rent", text), resultWith({ buy: 0.95, rent: 0.02 }), `${text} to buy`);
    expect(next.state).toEqual({ kind: "committed", intent: "buy" });
  });

  it("yields once the query becomes a different question", () => {
    const next = decide(force("rent", text), resultWith({ mortgage: 0.88 }), "what can I afford");
    expect(next.state).toEqual({ kind: "committed", intent: "mortgage" });
  });
});

describe("promote, reset, activeIntent", () => {
  it("promotes a chosen option to an ordinary commit, not a forced one", () => {
    const memory = promote("rent", "3 bedroom in Cupertino");
    expect(memory.state).toEqual({ kind: "committed", intent: "rent" });
    // Not `forced`: the user answered a question we asked, they did not override us, so
    // Jev is still allowed to change its mind later.
    expect(memory.state).not.toHaveProperty("forced", true);
  });

  it("resets to the initial memory", () => {
    expect(reset()).toEqual(initialMemory());
  });

  it("reports an intent only for the two states that render a card", () => {
    expect(activeIntent({ kind: "input" })).toBeNull();
    expect(activeIntent({ kind: "choose", options: ["buy", "rent"] })).toBeNull();
    expect(activeIntent({ kind: "ghost", intent: "buy" })).toBe("buy");
    expect(activeIntent({ kind: "committed", intent: "rent" })).toBe("rent");
  });
});

describe("thresholds stay coherent", () => {
  it("keeps every hysteresis pair in the right order", () => {
    // A guard against a future edit that accidentally inverts a pair and reintroduces
    // the oscillation these thresholds exist to prevent.
    expect(THRESHOLDS.inputBelow).toBeLessThan(THRESHOLDS.commitAt);
    expect(THRESHOLDS.dropBelow).toBeLessThan(THRESHOLDS.inputBelow);
    expect(THRESHOLDS.commitAt).toBeLessThan(THRESHOLDS.challengerOverride);
    expect(THRESHOLDS.chooseFloor).toBeLessThan(THRESHOLDS.inputBelow);
  });
});

describe("a fresh memory", () => {
  it("takes the raw reading, since there is nothing to protect", () => {
    const next = decide(initialMemory(), resultWith({ buy: 0.8 }), "buy a house");
    expect(next.state).toEqual({ kind: "committed", intent: "buy" });
    expect(next.lockedText).toBe("buy a house");
  });

  it("does not lock text for a state that is not a commitment", () => {
    const next = decide(initialMemory(), resultWith({ buy: 0.5 }), "a house");
    expect(next.state).toEqual({ kind: "ghost", intent: "buy" });
    expect(next.lockedText).toBe("");
  });
});

describe("neutralAnswer", () => {
  it("is fully confident in its own value", () => {
    expect(neutralAnswer("none")).toEqual({ value: "none", confidence: 1, probabilities: { none: 1 } });
  });
});
