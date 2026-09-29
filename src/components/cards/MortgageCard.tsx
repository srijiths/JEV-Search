"use client";

import { useMemo, useState } from "react";
import { motion } from "motion/react";
import { formatMoney } from "@/lib/parse/common";
import { estimateMortgage, mortgagePrice, MORTGAGE_DEFAULTS } from "@/lib/parse/mortgage";
import type { SearchQuery } from "@/lib/jev/types";
import { INTENT_SPECS } from "./intentSpecs";
import { SearchCard } from "./SearchCard";

/**
 * The one card that computes rather than filters.
 *
 * Every number here comes from `estimateMortgage`. Rate, term and down payment are
 * editable because the defaults are placeholders, not market data, and a payment figure
 * presented as fact when the rate was guessed would be worse than no figure at all.
 */

export type MortgageCardProps = {
  query: SearchQuery;
  ghost?: boolean;
  onSubmit?: () => void;
  onDismiss?: () => void;
};

export function MortgageCard({ query, ghost, onSubmit, onDismiss }: MortgageCardProps) {
  const [downPercent, setDownPercent] = useState(MORTGAGE_DEFAULTS.downFraction * 100);
  const [ratePercent, setRatePercent] = useState(MORTGAGE_DEFAULTS.annualRate * 100);
  const [termYears, setTermYears] = useState<number>(MORTGAGE_DEFAULTS.termYears);

  const price = mortgagePrice(query.price_min, query.price_max);

  const estimate = useMemo(
    () =>
      price === null
        ? null
        : estimateMortgage({
            price,
            downFraction: downPercent / 100,
            annualRate: ratePercent / 100,
            termYears,
          }),
    [price, downPercent, ratePercent, termYears],
  );

  return (
    <SearchCard
      spec={INTENT_SPECS.mortgage}
      query={query}
      ghost={ghost}
      onSubmit={onSubmit}
      onDismiss={onDismiss}
    >
      <motion.div layout="position" className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
        {price === null || !estimate ? (
          <p className="text-sm text-ink-mid">
            Add a price — &ldquo;can I afford an $800k house&rdquo; — and the monthly cost appears here.
          </p>
        ) : (
          <>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-semibold tabular-nums text-amber-700">
                {formatMoney(estimate.total)}
              </span>
              <span className="text-xs text-ink-mid">per month, all in</span>
            </div>

            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs sm:grid-cols-4">
              <Row label="Principal &amp; interest" value={estimate.principalInterest} />
              <Row label="Property tax" value={estimate.tax} />
              <Row label="Insurance" value={estimate.insurance} />
              <Row label="Down payment" value={estimate.downPayment} />
            </dl>

            {!ghost && (
              <div className="mt-4 grid grid-cols-3 gap-3">
                <Input label="Down %" value={downPercent} step={1} min={0} max={100} onChange={setDownPercent} />
                <Input label="Rate %" value={ratePercent} step={0.125} min={0} max={25} onChange={setRatePercent} />
                <Input label="Years" value={termYears} step={5} min={5} max={40} onChange={setTermYears} />
              </div>
            )}
          </>
        )}
      </motion.div>
    </SearchCard>
  );
}

function Row({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt className="text-ink-muted">{label}</dt>
      <dd className="tabular-nums text-ink-soft">{formatMoney(value)}</dd>
    </div>
  );
}

function Input({
  label,
  value,
  step,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  step: number;
  min: number;
  max: number;
  onChange: (next: number) => void;
}) {
  return (
    <label className="block">
      <span className="text-[10px] font-medium uppercase tracking-wide text-ink-muted">{label}</span>
      <input
        type="number"
        value={value}
        step={step}
        min={min}
        max={max}
        onChange={(event) => {
          const next = Number(event.target.value);
          // An empty input parses to NaN, which would render the whole card as "$NaN".
          if (Number.isFinite(next)) onChange(next);
        }}
        className="mt-1 w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-sm tabular-nums text-ink-soft outline-none focus:border-amber-400"
      />
    </label>
  );
}
