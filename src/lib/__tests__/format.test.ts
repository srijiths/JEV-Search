import { describe, expect, it } from "vitest";
import { formatParse } from "../format";

/**
 * `formatParse` exists to stop a real measurement from printing as "0ms", so the cases worth
 * pinning are all at the bottom of the range — the top of the range never occurs.
 */
describe("formatParse", () => {
  it("keeps two decimals below a millisecond, where every real parse lands", () => {
    expect(formatParse(0.107)).toBe("0.11ms");
    expect(formatParse(0.047)).toBe("0.05ms");
    expect(formatParse(0.915)).toBe("0.92ms");
  });

  it("never prints a positive measurement as zero", () => {
    // The failure mode this function is for: 0.004ms is a result, and "0.00ms" reads as an
    // unimplemented stub. Two decimals alone are not enough — the floor is what catches it.
    expect(formatParse(0.004)).toBe("<0.01ms");
    expect(formatParse(0.0001)).toBe("<0.01ms");
  });

  it("reports a clock-coarsened zero as a bound rather than an exact figure", () => {
    // Browsers quantise `performance.now()`; a difference of exactly 0 means "below the
    // clock's resolution", which is a different claim from "took no time".
    expect(formatParse(0)).toBe("<0.01ms");
    expect(formatParse(-0)).toBe("<0.01ms");
    expect(formatParse(NaN)).toBe("<0.01ms");
  });

  it("switches to one decimal once the figure no longer needs two", () => {
    expect(formatParse(0.01)).toBe("0.01ms");
    expect(formatParse(1)).toBe("1.0ms");
    expect(formatParse(4.19)).toBe("4.2ms");
  });
});
