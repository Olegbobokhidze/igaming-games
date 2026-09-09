/**
 * Monetary primitives.
 *
 * Amounts are integer minor units (cents, tetri, ...) — never floats.
 * Binary floating point cannot represent 0.1 exactly, and a crash game
 * multiplies balances constantly, so drift would compound into real
 * accounting errors. The branded type below makes an accidental raw
 * `number` a compile error at the boundary.
 */

declare const minorUnitsBrand: unique symbol;

/** An amount in integer minor units, e.g. 1250 === 12.50. */
export type Minor = number & { readonly [minorUnitsBrand]: 'Minor' };

/** ISO-4217 currency code, e.g. 'EUR'. */
export type CurrencyCode = string;

export interface Money {
  readonly amount: Minor;
  readonly currency: CurrencyCode;
}

/** Number of minor units in one major unit, per currency. */
export const DEFAULT_MINOR_UNIT_SCALE = 100;

/** Unchecked cast used at trusted boundaries (parsed protocol payloads). */
export const asMinor = (value: number): Minor => value as Minor;

// TODO(stage-2): add add/subtract/multiplyByMultiplier/compare helpers plus
// an explicit rounding policy for cashout (round half-down in the house's
// favour, decided with product) and a `formatMoney` for display.
