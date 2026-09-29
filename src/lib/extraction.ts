/**
 * How a filter value is allowed to be produced.
 *
 * The flag exists because "let the model read the query" and "parse the query" are both
 * defensible for the *closed-set* filters — home type, status, stories, feature
 * checkboxes — and the only way to find out which is better on real traffic is to be able
 * to switch between them and measure.
 *
 * It deliberately does not exist for numbers. See `FieldKind` in `./filters/fields`.
 */
export const EXTRACTION_MODES = ["hybrid", "jev"] as const;
export type ExtractionMode = (typeof EXTRACTION_MODES)[number];

export const DEFAULT_MODE: ExtractionMode = "hybrid";

/**
 * `hybrid` is the default, and the reason is cost and accuracy pulling the same way:
 * a literal "townhome" in the text is already a certainty, so paying Jev to re-read it
 * buys nothing and adds ~30 questions to every keystroke. Jev earns its place on the
 * judgement calls — what the person is *trying to do*, and requirements they imply
 * without naming ("somewhere the dog can run").
 */
export function resolveMode(raw: string | undefined | null): ExtractionMode {
  const v = raw?.trim().toLowerCase();
  return (EXTRACTION_MODES as readonly string[]).includes(v ?? "") ? (v as ExtractionMode) : DEFAULT_MODE;
}

/** Where a single field's value actually came from on this request. */
export const FIELD_SOURCES = ["parser", "jev", "none"] as const;
export type FieldSource = (typeof FIELD_SOURCES)[number];

/**
 * Per-field provenance for one extraction.
 *
 * Returned alongside the query rather than inside it: the `SearchQuery` is the contract a
 * listings backend consumes and it should not grow debug metadata. This is what the
 * mode comparison is actually read from — a field-by-field answer to "who decided this".
 */
export type FieldSources = Record<string, FieldSource>;
