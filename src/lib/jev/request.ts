import { questions } from "./questions";
import { extendedQuestions } from "./extended";
import { DEFAULT_MODE, type ExtractionMode } from "../extraction";
import type { Question } from "./schema";

/**
 * The exact body posted to `POST /api/alpha/decisions`, built in one place.
 *
 * This module exists so the debug panel can show the request *by construction* rather
 * than by description. The alternative was a hand-written summary in the UI next to the
 * real call in `client.ts`, and those two drift — the panel would keep claiming 17
 * questions and a `{ query }` state long after the call had changed, which is the exact
 * failure mode a debug panel is supposed to protect you from.
 *
 * Deliberately free of `server-only` and of any runtime import: `questions.ts`,
 * `extended.ts` and `schema.ts` are plain data and builders, so this whole file is safe
 * to pull into the client bundle. The API key is not involved — it travels in a header
 * that `@openrouter/sdk` adds server-side, and nothing in the body below is a secret.
 */

/** The model to pin when `JEV_MODEL` is unset. `typesafe/jev-latest` is not routable (404). */
export const DEFAULT_MODEL = "typesafe/jev-1.13";

export type DecisionsRequest = {
  model: string;
  /**
   * The input Jev classifies.
   *
   * An object rather than a bare string: it labels the field for Jev, and leaves room to
   * add context (recent searches, viewport) without the questions having to guess which
   * part of a blob is the query.
   */
  state: { query: string };
  questions: Record<string, Question>;
};

/**
 * Which questions a mode sends.
 *
 * `hybrid` sends the core set only. `jev` appends the closed-set questions, because that
 * is the entire mechanism of the flag: Jev bills per prompt token and the schema is
 * resent on every keystroke, so questions whose answers would be discarded are pure spend.
 */
export function questionsFor(mode: ExtractionMode): Record<string, Question> {
  return mode === "jev" ? { ...questions, ...extendedQuestions() } : { ...questions };
}

export function decisionsRequest(
  text: string,
  mode: ExtractionMode = DEFAULT_MODE,
  model: string = DEFAULT_MODEL,
): DecisionsRequest {
  return { model, state: { query: text }, questions: questionsFor(mode) };
}

/** Prompt size of a request, in characters. The schema dominates; `state` is tens of bytes. */
export function requestChars(request: DecisionsRequest): number {
  return JSON.stringify(request).length;
}
