/**
 * Question builders for the OpenRouter Decisions API (`POST /api/alpha/decisions`).
 *
 * These are deliberately hand-rolled rather than imported from `@typesafe-ai/sdk`:
 * the Decisions wire format differs from TypeSafe's own System One format in two
 * ways that matter, and both are easy to get wrong silently.
 *
 *   1. `instructions` is REQUIRED on every question (System One infers it).
 *   2. `score.criteria` is an ARRAY of rubric levels, lowest first — not an
 *      object keyed by level number.
 *
 * The types below mirror `DecisionsChoiceQuestion` / `DecisionsNoulQuestion` /
 * `DecisionsScoreQuestion` from `@openrouter/sdk`, minus the object/array
 * variants of each string field that we never use. Keeping our own copy means
 * `questions.ts` carries no runtime import, so it stays safe to pull into a
 * client bundle for the debug panel.
 */

export type ChoiceQuestion<K extends string = string> = {
  type: "choice";
  instructions: string;
  criteria: Record<K, string>;
};

export type NoulQuestion = {
  type: "noul";
  instructions: string;
  criteria?: { true: string; false: string };
};

export type ScoreQuestion = {
  type: "score";
  instructions: string;
  /** Rubric levels in ascending order. Index 0 is the lowest level. */
  criteria: string[];
};

export type Question = ChoiceQuestion | NoulQuestion | ScoreQuestion;

/**
 * Pick exactly one labelled option. The option keys become the answer's
 * `choice` string and the keys of its `probabilities` map.
 *
 * `const C` preserves the literal key union, which is what lets `client.ts`
 * type-check that the intent options and the `IntentKey` union stay in sync.
 */
export function choice<const C extends Record<string, string>>(
  instructions: string,
  criteria: C,
): ChoiceQuestion<Extract<keyof C, string>> {
  return { type: "choice", instructions, criteria };
}

/** A truth probability in [0, 1]. No confidence, no probabilities — the value *is* the probability. */
export function noul(instructions: string, criteria?: { true: string; false: string }): NoulQuestion {
  return criteria ? { type: "noul", instructions, criteria } : { type: "noul", instructions };
}

/**
 * An ordered rubric. The answer is an *expected* score — a probability-weighted
 * blend across levels, so it is fractional (2.4 means "mostly level 2, leaning 3")
 * and must not be compared with `===`.
 *
 * Levels are 1-indexed on the wire: `criteria[0]` is level 1.
 */
export function score(instructions: string, criteria: readonly string[]): ScoreQuestion {
  return { type: "score", instructions, criteria: [...criteria] };
}
