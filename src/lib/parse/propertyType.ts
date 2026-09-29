import { kw, type Keyword } from "./common";
import { parseRooms } from "./rooms";
import { PROPERTY_TYPES, type PropertyType } from "../jev/types";

/**
 * What kind of building. A vocabulary lookup, so it is code's job.
 *
 * The keyword written into `raw_keywords` is the canonical type ("house"), not the
 * matched surface form ("houses") — the canonical form is what a downstream listing
 * query would need, and plural/singular noise is not worth carrying.
 */

const TRIGGERS: Array<[RegExp, PropertyType]> = [
  // Deliberately no bare "home"/"homes": "homes for sale in Cupertino" is how people say
  // *any* property, so treating it as `house` would silently exclude every condo the
  // user would have been happy with. "House" is specific; "home" is not.
  [/\b(?:single[-\s]?family|houses?|detached|bungalows?|ranch(?:es)?|colonials?)\b/i, "house"],
  [/\b(?:condos?|condominiums?|co[-\s]?ops?|cooperatives?)\b/i, "condo"],
  [/\b(?:town\s?houses?|town\s?homes?|row\s?houses?|row\s?homes?)\b/i, "townhouse"],
  [/\b(?:apartments?|apts?|flats?|lofts?|studios?|rentals? units?)\b/i, "apartment"],
  [/\b(?:multi[-\s]?family|duplex(?:es)?|triplex(?:es)?|fourplex(?:es)?|quadplex(?:es)?|\d+[-\s]?unit)\b/i, "multi-family"],
  [/\b(?:lands?|lots?|acreage|acres?|parcels?|vacant lots?)\b/i, "land"],
  [/\b(?:mobile homes?|manufactured homes?|trailers?|modular homes?)\b/i, "mobile"],
  // Before `land` would be wrong — "ranch" is a house style in most of the US and is
  // already claimed above, so only the unambiguous farm words appear here.
  [/\b(?:farms?|farmhouses?|farmland|homesteads?|orchards?|vineyards?)\b/i, "farm"],
];

export type PropertyTypeHit = {
  property_type: PropertyType[];
  keywords: Keyword[];
};

/**
 * Multiple types can be asked for at once ("condo or townhouse"), so every trigger
 * is tested. Order follows `PROPERTY_TYPES` rather than the text, because the array
 * is a filter set and a stable order makes two equivalent queries compare equal.
 */
export function parsePropertyType(text: string): PropertyTypeHit {
  const found = new Map<PropertyType, number>();

  for (const [re, type] of TRIGGERS) {
    const m = re.exec(text);
    if (!m) continue;
    // "townhouse" also matches the house trigger; the more specific type recorded
    // the earlier position, and keeping the earliest keeps the keyword honest.
    const at = found.get(type);
    if (at === undefined || m.index < at) found.set(type, m.index);
  }

  // "town houses" contains "houses", so `house` is spuriously present whenever a
  // townhouse was asked for. Drop the generic type unless a house word also appears
  // somewhere the townhouse phrase does not cover.
  dropIfOverlapping(text, found, "house", /\btown\s?(?:houses?|homes?)\b/i);

  // "half an acre" in "3 bed single story, half an acre" is a lot size, not a request for
  // vacant land — a parcel with nothing on it has no bedrooms. `home.ts` reads the figure
  // as `lot_size_min`, so leaving `land` set here as well would filter out every house the
  // person just described. Another stated building type settles it the same way.
  if (found.has("land") && (found.size > 1 || hasRooms(text))) found.delete("land");

  const property_type = PROPERTY_TYPES.filter((t) => found.has(t));
  const keywords = property_type.map((t) => kw(t, found.get(t)!));

  return { property_type, keywords };
}

/** A stated bed or bath count. Vacant land has neither, so it rules `land` out. */
function hasRooms(text: string): boolean {
  const rooms = parseRooms(text);
  return rooms.beds_min !== null || rooms.baths_min !== null;
}

/**
 * Remove `generic` if the only reason it matched is that `specific` contains it —
 * i.e. the text has no occurrence of a house word outside the specific phrase.
 */
function dropIfOverlapping(
  text: string,
  found: Map<PropertyType, number>,
  generic: PropertyType,
  specific: RegExp,
) {
  if (!found.has(generic)) return;
  const without = text.replace(new RegExp(specific.source, "gi"), " ");
  const genericTrigger = TRIGGERS.find(([, t]) => t === generic)?.[0];
  if (genericTrigger && !genericTrigger.test(without)) found.delete(generic);
}

const LABELS: Record<PropertyType, string> = {
  house: "House",
  condo: "Condo",
  townhouse: "Townhouse",
  apartment: "Apartment",
  "multi-family": "Multi-family",
  land: "Land",
  mobile: "Mobile home",
  farm: "Farm",
};

/** "House" / "Condo or Townhouse" / "Any type" — the label a card shows. */
export function formatPropertyTypes(types: readonly PropertyType[]): string {
  if (!types.length) return "Any type";
  const labels = types.map((t) => LABELS[t]);
  if (labels.length === 1) return labels[0];
  return `${labels.slice(0, -1).join(", ")} or ${labels[labels.length - 1]}`;
}
