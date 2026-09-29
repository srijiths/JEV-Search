/**
 * Mortgage arithmetic for the mortgage card.
 *
 * Emphatically code's job, not Jev's. Jev decides that a query *is* about affordability;
 * the amortisation formula then produces a number that is either right or a bug, never
 * "probably about right". A payment estimate a user might act on is the last thing that
 * should come out of a language model.
 */

export type MortgageInput = {
  /** Purchase price. */
  price: number;
  /** Down payment as a fraction, e.g. 0.2 for 20%. */
  downFraction?: number;
  /** Annual nominal rate as a fraction, e.g. 0.0675. */
  annualRate?: number;
  termYears?: number;
  /** Annual property tax as a fraction of price. */
  taxRate?: number;
  /** Annual homeowners insurance as a fraction of price. */
  insuranceRate?: number;
  /** Monthly HOA dues in dollars. */
  hoaMonthly?: number;
};

export type MortgageEstimate = {
  loanAmount: number;
  downPayment: number;
  /** Principal and interest only. */
  principalInterest: number;
  tax: number;
  insurance: number;
  hoa: number;
  /** Everything above, per month. */
  total: number;
};

/**
 * Defaults are placeholders the card exposes as editable inputs, not claims about the
 * market. They are here so the card has something to show the moment it appears.
 */
export const MORTGAGE_DEFAULTS = {
  downFraction: 0.2,
  annualRate: 0.0675,
  termYears: 30,
  taxRate: 0.011,
  insuranceRate: 0.0035,
  hoaMonthly: 0,
} as const;

export function estimateMortgage(input: MortgageInput): MortgageEstimate {
  const {
    price,
    downFraction = MORTGAGE_DEFAULTS.downFraction,
    annualRate = MORTGAGE_DEFAULTS.annualRate,
    termYears = MORTGAGE_DEFAULTS.termYears,
    taxRate = MORTGAGE_DEFAULTS.taxRate,
    insuranceRate = MORTGAGE_DEFAULTS.insuranceRate,
    hoaMonthly = MORTGAGE_DEFAULTS.hoaMonthly,
  } = input;

  const downPayment = Math.round(price * downFraction);
  const loanAmount = Math.max(0, price - downPayment);
  const monthlyRate = annualRate / 12;
  const payments = Math.round(termYears * 12);

  // A 0% loan divides by zero in the standard formula, so it is handled separately.
  const principalInterest =
    monthlyRate === 0
      ? payments > 0
        ? loanAmount / payments
        : 0
      : (loanAmount * monthlyRate) / (1 - Math.pow(1 + monthlyRate, -payments));

  const tax = (price * taxRate) / 12;
  const insurance = (price * insuranceRate) / 12;

  return {
    loanAmount,
    downPayment,
    principalInterest: round(principalInterest),
    tax: round(tax),
    insurance: round(insurance),
    hoa: round(hoaMonthly),
    total: round(principalInterest + tax + insurance + hoaMonthly),
  };
}

const round = (n: number) => (Number.isFinite(n) ? Math.round(n) : 0);

/**
 * The price to run the numbers on, given whatever the query pinned down. A budget
 * ceiling is the figure someone asking "what can I afford at 800k" means.
 */
export function mortgagePrice(price_min: number | null, price_max: number | null): number | null {
  if (price_max !== null && price_min !== null) return Math.round((price_min + price_max) / 2);
  return price_max ?? price_min;
}
