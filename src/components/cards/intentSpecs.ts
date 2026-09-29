import {
  Building2,
  CalendarClock,
  Car,
  Handshake,
  Home,
  Landmark,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";
import type { CardIntent } from "@/lib/jev/types";

/**
 * One descriptor per intent, instead of seven near-identical card components.
 *
 * The cards differ in accent colour, wording, and *which filters are worth showing* —
 * a rental search has no use for a mortgage rate and a sold-comps lookup has no use for
 * a move-in date. All of that is data, so it lives here, and `SearchCard` renders it.
 * The only intent that needs real code of its own is `mortgage`, because it does
 * arithmetic rather than filtering.
 */

/** Filter fields a card can display, in the order they read best. */
export type FieldKey =
  | "location"
  | "propertyType"
  | "price"
  | "beds"
  | "baths"
  | "sqft"
  | "amenities"
  | "timeframe"
  | "sort";

export type IntentSpec = {
  intent: CardIntent;
  /** Card heading. */
  title: string;
  /** One line under the heading, explaining what this card will do. */
  subtitle: string;
  /** Label on the submit button. */
  action: string;
  icon: LucideIcon;
  /**
   * Tailwind classes for this card's accent. Spelled out rather than interpolated from
   * a colour name, because Tailwind only emits classes it can see in the source.
   */
  accent: { text: string; bg: string; border: string; ring: string; chip: string };
  fields: FieldKey[];
  /** Is the price a monthly figure? Changes formatting from "$1M" to "$3,000/mo". */
  monthlyPrice?: boolean;
  /** Shown in the palette so the user can switch intents by hand. */
  shortLabel: string;
};

/*
 * On a white canvas an accent has to carry contrast in the *text*, not the fill: a
 * translucent `-500/15` wash that read as colour against near-black is almost invisible
 * against white. So fills drop to `-50`, hairlines to `-200`, and the ink moves to
 * `-600`/`-700`, which clears WCAG AA on white while staying recognisably the same hue.
 */
const ACCENTS = {
  emerald: {
    text: "text-emerald-600",
    bg: "bg-emerald-50",
    border: "border-emerald-200",
    ring: "ring-emerald-100",
    chip: "bg-emerald-50 text-emerald-700 border-emerald-200",
  },
  sky: {
    text: "text-sky-600",
    bg: "bg-sky-50",
    border: "border-sky-200",
    ring: "ring-sky-100",
    chip: "bg-sky-50 text-sky-700 border-sky-200",
  },
  violet: {
    text: "text-violet-600",
    bg: "bg-violet-50",
    border: "border-violet-200",
    ring: "ring-violet-100",
    chip: "bg-violet-50 text-violet-700 border-violet-200",
  },
  amber: {
    text: "text-amber-600",
    bg: "bg-amber-50",
    border: "border-amber-200",
    ring: "ring-amber-100",
    chip: "bg-amber-50 text-amber-700 border-amber-200",
  },
  rose: {
    text: "text-rose-600",
    bg: "bg-rose-50",
    border: "border-rose-200",
    ring: "ring-rose-100",
    chip: "bg-rose-50 text-rose-700 border-rose-200",
  },
  teal: {
    text: "text-teal-600",
    bg: "bg-teal-50",
    border: "border-teal-200",
    ring: "ring-teal-100",
    chip: "bg-teal-50 text-teal-700 border-teal-200",
  },
  indigo: {
    text: "text-indigo-600",
    bg: "bg-indigo-50",
    border: "border-indigo-200",
    ring: "ring-indigo-100",
    chip: "bg-indigo-50 text-indigo-700 border-indigo-200",
  },
} as const;

export const INTENT_SPECS: Record<CardIntent, IntentSpec> = {
  buy: {
    intent: "buy",
    title: "Homes for sale",
    subtitle: "Listings on the market that match your criteria",
    action: "Search listings",
    icon: Home,
    accent: ACCENTS.emerald,
    fields: ["location", "propertyType", "price", "beds", "baths", "sqft", "amenities", "sort"],
    shortLabel: "Buy",
  },
  rent: {
    intent: "rent",
    title: "Rentals",
    subtitle: "Places available to lease right now",
    action: "Search rentals",
    icon: Building2,
    accent: ACCENTS.sky,
    fields: ["location", "propertyType", "price", "beds", "baths", "amenities", "timeframe", "sort"],
    monthlyPrice: true,
    shortLabel: "Rent",
  },
  sold: {
    intent: "sold",
    title: "Recently sold",
    subtitle: "Closed sales and comparables in this area",
    action: "Show comparables",
    icon: TrendingUp,
    accent: ACCENTS.violet,
    // No move-in date and no amenity filter: this is a price-history question, and
    // amenities would narrow the comp set to the point of being useless.
    fields: ["location", "propertyType", "price", "beds", "sqft"],
    shortLabel: "Sold",
  },
  mortgage: {
    intent: "mortgage",
    title: "Affordability",
    subtitle: "What this would cost you per month",
    action: "Refine estimate",
    icon: Landmark,
    accent: ACCENTS.amber,
    fields: ["price", "location"],
    shortLabel: "Mortgage",
  },
  valuation: {
    intent: "valuation",
    title: "What's it worth",
    subtitle: "An estimated value for this property",
    action: "Get estimate",
    icon: TrendingUp,
    accent: ACCENTS.rose,
    fields: ["location", "propertyType", "beds", "baths", "sqft"],
    shortLabel: "Value",
  },
  commute: {
    intent: "commute",
    title: "Search by commute",
    subtitle: "Homes within reach of where you need to be",
    action: "Search by travel time",
    icon: Car,
    accent: ACCENTS.teal,
    fields: ["location", "propertyType", "price", "beds", "amenities"],
    shortLabel: "Commute",
  },
  agent: {
    intent: "agent",
    title: "Find an agent",
    subtitle: "Agents who work in this area and price range",
    action: "Browse agents",
    icon: Handshake,
    accent: ACCENTS.indigo,
    fields: ["location", "propertyType", "price"],
    shortLabel: "Agent",
  },
};

/** Palette order — most common intents first, so the ones people want are leftmost. */
export const PALETTE_ORDER: CardIntent[] = [
  "buy",
  "rent",
  "sold",
  "mortgage",
  "valuation",
  "commute",
  "agent",
];

export { CalendarClock };
