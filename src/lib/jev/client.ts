import "server-only";
import { OpenRouter } from "@openrouter/sdk";
import { RequestAbortedError, RequestTimeoutError } from "@openrouter/sdk/models/errors";
import { DEFAULT_MODEL, decisionsRequest } from "./request";
import {
  CHOICE_ESCAPE,
  EXTENDED_CHOICES,
  EXTENDED_NOUL_KEYS,
  choiceOptions,
  type ExtendedChoiceKey,
} from "./extended";
import { DEFAULT_MODE, type ExtractionMode } from "../extraction";
import {
  INTENT_KEYS,
  PRICE_BOUNDS,
  PRICE_CADENCES,
  SORT_PREFERENCES,
  type Answer,
  type ExtendedAnswers,
  type IntentResult,
} from "./types";

/**
 * Online-only Jev classification. There is no offline keyword fallback and no
 * chat-completions adapter: every keystroke that gets classified is classified by
 * Jev itself, and a failure surfaces as a failure.
 *
 * Jev is a System One model, so it does not speak `/chat/completions`. It is reached
 * through OpenRouter's Decisions router:
 *
 *     POST https://openrouter.ai/api/alpha/decisions
 *     { model, state, questions } -> { answers, model, provider, usage }
 *
 * `openrouter.alpha.decisions.create()` is the SDK wrapper for exactly that route.
 * Note the Decisions router has its own base URL (`https://openrouter.ai`), distinct
 * from the `/api/v1` base the rest of the SDK uses — which is why `serverURL` is
 * never set below. Setting it would silently redirect this call.
 *
 * Model pinning: `typesafe/jev-latest` is not a resolvable OpenRouter slug (404).
 * A concrete version is required, hence the `typesafe/jev-1.13` default.
 */

/**
 * Re-exported rather than defined here: `./request` owns the request body, and this
 * module is `server-only`, so a client-side reader of the default model could not import
 * it from here.
 */
export { DEFAULT_MODEL };

/** How long to wait before giving up. Past ~4s the user has typed a different query anyway. */
const TIMEOUT_MS = 4000;

let client: OpenRouter | null = null;

/** A real-looking key: not empty and not a copied placeholder like "sk-..." or "your-key-here". */
export function looksLikeKey(key: string | undefined): key is string {
  const k = key?.trim() ?? "";
  return k.length >= 12 && !/\.\.\.|your|xxx|placeholder|changeme|<|>/i.test(k);
}

export class JevConfigError extends Error {}

/** Thrown when Jev answers in a shape the question schema did not ask for. */
export class JevProtocolError extends Error {}

/**
 * Resolve config from the environment. Throws rather than degrading: in online-only
 * mode a missing key is a setup error the developer needs to see, not something to
 * paper over with a fabricated classification.
 */
function config() {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!looksLikeKey(apiKey)) {
    throw new JevConfigError(
      "Missing OPENROUTER_API_KEY. Put your OpenRouter key in .env.local — see README.md § Setup.",
    );
  }
  return { apiKey, model: process.env.JEV_MODEL?.trim() || DEFAULT_MODEL };
}

/**
 * Is the deployment using the default model?
 *
 * The browser cannot read `JEV_MODEL`, so the debug panel would otherwise have to guess
 * which model a not-yet-made request will name. This lets the route tell it, instead of
 * publishing the variable to the bundle.
 */
export function configuredModel(): string {
  return process.env.JEV_MODEL?.trim() || DEFAULT_MODEL;
}

function getClient(apiKey: string) {
  if (!client) {
    client = new OpenRouter({
      apiKey,
      // One fast attempt. A retried answer lands after the user has typed more
      // characters, so it is stale by arrival — an error we can show is worth more.
      retryConfig: { strategy: "none" },
      appTitle: "JEV-Search",
    });
  }
  return client;
}

// ─────────────────────────────────────────────────────────────
// Wire -> internal shape
//
// The Decisions response types every answer as a union and leaves `choice` as an
// unconstrained string, so each answer is narrowed by the question it came from.
// ─────────────────────────────────────────────────────────────

type WireAnswer = { type?: string } & Record<string, unknown>;

function pick(answers: Record<string, WireAnswer>, key: string, want: string): WireAnswer {
  const a = answers[key];
  if (!a) throw new JevProtocolError(`Jev omitted an answer for "${key}".`);
  if (a.type !== want) {
    throw new JevProtocolError(`Jev answered "${key}" as ${String(a.type)}, expected ${want}.`);
  }
  return a;
}

/**
 * Narrow a choice answer to its declared option set.
 *
 * `fallback` is each question's escape option. Using it rather than throwing is the
 * right call here: an unrecognised label means Jev picked something outside the
 * schema, and "unspecified" is the honest reading of that — it is not a signal we
 * can act on, and it should not take down a whole keystroke's classification.
 */
function asChoice<T extends string>(
  answers: Record<string, WireAnswer>,
  key: string,
  options: readonly T[],
  fallback: T,
): Answer<T> {
  const a = pick(answers, key, "choice");
  const raw = typeof a.choice === "string" ? a.choice : "";
  const value = (options as readonly string[]).includes(raw) ? (raw as T) : fallback;

  const probabilities: Partial<Record<T, number>> = {};
  const wire = a.probabilities;
  if (wire && typeof wire === "object") {
    for (const [k, v] of Object.entries(wire as Record<string, unknown>)) {
      if (typeof v === "number" && Number.isFinite(v) && (options as readonly string[]).includes(k)) {
        probabilities[k as T] = v;
      }
    }
  }

  // `confidence` is optional on the wire. Fall back to this option's own probability,
  // then to 0 — see the `Answer` docs in ./types for why 0 and not a guess.
  const reported = typeof a.confidence === "number" && Number.isFinite(a.confidence) ? a.confidence : undefined;
  return { value, confidence: reported ?? probabilities[value] ?? 0, probabilities };
}

