import { applyTeamProfileUpdate } from '../../../lib/teamProfileEvents';

/**
 * The Matchup read model, pure (ADR 0029: the entities layer's first slice; ADR
 * 0030: status is a server fact). It is the one spelling of a Matchup as the
 * client knows it, built from any of the three wire shapes the server speaks -
 * the list row's snake_case columns, the detail body's per-side objects, and the
 * live score event's flat camelCase entry - so a surface reads one shape and
 * never a database column name again.
 *
 * The shape:
 *
 *   { id, season, week, final, status,
 *     home: { teamId, name, avatarUrl, avatarStaticUrl,
 *             score, expectedFinal, playersRemaining },
 *     away: { ...same } }
 *
 * `status` is the server's fact (ADR 0030): one of 'scheduled', 'live',
 * 'played', 'final', or `null` when the server could not compute it. It is never
 * inferred here. Values are carried across verbatim (this module renames, it
 * does not retype); the presenter coerces for display exactly as it always has.
 */

function has(obj, key) {
  return obj != null && Object.prototype.hasOwnProperty.call(obj, key);
}

/**
 * From a Matchup list row (`GET /api/league/:id/matchups`, one row of the array
 * attachExpectedFinals decorates). This builder is where a Matchup's wire column
 * names belong (a team's Expected final is `home_expected_final`; ADR 0029), so
 * a surface reading the model never names them. Both Game Center and the
 * matchup-preview widget read the model now (the widget migrated in #864), so a
 * Matchup's wire column names live only here.
 */
export function matchupFromListRow(row) {
  const r = row || {};
  return {
    id: r.id ?? null,
    season: r.season ?? null,
    week: r.week ?? null,
    final: !!r.final,
    status: r.status ?? null,
    nflGameIds: Array.isArray(r.nfl_game_ids)
      ? r.nfl_game_ids.map(String)
      : Array.isArray(r.nflGameIds) ? r.nflGameIds.map(String) : [],
    // The earliest kickoff among either side's starters, and when the live
    // score pass last touched the week (#892); ISO strings or null.
    firstKickoffAt: r.first_kickoff_at ?? null,
    syncedAt: r.synced_at ?? null,
    // The stored preview Narrative (ADR 0063), or null.
    narrative: r.narrative ?? null,
    home: {
      teamId: r.home_team_id ?? null,
      name: r.home_team_name ?? null,
      avatarUrl: r.home_team_avatar_url ?? null,
      avatarStaticUrl: r.home_team_avatar_static_url ?? null,
      score: r.home_score ?? null,
      expectedFinal: r.home_expected_final ?? null,
      playersRemaining: r.home_players_remaining ?? null,
    },
    away: {
      teamId: r.away_team_id ?? null,
      name: r.away_team_name ?? null,
      avatarUrl: r.away_team_avatar_url ?? null,
      avatarStaticUrl: r.away_team_avatar_static_url ?? null,
      score: r.away_score ?? null,
      expectedFinal: r.away_expected_final ?? null,
      playersRemaining: r.away_players_remaining ?? null,
    },
  };
}

/**
 * The viewer's own Matchup out of the week's Matchups (already read as the one
 * Matchup shape), picked by Team id (#112): the row whose home or away side is
 * the viewer's Team, or null with no viewer Team, no such row, or no list.
 * The one place the pick lives, so the Lineup page, the team-summary-strip and
 * the matchup-preview cannot drift (#1872).
 */
export function viewerMatchupOf(matchups, viewerTeamId) {
  if (viewerTeamId == null || !Array.isArray(matchups)) return null;
  return (
    matchups.find((m) => m && (m.home.teamId === viewerTeamId || m.away.teamId === viewerTeamId)) || null
  );
}

/**
 * From the Matchup detail body (`GET /api/league/:id/matchups/:matchupId`):
 * `{ matchup, home, away }`, where the score lives on `matchup.home_score` and
 * each side's identity, Expected final and Players remaining live on the
 * per-side object. The detail body carries no per-side avatar today, so those
 * read null until a side supplies them. It reads no player row: a starter row
 * goes through `playerFromDetailRow` below.
 */
export function matchupFromDetailBody(body) {
  const b = body || {};
  const m = b.matchup || {};
  const h = b.home || {};
  const a = b.away || {};
  return {
    id: m.id ?? null,
    season: m.season ?? null,
    week: m.week ?? null,
    final: !!m.final,
    status: m.status ?? null,
    firstKickoffAt: m.first_kickoff_at ?? null,
    syncedAt: m.synced_at ?? null,
    home: {
      teamId: h.teamId ?? null,
      name: h.name ?? null,
      avatarUrl: h.avatarUrl ?? null,
      avatarStaticUrl: h.avatarStaticUrl ?? null,
      score: m.home_score ?? null,
      expectedFinal: h.expectedFinal ?? null,
      playersRemaining: h.playersRemaining ?? null,
    },
    away: {
      teamId: a.teamId ?? null,
      name: a.name ?? null,
      avatarUrl: a.avatarUrl ?? null,
      avatarStaticUrl: a.avatarStaticUrl ?? null,
      score: m.away_score ?? null,
      expectedFinal: a.expectedFinal ?? null,
      playersRemaining: a.playersRemaining ?? null,
    },
  };
}

