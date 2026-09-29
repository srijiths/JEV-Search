/**
 * Formatters shared by more than one surface.
 *
 * Anything with a single consumer stays next to that consumer; this file is for the cases
 * where two places print the same number and disagreeing about the rounding would read as
 * the app contradicting itself.
 */

/**
 * A sub-millisecond duration, for the HUD and the timeline.
 *
 * Two decimals below 1ms, because the parse is the one figure in this app whose whole point
 * is how small it is — `toFixed(0)` turns every measurement into "0ms", which reads as an
 * unimplemented placeholder rather than a result.
 *
 * The floor is a bound and not a rounding, and it catches two different things. Browsers
 * coarsen `performance.now()` (5µs in Chromium, more in Firefox with resistFingerprinting on)
 * so an exact 0 genuinely means "below the clock's resolution" — but so does 0.004, which
 * `toFixed(2)` would print as "0.00ms" and reintroduce the exact failure this function exists
 * to avoid. Anything under the displayable precision is reported as under it.
 *
 * Written `!(ms >= 0.01)` rather than `ms < 0.01` so a `NaN` — a subtraction against a clock
 * that was never read — takes the bound rather than falling through to print "NaNms".
 */
export function formatParse(ms: number): string {
  if (!(ms >= 0.01)) return "<0.01ms";
  if (ms < 1) return `${ms.toFixed(2)}ms`;
  return `${ms.toFixed(1)}ms`;
}
