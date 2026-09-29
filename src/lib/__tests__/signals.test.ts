import { describe, expect, it } from "vitest";
import {
  SIGNAL_THRESHOLDS,
  emptyGatedSignals,
  gateChoice,
  gateNoul,
  gateResult,
  gateSignals,
} from "../signals";
import { neutralAnswer, neutralSignals, noneResult, type Answer, type Signals } from "../jev/types";

/**
 * The gating tests all turn on the same question: given the *same* probability, does the
 * answer differ depending on what was already on screen? It has to. A signal sitting on
 * its threshold must hold, not blink.
 */

const answer = <T extends string>(value: T, confidence: number): Answer<T> => ({
  value,
  confidence,
  probabilities: { [value]: confidence } as Partial<Record<T, number>>,
});

const signals = (overrides: Partial<Signals> = {}): Signals => ({ ...neutralSignals(), ...overrides });

describe("gateChoice", () => {
  it("needs the higher threshold to turn on", () => {
    expect(gateChoice(answer("maximum", 0.55), false)).toBeNull();
    expect(gateChoice(answer("maximum", 0.6), false)).toBe("maximum");
  });

  it("stays on down to the lower threshold", () => {
    // The same 0.55 that could not turn the signal on keeps it on once it is on.
    expect(gateChoice(answer("maximum", 0.55), true)).toBe("maximum");
    expect(gateChoice(answer("maximum", 0.49), true)).toBeNull();
  });

  it("reports escape options as absent however confident they are", () => {
    // "unspecified" at 99% is a confident statement that there is no signal here.
    expect(gateChoice(answer("unspecified", 0.99), false)).toBeNull();
    expect(gateChoice(neutralAnswer("none"), true)).toBeNull();
  });
});

describe("gateNoul", () => {
  it("uses the on threshold when off and the off threshold when on", () => {
    expect(gateNoul(0.5, false)).toBe(false);
    expect(gateNoul(0.5, true)).toBe(true);
    expect(gateNoul(0.7, false)).toBe(true);
    expect(gateNoul(0.4, true)).toBe(false);
  });
});

describe("gateSignals", () => {
  it("reports nothing for a neutral result", () => {
    expect(gateSignals(emptyGatedSignals(), neutralSignals())).toEqual(emptyGatedSignals());
  });

  it("turns on the flags that clear the threshold and no others", () => {
    const gated = gateSignals(
      emptyGatedSignals(),
      signals({ wantsPetFriendly: 0.9, wantsParking: 0.5, wantsLuxury: 0.66 }),
    );
    expect(gated.flags).toEqual(["wantsPetFriendly", "wantsLuxury"]);
  });

  it("keeps a borderline flag that was already on", () => {
    const first = gateSignals(emptyGatedSignals(), signals({ wantsOutdoorSpace: 0.8 }));
    const second = gateSignals(first, signals({ wantsOutdoorSpace: 0.5 }));
    expect(first.flags).toEqual(["wantsOutdoorSpace"]);
    expect(second.flags).toEqual(["wantsOutdoorSpace"]);

    // …but not once it falls past the off threshold.
    const third = gateSignals(second, signals({ wantsOutdoorSpace: 0.3 }));
    expect(third.flags).toEqual([]);
  });

  it("gates each choice independently", () => {
    const gated = gateSignals(
      emptyGatedSignals(),
      signals({
        priceBound: answer("maximum", 0.82),
        priceCadence: answer("monthly", 0.55), // below the on threshold
        sortPreference: answer("price_asc", 0.7),
      }),
    );
    expect(gated).toMatchObject({ priceBound: "maximum", priceCadence: null, sortPreference: "price_asc" });
  });

  it("applies hysteresis to the urgency score, not a single cutoff", () => {
    const rising = gateSignals(emptyGatedSignals(), signals({ urgency: { score: 2.2, confidence: 0.8 } }));
    expect(rising.urgent).toBe(false);

    const on = gateSignals(emptyGatedSignals(), signals({ urgency: { score: 2.5, confidence: 0.8 } }));
    expect(on.urgent).toBe(true);

    const holding = gateSignals(on, signals({ urgency: { score: 2.2, confidence: 0.8 } }));
    expect(holding.urgent).toBe(true);

    const off = gateSignals(holding, signals({ urgency: { score: 2.0, confidence: 0.8 } }));
    expect(off.urgent).toBe(false);
  });

  it("is pure — the previous state is never mutated", () => {
    const prev = gateSignals(emptyGatedSignals(), signals({ wantsPetFriendly: 0.9 }));
    const snapshot = structuredClone(prev);
    gateSignals(prev, signals({ wantsParking: 0.9 }));
    expect(prev).toEqual(snapshot);
  });
});

describe("gateResult", () => {
  it("unwraps a whole result", () => {
    expect(gateResult(emptyGatedSignals(), noneResult())).toEqual(emptyGatedSignals());
  });
});

describe("signal thresholds stay coherent", () => {
  it("keeps the keep-threshold below the turn-on threshold in every pair", () => {
    expect(SIGNAL_THRESHOLDS.choiceKeep).toBeLessThan(SIGNAL_THRESHOLDS.choiceMin);
    expect(SIGNAL_THRESHOLDS.noulOff).toBeLessThan(SIGNAL_THRESHOLDS.noulOn);
    expect(SIGNAL_THRESHOLDS.urgentOff).toBeLessThan(SIGNAL_THRESHOLDS.urgentOn);
  });
});
