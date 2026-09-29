"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/cn";
import { EXTRACTION_MODES, type ExtractionMode, type FieldSources } from "@/lib/extraction";
import { QUESTION_COUNT, QUESTION_SCHEMA_CHARS } from "@/lib/jev/questions";
import { EXTENDED_QUESTION_COUNT, EXTENDED_SCHEMA_CHARS } from "@/lib/jev/extended";
import type { IntentResult, SearchQuery } from "@/lib/jev/types";
import type { GatedSignals } from "@/lib/signals";
import type { Memory } from "@/lib/decide";
import { JevAnswers } from "./JevAnswers";
import { JevRequest } from "./JevRequest";
import { Provenance } from "./Provenance";

/**
 * What the machine actually thinks, on screen.
 *
 * This is not a developer nicety bolted on at the end — it is how you tell a threshold
 * problem from a criteria problem. If the probabilities look right but the card is wrong,
 * `decide.ts` needs tuning; if the probabilities themselves look wrong, a question in
 * `questions.ts` is badly worded. Without seeing both you are guessing.
 *
 * Read top to bottom it is the whole pipeline in order: what went to Jev, what came back,
 * what survived gating, who ended up deciding each field, the object a backend receives,
 * and where the milliseconds went.
 * Each of those is its own component, because the sections have nothing in common but the
 * shell and keeping them in one file made the interesting part hard to find.
 */

