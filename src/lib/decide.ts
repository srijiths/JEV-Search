import type { CardIntent, IntentKey, IntentResult } from "./jev/types";

/**
 * The confidence state machine.
 *
 * Jev re-answers on every keystroke, and its probabilities genuinely move as a query
 * takes shape: "3 bed" leans rent, "3 bed house to buy" leans buy. Rendering the raw
 * argmax would make the card thrash between layouts mid-word — the single worst thing
 * a morphing UI can do, because the user loses the thing they were reading.
 *
 * So the raw answer is never rendered directly. It feeds a machine with four states
 * and a deliberate reluctance to leave the one it is in:
 *
 *   input      -> nothing is confident enough to show
 *   ghost      -> a faint preview of where this is heading, still editable as text
 *   choose     -> two intents are genuinely close; ask instead of guessing
 *   committed  -> the card is up
 *
 * Every threshold below is a hysteresis pair or a counter. None of them are tuning
 * knobs on accuracy; they are all about not moving the UI under the user's hands.
 */

export const THRESHOLDS = {
  /** Below this, show the plain input — no preview at all. */
  inputBelow: 0.4,
  /** At or above this, a single intent is confident enough to render its card. */
  commitAt: 0.7,
  /** Two intents this close are a genuine tie, not a winner. */
  chooseGap: 0.15,
  /** …but only worth asking about if both are at least this likely. */
  chooseFloor: 0.25,
  /** A challenger this confident takes over immediately, without waiting. */
  challengerOverride: 0.85,
  /** Otherwise it must beat the incumbent this many keystrokes in a row. */
  challengerWins: 2,
  /** A committed card falls back to a preview only once its intent drops below this. */
  dropBelow: 0.3,
  /**
   * How much of the query has to change before a committed or user-forced intent stops
   * being sticky. A fraction of the committed text's length, so editing one word in a
   * long query does not reset the card, but clearing it and typing something else does.
   */
  forcedChangeRatio: 0.3,
} as const;

export type UiState =
  | { kind: "input" }
  | { kind: "ghost"; intent: CardIntent }
  | { kind: "choose"; options: [CardIntent, CardIntent] }
  | { kind: "committed"; intent: CardIntent; forced?: boolean };

export type Memory = {
  state: UiState;
  /** The query as it read when the current intent was locked in. */
  lockedText: string;
  /** The intent currently mounting a challenge, and how many consecutive rounds it has won. */
  challenger: { intent: CardIntent; wins: number } | null;
};

export const initialMemory = (): Memory => ({ state: { kind: "input" }, lockedText: "", challenger: null });

export function activeIntent(state: UiState): CardIntent | null {
  return state.kind === "ghost" || state.kind === "committed" ? state.intent : null;
}

// ─────────────────────────────────────────────────────────────
// Text change detection
// ─────────────────────────────────────────────────────────────

/** Iterative two-row Levenshtein — called on every keystroke, so no recursion, no matrix. */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  let curr = new Array<number>(b.length + 1);

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length];
}

/**
 * Has the query changed enough to abandon a lock?
 *
 * Scaled by the *locked* length rather than the max of the two, so that deleting most
 * of a long query counts as a substantial change even though the new text is short.
 */
export function changedSubstantially(lockedText: string, text: string): boolean {
  if (!lockedText) return true;
  const distance = levenshtein(lockedText.toLowerCase(), text.toLowerCase());
  return distance / lockedText.length > THRESHOLDS.forcedChangeRatio;
}

/**
 * Is this the same query with more detail on the end?
 *
 * Levenshtein alone cannot tell "I added an amenity" from "I asked something else":
 * appending " with a backyard" to a short query is a large edit by distance, but the
 * original question is still there in full. That distinction only matters for a locked
 * intent — refining a query should never throw away what the user explicitly picked,
 * whereas replacing it should.
 */
export function isRefinement(lockedText: string, text: string): boolean {
  return lockedText.length > 0 && text.toLowerCase().startsWith(lockedText.toLowerCase());
}

// ─────────────────────────────────────────────────────────────
// Reading the raw answer
// ─────────────────────────────────────────────────────────────

export type Ranked = Array<{ intent: CardIntent; p: number }>;

/**
 * Card intents by probability, highest first.
 *
 * `none` is dropped rather than ranked: it is the escape option, and its probability is
 * a statement that no card applies, which the `inputBelow` floor already expresses.
 * Falls back to the chosen value's own confidence when `probabilities` is absent.
 */
