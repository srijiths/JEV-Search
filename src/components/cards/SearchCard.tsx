"use client";

import { motion } from "motion/react";
import { MapPin, X } from "lucide-react";
import { cn } from "@/lib/cn";
import type { SearchQuery } from "@/lib/jev/types";
import { formatLocation } from "@/lib/parse/location";
import { formatPriceRange } from "@/lib/parse/price";
import { formatPropertyTypes } from "@/lib/parse/propertyType";
import { formatBaths, formatBeds } from "@/lib/parse/rooms";
import { formatAmenity } from "@/lib/parse/amenities";
import type { PropertyType } from "@/lib/jev/types";
import type { FieldKey, IntentSpec } from "./intentSpecs";

/**
 * The filter card. Driven entirely by an `IntentSpec`, so all seven intents share one
 * layout and differ only in accent, wording, and which fields they show.
 *
 * Fields with no value are omitted rather than rendered empty. A card that lists
 * "Beds: —" is telling the user about a field they never mentioned, and the point of
 * the morph is to show them what the machine understood, not a blank form.
 */

export type SearchCardProps = {
  spec: IntentSpec;
  query: SearchQuery;
  /** A ghost is the faint preview shown before the intent is committed. */
  ghost?: boolean;
  onSubmit?: () => void;
  onDismiss?: () => void;
  /** Extra content between the filters and the action row, e.g. the mortgage figures. */
  children?: React.ReactNode;
};

type Field = { key: FieldKey; label: string; value: string };

function fieldsFor(spec: IntentSpec, q: SearchQuery): Field[] {
  const values: Partial<Record<FieldKey, string>> = {
    location: formatLocation(q.location),
    propertyType: q.property_type.length
      ? formatPropertyTypes(q.property_type as PropertyType[])
      : "",
    price: formatPriceRange(q.price_min, q.price_max, spec.monthlyPrice),
    beds: formatBeds(q.beds_min),
    baths: formatBaths(q.baths_min),
    sqft: q.sqft_min !== null ? `${q.sqft_min.toLocaleString("en-US")}+ sqft` : "",
    amenities: "", // Rendered as chips below, not as a single value.
    timeframe: q.timeframe,
    sort: q.sort_by ? SORT_LABELS[q.sort_by] ?? q.sort_by : "",
  };

  const labels: Record<FieldKey, string> = {
    location: "Where",
    propertyType: "Type",
    price: spec.monthlyPrice ? "Rent" : "Price",
    beds: "Beds",
    baths: "Baths",
    sqft: "Size",
    amenities: "Must have",
    timeframe: "When",
    sort: "Sort",
  };

  return spec.fields
    .filter((key) => key !== "amenities" && values[key])
    .map((key) => ({ key, label: labels[key], value: values[key]! }));
}

const SORT_LABELS: Record<string, string> = {
  price_asc: "Lowest price",
  price_desc: "Highest price",
  newest: "Newest first",
  largest: "Largest first",
};

export function SearchCard({ spec, query, ghost, onSubmit, onDismiss, children }: SearchCardProps) {
  const fields = fieldsFor(spec, query);
  const showAmenities = spec.fields.includes("amenities") && query.amenities.length > 0;
  const Icon = spec.icon;

  return (
    <motion.section
      // `layout` is what makes one card morph into the next rather than cross-fade:
      // shared elements animate between positions instead of being torn down.
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: ghost ? 0.55 : 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ type: "spring", stiffness: 420, damping: 34 }}
      aria-live="polite"
      aria-label={`${spec.title}${ghost ? " (preview)" : ""}`}
      className={cn(
        "relative w-full rounded-2xl border bg-surface p-5 shadow-sm ring-1",
        spec.accent.border,
        spec.accent.ring,
        ghost && "pointer-events-none border-dashed",
      )}
    >
      <header className="flex items-start gap-3">
        <span className={cn("grid size-9 shrink-0 place-items-center rounded-xl", spec.accent.bg)}>
          <Icon className={cn("size-[18px]", spec.accent.text)} aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold text-ink">{spec.title}</h2>
          <p className="truncate text-xs text-ink-muted">{spec.subtitle}</p>
        </div>
        {!ghost && onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss this card and go back to plain text"
            className="rounded-lg p-1.5 text-ink-muted transition hover:bg-raised hover:text-ink-soft"
          >
            <X className="size-4" aria-hidden />
          </button>
        )}
      </header>

      {fields.length > 0 && (
        <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
          {fields.map((field) => (
            <motion.div key={field.key} layout="position" className="min-w-0">
              <dt className="text-[10px] font-medium uppercase tracking-wide text-ink-muted">
                {field.label}
              </dt>
              <dd className="flex items-center gap-1 truncate text-sm text-ink-soft">
                {field.key === "location" && <MapPin className="size-3 shrink-0 text-ink-muted" aria-hidden />}
                <span className="truncate">{field.value}</span>
              </dd>
            </motion.div>
          ))}
        </dl>
      )}

      {showAmenities && (
        <motion.div layout="position" className="mt-4">
          <p className="text-[10px] font-medium uppercase tracking-wide text-ink-muted">Must have</p>
          <ul className="mt-1.5 flex flex-wrap gap-1.5">
            {query.amenities.map((tag) => (
              <li
                key={tag}
                className={cn("rounded-full border px-2 py-0.5 text-xs", spec.accent.chip)}
              >
                {formatAmenity(tag)}
              </li>
            ))}
          </ul>
        </motion.div>
      )}

      {children}

      {!ghost && (
        <motion.div layout="position" className="mt-5 flex items-center justify-between gap-3">
          <p className="text-xs text-ink-muted">
            {fields.length === 0 && !showAmenities
              ? "Keep typing to add filters."
              : `${fields.length + (showAmenities ? query.amenities.length : 0)} filters`}
          </p>
          <button
            type="button"
            onClick={onSubmit}
            className={cn(
              "rounded-xl border px-3.5 py-2 text-sm font-medium transition",
              spec.accent.chip,
              "hover:brightness-95",
            )}
          >
            {spec.action}
          </button>
        </motion.div>
      )}
    </motion.section>
  );
}
