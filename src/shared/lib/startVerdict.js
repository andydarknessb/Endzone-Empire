// The one client reader of the Start verdict (CONTEXT.md; spec #2042): every
// wire that names a player's verdict (the Lineup wire's entries, the Players
// wire's rows, the Start/sit advice wire's sides) states it as
// `startVerdict: { outcome, reason, numberTrusted }`. The server owns the
// verdict; surfaces read it through here and never re-derive it from a fact.

/** The verdict's `reason` (bye, out, ir, no_history, backup, no_practice, ...), else null. */
export function startVerdictReason(subject) {
  return subject?.startVerdict?.reason ?? null;
}

/** True when the verdict says the player will not play (`outcome` 'unavailable'). */
export function isStartVerdictUnavailable(subject) {
  return subject?.startVerdict?.outcome === 'unavailable';
}
