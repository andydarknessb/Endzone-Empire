/**
 * Canonical form, digest, and shape verification for the frozen season
 * schedule manifests (server/data/nfl-schedule-<season>.json).
 *
 * A manifest is the INDEPENDENT authority the holdout ledger validates the
 * runtime schedule against, so the manifest itself must be tamper-evident
 * and structurally complete before anything trusts it:
 *
 * - `computeManifestDigest` hashes an explicitly reconstructed canonical
 *   form (season, then per week: capture deadline + sorted game
 *   identities). Key order and content are fully determined here, so the
 *   generator and the verifier cannot drift apart, and cosmetic re-encoding
 *   of the JSON file never changes the digest.
 * - `verifySeasonManifest` refuses a manifest whose stored `digest` does
 *   not reproduce, whose games are malformed, or that is missing a
 *   `captureNotAfter` deadline for ANY week 1..18. The deadline is the
 *   conservative, independently sourced capture cutoff - runtime data may
 *   tighten it but never extend it - so a week without one has no
 *   trustworthy cutoff at all and the whole manifest is rejected at load.
 *
 * This module deliberately does NOT require the manifest JSON or any
 * database module: the generator script and the holdout service both
 * require it, and it must stay loadable with no credentials and no side
 * effects.
 */
const crypto = require('crypto');

const SEASON_WEEKS = 18;

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
  return { season: Number(manifest.season), weeks };
}

function computeManifestDigest(manifest) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(canonicalForm(manifest)))
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
  const gamesByWeek = new Map();
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
  canonicalForm,
  computeManifestDigest,
  verifySeasonManifest,
};
