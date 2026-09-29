"use client";

import { useCallback, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { AlertTriangle, Loader2, Search } from "lucide-react";
import { cn } from "@/lib/cn";
import { activeIntent } from "@/lib/decide";
import { hasFilters } from "@/lib/parse/query";
import { useSearchIntent } from "@/hooks/useSearchIntent";
import type { ExtractionMode } from "@/lib/extraction";
import type { SearchQuery } from "@/lib/jev/types";
import { IntentCard } from "../cards/IntentCard";
import { DebugPanel } from "../ui/DebugPanel";
import { LatencyHud } from "../ui/LatencyHud";
import { LatencyTimeline } from "../ui/LatencyTimeline";
import { ChoosePrompt } from "./ChoosePrompt";
import { ExampleQueries } from "./ExampleQueries";
import { IntentPalette } from "./IntentPalette";

/**
 * One input that becomes the right search.
 *
 * The input is never replaced — it stays mounted and focused throughout, and the card
 * grows underneath it. That is deliberate: the morph is meant to feel like the page
 * understanding you, not like being redirected to a form. Swapping the input out would
 * drop the caret and the user's place in their own sentence.
 */

export function MorphSearch() {
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const [submitted, setSubmitted] = useState<SearchQuery | null>(null);
  /**
   * `undefined` until the user picks one, so the server's `EXTRACTION_MODE` decides. The
   * toggle is an override for comparing the two modes, not the place the default lives.
   */
  const [mode, setMode] = useState<ExtractionMode | undefined>(undefined);
  const {
    memory,
    signals,
    query,
    sources,
    mode: activeMode,
    model,
    result,
    status,
    error,
    latencyMs,
    parseMs,
    timing,
    force,
    promote,
    dismiss,
  } = useSearchIntent(text, mode);

  const state = memory.state;
  const intent = activeIntent(state);
  const ready = hasFilters(query);

  const submit = useCallback(() => setSubmitted(query), [query]);

  /**
   * Picking an example fills the box and puts the caret back in it.
   *
   * The list stays mounted now, so this is no longer rescuing focus from a disappearing
   * button — it is a choice. The caret belongs on the sentence that just loaded, because the
   * next thing anyone does with an example is edit it: change the city, push the price, watch
   * which half of the output moves. Leaving focus on the chip would mean reaching for the
   * mouse again in the one app whose premise is that you never leave the input.
   */
  const pickExample = useCallback((example: string) => {
    setText(example);
    setSubmitted(null);
    inputRef.current?.focus();
  }, []);

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4">
      {/* ── The input, always mounted ── */}
      <div
        className={cn(
          "flex items-center gap-3 rounded-2xl border bg-surface px-4 py-3 shadow-sm transition",
          status === "error" ? "border-red-300" : "border-line focus-within:border-line-strong",
        )}
      >
        <Search className="size-4 shrink-0 text-ink-muted" aria-hidden />
        <input
          ref={inputRef}
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            // A new query invalidates the last submitted one; leaving it up would show
            // results for a sentence that is no longer on screen.
            setSubmitted(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && ready) submit();
          }}
          placeholder="Describe what you're looking for…"
          aria-label="Describe what you're looking for"
          autoFocus
          className="min-w-0 flex-1 bg-transparent text-[15px] text-ink outline-none placeholder:text-ink-faint"
        />
        <span aria-live="polite" className="shrink-0">
          {status === "thinking" && <Loader2 className="size-4 animate-spin text-ink-muted" aria-label="Thinking" />}
          {status === "error" && <AlertTriangle className="size-4 text-red-500" aria-label="Classification failed" />}
        </span>
      </div>

      {/*
       * The error state is shown, not papered over. There is no offline classifier by
       * design, so a failed call means the app genuinely does not know what this query
       * is — and saying so beats morphing into a confidently wrong card.
       */}
      {status === "error" && error && (
        <div
          role="alert"
          className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900"
        >
          <p className="font-medium">Couldn&rsquo;t classify that.</p>
          <p className="mt-0.5 text-xs text-red-700">{error}</p>
          <p className="mt-2 text-xs text-ink-mid">
            Filters below are still parsed from your text — only the search type is missing. You can
            pick one yourself.
          </p>
        </div>
      )}

      {/* ── The morph ── */}
      <AnimatePresence mode="popLayout" initial={false}>
        {state.kind === "choose" && (
          <ChoosePrompt key="choose" options={state.options} onPick={promote} />
        )}
        {intent && (
          <IntentCard
            key={intent}
            intent={intent}
            query={query}
            ghost={state.kind === "ghost"}
            onSubmit={submit}
            onDismiss={dismiss}
          />
        )}
        {state.kind === "input" && text.trim().length >= 3 && status !== "error" && (
          <motion.p
            key="waiting"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="px-1 text-xs text-ink-faint"
          >
            Not sure yet what kind of search this is — keep going.
          </motion.p>
        )}
      </AnimatePresence>

      {/* ── Manual override, once there is anything to override ── */}
      {text.trim().length >= 3 && (
        <div className="flex items-center justify-between gap-3 px-1">
          <IntentPalette active={intent} onPick={force} />
          {state.kind === "committed" && state.forced && (
            <span className="shrink-0 text-[11px] text-ink-faint">your pick</span>
          )}
        </div>
      )}

      {/*
       * ── Example queries, always ──
       *
       * Below the card rather than above it, and permanent. Above, a fourteen-entry list would
       * push the card off the first screen — and the card is the entire point. Here it reads as
       * "try the next one" and sits a few pixels from the thing that changes, which is what you
       * want when the demo is clicking down the list and watching the morph keep up.
       */}
      <ExampleQueries onPick={pickExample} active={text} />

      {/*
       * ── The two clocks ──
       *
       * Below the card rather than above it, because it is a claim *about* what just
       * happened: you watch the filters appear as you type, then read why that was possible.
       * It renders itself away until a real call has completed.
       */}
      <LatencyTimeline parseMs={parseMs} timing={timing} />

      {/* ── What a backend would receive ── */}
      {submitted && (
        <section className="rounded-2xl border border-line bg-surface p-4 shadow-sm">
          <h2 className="text-xs font-medium text-ink-mid">Submitted query</h2>
          <p className="mt-0.5 text-[11px] text-ink-faint">
            This is the JSON a listings API would receive. Nothing is called — the point of this app
            is producing it.
          </p>
          <pre className="mt-2 overflow-x-auto rounded-xl bg-raised p-3 text-[11px] leading-relaxed text-ink-soft">
            {JSON.stringify(submitted, null, 2)}
          </pre>
        </section>
      )}

      <DebugPanel
        text={text}
        result={result}
        query={query}
        sources={sources}
        mode={activeMode}
        model={model}
        onModeChange={setMode}
        signals={signals}
        memory={memory}
        latencyMs={latencyMs}
      />

      <LatencyHud
        status={status}
        latencyMs={latencyMs}
        parseMs={parseMs}
        cached={result?.cached}
        costUsd={result?.costUsd}
        inputTokens={result?.inputTokens}
        outputTokens={result?.outputTokens}
      />
    </div>
  );
}