export function DebugPanel({
  text,
  result,
  query,
  sources,
  mode,
  model,
  onModeChange,
  signals,
  memory,
  latencyMs,
}: {
  /** The raw input, so the request section can show exactly what is sent. */
  text: string;
  result: IntentResult | null;
  query: SearchQuery;
  sources: FieldSources;
  mode: ExtractionMode;
  /** The model the request names. From the server, since `JEV_MODEL` is not public. */
  model: string;
  /** Omitted leaves the toggle out, for any embedding that should not change the mode. */
  onModeChange?: (mode: ExtractionMode) => void;
  signals: GatedSignals;
  memory: Memory;
  latencyMs: number;
}) {
  const [open, setOpen] = useState(false);

  // What each mode costs to send. The schema, not the query, is the bill: `state` is
  // `{ query }` and measures in the tens of bytes, while the question schema is resent
  // in full on every keystroke.
  const jevChars = QUESTION_SCHEMA_CHARS + EXTENDED_SCHEMA_CHARS;
  const jevCount = QUESTION_COUNT + EXTENDED_QUESTION_COUNT;

  return (
    <section className="rounded-2xl border border-line bg-surface shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left"
      >
        <span className="text-xs font-medium text-ink-mid">
          Under the hood
          <span className="ml-2 font-normal text-ink-faint">
            {mode} · {memory.state.kind}
            {result ? ` · ${result.questionCount} questions · ${latencyMs}ms` : ""}
            {result?.cached ? " · cached" : ""}
          </span>
        </span>
        <ChevronDown className={cn("size-4 text-ink-muted transition", open && "rotate-180")} aria-hidden />
      </button>

      {open && (
        <div className="space-y-5 border-t border-line px-4 py-4">
          {/* ── 1. Which split is in force, and what it costs ── */}
          <div>
            <h3 className="text-[10px] font-medium uppercase tracking-wide text-ink-muted">
              Extraction mode
            </h3>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {onModeChange &&
                EXTRACTION_MODES.map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => onModeChange(m)}
                    aria-pressed={mode === m}
                    className={cn(
                      "rounded-full border px-2.5 py-0.5 text-[11px] transition",
                      mode === m
                        ? "border-line-strong bg-raised font-medium text-ink"
                        : "border-line text-ink-muted hover:border-line-strong hover:text-ink-soft",
                    )}
                  >
                    {m}
                  </button>
                ))}
              <span className="text-[11px] text-ink-faint">
                hybrid {QUESTION_COUNT} q / {QUESTION_SCHEMA_CHARS.toLocaleString("en-US")} chars ·
                jev {jevCount} q / {jevChars.toLocaleString("en-US")} chars
              </span>
            </div>

            {/*
              * Spelled out because the two words are otherwise just labels on two buttons.
              * Anyone reading this panel is trying to work out why a filter is missing, and
              * "which half was even asked" is the first thing they need to know.
              */}
            <dl className="mt-2 space-y-1 text-[11px] leading-relaxed">
              <div className="flex gap-2">
                <dt className="w-12 shrink-0 font-mono text-ink-soft">hybrid</dt>
                <dd className="text-ink-muted">
                  Jev decides <em>which card</em> to show. The parsers fill every filter.
                </dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-12 shrink-0 font-mono text-ink-soft">jev</dt>
                <dd className="text-ink-muted">
                  That, plus Jev infers the closed-set filters for queries that imply one
                  without naming it — &ldquo;nothing with stairs&rdquo; &rarr;{" "}
                  <code className="text-ink-soft">stories: single</code>.
                </dd>
              </div>
            </dl>
            <p className="mt-1.5 text-[11px] leading-relaxed text-ink-faint">
              Neither mode lets Jev near a number, a place or a date — both parse those. Where
              the two halves disagree, the literal text wins.
            </p>
          </div>

          {/* ── 2. What goes out ── */}
          <JevRequest text={text} mode={mode} model={model} />

          {/* ── 3. What comes back ── */}
          <JevAnswers result={result} />

          {/* ── 4. What survived hysteresis and reached the UI ── */}
          <div>
            <h3 className="text-[10px] font-medium uppercase tracking-wide text-ink-muted">
              Signals, after gating — what the UI is allowed to act on
            </h3>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {[
                signals.priceBound && `bound: ${signals.priceBound}`,
                signals.priceCadence && `cadence: ${signals.priceCadence}`,
                signals.sortPreference && `sort: ${signals.sortPreference}`,
                signals.urgent && "urgent",
                ...signals.flags,
              ]
                .filter(Boolean)
                .map((label) => (
                  <span
                    key={String(label)}
                    className="rounded-full border border-line px-2 py-0.5 text-[11px] text-ink-mid"
                  >
                    {String(label)}
                  </span>
                ))}
              {!signals.priceBound &&
                !signals.priceCadence &&
                !signals.sortPreference &&
                !signals.urgent &&
                signals.flags.length === 0 && (
                  <span className="text-xs text-ink-faint">None above threshold.</span>
                )}
            </div>
          </div>

          {/* ── 5. Who ended up owning each field ── */}
          <Provenance sources={sources} mode={mode} />

          {/* ── 6. The object this all exists to produce ── */}
          <div>
            <h3 className="text-[10px] font-medium uppercase tracking-wide text-ink-muted">
              SearchQuery — the API contract
            </h3>
            <pre className="mt-2 max-h-80 overflow-auto rounded-xl border border-line bg-raised p-3 text-[11px] leading-relaxed text-ink-soft">
              {JSON.stringify(query, null, 2)}
            </pre>
          </div>

          {/*
            * ── 7. Where the time went ──
            *
            * Two clocks, nested: `result.latencyMs` is measured in `client.ts` around the
            * POST alone, `latencyMs` is measured in the browser around the whole fetch. The
            * gap between them is this app — route handling, every parser, and two JSON
            * round trips. Worth splitting out, because "the search feels slow" has two
            * completely different fixes depending on which side the time is on, and a
            * single total cannot tell you which.
            */}
          {result && !result.cached && (
            <div>
              <h3 className="text-[10px] font-medium uppercase tracking-wide text-ink-muted">
                Where the time went
              </h3>
              <ul className="mt-2 space-y-1 text-[11px] text-ink-muted">
                <li className="flex items-baseline gap-2">
                  <span className="w-44 shrink-0">upstream POST</span>
                  <span className="tabular-nums text-ink-soft">{result.latencyMs} ms</span>
                  <span className="text-ink-faint">
                    network to OpenRouter, plus Jev answering {result.questionCount} questions
                  </span>
                </li>
                <li className="flex items-baseline gap-2">
                  <span className="w-44 shrink-0">this app</span>
                  <span className="tabular-nums text-ink-soft">
                    {Math.max(0, latencyMs - result.latencyMs)} ms
                  </span>
                  <span className="text-ink-faint">route, parsers, JSON both ways</span>
                </li>
                <li className="flex items-baseline gap-2 border-t border-line pt-1">
                  <span className="w-44 shrink-0">browser round trip</span>
                  <span className="tabular-nums text-ink-soft">{latencyMs} ms</span>
                  <span className="text-ink-faint">what the HUD shows</span>
                </li>
              </ul>
              <p className="mt-1.5 text-[11px] leading-relaxed text-ink-faint">
                A dev server inflates the middle row — it compiles on demand and skips
                optimisation. Compare under <code className="text-ink-muted">next start</code>
                {" "}before concluding anything about where the time is.
              </p>
            </div>
          )}

          {result && (
            <p className="text-[11px] text-ink-faint">
              {result.model}
              {result.provider ? ` via ${result.provider}` : ""}
              {result.costUsd !== undefined ? ` · $${result.costUsd.toFixed(6)}` : ""}
              {" · readiness "}
              {result.readiness.toFixed(2)}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
