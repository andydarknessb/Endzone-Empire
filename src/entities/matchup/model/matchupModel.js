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
 * From the Matchup detail body (`GET /api/league/:id/matchups/:matchupId`):
 * `{ matchup, home, away }`, where the score lives on `matchup.home_score` and
 * each side's identity, Expected final and Players remaining live on the
 * per-side object. The detail body carries no per-side avatar today, so those
 * read null until a side supplies them.
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

const CHIP_LABELS = {
  scheduled: 'Scheduled',
  live: 'LIVE',
  played: 'Awaiting final',
  final: 'Final',
};

// The four server values, and the three of them that mean the Matchup has
// started. `hasStarted` keys off these sets, so a value outside them (null, or
// an unrecognised string from a skewed server) reads as unknown, never as a
// false "has started" that would render the win-probability bar (F5).
const STARTED_STATUSES = new Set(['live', 'played', 'final']);
const KNOWN_STATUSES = new Set(['scheduled', 'live', 'played', 'final']);

/**
 * The one status predicate (ADR 0030). Given a Matchup's `status`, it returns
 * the chip label to show and whether the Matchup has started:
 *
 *   - the four server values map to their chip label; every other reader that
 *     used to ask "is this live" asks `hasStarted` instead.
 *   - `hasStarted` is true for the three started values (`live`, `played`,
 *     `final`) and false for `scheduled`.
 *   - an unknown status - `null`, absent, or an unrecognised string - is not
 *     guessed: it renders NO chip (`chipLabel: null`) rather than a false
 *     "Scheduled", and `hasStarted` is `null`, never `false` - "the server could
 *     not say" is not "not started". A caller drives its not-started branch off
 *     `hasStarted === false`, so an unknown status asserts neither state.
 */
export function matchupStatusView(status) {
  return {
    chipLabel: CHIP_LABELS[status] ?? null,
    hasStarted: KNOWN_STATUSES.has(status) ? STARTED_STATUSES.has(status) : null,
  };
}
