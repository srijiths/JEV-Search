import type { Answer, IntentResult, SignalKey, Signals } from "./jev/types";

/**
 * Signal gating.
 *
 * Every probability Jev returns moves a little on every keystroke. Comparing each one
 * against a single threshold would make badges and chips blink on and off while the
 * user is still typing, so each signal has a *pair* of thresholds: a higher one to
 * turn on and a lower one to stay on. A signal hovering at the boundary holds whatever
 * it already was instead of oscillating.
 *
 * This is the same hysteresis idea as `decide.ts`, applied per signal rather than to
 * the intent as a whole.
 */
export const SIGNAL_THRESHOLDS = {
  /** A choice needs this much confidence before it is acted on. */
  choiceMin: 0.6,
  /** …and drops out only below this. The gap is what stops the flicker. */
  choiceKeep: 0.5,
  /** A noul turns on here. */
  noulOn: 0.65,
  /** …and off here. */
  noulOff: 0.45,
  /** Expected score, on a 1..3 rubric, at which "urgent" turns on. */
  urgentOn: 2.4,
  /** …and off. */
  urgentOff: 2.1,
} as const;

/**
 * Options that mean "no signal". A gated choice that lands on one of these is reported
 * as absent rather than as a confident answer, because "unspecified" is not something
 * the UI should render a chip for.
 */
const ESCAPES = new Set(["unspecified", "other", "none", "any"]);

/**
 * Was this choice previously in effect? A choice that was on stays on down to
 * `choiceKeep`; a choice that was off must clear `choiceMin`.
 */
export function gateChoice<T extends string>(answer: Answer<T>, wasOn: boolean): T | null {
  const floor = wasOn ? SIGNAL_THRESHOLDS.choiceKeep : SIGNAL_THRESHOLDS.choiceMin;
  if (answer.confidence < floor) return null;
  if (ESCAPES.has(answer.value)) return null;
  return answer.value;
}

export function gateNoul(value: number, wasOn: boolean): boolean {
  return value >= (wasOn ? SIGNAL_THRESHOLDS.noulOff : SIGNAL_THRESHOLDS.noulOn);
}

/** Which signals the UI currently considers active. `null` for a choice that is off. */
export type GatedSignals = {
  priceBound: string | null;
  priceCadence: string | null;
  sortPreference: string | null;
  urgent: boolean;
  /** Only the `wants*` / `is*` / `has*` nouls that are currently on. */
  flags: SignalKey[];
};

export function emptyGatedSignals(): GatedSignals {
  return { priceBound: null, priceCadence: null, sortPreference: null, urgent: false, flags: [] };
}

const NOUL_KEYS = [
  "wantsNewConstruction",
  "wantsOutdoorSpace",
  "wantsParking",
  "wantsPetFriendly",
  "wantsFurnished",
  "wantsLuxury",
  "wantsInvestment",
  "isFamilyOriented",
  "isQuestion",
  "hasNegation",
  "isAddressLookup",
] as const satisfies readonly SignalKey[];

/**
 * Gate a fresh result against the previously gated state.
 *
 * `prev` is what makes this hysteresis rather than thresholding — pass the last
 * `GatedSignals` you rendered, not a fresh empty one, or the flicker comes back.
 */
export function gateSignals(prev: GatedSignals, signals: Signals): GatedSignals {
  const flags = NOUL_KEYS.filter((key) => gateNoul(signals[key] as number, prev.flags.includes(key)));

  return {
    priceBound: gateChoice(signals.priceBound, prev.priceBound !== null),
    priceCadence: gateChoice(signals.priceCadence, prev.priceCadence !== null),
    sortPreference: gateChoice(signals.sortPreference, prev.sortPreference !== null),
    urgent: signals.urgency.score >= (prev.urgent ? SIGNAL_THRESHOLDS.urgentOff : SIGNAL_THRESHOLDS.urgentOn),
    flags,
  };
}

/** Convenience wrapper for callers holding a whole result. */
export const gateResult = (prev: GatedSignals, result: IntentResult): GatedSignals =>
  gateSignals(prev, result.signals);
