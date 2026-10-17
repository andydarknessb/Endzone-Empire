/**
 * The Waivers page's cursor (ADR 0067 wave 3, spec #2347 ruling 5): of the rows shown on the current
 * page, the unclaimed one with the largest positive Upgrade, whatever week the Upgrade reads in.
 * Ties go to that week's projection, then the name. A row with a pending claim is skipped. Pure and
 * read-free: it sees only the rows the page already has. `null` when no Upgrade is positive, which
 * is every row in best ball (the server sends no Upgrade there).
 *
 * @param {Array<object>} rows  `GET /api/players?view=cards` rows (`upgrade`, `projWeek`, `weeks`)
 * @param {Iterable<number>} [pendingPlayerIds]  players the manager already has a pending claim on
 */
export function nextClaimRow(rows, pendingPlayerIds = []) {
  const skipped = new Set(pendingPlayerIds);
  // The projection in the week the Upgrade reads in, else the row's own week.
  const projection = (row) => {
    const week = row.upgrade.week;
    const points = week != null ? row.weeks?.find((w) => w.week === week)?.points : null;
    return Number(points ?? row.projWeek?.points) || 0;
  };
  const candidates = (Array.isArray(rows) ? rows : []).filter(
    (row) => row && !skipped.has(row.id) && row.upgrade?.points > 0,
  );
  candidates.sort(
    (a, b) =>
      b.upgrade.points - a.upgrade.points
      || projection(b) - projection(a)
      || String(a.name).localeCompare(String(b.name)),
  );
  return candidates[0] || null;
}

const HOUR_MS = 3600 * 1000;

/** True when a Clear time is under one hour away (the cursor frame and the Status line turn Danger). */
export function clearsUnderHour(availableAt, now = Date.now()) {
  const at = availableAt ? new Date(availableAt).getTime() : NaN;
  return Number.isFinite(at) && at - now < HOUR_MS;
}
