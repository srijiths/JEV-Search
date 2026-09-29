"use client";

import type { CardIntent, SearchQuery } from "@/lib/jev/types";
import { INTENT_SPECS } from "./intentSpecs";
import { MortgageCard } from "./MortgageCard";
import { SearchCard } from "./SearchCard";

/** Route an intent to its card. Only `mortgage` needs a bespoke one; the rest are specs. */
export function IntentCard({
  intent,
  query,
  ghost,
  onSubmit,
  onDismiss,
}: {
  intent: CardIntent;
  query: SearchQuery;
  ghost?: boolean;
  onSubmit?: () => void;
  onDismiss?: () => void;
}) {
  if (intent === "mortgage") {
    return <MortgageCard query={query} ghost={ghost} onSubmit={onSubmit} onDismiss={onDismiss} />;
  }
  return (
    <SearchCard
      spec={INTENT_SPECS[intent]}
      query={query}
      ghost={ghost}
      onSubmit={onSubmit}
      onDismiss={onDismiss}
    />
  );
}
