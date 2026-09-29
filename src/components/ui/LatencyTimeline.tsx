"use client";

import { formatParse } from "@/lib/format";
import type { Timing } from "@/hooks/useSearchIntent";

/**
 * The two clocks in this app, drawn to the same scale.
 *
 * Everything else on screen shows *what* the app understood. This shows *when* — and the
 * answer is that the two halves of the system are separated by three or four orders of
 * magnitude. Filters come from regexes running in the browser and land before the next
 * keystroke; the card waits on a hosted classification and lands a third of a second later.
 * Both facts are already true of the code (`useSearchIntent` recomputes the query locally on
 * every render and throws away the server's copy), but they are invisible until measured,
 * and the interesting claim is the *ratio*, which no single number can carry.
 *
 * The 100ms line is here because that is the number search teams are actually held to, and
 * it settles the question that matters: a deterministic parse has room to spare inside that
 * budget, and a network call to any hosted model does not. Which is an argument for putting
 * the model outside the blocking path, not for giving up on the model.
 */

/** The latency search UIs get judged against. Everything here is drawn relative to it. */
const BUDGET_MS = 100;

/** So a sub-pixel bar still reads as a bar. See the caption — the fudge is disclosed. */
const MIN_BAR_PX = 3;

export function LatencyTimeline({ parseMs, timing }: { parseMs: number; timing: Timing | null }) {
  // Nothing to scale against until a real call has completed. The parse time alone would be
  // a bar with no second bar to be small compared to, which is not the point being made.
  if (!timing) return null;

  // Never smaller than the budget, so the dashed line stays on screen even if a cached-warm
  // route somehow returns faster than 100ms — the line is the reference, not a decoration.
  const axisMs = Math.max(timing.totalMs, BUDGET_MS) * 1.06;
  const pct = (ms: number) => `${Math.min(100, (ms / axisMs) * 100)}%`;

  const ratio = parseMs > 0 ? Math.round(timing.totalMs / parseMs) : null;
  const overBudget = timing.totalMs / BUDGET_MS;

  return (
    <section className="rounded-2xl border border-line bg-surface p-4 shadow-sm">
      <h2 className="text-xs font-medium text-ink-mid">Where the time goes</h2>
      <p className="mt-0.5 text-[11px] leading-relaxed text-ink-faint">
        The filters are parsed in the browser and render as you type. Only the card waits on Jev.
        Nothing the user reads is blocked on the network.
      </p>

      <div className="relative mt-3 space-y-2.5">
        {/* The 100ms budget, crossing both tracks so the comparison is direct. */}
        <div
          aria-hidden
          className="absolute inset-y-0 z-10 border-l border-dashed border-ink-muted"
          style={{ left: pct(BUDGET_MS) }}
        />

        <Track
          label="Filters"
          detail="regex, in the browser"
          value={formatParse(parseMs)}
          segments={[{ ms: parseMs, className: "bg-emerald-500" }]}
          pct={pct}
        />
        <Track
          label="Card"
          detail="Jev, over the network"
          value={`${timing.totalMs}ms`}
          segments={[
            { ms: timing.debounceMs, className: "bg-amber-300" },
            { ms: timing.networkMs, className: "bg-amber-500" },
          ]}
          pct={pct}
        />
      </div>

      <dl className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-ink-faint">
        <Legend className="bg-emerald-500">parse</Legend>
        <Legend className="bg-amber-300">debounce {timing.debounceMs}ms</Legend>
        <Legend className="bg-amber-500">network {timing.networkMs}ms</Legend>
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="h-2 w-0 border-l border-dashed border-ink-muted" />
          100ms budget
        </span>
      </dl>

      <p className="mt-2 text-[11px] leading-relaxed text-ink-faint">
        {ratio === null ? (
          <>The parse is too fast for the browser&rsquo;s clock to resolve.</>
        ) : (
          <>
            The filters land <span className="tabular-nums text-ink-mid">{ratio.toLocaleString()}×</span>{" "}
            sooner than the card, at{" "}
            <span className="tabular-nums text-ink-mid">
              {Math.round((parseMs / BUDGET_MS) * 100) < 1
                ? "under 1%"
                : `${Math.round((parseMs / BUDGET_MS) * 100)}%`}
            </span>{" "}
            of the budget.{" "}
            {/*
             * Both branches, because a demo that can only ever report failure is not a
             * measurement. A hot cache or a very short prompt can land inside 100ms, and the
             * argument does not depend on it missing — it depends on which half is *load
             * bearing* for what the user reads.
             */}
            {overBudget > 1 ? (
              <>
                The card takes{" "}
                <span className="tabular-nums text-ink-mid">{overBudget.toFixed(1)}×</span> the whole
                budget — which is why it is the card that waits and not the filters.
              </>
            ) : (
              <>
                The card came back inside the budget this time, at{" "}
                <span className="tabular-nums text-ink-mid">
                  {Math.round(overBudget * 100)}%
                </span>{" "}
                of it — but that is one sample of a hosted call, and it is not the number you
                would design a search box around.
              </>
            )}
          </>
        )}{" "}
        The debounce is this app&rsquo;s own choice and can be tuned; the network leg cannot. The
        parse bar is drawn at a {MIN_BAR_PX}px minimum, because at this scale it is narrower than one
        pixel.
      </p>
    </section>
  );
}

function Track({
  label,
  detail,
  value,
  segments,
  pct,
}: {
  label: string;
  detail: string;
  value: string;
  segments: { ms: number; className: string }[];
  pct: (ms: number) => string;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 text-[11px]">
        <span className="text-ink-mid">
          {label} <span className="text-ink-faint">· {detail}</span>
        </span>
        <span className="shrink-0 tabular-nums text-ink-soft">{value}</span>
      </div>
      {/* `flex` rather than absolute offsets, so the segments stack without any arithmetic. */}
      <div className="mt-1 flex h-2 overflow-hidden rounded-full bg-raised">
        {segments.map((segment, index) => (
          <div
            key={index}
            className={segment.className}
            style={{ width: pct(segment.ms), minWidth: segment.ms > 0 ? MIN_BAR_PX : 0 }}
          />
        ))}
      </div>
    </div>
  );
}

function Legend({ className, children }: { className: string; children: React.ReactNode }) {
  return (
    <span className="flex items-center gap-1.5">
      <span aria-hidden className={`size-2 rounded-full ${className}`} />
      {children}
    </span>
  );
}
