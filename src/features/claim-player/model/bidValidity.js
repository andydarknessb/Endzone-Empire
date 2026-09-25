/**
 * The one FAAB bid rule (#1642): a non-negative whole dollar amount not above
 * what remains, the same rule the server enforces (`Number.isInteger(bid) &&
 * bid >= 0`, then 409 above `faab_remaining`). Both claim surfaces derive
 * their invalid state and helper text from here.
 */
export function isValidBid({ bid, faabRemaining }) {
  if (bid === '' || bid == null) return false;
  const n = Number(bid);
  return Number.isInteger(n) && n >= 0 && n <= faabRemaining;
}

export const bidHelperText = (faabRemaining) => `Enter a whole-dollar bid between $0 and $${faabRemaining}`;
