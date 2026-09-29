"use client";

import { cn } from "@/lib/cn";
import { formatParse } from "@/lib/format";
import type { Status } from "@/hooks/useSearchIntent";

/**
 * A permanent, honest readout of what the last keystroke cost — in time and in money.
 *
 * Online-only means every keystroke that misses the cache is a paid network round trip, and
 * the UI's responsiveness is not a detail — it is the product. Putting the numbers on screen
 * keeps that visible instead of hiding it behind a spinner: a 200ms answer feels like
 * thinking, a 2s answer feels broken, and you can only tune what you can see. The token
 * count is here for the same reason, and because it is the one number that makes the
 * `EXTRACTION_MODE` tradeoff concrete — `jev` mode asks 51 questions instead of 17 and the
 * prompt is about 2.5× the size, which is a sentence until you watch the figure change.
 *
 * `cached` is called out separately because a cache hit is genuinely 0ms of network and 0
 * tokens, and reporting that as a fast Jev call would flatter the model with someone else's
 * work. The route drops the usage numbers on that path, so there is nothing to print.
 */
export function LatencyHud({
  status,
  latencyMs,
  parseMs,
  cached,
  costUsd,
  inputTokens,
  outputTokens,
}: {
  status: Status;
  latencyMs: number;
  parseMs: number;
  cached?: boolean;
  costUsd?: number;
  inputTokens?: number;
  outputTokens?: number;
}) {
  const label =
    status === "idle"
      ? "waiting for input"
      : status === "thinking"
        ? "asking Jev…"
        : status === "error"
          ? "call failed"
          : cached
            ? "cached · 0ms"
            : `${latencyMs}ms`;

  /*
   * Only once the call has landed. While `status` is `thinking` the `result` prop still
   * holds the *previous* keystroke's answer, and printing its cost beside "asking Jev…"
   * would attribute one call's tokens to another.
   */
  const usage =
    status === "ready"
      ? [
          costUsd === undefined ? null : formatCost(costUsd),
          formatTokens(inputTokens, outputTokens),
        ].filter((part): part is string => part !== null)
      : [];

  /*
   * Unlike everything else here, the parse time is shown in every state including `thinking`
   * — because unlike everything else here it is not waiting on anything. That is the whole
   * claim: while the dot is pulsing amber, the filters on screen have already been computed
   * from the current text. `idle` is the one exception, where there is no query to parse.
   */
  const parse = status === "idle" ? [] : [`${formatParse(parseMs)} parse`];

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed bottom-4 right-4 z-50 flex items-center gap-2 rounded-full border border-line bg-surface/90 px-3 py-1.5 text-[11px] tabular-nums text-ink-mid backdrop-blur"
    >
      <span
        className={cn(
          "size-1.5 rounded-full transition-colors",
          status === "thinking" && "animate-pulse bg-amber-500",
          status === "ready" && (cached ? "bg-sky-500" : "bg-emerald-500"),
          status === "error" && "bg-red-500",
          status === "idle" && "bg-ink-faint",
        )}
      />
      {[label, ...parse, ...usage].join(" · ")}
    </div>
  );
}

/**
 * A single decision costs a fraction of a cent, and `$0.0002` rounds most of the signal
 * away — the figure stops moving between modes, which is the one thing it is here to show.
 * So anything under a cent is shown in cents to two significant figures: "0.021¢". The
 * `Number` round trip is there to drop the trailing zeros `toPrecision` leaves behind.
 */
function formatCost(usd: number): string {
  if (usd <= 0) return "free";
  if (usd < 0.01) return `${Number((usd * 100).toPrecision(2))}¢`;
  return `$${usd.toFixed(2)}`;
}

/**
 * "1,240→86 tok", or nothing at all.
 *
 * Both halves are shown rather than a total, because they are not interchangeable: the
 * input side is the question schema and grows with the mode, the output side is a handful
 * of answers and barely moves. A sum would hide exactly the thing worth watching.
 */
function formatTokens(input?: number, output?: number): string | null {
  if (input === undefined && output === undefined) return null;
  const n = (value?: number) => (value === undefined ? "?" : value.toLocaleString());
  return `${n(input)}→${n(output)} tok`;
}
