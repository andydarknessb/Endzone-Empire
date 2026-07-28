/**
 * Canonical form, digest, and shape verification for the frozen season
 * schedule manifests (server/data/nfl-schedule-<season>.json).
 *
 * A manifest is the INDEPENDENT authority the holdout ledger validates the
 * runtime schedule against, so the manifest itself must be tamper-evident
 * and structurally complete before anything trusts it:
 *
 * - `computeManifestDigest` hashes an explicitly reconstructed canonical
 *   form: season, the FULL source provenance (URL, revision, generator,
 *   policy), any date-flex deadline overrides with their authorities, and
 *   per week the capture deadline + sorted game identities. Everything the
 *   manifest asserts is inside the digest - swapping the claimed source
 *   revision or an override's authority is as tamper-evident as moving a
 *   game. Serialization is key-sorted, so cosmetic re-encoding of the JSON
 *   file never changes the digest and the generator and verifier cannot
 *   drift apart.
 * - `verifySeasonManifest` refuses a manifest whose stored `digest` does
 *   not reproduce, whose games are malformed, or that fails the FULL
 *   SEASON invariants: exactly 272 games, exactly the 32 canonical
 *   franchises, each appearing in exactly 17 distinct weeks and never
 *   twice in one week, every week 1..18 populated with games and a valid
 *   `captureNotAfter` deadline. The deadline is the conservative,
 *   independently sourced capture cutoff - runtime data may tighten it but
 *   never extend it - and where a date-flex override exists (e.g. the
 *   Week 18 Saturday reserve) the stored deadline must not exceed it.
 *
 * This module deliberately does NOT require the manifest JSON or any
 * database module: the generator script and the holdout service both
 * require it, and it must stay loadable with no credentials and no side
 * effects.
 */
const crypto = require('crypto');

const SEASON_WEEKS = 18;
const GAMES_PER_TEAM = 17;
const TOTAL_GAMES = 272;

/**
 * The 32 NFL franchises in `normalizeTeamKey` vocabulary. This is the
 * EXPECTED domain - a constant, never inferred from data - shared by the
 * manifest verifier, the generator, and the holdout schedule validator.
 */
const CANONICAL_TEAM_KEYS = Object.freeze([
  'ARI', 'ATL', 'BAL', 'BUF', 'CAR', 'CHI', 'CIN', 'CLE', 'DAL', 'DEN',
  'DET', 'GB', 'HOU', 'IND', 'JAX', 'KC', 'LAC', 'LAR', 'LV', 'MIA',
  'MIN', 'NE', 'NO', 'NYG', 'NYJ', 'PHI', 'PIT', 'SEA', 'SF', 'TB',
  'TEN', 'WAS',
]);

/** Deterministic JSON: keys sorted recursively, undefined values skipped. */
function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
}

function canonicalForm(manifest) {
  const weeks = [];
  for (let week = 1; week <= SEASON_WEEKS; week++) {
    const games = (manifest.games || [])
      .filter((g) => Number(g.week) === week)
      .map((g) => `${g.away}@${g.home}`)
      .sort();
    weeks.push({
      week,
      captureNotAfter: manifest.captureNotAfter
        ? manifest.captureNotAfter[String(week)]
        : undefined,
      games,
    });
  }
  return {
    season: Number(manifest.season),
    source: manifest.source === undefined ? null : manifest.source,
    deadlineOverrides: manifest.deadlineOverrides === undefined ? null : manifest.deadlineOverrides,
    weeks,
  };
}

function computeManifestDigest(manifest) {
  return crypto
    .createHash('sha256')
    .update(stableStringify(canonicalForm(manifest)))
    .digest('hex');
}

