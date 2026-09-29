"use client";

import { cn } from "@/lib/cn";
import { SIGNAL_THRESHOLDS } from "@/lib/signals";
import type { IntentResult } from "@/lib/jev/types";

/**
 * Everything Jev returned, before any gating.
 *
 * `signals.ts` deliberately hides most of this from the UI — a noul at 0.31 is noise and
 * rendering it as a chip would make the interface twitch. But "hidden from the UI" and
 * "hidden from you" are different requirements, and for working out why a filter did or
 * did not appear you need the raw number and the threshold it was compared against.
 *
 * So every answer is listed, the threshold is drawn on the bar, and the ones that cleared it
 * are marked. A noul sitting at 0.58 against a 0.65 floor is the single most common reason a
 * feature the user clearly asked for is missing, and it is invisible anywhere else.
 */

const { noulOn, choiceMin, urgentOn } = SIGNAL_THRESHOLDS;

/** Rubric levels in `questions.ts`, for mapping a 1..3 score onto a 0..1 bar. */
const SCORE_LEVELS = 3;

/**
 * A 0..1 value with its decision threshold drawn in, so "why not?" is answerable by eye.
 *
 * `threshold` is optional because not every answer has one: `readiness` feeds the state
 * machine as a continuous input rather than being compared to a floor, and inventing a line
 * for it would imply a cutoff that does not exist.
 */
function Meter({ value, threshold }: { value: number; threshold?: number }) {
  const on = threshold !== undefined && value >= threshold;
  return (
    <span className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-track">
      <span
        className={cn("block h-full rounded-full", on ? "bg-emerald-500" : "bg-ink-faint")}
        style={{ width: `${Math.round(Math.min(1, Math.max(0, value)) * 100)}%` }}
      />
      {/* The floor, as a hairline. Without it a bar is a number with no verdict attached. */}
      {threshold !== undefined && (
        <span
          aria-hidden
          className="absolute inset-y-0 w-px bg-ink-soft/50"
          style={{ left: `${Math.round(threshold * 100)}%` }}
        />
      )}
    </span>
  );
}

function Row({
  name,
  value,
  threshold,
  note,
}: {
  name: string;
  value: number;
  threshold?: number;
  note?: string;
}) {
  return (
    <li className="flex items-center gap-2">
      <span className="w-44 shrink-0 truncate font-mono text-[11px] text-ink-muted" title={name}>
        {name}
      </span>
      <Meter value={value} threshold={threshold} />
      <span className="w-24 shrink-0 text-right text-[11px] tabular-nums text-ink-muted">
        {note ?? value.toFixed(2)}
      </span>
    </li>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-3">
      <p className="text-[10px] uppercase tracking-wide text-ink-faint">{title}</p>
      <ul className="mt-1.5 space-y-1">{children}</ul>
    </div>
  );
}

export function JevAnswers({ result }: { result: IntentResult | null }) {
  if (!result) {
    return (
      <div>
        <h3 className="text-[10px] font-medium uppercase tracking-wide text-ink-muted">
          Jev&rsquo;s answers
        </h3>
        <p className="mt-1 text-xs text-ink-faint">Nothing classified yet.</p>
      </div>
    );
  }

  const { signals, extended } = result;
  const choices = [
    { name: "intent", answer: result.intent },
    { name: "priceBound", answer: signals.priceBound },
    { name: "priceCadence", answer: signals.priceCadence },
    { name: "sortPreference", answer: signals.sortPreference },
  ];

  // Everything typed as a bare number in `Signals` is a noul. Listed from the object rather
  // than from a hand-written array, so a question added to `questions.ts` shows up here
  // without anyone remembering to add a row.
  const coreNouls = Object.entries(signals).filter(
    (entry): entry is [string, number] => typeof entry[1] === "number",
  );

  return (
    <div>
      <h3 className="text-[10px] font-medium uppercase tracking-wide text-ink-muted">
        Jev&rsquo;s answers — raw, before gating
      </h3>

      <Group title={`Choices — acted on at confidence ≥ ${choiceMin}`}>
        {choices.map(({ name, answer }) => (
          <Row
            key={name}
            name={name}
            value={answer.confidence}
            threshold={choiceMin}
            note={`${answer.value} · ${answer.confidence.toFixed(2)}`}
          />
        ))}
      </Group>

      {/* Bars are the score over its rubric; the number beside them is the score itself. */}
      <Group title={`Scores — expected level on a 1–${SCORE_LEVELS} rubric`}>
        <Row
          name="readiness"
          value={result.readiness / SCORE_LEVELS}
          note={`${result.readiness.toFixed(2)} / ${SCORE_LEVELS}`}
        />
        <Row
          name="urgency"
          value={signals.urgency.score / SCORE_LEVELS}
          threshold={urgentOn / SCORE_LEVELS}
          note={`${signals.urgency.score.toFixed(2)} / ${SCORE_LEVELS}`}
        />
      </Group>

      <Group title={`Nouls, core set — acted on at ≥ ${noulOn}`}>
        {coreNouls.map(([name, value]) => (
          <Row key={name} name={name} value={value} threshold={noulOn} />
        ))}
      </Group>

      {extended ? (
        <>
          <Group title={`Extended choices — jev mode only, ≥ ${choiceMin}`}>
            {Object.entries(extended.choices).map(([name, a]) => (
              <Row
                key={name}
                name={name}
                value={a.confidence}
                threshold={choiceMin}
                note={`${a.value} · ${a.confidence.toFixed(2)}`}
              />
            ))}
          </Group>
          <Group title={`Extended nouls — jev mode only, ≥ ${noulOn}`}>
            {Object.entries(extended.nouls).map(([name, value]) => (
              <Row key={name} name={name} value={value} threshold={noulOn} />
            ))}
          </Group>
        </>
      ) : (
        <p className="mt-3 text-[11px] leading-relaxed text-ink-faint">
          The 34 extended questions were not asked — this ran in{" "}
          <code className="text-ink-muted">hybrid</code> mode, where the closed-set filters come
          from the parsers instead. Switch the mode above to see Jev&rsquo;s answers for them.
        </p>
      )}
    </div>
  );
}
