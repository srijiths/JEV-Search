"use client";

import { cn } from "@/lib/cn";
import type { ExtractionMode, FieldSource, FieldSources } from "@/lib/extraction";
import { FIELDS, sourceFor, type FieldSpec } from "@/lib/filters/fields";

/**
 * Who decided each field, this run.
 *
 * This is the answer to the only question that matters once both halves work: given a
 * `SearchQuery`, which values did a model produce and which did a regex? You cannot read it
 * off the output — `beds_min: 3` looks identical either way — and getting it wrong sends you
 * to the wrong file. So every field is listed under the half that produced it, with the
 * parser or question that owns it, rather than summarised as a count.
 *
 * `none` gets its own column deliberately. "Jev was asked and said no" and "nobody could
 * tell" are different bugs: the first is a threshold or a criteria problem, the second means
 * the text genuinely did not say, or a trigger is missing.
 */

const GROUPS: { source: FieldSource; title: string; blurb: string; style: string; dot: string }[] = [
  {
    source: "jev",
    title: "Jev decided",
    blurb: "A model read the query and picked a label. Non-deterministic — re-asking can differ.",
    style: "border-violet-200 bg-violet-50/60",
    dot: "bg-violet-500",
  },
  {
    source: "parser",
    title: "Deterministic code decided",
    blurb: "A regex matched literal text. The same sentence always produces the same value.",
    style: "border-sky-200 bg-sky-50/60",
    dot: "bg-sky-500",
  },
  {
    source: "none",
    title: "Nobody — left empty",
    blurb: "Asked or scanned, and nothing was found. The query does not constrain these.",
    style: "border-line bg-raised",
    dot: "bg-ink-faint",
  },
];

export function Provenance({ sources, mode }: { sources: FieldSources; mode: ExtractionMode }) {
  const other: ExtractionMode = mode === "jev" ? "hybrid" : "jev";

  const byGroup = GROUPS.map((group) => ({
    ...group,
    fields: FIELDS.filter((f) => (sources[f.field] ?? "none") === group.source),
  }));

  // How many fields would change hands if the toggle were flipped — the concrete answer to
  // "what does this flag buy me", computed from the registry rather than asserted in prose.
  const moved = FIELDS.filter((f) => sourceFor(f.kind, mode) !== sourceFor(f.kind, other));

  return (
    <div>
      <h3 className="text-[10px] font-medium uppercase tracking-wide text-ink-muted">
        Who decided what — this query, in {mode} mode
      </h3>

      <div className="mt-2 grid gap-2 sm:grid-cols-3">
        {byGroup.map((group) => (
          <div key={group.source} className={cn("rounded-xl border p-2.5", group.style)}>
            <p className="flex items-center gap-1.5 text-[11px] font-medium text-ink-soft">
              <span className={cn("size-1.5 shrink-0 rounded-full", group.dot)} aria-hidden />
              {group.title}
              <span className="ml-auto tabular-nums text-ink-muted">{group.fields.length}</span>
            </p>
            <p className="mt-1 text-[10px] leading-relaxed text-ink-muted">{group.blurb}</p>
            {group.fields.length > 0 ? (
              <ul className="mt-2 space-y-1">
                {group.fields.map((spec) => (
                  <Row key={spec.field} spec={spec} moved={moved.includes(spec)} />
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-[10px] text-ink-faint">None.</p>
            )}
          </div>
        ))}
      </div>

      <p className="mt-2 text-[11px] leading-relaxed text-ink-faint">
        <span className="text-ink-muted">◆</span> marks the {moved.length} fields that would
        change hands in <code className="text-ink-muted">{other}</code> mode. The rest are fixed
        in both, and that is a property of Jev rather than an unfinished feature: it answers
        with a label, a probability or a score, so prices, areas, dates, addresses and keywords
        have no answer shape it could return them in.
      </p>
    </div>
  );
}

function Row({ spec, moved }: { spec: FieldSpec; moved: boolean }) {
  return (
    <li className="flex items-baseline gap-1.5">
      {/* The `◆` column is always present, so the field names stay aligned down the list. */}
      <span className="w-2 shrink-0 text-[10px] text-ink-muted">{moved ? "◆" : ""}</span>
      <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-ink-soft" title={spec.label}>
        {spec.field}
      </span>
      <span className="shrink-0 font-mono text-[10px] text-ink-faint">
        {spec.owner.replace(/^parse\//, "")}
      </span>
    </li>
  );
}
