"use client";

import { cn } from "@/lib/cn";
import type { CardIntent } from "@/lib/jev/types";
import { INTENT_SPECS, PALETTE_ORDER } from "../cards/intentSpecs";

/**
 * Manual intent override.
 *
 * Any classifier is wrong sometimes, and a morphing UI makes being wrong loud — the
 * whole card is the mistake. This is the escape hatch: pick the search you actually
 * wanted and it sticks until the query is rewritten (see `force` in `decide.ts`).
 */
export function IntentPalette({
  active,
  onPick,
}: {
  active: CardIntent | null;
  onPick: (intent: CardIntent) => void;
}) {
  return (
    <div role="group" aria-label="Choose a search type" className="flex flex-wrap gap-1.5">
      {PALETTE_ORDER.map((intent) => {
        const spec = INTENT_SPECS[intent];
        const Icon = spec.icon;
        const isActive = active === intent;
        return (
          <button
            key={intent}
            type="button"
            onClick={() => onPick(intent)}
            aria-pressed={isActive}
            className={cn(
              "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition",
              isActive
                ? spec.accent.chip
                : "border-line text-ink-muted hover:border-line-strong hover:text-ink-soft",
            )}
          >
            <Icon className="size-3" aria-hidden />
            {spec.shortLabel}
          </button>
        );
      })}
    </div>
  );
}
