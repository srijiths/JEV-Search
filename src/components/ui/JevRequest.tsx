"use client";

import { useState } from "react";
import { cn } from "@/lib/cn";
import type { ExtractionMode } from "@/lib/extraction";
import { decisionsRequest, questionsFor, requestChars } from "@/lib/jev/request";
import type { Question } from "@/lib/jev/schema";

/**
 * The request, exactly as posted to Jev.
 *
 * Built with `decisionsRequest()` — the same function `src/lib/jev/client.ts` calls to make
 * the real call — so this is the request rather than a description of it. That distinction
 * is the entire reason this component exists: a debug panel that paraphrases the payload
 * from a developer's memory of it will keep showing the old shape after the call changes,
 * and you will spend an afternoon debugging the wrong thing.
 *
 * Two halves are worth separating by eye, because they behave completely differently:
 *
 *   `state`     — the input. Changes on every keystroke, measures in tens of bytes.
 *   `questions` — the schema. Fixed for a given mode, and ~99% of what you pay for, because
 *                 it is resent in full on every single request.
 */

/** Every question name asked in `hybrid`. Anything outside this set is an extended question. */
const CORE_KEYS = new Set(Object.keys(questionsFor("hybrid")));

/** What a question can answer with — the honest bound on what Jev can tell you. */
function answerShape(q: Question): string {
  if (q.type === "choice") return Object.keys(q.criteria).join(" | ");
  if (q.type === "score") return `score 1–${q.criteria.length}, fractional`;
  return "probability 0–1";
}

const TYPE_STYLE: Record<Question["type"], string> = {
  choice: "border-violet-200 bg-violet-50 text-violet-700",
  noul: "border-sky-200 bg-sky-50 text-sky-700",
  score: "border-amber-200 bg-amber-50 text-amber-700",
};

export function JevRequest({
  text,
  mode,
  model,
}: {
  /** The raw input. Shown verbatim, including whitespace, because that is what is sent. */
  text: string;
  mode: ExtractionMode;
  model: string;
}) {
  const [showSchema, setShowSchema] = useState(false);

  const request = decisionsRequest(text, mode, model);
  const entries = Object.entries(request.questions);
  const chars = requestChars(request);
  const stateChars = JSON.stringify(request.state).length;

  return (
    <div>
      <h3 className="text-[10px] font-medium uppercase tracking-wide text-ink-muted">
        Input sent to Jev — POST /api/alpha/decisions
      </h3>

      {/* ── The part that changes as you type ── */}
      <pre className="mt-2 overflow-x-auto rounded-xl border border-line bg-raised p-3 text-[11px] leading-relaxed text-ink-soft">
        {JSON.stringify({ model: request.model, state: request.state }, null, 2)}
      </pre>
      <p className="mt-1.5 text-[11px] leading-relaxed text-ink-faint">
        That is the whole input — Jev is given the query string and nothing else. No chat
        transcript, no system prompt, no listing data, no history. It answers the{" "}
        {entries.length} questions below against it in parallel, which is why one round trip
        is enough.
      </p>

      {/* ── The part that costs money ── */}
      <div className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[11px] text-ink-muted">
        <span>
          <span className="tabular-nums text-ink-soft">{entries.length}</span> questions
        </span>
        <span>
          <span className="tabular-nums text-ink-soft">{chars.toLocaleString("en-US")}</span> chars
          total
        </span>
        <span className="text-ink-faint">
          of which the query is {stateChars.toLocaleString("en-US")} — the schema is the bill
        </span>
        <button
          type="button"
          onClick={() => setShowSchema((v) => !v)}
          className="rounded-full border border-line px-2 py-0.5 text-[10px] text-ink-muted transition hover:border-line-strong hover:text-ink-soft"
        >
          {showSchema ? "Hide raw schema" : "Show raw schema"}
        </button>
      </div>

      {showSchema ? (
        <pre className="mt-2 max-h-80 overflow-auto rounded-xl border border-line bg-raised p-3 text-[10px] leading-relaxed text-ink-soft">
          {JSON.stringify(request.questions, null, 2)}
        </pre>
      ) : (
        <ul className="mt-2 divide-y divide-line overflow-hidden rounded-xl border border-line">
          {entries.map(([name, q]) => (
            <li key={name} className="flex items-baseline gap-2 px-2.5 py-1.5">
              <span className="w-40 shrink-0 truncate font-mono text-[11px] text-ink-soft">{name}</span>
              <span
                className={cn(
                  "shrink-0 rounded-full border px-1.5 py-px text-[10px]",
                  TYPE_STYLE[q.type],
                )}
              >
                {q.type}
              </span>
              {/*
               * Core questions go in both modes; extended ones only in `jev`. Marked here
               * rather than in a separate list so the count above and the rows agree.
               */}
              {!CORE_KEYS.has(name) && (
                <span className="shrink-0 text-[10px] text-ink-faint">extended</span>
              )}
              <span className="min-w-0 flex-1 truncate text-right font-mono text-[10px] text-ink-faint">
                {answerShape(q)}
              </span>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-1.5 text-[11px] leading-relaxed text-ink-faint">
        Read the right-hand column as the limit on what Jev can be asked for. Every answer is
        a label, a probability or a fractional score — so no question above can come back
        holding <code className="text-ink-muted">850000</code> or{" "}
        <code className="text-ink-muted">100 Main St</code>, and nothing in this app tries.
      </p>
    </div>
  );
}
