import { NextResponse } from "next/server";
import { classifyWithJev, configuredModel, isAbort, JevConfigError, JevProtocolError } from "@/lib/jev/client";
import { intentRequestSchema, type IntentResult } from "@/lib/jev/types";
import { extract } from "@/lib/parse/query";
import { resolveMode } from "@/lib/extraction";
import { LRU, normalizeKey } from "@/lib/lru";

/**
 * POST /api/search-intent
 *
 * The one server route. It exists for a single reason: the OpenRouter key must never
 * reach the browser. Everything else here is about not wasting calls.
 *
 * Node runtime, not edge — `@openrouter/sdk` and `server-only` both expect it.
 */
export const runtime = "nodejs";

/**
 * Server-side cache, shared across every user of this instance.
 *
 * The client caches too, but this is the one that matters for cost: real users type the
 * same prefixes ("2 bedroom", "homes in cupertino"), and Jev bills per prompt token with
 * the full question schema resent on every keystroke.
 *
 * Sharing it across users is sound because the request carries no user context — `state`
 * is `{ query }` and nothing else, so one person's answer for a given text is everyone's.
 * The key is mode-scoped, since the two modes ask different questions.
 */
const cache = new LRU<IntentResult>(500);

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const parsed = intentRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Expected { text: string }." }, { status: 400 });
  }

  const text = parsed.data.text;
  const trimmed = text.trim();

  // The request may override the server default, so the two modes can be compared on the
  // same text without a redeploy. An unrecognised value falls back rather than 400s:
  // `hybrid` is a working search, and rejecting the keystroke outright is not.
  const mode = resolveMode(parsed.data.mode ?? process.env.EXTRACTION_MODE);

  // Too short to mean anything. Answered without a call rather than with a fabricated
  // classification: `intent: ""` is the honest reading of "sh".
  // `model` rides along on every response, including this one, because the debug panel
  // needs to name the model in the request it renders *before* any call has been made.
  // The alternative was a `NEXT_PUBLIC_JEV_MODEL` twin of a server variable — a second
  // source of truth for the sake of one string. A model slug is not a secret.
  const model = configuredModel();

  if (trimmed.length < 3) {
    const { query, sources } = extract(text, undefined, mode);
    return NextResponse.json({ result: null, query, sources, mode, model });
  }

  // The mode is part of the key because the two modes ask different questions and so
  // produce different results for one text. Without it a `hybrid` answer would be served
  // to a `jev` request, which is exactly the comparison the flag exists to make.
  const key = `${mode}:${normalizeKey(text)}`;
  const cached = cache.get(key);
  if (cached) {
    const { query, sources } = extract(text, cached, mode);
    return NextResponse.json({
      // The zeroed latency and the dropped usage are one statement: this keystroke cost no
      // network time and no tokens. Replaying the original call's cost here would bill the
      // same answer twice on screen, and a cache hit is the one number that is honestly
      // nothing. `undefined` keys are omitted by `JSON.stringify`, so they arrive absent.
      result: { ...cached, cached: true, latencyMs: 0, costUsd: undefined, inputTokens: undefined, outputTokens: undefined },
      query,
      sources,
      mode,
      model,
    });
  }

  try {
    const result = await classifyWithJev(text, request.signal, mode);
    cache.set(key, result);
    const { query, sources } = extract(text, result, mode);
    return NextResponse.json({ result, query, sources, mode, model });
  } catch (err) {
    // The client moved on mid-flight. 499 is nginx's code for it; nothing renders it,
    // and the hook drops the response anyway.
    if (isAbort(err) || request.signal.aborted) {
      return NextResponse.json({ error: "aborted" }, { status: 499 });
    }

    // A setup problem, not a runtime one — surfaced verbatim so the developer reads the
    // actual cause instead of "classification unavailable".
    if (err instanceof JevConfigError) {
      return NextResponse.json({ error: err.message, kind: "config" }, { status: 500 });
    }

    if (err instanceof JevProtocolError) {
      return NextResponse.json({ error: err.message, kind: "protocol" }, { status: 502 });
    }

    const message = err instanceof Error ? err.message : "Unknown error calling Jev.";
    console.error("[search-intent] Jev call failed:", err);
    return NextResponse.json({ error: message, kind: "upstream" }, { status: 502 });
  }
}