export function ranked(result: IntentResult): Ranked {
  const probs = result.intent.probabilities;
  const entries = Object.entries(probs) as Array<[IntentKey, number]>;

  const out: Ranked = entries
    .filter(([key, p]) => key !== "none" && Number.isFinite(p))
    .map(([key, p]) => ({ intent: key as CardIntent, p }));

  if (!out.length && result.intent.value !== "none") {
    out.push({ intent: result.intent.value as CardIntent, p: result.intent.confidence });
  }

  return out.sort((a, b) => b.p - a.p);
}

/** What this single answer would say on its own, ignoring what is currently on screen. */
export function rawState(result: IntentResult): UiState {
  const order = ranked(result);
  const top = order[0];
  if (!top || top.p < THRESHOLDS.inputBelow) return { kind: "input" };

  const second = order[1];
  if (
    second &&
    top.p - second.p < THRESHOLDS.chooseGap &&
    second.p >= THRESHOLDS.chooseFloor &&
    top.p < THRESHOLDS.commitAt
  ) {
    return { kind: "choose", options: [top.intent, second.intent] };
  }

  return top.p >= THRESHOLDS.commitAt
    ? { kind: "committed", intent: top.intent }
    : { kind: "ghost", intent: top.intent };
}

// ─────────────────────────────────────────────────────────────
// The machine
// ─────────────────────────────────────────────────────────────

/**
 * Fold a fresh answer into the current state.
 *
 * Pure: same memory plus same result gives the same next memory, which is what makes
 * the whole thing testable without a browser.
 */
export function decide(memory: Memory, result: IntentResult, text: string): Memory {
  const order = ranked(result);
  const raw = rawState(result);
  const current = memory.state;

  // A user-forced intent outranks the model until the query itself changes.
  if (current.kind === "committed" && current.forced) {
    const rewritten =
      changedSubstantially(memory.lockedText, text) && !isRefinement(memory.lockedText, text);
    if (rewritten) return { state: raw, lockedText: text, challenger: null };

    // The query was only refined, so the pick stands — unless the words that were added
    // make a different intent unmistakable. Someone who picks "rent" and then types
    // "…to buy" has contradicted themselves, and following the sentence beats following
    // the click. This is the same override used against a committed card, so the bar is
    // just as high: one round of ordinary confidence is not enough.
    const leader = order[0];
    if (leader && leader.intent !== current.intent && leader.p >= THRESHOLDS.challengerOverride) {
      return { state: { kind: "committed", intent: leader.intent }, lockedText: text, challenger: null };
    }
    return memory;
  }

  if (current.kind !== "committed") {
    // Nothing is locked in, so there is nothing to protect — take the raw reading.
    return { state: raw, lockedText: raw.kind === "committed" ? text : memory.lockedText, challenger: null };
  }

  const incumbent = current.intent;
  const incumbentP = order.find((r) => r.intent === incumbent)?.p ?? 0;
  const top = order[0];

  // Rewriting the query drops the lock outright: the old card is about old text.
  if (changedSubstantially(memory.lockedText, text)) {
    return { state: raw, lockedText: raw.kind === "committed" ? text : "", challenger: null };
  }

  // The incumbent has collapsed. Fall back to whatever the answer says now, which may
  // be a ghost or the plain input.
  if (incumbentP < THRESHOLDS.dropBelow) {
    return { state: raw, lockedText: raw.kind === "committed" ? text : "", challenger: null };
  }

  // Still the top answer: hold, and forget any challenge in progress.
  if (!top || top.intent === incumbent) {
    return { state: current, lockedText: memory.lockedText, challenger: null };
  }

  // A challenger leads. Overwhelming confidence takes over at once; anything less has
  // to hold the lead across consecutive keystrokes, which is what filters out the
  // mid-word wobble that made this machine necessary.
  if (top.p >= THRESHOLDS.challengerOverride) {
    return { state: { kind: "committed", intent: top.intent }, lockedText: text, challenger: null };
  }

  const wins = memory.challenger?.intent === top.intent ? memory.challenger.wins + 1 : 1;
  if (wins >= THRESHOLDS.challengerWins && top.p >= THRESHOLDS.commitAt) {
    return { state: { kind: "committed", intent: top.intent }, lockedText: text, challenger: null };
  }

  return { state: current, lockedText: memory.lockedText, challenger: { intent: top.intent, wins } };
}

/** The user picked an intent from the palette. Sticks until the query is rewritten. */
export function force(intent: CardIntent, text: string): Memory {
  return { state: { kind: "committed", intent, forced: true }, lockedText: text, challenger: null };
}

/** The user resolved a `choose` state. Treated as a normal commit, not a forced one. */
export function promote(intent: CardIntent, text: string): Memory {
  return { state: { kind: "committed", intent }, lockedText: text, challenger: null };
}

/** Back to the plain input, e.g. the user dismissed the card. */
export function reset(): Memory {
  return initialMemory();
}
