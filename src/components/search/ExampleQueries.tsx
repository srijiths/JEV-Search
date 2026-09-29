"use client";

import { cn } from "@/lib/cn";
import { EXAMPLE_GROUPS } from "@/lib/examples";
import { INTENT_SPECS } from "../cards/intentSpecs";

/**
 * This app's only documentation, and permanently on screen.
 *
 * Thirty-six filters are invisible until something fills them, so a visitor facing an empty
 * box has no way to know that "no HOA" or "at least half an acre" or "within 25 minutes of
 * Apple Park" are all understood. One click puts a fully-specified query on screen and the
 * card underneath shows what came out of it.
 *
 * It stays mounted after a pick rather than standing in for an empty box, because the list is
 * the fastest way to see the *morph* — the thing worth watching is one card becoming another,
 * and that needs the next query to be one click away rather than a full retype. `active` marks
 * which one is currently in the box so clicking along the list stays legible; it stops matching
 * the moment the query is edited by hand, which is the honest reading.
 *
 * Grouped by the card each query becomes, and labelled in that card's accent colour, so the
 * list doubles as a preview of the morph: pick the teal one and a teal commute card is what
 * appears. The queries themselves live in `src/lib/examples.ts`, where a test holds them to
 * covering every filter a parser owns.
 */
export function ExampleQueries({
  onPick,
  active,
}: {
  onPick: (text: string) => void;
  /** The current query text, so the chip that produced it can be marked. */
  active?: string;
}) {
  return (
    <section aria-labelledby="examples-heading" className="space-y-2">
      <h2 id="examples-heading" className="px-1 text-[11px] text-ink-faint">
        Try one of these — between them they use every filter this box understands.
      </h2>
      <dl className="space-y-1.5">
        {EXAMPLE_GROUPS.map(({ intent, examples }) => {
          const spec = INTENT_SPECS[intent];
          const Icon = spec.icon;
          return (
            <div key={intent} className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
              <dt className={cn("flex w-16 shrink-0 items-center gap-1 text-[11px] font-medium", spec.accent.text)}>
                <Icon className="size-3 shrink-0" aria-hidden />
                {spec.shortLabel}
              </dt>
              {examples.map((example) => {
                const isActive = active === example.text;
                return (
                  <dd key={example.text} className="min-w-0">
                    <button
                      type="button"
                      onClick={() => onPick(example.text)}
                      // Hover-only, so it is an extra rather than the label. The query itself
                      // is the button's text and says plenty on its own.
                      title={example.shows}
                      // `aria-current` rather than `aria-pressed`: this is not a toggle that
                      // can be switched off, it is "you are here" within a list of the same
                      // kind of thing. Pressing it again is a no-op, not an untoggle.
                      aria-current={isActive || undefined}
                      className={cn(
                        "rounded-full border px-2.5 py-1 text-left text-xs transition",
                        isActive
                          ? "border-line-strong bg-raised text-ink"
                          : "border-line text-ink-muted hover:border-line-strong hover:text-ink-soft",
                      )}
                    >
                      {example.text}
                    </button>
                  </dd>
                );
              })}
            </div>
          );
        })}
      </dl>
    </section>
  );
}
