"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LRU, normalizeKey } from "@/lib/lru";
import {
  decide,
  force as forceIntent,
  initialMemory,
  promote as promoteIntent,
  reset as resetMemory,
  type Memory,
} from "@/lib/decide";
import { emptyGatedSignals, gateSignals, type GatedSignals } from "@/lib/signals";
import { extract } from "@/lib/parse/query";
import { DEFAULT_MODE, type ExtractionMode, type FieldSources } from "@/lib/extraction";
import { DEFAULT_MODEL } from "@/lib/jev/request";
import type { CardIntent, IntentResult, SearchQuery } from "@/lib/jev/types";

/**
 * The whole client-side loop: text in, a UI state and a `SearchQuery` out.
 *
 * Three problems have to be solved at once, and they pull against each other:
 *
 *   1. Every keystroke wants a fresh answer, but every call costs money and latency.
 *      -> debounce, plus an LRU so backspacing is free.
 *   2. Responses can land out of order, and a stale one would morph the card backwards.
 *      -> an incrementing request id; anything but the newest is dropped.
 *   3. The answer moves on every keystroke, and rendering it raw makes the card thrash.
 *      -> `decide.ts` and `signals.ts` hold the state steady.
 *
 * The `SearchQuery` itself is recomputed locally on every keystroke, not on every
 * response. The parsers are pure string work, so the user sees the price and bed count
 * update as they type even while Jev is still deciding what kind of search this is. The
 * route returns a query too; it is ignored for exactly that reason — by the time it lands
 * the text has usually moved on, and the copy computed here is the current one.
 */

const DEBOUNCE_MS = 120;
const MIN_LENGTH = 3;
const CACHE_SIZE = 300;

export type Status = "idle" | "thinking" | "ready" | "error";

/**
 * Where the time went on the last uncached call, split by who spent it.
 *
 * Three segments rather than one number, because they are three different kinds of cost and
 * only one of them is fixed. The debounce is a constant this app chose and could change; the
 * network is a hosted round trip and cannot be tuned from here; the parse is the work that
 * actually produces the filters, and it is the one the user never waits for.
 */
export type Timing = {
  /** Last keystroke to the request leaving — the debounce, which is `DEBOUNCE_MS` by choice. */
  debounceMs: number;
  /** The round trip itself. */
  networkMs: number;
  /** Keystroke to card. `debounceMs + networkMs`, which is what the user actually waits. */
  totalMs: number;
};

export type SearchIntentState = {
  /** Steady UI state from the confidence machine — what to render. */
  memory: Memory;
  /** Gated signals — which chips and badges are on. */
  signals: GatedSignals;
  /** The structured filter set. Always current with the text. */
  query: SearchQuery;
  /**
   * Who produced each field of that query on this run — `parser`, `jev` or `none`.
   *
   * This is the only way to tell the two modes apart from the outside: both return a
   * `SearchQuery` of the same shape, and the interesting question is never "what are the
   * filters" but "which half of the system decided them".
   */
  sources: FieldSources;
  /** The mode this extraction ran in. Reflects the server's resolved mode once one lands. */
  mode: ExtractionMode;
  /**
   * The model the server would send this to, learnt the same way as `mode`.
   *
   * Carried separately from `result.model` because the panel shows the *request* before any
   * response exists, and `result.model` is what OpenRouter reported having routed to —
   * usually the same string, but not by construction.
   */
  model: string;
  /** The last classification, for the debug panel. `null` before the first one lands. */
  result: IntentResult | null;
  status: Status;
  /** Populated when `status` is "error". Shown rather than swallowed: there is no fallback. */
  error: string | null;
  /** Round-trip time of the last call, for the latency HUD. */
  latencyMs: number;
  /**
   * How long the local parse of the current text took, in milliseconds.
   *
   * Fractional and deliberately not rounded: the whole point of the number is that it sits
   * three orders of magnitude below `latencyMs`, and rounding it to an integer would erase it.
   * Browsers coarsen `performance.now()` (5µs in Chromium, more in Firefox with privacy
   * settings on), so treat this as "the right order of magnitude" rather than a benchmark.
   */
  parseMs: number;
  /** Segments of the last uncached call. `null` until one completes. */
  timing: Timing | null;
};

