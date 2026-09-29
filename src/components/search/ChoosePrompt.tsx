"use client";

import { motion } from "motion/react";
import { cn } from "@/lib/cn";
import type { CardIntent } from "@/lib/jev/types";
import { INTENT_SPECS } from "../cards/intentSpecs";

/**
 * The tie-breaker.
 *
 * When two intents sit within `chooseGap` of each other, guessing has a coin-flip
 * chance of morphing into the wrong layout — and the user then has to notice and undo
 * it. Asking costs one click and is always right. "3 bedroom in Cupertino" is the standard
 * example: nothing in it says buy or rent.
 */
export function ChoosePrompt({
  options,
  onPick,
}: {
  options: [CardIntent, CardIntent];
  onPick: (intent: CardIntent) => void;
}) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ type: "spring", stiffness: 420, damping: 34 }}
      className="rounded-2xl border border-line bg-surface p-5 shadow-sm"
    >
      {/* Deliberately not "buy or rent": buy/rent is the common tie, but sold/valuation
          and buy/mortgage tie too, and a hardcoded question would misdescribe those. */}
      <p className="text-sm text-ink-soft">Which did you mean?</p>
      <p className="mt-0.5 text-xs text-ink-muted">
        This could go either way — pick one and the search follows.
      </p>
      <div className="mt-4 grid grid-cols-2 gap-3">
        {options.map((intent) => {
          const spec = INTENT_SPECS[intent];
          const Icon = spec.icon;
          return (
            <button
              key={intent}
              type="button"
              onClick={() => onPick(intent)}
              className={cn(
                "flex items-center gap-3 rounded-xl border p-3 text-left transition hover:brightness-95",
                spec.accent.border,
                spec.accent.bg,
              )}
            >
              <span className={cn("grid size-8 shrink-0 place-items-center rounded-lg", spec.accent.bg)}>
                <Icon className={cn("size-4", spec.accent.text)} aria-hidden />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-ink">{spec.title}</span>
                <span className="block truncate text-xs text-ink-muted">{spec.shortLabel}</span>
              </span>
            </button>
          );
        })}
      </div>
    </motion.div>
  );
}