function asScore(answers: Record<string, WireAnswer>, key: string) {
  const a = pick(answers, key, "score");
  const score = typeof a.score === "number" && Number.isFinite(a.score) ? a.score : 0;
  const confidence = typeof a.confidence === "number" && Number.isFinite(a.confidence) ? a.confidence : 0;
  return { score, confidence };
}

/** A noul *is* the probability — there is no separate confidence to reconcile. */
function asNoul(answers: Record<string, WireAnswer>, key: string): number {
  const a = pick(answers, key, "noul");
  return typeof a.noul === "number" && Number.isFinite(a.noul) ? a.noul : 0;
}

/**
 * A tolerant reader for the extended set.
 *
 * Unlike the core questions, a missing or malformed extended answer is not a protocol
 * error. The core set decides which card to render, so a gap there means the classification
 * failed and the user should be told. The extended set only fills filters the text did not
 * state, so a gap there means one fewer inferred filter — worth degrading silently rather
 * than throwing away a whole keystroke's classification over a feature checkbox.
 */
function readExtended(answers: Record<string, WireAnswer>): ExtendedAnswers {
  const out: ExtendedAnswers = { choices: {}, nouls: {} };

  for (const key of Object.keys(EXTENDED_CHOICES) as ExtendedChoiceKey[]) {
    const a = answers[key];
    if (!a || a.type !== "choice") continue;
    const raw = typeof a.choice === "string" ? a.choice : "";
    const options = choiceOptions(key);
    const value = options.includes(raw) ? raw : CHOICE_ESCAPE[key];
    const probabilities = a.probabilities as Record<string, unknown> | undefined;
    const reported = typeof a.confidence === "number" && Number.isFinite(a.confidence) ? a.confidence : undefined;
    const fromProbs = typeof probabilities?.[value] === "number" ? (probabilities[value] as number) : 0;
    out.choices[key] = { value, confidence: reported ?? fromProbs };
  }

  for (const key of EXTENDED_NOUL_KEYS) {
    const a = answers[key];
    if (!a || a.type !== "noul") continue;
    out.nouls[key] = typeof a.noul === "number" && Number.isFinite(a.noul) ? a.noul : 0;
  }

  return out;
}

/**
 * One call, every question answered in parallel against the same state.
 *
 * `mode` decides how many questions go out. `hybrid` sends the 17 core questions;
 * `jev` appends the closed-set questions from `./extended`. The extra ones are not sent in
 * `hybrid` mode at all, which is the whole point of the flag: Jev bills per prompt token
 * and the schema is resent on every keystroke, so questions whose answers would be
 * discarded are pure spend.
 *
 * Throws on config, network, timeout, abort and protocol errors. Callers are
 * expected to let those reach the UI as an error state.
 */
export async function classifyWithJev(
  text: string,
  signal?: AbortSignal,
  mode: ExtractionMode = DEFAULT_MODE,
): Promise<IntentResult> {
  const { apiKey, model } = config();
  const started = Date.now();

  // Built by `./request` rather than inline, so the debug panel renders the same object
  // this line sends. A panel that describes the request from memory is a panel that
  // eventually lies about it.
  const body = decisionsRequest(text, mode, model);

  const res = await getClient(apiKey).alpha.decisions.create(
    { decisionsRequest: body },
    { signal, timeoutMs: TIMEOUT_MS },
  );

  const latencyMs = Date.now() - started;
  const a = res.answers as Record<string, WireAnswer>;

  return {
    intent: asChoice(a, "intent", INTENT_KEYS, "none"),
    readiness: asScore(a, "readiness").score,
    signals: {
      priceBound: asChoice(a, "priceBound", PRICE_BOUNDS, "none"),
      priceCadence: asChoice(a, "priceCadence", PRICE_CADENCES, "unspecified"),
      sortPreference: asChoice(a, "sortPreference", SORT_PREFERENCES, "unspecified"),
      urgency: asScore(a, "urgency"),
      wantsNewConstruction: asNoul(a, "wantsNewConstruction"),
      wantsOutdoorSpace: asNoul(a, "wantsOutdoorSpace"),
      wantsParking: asNoul(a, "wantsParking"),
      wantsPetFriendly: asNoul(a, "wantsPetFriendly"),
      wantsFurnished: asNoul(a, "wantsFurnished"),
      wantsLuxury: asNoul(a, "wantsLuxury"),
      wantsInvestment: asNoul(a, "wantsInvestment"),
      isFamilyOriented: asNoul(a, "isFamilyOriented"),
      isQuestion: asNoul(a, "isQuestion"),
      hasNegation: asNoul(a, "hasNegation"),
      isAddressLookup: asNoul(a, "isAddressLookup"),
    },
    extended: mode === "jev" ? readExtended(a) : undefined,
    mode,
    latencyMs,
    questionCount: Object.keys(body.questions).length,
    model: res.model,
    provider: res.provider,
    costUsd: res.usage?.cost,
    inputTokens: res.usage?.inputTokens,
    outputTokens: res.usage?.outputTokens,
  };
}

/** True for the two errors that mean "nobody is waiting for this any more". */
export function isAbort(err: unknown): boolean {
  return (
    err instanceof RequestAbortedError ||
    err instanceof RequestTimeoutError ||
    (err instanceof Error && err.name === "AbortError")
  );
}