type ApiOk = {
  result: IntentResult | null;
  query: SearchQuery;
  sources: FieldSources;
  mode: ExtractionMode;
  model: string;
};
type ApiErr = { error: string; kind?: string };

/**
 * `mode` is optional on purpose.
 *
 * Passing nothing sends no mode at all, which lets the server's `EXTRACTION_MODE` decide —
 * the deployment-wide default belongs to the deployment, not to a component. Passing one
 * overrides it for these requests, which is what the debug panel's toggle does so the two
 * modes can be compared on the same text without a redeploy.
 */
export function useSearchIntent(text: string, mode?: ExtractionMode) {
  const [memory, setMemory] = useState<Memory>(initialMemory);
  const [signals, setSignals] = useState<GatedSignals>(emptyGatedSignals);
  const [result, setResult] = useState<IntentResult | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [latencyMs, setLatencyMs] = useState(0);
  /**
   * Holds the last *uncached* call, and is not cleared on a cache hit.
   *
   * Keeping it means the timeline stays still while someone types into a warm cache instead
   * of blinking in and out — and a cache hit has nothing to show anyway, since its whole
   * claim is that no time was spent. `status`/`cached` already say when that is happening.
   */
  const [timing, setTiming] = useState<Timing | null>(null);
  /**
   * The mode the *server* resolved, learnt from the last response.
   *
   * Needed because when `mode` is left undefined the browser genuinely does not know which
   * mode it is getting — `EXTRACTION_MODE` is server-side, and exposing it as a
   * `NEXT_PUBLIC_` twin would be a second source of truth that drifts. One round trip
   * answers the question instead. Until then the extraction runs in the default mode,
   * which is harmless: with no result in hand the two modes produce the same query.
   */
  const [serverMode, setServerMode] = useState<ExtractionMode | null>(null);
  /** Same idea as `serverMode`: `JEV_MODEL` is server-side, so one round trip reveals it. */
  const [serverModel, setServerModel] = useState<string | null>(null);

  const cache = useRef(new LRU<IntentResult>(CACHE_SIZE));
  const abort = useRef<AbortController | null>(null);
  /** Monotonic id of the newest request. Anything older that lands is discarded. */
  const reqId = useRef(0);
  /** Read inside the effect without making it a dependency, so typing does not re-fire it. */
  const latest = useRef({ memory, signals });
  latest.current = { memory, signals };

  /**
   * Fold a classification into the steady state. Kept in one place so a cache hit, a
   * fresh response and a replayed result all take exactly the same path.
   */
  const apply = useCallback((next: IntentResult, forText: string) => {
    setResult(next);
    setMemory((prev) => decide(prev, next, forText));
    setSignals((prev) => gateSignals(prev, next.signals));
  }, []);

  useEffect(() => {
    const trimmed = text.trim();

    if (trimmed.length < MIN_LENGTH) {
      abort.current?.abort();
      reqId.current += 1;
      setStatus("idle");
      setError(null);
      setResult(null);
      setMemory(resetMemory());
      setSignals(emptyGatedSignals());
      return;
    }

    // Scoped by mode, because the two modes ask different questions and so answer the
    // same text differently. `default` is its own bucket: it means "whatever the server's
    // env says", which is fixed for the life of the page and therefore a coherent key.
    const key = `${mode ?? "default"}:${normalizeKey(text)}`;
    const hit = cache.current.get(key);
    if (hit) {
      // No network, no debounce, no spinner — the answer is already known.
      setStatus("ready");
      setError(null);
      setLatencyMs(0);
      // A cached result carries the mode it was produced under, so replaying it does not
      // silently reuse an answer from the other mode.
      if (hit.mode) setServerMode(hit.mode);
      apply(hit, text);
      return;
    }

    setStatus("thinking");

    // Taken here rather than inside the timer, so the debounce is inside the measurement.
    // This effect runs on the commit for the newest text, so it is as close to "the moment
    // the user pressed the key" as the hook can get. Each keystroke clears the previous
    // timer and re-enters here, which is what makes this the *last* keystroke and not the
    // first — the right zero for a question about what the user waits.
    const changedAt = performance.now();

    const timer = setTimeout(() => {
      abort.current?.abort();
      const controller = new AbortController();
      abort.current = controller;
      const id = (reqId.current += 1);
      const started = performance.now();

      void (async () => {
        try {
          const response = await fetch("/api/search-intent", {
            method: "POST",
            headers: { "content-type": "application/json" },
            // `mode` omitted rather than sent as null when undefined, so the route's
            // `?? process.env.EXTRACTION_MODE` fallback is the one that fires.
            body: JSON.stringify(mode ? { text, mode } : { text }),
            signal: controller.signal,
          });

          // A newer keystroke already fired. Dropping this is the point of `reqId`:
          // without it a slow early response lands last and morphs the card backwards.
          if (id !== reqId.current) return;

          if (!response.ok) {
            const body = (await response.json().catch(() => null)) as ApiErr | null;
            setStatus("error");
            setError(body?.error ?? `Classification failed (${response.status}).`);
            return;
          }

          const body = (await response.json()) as ApiOk;
          const landed = performance.now();
          setLatencyMs(Math.round(landed - started));
          setTiming({
            // Measured, not `DEBOUNCE_MS`: a busy main thread makes the real wait longer
            // than the constant, and the demo should show the wait rather than the intent.
            debounceMs: Math.round(started - changedAt),
            networkMs: Math.round(landed - started),
            totalMs: Math.round(landed - changedAt),
          });
          setStatus("ready");
          setError(null);
          if (body.mode) setServerMode(body.mode);
          if (body.model) setServerModel(body.model);

          if (body.result) {
            cache.current.set(key, body.result);
            apply(body.result, text);
          }
        } catch (err) {
          // An abort is this hook's own doing, not a failure to report.
          if (controller.signal.aborted || (err instanceof Error && err.name === "AbortError")) return;
          if (id !== reqId.current) return;
          setStatus("error");
          setError(err instanceof Error ? err.message : "Could not reach the classifier.");
        }
      })();
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
    // `mode` is a dependency: flipping the toggle has to re-ask, because the answer to
    // "which mode is this" is the entire reason the toggle exists.
  }, [text, mode, apply]);

  // Abort whatever is in flight when the component goes away.
  useEffect(() => () => abort.current?.abort(), []);

  /**
   * Recomputed from the text on every render, not from the last response. The parsers
   * are pure and cheap, so filters stay in step with the input even mid-classification.
   */
  const effectiveMode = mode ?? serverMode ?? DEFAULT_MODE;
  const { query, sources, parseMs } = useMemo(() => {
    // Timed inside the memo rather than with a ref written during render, so the duration
    // is part of the memoized value and cannot drift out of step with the query it produced.
    // Under StrictMode this runs twice in development; the second figure is the warm one.
    const at = performance.now();
    const { query: q, sources: s } = extract(text, result ?? undefined, effectiveMode);
    return { query: q, sources: s, parseMs: performance.now() - at };
  }, [text, result, effectiveMode]);

  /** The user picked an intent from the palette — overrides Jev until the query changes. */
  const force = useCallback((intent: CardIntent) => setMemory(forceIntent(intent, text)), [text]);

  /** The user resolved a two-way `choose` state. */
  const promote = useCallback((intent: CardIntent) => setMemory(promoteIntent(intent, text)), [text]);

  /** The user dismissed the card and wants the plain input back. */
  const dismiss = useCallback(() => setMemory(resetMemory()), []);

  const state: SearchIntentState = {
    memory,
    signals,
    query,
    sources,
    mode: effectiveMode,
    model: serverModel ?? DEFAULT_MODEL,
    result,
    status,
    error,
    latencyMs,
    parseMs,
    timing,
  };
  return { ...state, force, promote, dismiss };
}