/**
 * One player row of the Matchup detail body, normalised to the Roster entity's
 * camelCase shape (`playerId`, `nflTeam`, `injuryStatus`, `photoUrl`,
 * `gameState`, `gameClock`, `projectedPoints`; #2147, ADR 0029), so a surface
 * that reads it never names a wire column. This is where those columns' names
 * belong. `useMatchup` still hands the page the raw starters (the Decision card
 * lookup, the score deltas and the Slot comparison read the wire shape), so the
 * page model maps the rows a surface wants normalised through this.
 *
 * `points` is null exactly while the producer classifies the player's game
 * `scheduled` (the Ledger row's "blank until kickoff", CONTEXT.md): the wire
 * sends 0 there, and a player who has not taken the field has no points yet.
 * Every other state, including none priced (null), keeps the wire's number;
 * the producer's classification is the only kickoff fact the row carries and
 * nothing is inferred (ADR 0030).
 *
 * A missing row is no player (null), so a slot only one side filled keeps its
 * empty opposite side.
 */
export function playerFromDetailRow(row) {
  if (row == null) return null;
  const gameState = row.game_state ?? null;
  return {
    playerId: row.id ?? null,
    name: row.name ?? null,
    position: row.position ?? null,
    slot: row.slot ?? null,
    nflTeam: row.nfl_team ?? null,
    injuryStatus: row.injury_status ?? null,
    photoUrl: row.photo_url ?? null,
    gameState,
    gameClock: row.game_clock ?? null,
    opponent: row.opponent ?? null,
    projectedPoints: row.projected ?? null,
    availability: row.availability ?? null,
    stats: row.stats ?? null,
    points: gameState === 'scheduled' ? null : row.points ?? null,
  };
}

/**
 * A live score event entry (one element of `scores:updated`'s `scored` array)
 * applied to an existing model, returning a new model. The scores, `status` and
 * the four figure fields (home/away Expected final and Players remaining) are
 * each applied only when the entry carries them, so an entry from an older
 * server that predates a field leaves that field exactly as it was rather than
 * nulling it. In practice a live entry always carries the scores, so they always
 * move; the same has-it guard on the scores just means a partial entry never
 * nulls one. The team identities (id, name, avatar) never ride a score event and
 * are untouched.
 *
 * An entry for a different Matchup (or a missing model/entry) is a no-op.
 */
export function applyScoreEvent(model, entry) {
  if (!model || !entry || entry.matchupId !== model.id) return model;
  const patchSide = (side, prefix) => {
    const next = { ...side };
    if (has(entry, `${prefix}Score`)) next.score = entry[`${prefix}Score`];
    if (has(entry, `${prefix}ExpectedFinal`)) next.expectedFinal = entry[`${prefix}ExpectedFinal`];
    if (has(entry, `${prefix}PlayersRemaining`)) next.playersRemaining = entry[`${prefix}PlayersRemaining`];
    return next;
  };
  return {
    ...model,
    ...(has(entry, 'status') ? { status: entry.status } : {}),
    // The two week facts (#892) move with the same has-it guard: an older
    // entry without them leaves the model's values as they were.
    ...(has(entry, 'firstKickoffAt') ? { firstKickoffAt: entry.firstKickoffAt } : {}),
    ...(has(entry, 'syncedAt') ? { syncedAt: entry.syncedAt } : {}),
    home: patchSide(model.home, 'home'),
    away: patchSide(model.away, 'away'),
  };
}

/**
 * A Team identity update (name/avatar) applied per side through the generic Team
 * profile update helper (teamProfileEvents.js), returning a new model. The per-
 * side shape's identity fields are exactly the helper's default keys, so it
 * patches the side whose `teamId` matches and returns the other side unchanged;
 * a matchup neither side of which is the updated Team comes back untouched.
 */
export function applyIdentityPatch(model, update) {
  if (!model) return model;
  return {
    ...model,
    home: applyTeamProfileUpdate(model.home, update),
    away: applyTeamProfileUpdate(model.away, update),
  };
}

// A missing score is NaN, not Number(null) = 0.
function scoreOf(value) {
  return value == null || value === '' ? NaN : Number(value);
}

/**
 * The result line of a settled Matchup (#2007): what both scoreboards print in
 * place of the win bar and the Expected final figures once the week is decided.
 * Only `played` and `final` have one (null for scheduled, live and an unknown
 * status). It reads from the viewer's side ("You won by 6.2", "You lost by
 * 6.2"), names the winner for a spectator ("Duluth Dockworkers won by 6.2"),
 * and reads "Tied" on equal scores. The margin is one decimal, from the two
 * scores (two when the boards would print the same figure for both). A score
 * that is not a finite number gives no line (null). `played` is prefixed
 * "Unofficial: " because the score of record is not yet written (ADR 0030).
 */
export function matchupResultLine(matchup, viewerTeamId) {
  const m = matchup || {};
  if (m.status !== 'played' && m.status !== 'final') return null;
  const home = m.home || {};
  const away = m.away || {};
  // A score the server could not say is not zero: no line, rather than a
  // "Tied" or a margin invented from nothing.
  const homeScore = scoreOf(home.score);
  const awayScore = scoreOf(away.score);
  if (!Number.isFinite(homeScore) || !Number.isFinite(awayScore)) return null;
  const prefix = m.status === 'played' ? 'Unofficial: ' : '';
  if (homeScore === awayScore) return `${prefix}Tied`;
  const winner = homeScore > awayScore ? home : away;
  const diff = Math.abs(homeScore - awayScore);
  // One decimal, unless the boards print the two scores as the same figure
  // (they round to one decimal): then two, so the line never says a margin
  // the boards do not show (100.04 v 99.96 prints 100.0 / 100.0, "won by 0.08").
  const margin = homeScore.toFixed(1) === awayScore.toFixed(1) ? diff.toFixed(2) : diff.toFixed(1);
  const isViewer = (side) => viewerTeamId != null && side.teamId != null && side.teamId === viewerTeamId;
  if (isViewer(home) || isViewer(away)) {
    return `${prefix}You ${isViewer(winner) ? 'won' : 'lost'} by ${margin}`;
  }
  return `${prefix}${winner.name || (winner === home ? 'Home' : 'Away')} won by ${margin}`;
}