function verifySeasonManifest(manifest) {
  if (!manifest || typeof manifest !== 'object') {
    throw new Error('schedule manifest must be an object');
  }
  const season = Number(manifest.season);
  if (!Number.isInteger(season)) {
    throw new Error('schedule manifest is missing an integer season');
  }
  if (!Array.isArray(manifest.games) || manifest.games.length === 0) {
    throw new Error(`schedule manifest for ${season} has no games`);
  }
  const canonical = new Set(CANONICAL_TEAM_KEYS);
  const gamesByWeek = new Map();
  const weeksByTeam = new Map();
  for (const game of manifest.games) {
    const week = Number(game.week);
    if (!Number.isInteger(week) || week < 1 || week > SEASON_WEEKS) {
      throw new Error(`schedule manifest for ${season} has a game with week ${game.week}`);
    }
    if (typeof game.away !== 'string' || !game.away || typeof game.home !== 'string' || !game.home) {
      throw new Error(`schedule manifest for ${season} week ${week} has a game without both teams`);
    }
    if (game.away === game.home) {
      throw new Error(`schedule manifest for ${season} week ${week} lists ${game.home} against itself`);
    }
    for (const team of [game.away, game.home]) {
      if (!canonical.has(team)) {
        throw new Error(`schedule manifest for ${season} week ${week} names unknown team ${team}`);
      }
      if (!weeksByTeam.has(team)) weeksByTeam.set(team, new Set());
      if (weeksByTeam.get(team).has(week)) {
        throw new Error(`schedule manifest for ${season} week ${week} lists ${team} in two games`);
      }
      weeksByTeam.get(team).add(week);
    }
    gamesByWeek.set(week, (gamesByWeek.get(week) || 0) + 1);
  }
  if (!manifest.captureNotAfter || typeof manifest.captureNotAfter !== 'object') {
    throw new Error(`schedule manifest for ${season} has no captureNotAfter deadlines`);
  }
  for (let week = 1; week <= SEASON_WEEKS; week++) {
    if (!gamesByWeek.get(week)) {
      throw new Error(`schedule manifest for ${season} has no games in week ${week}`);
    }
    const deadline = manifest.captureNotAfter[String(week)];
    if (!deadline || Number.isNaN(new Date(deadline).getTime())) {
      throw new Error(
        `schedule manifest for ${season} has no valid captureNotAfter deadline for week ${week}`
      );
    }
  }
  // Full-season invariants: the same expected domain the generator enforced
  // must hold at REGISTRATION, or a malformed schedule with a freshly
  // recomputed digest could still become an authority.
  if (manifest.games.length !== TOTAL_GAMES) {
    throw new Error(
      `schedule manifest for ${season} has ${manifest.games.length} games, expected exactly ${TOTAL_GAMES}`
    );
  }
  const missingTeams = CANONICAL_TEAM_KEYS.filter((t) => !weeksByTeam.has(t));
  if (missingTeams.length > 0) {
    throw new Error(`schedule manifest for ${season} is missing team(s): ${missingTeams.join(', ')}`);
  }
  for (const [team, weeks] of weeksByTeam) {
    if (weeks.size !== GAMES_PER_TEAM) {
      throw new Error(
        `schedule manifest for ${season}: ${team} appears in ${weeks.size} week(s), expected exactly ${GAMES_PER_TEAM}`
      );
    }
  }
  // Date-flex overrides: each names a real week, and the stored deadline may
  // TIGHTEN the override but never exceed it - an override exists precisely
  // because the source's stored time is not trustworthy in the late
  // direction.
  if (manifest.deadlineOverrides != null) {
    if (typeof manifest.deadlineOverrides !== 'object' || Array.isArray(manifest.deadlineOverrides)) {
      throw new Error(`schedule manifest for ${season} has malformed deadlineOverrides`);
    }
    for (const [weekKey, override] of Object.entries(manifest.deadlineOverrides)) {
      const week = Number(weekKey);
      if (!Number.isInteger(week) || week < 1 || week > SEASON_WEEKS) {
        throw new Error(`schedule manifest for ${season} has a deadline override for week ${weekKey}`);
      }
      const cap = override && override.captureNotAfter;
      if (!cap || Number.isNaN(new Date(cap).getTime())) {
        throw new Error(
          `schedule manifest for ${season} week ${week} has a deadline override without a valid captureNotAfter`
        );
      }
      const stored = manifest.captureNotAfter[String(week)];
      if (new Date(stored) > new Date(cap)) {
        throw new Error(
          `schedule manifest for ${season} week ${week}: stored deadline ${stored} exceeds its date-flex override ${cap}`
        );
      }
    }
  }
  const digest = computeManifestDigest(manifest);
  if (manifest.digest !== digest) {
    throw new Error(
      `schedule manifest for ${season} fails its digest check (stored ${manifest.digest || 'nothing'}, ` +
      `computed ${digest}) - refusing a manifest that cannot prove it is the one that was generated`
    );
  }
  return manifest;
}

module.exports = {
  SEASON_WEEKS,
  GAMES_PER_TEAM,
  TOTAL_GAMES,
  CANONICAL_TEAM_KEYS,
  stableStringify,
  canonicalForm,
  computeManifestDigest,
  verifySeasonManifest,
};
