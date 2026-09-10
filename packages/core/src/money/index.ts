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

/**
 * Rounding applied when a stake is multiplied into a payout.
 *
 * A cashout at 2.333x on a 10.00 stake lands on 23.33 exactly, but many
 * multipliers do not: the product is fractional minor units and something
 * has to decide the last cent.
 *
 * The default is HALF-DOWN — an exact .5 goes to the player's detriment,
 * everything else rounds normally. That is the conventional house-favouring
 * choice and it is deliberately the ONLY place the policy is expressed, so
 * a regulator or a product decision can change it here and nowhere else.
 *
 * Note this affects only exact halves, which are rare; it is not a
 * systematic shave. The house edge lives in the crash distribution, not
 * here.
 */
export type RoundingPolicy = 'half-down' | 'half-up' | 'half-even';

export const DEFAULT_ROUNDING: RoundingPolicy = 'half-down';

/** Round a fractional minor amount to an integer under `policy`. */
export function roundMinor(
  value: number,
  policy: RoundingPolicy = DEFAULT_ROUNDING,
): Minor {
  const floor = Math.floor(value);
  const fraction = value - floor;

  // Anything that is not an exact half rounds the obvious way, whatever
  // the policy: only the tie is contested.
  if (fraction < 0.5) return asMinor(floor);
  if (fraction > 0.5) return asMinor(floor + 1);

  switch (policy) {
    case 'half-down':
      return asMinor(floor);
    case 'half-up':
      return asMinor(floor + 1);
    case 'half-even':
      // Banker's rounding: ties go to the even neighbour, so repeated
      // rounding does not drift in either direction.
      return asMinor(floor % 2 === 0 ? floor : floor + 1);
  }
}

/**
 * Payout for a stake cashed out at a multiplier.
 *
 * `multiplier` is a float here (2.75), not the wire representation. The
 * caller converts once at the protocol boundary so this stays readable.
 */
export function payoutFor(
  stake: Minor,
  multiplier: number,
  policy: RoundingPolicy = DEFAULT_ROUNDING,
): Minor {
  if (!Number.isFinite(multiplier) || multiplier <= 0) return asMinor(0);
  return roundMinor(stake * multiplier, policy);
}

export const addMinor = (a: Minor, b: Minor): Minor => asMinor(a + b);
export const subtractMinor = (a: Minor, b: Minor): Minor => asMinor(a - b);

/** Whether `balance` can cover `stake`. Stakes must be positive. */
export const canAfford = (balance: Minor, stake: Minor): boolean =>
  stake > 0 && balance >= stake;

/**
 * Format minor units for display: 1250 -> "12.50".
 *
 * Deliberately not locale-aware — the UI layer adds currency symbols and
 * separators. This only guarantees the decimal places are right.
 */
export function formatMinor(
  amount: Minor,
  scale: number = DEFAULT_MINOR_UNIT_SCALE,
): string {
  const digits = Math.max(0, Math.round(Math.log10(scale)));
  const negative = amount < 0;
  const absolute = Math.abs(amount);
  const major = Math.floor(absolute / scale);
  const minor = absolute % scale;
  const body =
    digits === 0
      ? String(major)
      : `${String(major)}.${String(minor).padStart(digits, '0')}`;
  return negative ? `-${body}` : body;
}
