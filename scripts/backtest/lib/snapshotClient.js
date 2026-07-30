'use strict';

/**
 * The exact-behaviour snapshot client: a `{ query }` object that answers the 8
 * production queries offline, from the frozen snapshot, so
 * `generateProjections` can be replayed through the REAL production path with
 * no database.
 *
 * THREE PROPERTIES DO THE WORK.
 *
 * 1. **Exact dispatch.** The client recognizes a query by the
 *    whitespace-normalized SHA-256 of its SQL, from the same shared table the
 *    extraction observed (`lib/sqlSurface.js`). Unknown SQL THROWS. A snapshot
 *    client that quietly returned `{rows: []}` for a query it did not recognize
 *    would turn "production issues a ninth query" into "that factor is
 *    unavailable" - a wrong number instead of an error.
 *
 * 2. **`{season, week, mode}` binding.** The client is constructed for one
 *    target week and refuses a query parameterized for any other. Without this,
 *    a loop that forgot to rebuild the client between weeks would serve week
 *    3's slice for week 9 and produce entirely plausible projections.
 *
 * 3. **Type fidelity.** The snapshot is JSON, and JSON has no `Date`, no
 *    bigint, and no numeric. The extraction stored timestamps as ISO strings
 *    (see `extract-snapshot.jsonSafe`), so `off` mode REHYDRATES every column
 *    back to the JS type the pg driver produced during the in-transaction
 *    oracle run, using the `dataTypeID`s the manifest recorded per column. Serve
 *    `kickoff_at` as a string and `new Date(r.kickoff_at).getTime()` still
 *    works, but `inputCutoff` becomes a string instead of a Date and the
 *    "bit-identical to the oracle" claim fails for a reason that has nothing to
 *    do with the model.
 *
 * TWO MODES.
 *
 * - `off` serves the captured rows as they were, and must reproduce the stored
 *   oracles bit-identically. This is the fidelity anchor: if off mode does not
 *   reproduce the oracle, nothing built on the snapshot means anything.
 * - `reconstructed` applies the overlays: per-week team and position from the
 *   archived roster files, the injury policy's status, and the orientation
 *   patch from the pinned `games.csv`. **No production write, ever** - the
 *   patch exists only in the snapshot.
 *
 * WHAT RECONSTRUCTED MODE DOES NOT SERVE. DEF pseudo-players are absent from
 * its `playersById` results by design: a defence has no GSIS identifier because
 * it is not a person, so the roster files say nothing about it. DEF is
 * synthesized per team-week in PHASE 3, from the pinned `stats_team_week` rows
 * plus `games.csv` scores. The omissions are counted under their own reason
 * (`def-synthesized-in-phase-3`) precisely so that roughly 32 expected
 * omissions a week cannot be mistaken for a roster-coverage failure.
 *
 * Pure: no filesystem here (the caller loads the snapshot), no network, no
 * database, no environment.
 */

const { surfaceEntryFor, normalizeSql, SQL_BY_NAME } = require('./sqlSurface');
const store = require('./snapshotStore');

/** Mirrors `projectionFeatures.HISTORY_SEASONS`. */
const HISTORY_SEASONS = 2;
/** Mirrors `bye.service.REG_SEASON_WEEKS`. */
const REG_SEASON_WEEKS = 18;

const MODES = Object.freeze({ OFF: 'off', RECONSTRUCTED: 'reconstructed' });
const MODE_NAMES = Object.freeze(Object.values(MODES));

// ---------------------------------------------------------------------------
// pg type rehydration
// ---------------------------------------------------------------------------

/**
 * How the pg driver represents each column type in JavaScript, by type OID.
 *
 * These are pg's DEFAULT parser behaviours, and the two surprising ones are
 * exactly the ones this snapshot has to get right: `int8` and `numeric` arrive
 * as STRINGS (they can exceed what a JS number holds exactly), while `int4`
 * arrives as a number. `players.adp` is numeric and `row_number()` is int8, so
 * both appear in the captured surface.
 */
const PG_TYPES = Object.freeze({
  16: 'boolean', // bool
  20: 'string', // int8 - pg returns bigint as a string
  21: 'number', // int2
  23: 'number', // int4
  25: 'string', // text
  114: 'json', // json
  700: 'number', // float4
  701: 'number', // float8
  1042: 'string', // bpchar
  1043: 'string', // varchar
  1082: 'date', // date
  1114: 'date', // timestamp
  1184: 'date', // timestamptz
  1700: 'string', // numeric - pg returns it as a string
  3802: 'json', // jsonb
});

/**
 * Type OIDs for columns the SQL COMPUTES, which therefore appear in no captured
 * relation's field list. `COUNT(*)::int` is int4 and the normalized team
 * columns are text.
 */
const COMPUTED_COLUMN_TYPES = Object.freeze({
  games: 23,
  team: 25,
  defense: 25,
  team_key: 25,
  opponent_key: 25,
  nfl_team: 25,
});

/**
 * Pure: build one column-name -> type-OID map from the manifest's per-relation
 * schema fingerprint.
 *
 * Merging across relations is safe and is CHECKED: a name that appears in two
 * captures with two different OIDs throws, because that would mean the client
 * had to guess which type to serve. In the real snapshot every shared name
 * agrees (`season` and `week` are int4 everywhere, `stats` is jsonb in both
 * stat relations), so a conflict means the schema moved.
 */
function buildColumnTypes(manifest, { extra = COMPUTED_COLUMN_TYPES } = {}) {
  const fingerprint = (manifest && manifest.schemaFingerprint) || {};
  const byColumn = new Map();
  const originOf = new Map();
  for (const [relation, entry] of Object.entries(fingerprint)) {
    for (const field of (entry && entry.fields) || []) {
      const name = String(field.name);
      const oid = field.dataTypeID === null || field.dataTypeID === undefined
        ? null : Number(field.dataTypeID);
      if (oid === null) continue;
      if (byColumn.has(name) && byColumn.get(name) !== oid) {
        throw new Error(
          `snapshot schema conflict: column "${name}" is type ${byColumn.get(name)} in ` +
          `${originOf.get(name)} but ${oid} in ${relation}; the client cannot know which type to serve`
        );
      }
      byColumn.set(name, oid);
      originOf.set(name, relation);
    }
  }
  for (const [name, oid] of Object.entries(extra)) {
    if (!byColumn.has(name)) byColumn.set(name, oid);
  }
  return byColumn;
}

/**
 * Pure: turn one stored JSON value back into what the pg driver would have
 * produced for that column type.
 *
 * Fail-closed on an unknown OID: silently passing a value through would hand
 * the engine a string where it expected a Date, and the resulting projection
 * would be wrong rather than absent.
 */
function rehydrateValue(value, oid, { column = 'column' } = {}) {
  const kind = PG_TYPES[oid];
  if (!kind) {
    throw new Error(
      `snapshot client: column "${column}" has pg type OID ${oid}, which has no rehydration rule. ` +
      'Serving it unconverted could hand the engine a different JS type than the oracle saw.'
    );
  }
  if (value === null || value === undefined) return null;
  switch (kind) {
    case 'date':
      return value instanceof Date ? value : new Date(String(value));
    case 'string':
      return typeof value === 'string' ? value : String(value);
    case 'number': {
      const n = typeof value === 'number' ? value : Number(value);
      if (!Number.isFinite(n)) {
        throw new Error(`snapshot client: column "${column}" holds ${JSON.stringify(value)}, not a number`);
      }
      return n;
    }
    case 'boolean':
      return typeof value === 'boolean' ? value : value === 'true' || value === 't';
    case 'json':
      return value;
    /* istanbul ignore next - PG_TYPES has no other kinds */
    default:
      throw new Error(`snapshot client: no rehydration for kind ${kind}`);
  }
}

/** Pure: rehydrate a whole row against the column-type map. */
function rehydrateRow(row, columnTypes) {
  const out = {};
  for (const [column, value] of Object.entries(row)) {
    if (!columnTypes.has(column)) {
      throw new Error(
        `snapshot client: no recorded pg type for column "${column}"; the manifest's schema ` +
        'fingerprint does not describe it, so its JS type cannot be reproduced'
      );
    }
    out[column] = rehydrateValue(value, columnTypes.get(column), { column });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Binding
// ---------------------------------------------------------------------------

/**
 * Fail loud unless a query's parameters name the season and week this client
 * was constructed for.
 *
 * `byeWeeks` carries a season but no target week on purpose (a bye is a gap in
 * the schedule, not a result), so only the season is checked there. Everything
 * else is checked on both.
 */
function assertBinding({ entry, params, season, week, historySeasons }) {
  const binding = entry.binding || {};
  const at = (index) => (index === undefined ? undefined : params[index]);
  const label = `${entry.name} query`;

  if (binding.season !== undefined) {
    const got = Number(at(binding.season));
    if (got !== Number(season)) {
      throw new Error(
        `${label}: this snapshot client is bound to season ${season} but the query asks for ${got}. ` +
        'A client serves exactly one {season, week, mode}; reusing one across weeks would answer ' +
        'from the wrong slice and produce a plausible number instead of an error.'
      );
    }
  }
  if (binding.week !== undefined) {
    const got = Number(at(binding.week));
    if (got !== Number(week)) {
      throw new Error(
        `${label}: this snapshot client is bound to week ${week} but the query asks for ${got}`
      );
    }
  }
  if (binding.firstSeason !== undefined) {
    const got = Number(at(binding.firstSeason));
    const expected = Number(season) - historySeasons;
    if (got !== expected) {
      throw new Error(
        `${label}: history window starts at ${got}, expected ${expected} ` +
        `(season ${season} minus ${historySeasons} seasons)`
      );
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// Row predicates that mirror the SQL
// ---------------------------------------------------------------------------

/** Pure: the input cutoff every prior-rows query spells - strictly before (S, W). */
function isStrictlyBefore(row, season, week) {
  const s = Number(row.season);
  const w = Number(row.week);
  return s < Number(season) || (s === Number(season) && w < Number(week));
}

/**
 * Pure: `ORDER BY "season" DESC, "week" DESC`, with a deterministic tiebreak.
 *
 * PostgreSQL leaves rows tied on (season, week) in an arbitrary order, so the
 * emulation cannot reproduce "the" order - there is not one. It sorts by
 * player_id within a tie instead, which is deterministic and, crucially,
 * IMMATERIAL: `loadFeatureBundle` groups these rows per player, and within one
 * player (season, week) is unique, so no consumer can observe the tiebreak.
 * A test pins that reasoning by shuffling tied rows and asserting the bundle is
 * unchanged.
 */
function orderSeasonWeekDesc(rows) {
  return [...rows].sort((a, b) => Number(b.season) - Number(a.season)
    || Number(b.week) - Number(a.week)
    || Number(a.player_id) - Number(b.player_id));
}

// ---------------------------------------------------------------------------
// The client
// ---------------------------------------------------------------------------

function assertMode(mode) {
  if (!MODE_NAMES.includes(mode)) {
    throw new Error(`unknown snapshot mode ${JSON.stringify(mode)} - expected ${MODE_NAMES.join(' or ')}`);
  }
  return mode;
}

/**
 * Pure: index the orientation overlay by season:week:team_key.
 *
 * The overlay is the ONLY place 2024/2025 orientation exists - production's
 * `nfl_games` rows carry `home_away = null` and repairing them is separately
 * deferred - so `reconstructed` mode reads it and `off` mode must not.
 */
function indexOverlay(overlayRows) {
  const byKey = new Map();
  for (const row of overlayRows || []) {
    byKey.set(`${Number(row.season)}:${Number(row.week)}:${row.team_key}`, row);
  }
  return byKey;
}

/**
 * Build a snapshot client for one `{season, week, mode}`.
 *
 * `snapshot` carries the captured relations and the manifest.
 * `reconstruction` is required in `reconstructed` mode and carries the
 * roster/injury indexes (`lib/asOfView`), the orientation overlay, the injury
 * policy, the production `normalizeTeamKey`, and the internal-id -> gsis-id
 * mapping the cohort builder produces.
 */
function createSnapshotClient({
  snapshot,
  season,
  week,
  mode,
  reconstruction = null,
  historySeasons = HISTORY_SEASONS,
}) {
  assertMode(mode);
  if (!snapshot || !snapshot.manifest) throw new Error('createSnapshotClient requires a loaded snapshot');
  if (!Number.isInteger(Number(season)) || !Number.isInteger(Number(week))) {
    throw new Error('createSnapshotClient requires an integer season and week');
  }
  if (mode === MODES.RECONSTRUCTED) {
    if (!reconstruction) throw new Error('reconstructed mode requires a reconstruction');
    // `overlayRows` and `viewFor` are required for the SAME reason as the other
    // four, and omitting either used to be worse than omitting them: a missing
    // `overlayRows` left `indexOverlay` with an empty map, so every schedule row
    // kept production's null `home_away`, `scheduleOrientation` returned null
    // for all of them, and the ENTIRE homeAway factor went unavailable - with
    // no error, no counter, and completely plausible output, in exactly the
    // arms this study exists to measure. A missing `viewFor` merely failed
    // later, with a TypeError from inside a query. Both now fail at
    // construction, by name.
    for (const key of ['rosterIndex', 'normalizeTeamKey', 'gsisByPlayerId', 'policy',
      'overlayRows', 'viewFor']) {
      if (!reconstruction[key]) throw new Error(`reconstructed mode requires reconstruction.${key}`);
    }
  }

  const targetSeason = Number(season);
  const targetWeek = Number(week);
  const columnTypes = buildColumnTypes(snapshot.manifest);
  const overlay = mode === MODES.RECONSTRUCTED ? indexOverlay(reconstruction.overlayRows) : null;
  const normalizeTeamKey = reconstruction ? reconstruction.normalizeTeamKey : null;

  const counters = {
    queries: 0,
    byQuery: {},
    // Kept as a total for compatibility; `playersOmittedByReason` is the one
    // the published report needs (preregistration 4.1 counts exclusions per
    // cause, because "excluded" covers four very different situations).
    playersOmittedNoReconstruction: 0,
    playersOmittedByReason: {},
    scanRowsUnattributed: 0,
    contradictions: 0,
  };

  const countOmission = (reason) => {
    counters.playersOmittedNoReconstruction++;
    counters.playersOmittedByReason[reason] = (counters.playersOmittedByReason[reason] || 0) + 1;
  };

  const schedule = (forSeason) => snapshot.nflGamesBySeason.get(Number(forSeason)) || [];

  /**
   * An empty overlay is legal - the PG contract fixtures use one deliberately -
   * but NOT for a season the study actually evaluates. For those, the overlay
   * is the only source of orientation that exists (production's 2024/2025
   * `nfl_games` rows carry `home_away = null`), so an overlay that does not
   * reach the target week's teams means the homeAway factor is silently off for
   * that week. That is the B1 failure in its narrower form, and it is checked
   * at construction rather than discovered in a result.
   *
   * `manifest.seasons` is the list of evaluated seasons; a fixture whose season
   * is not among them is explicitly outside this rule.
   */
  if (mode === MODES.RECONSTRUCTED) {
    const evaluationSeasons = (snapshot.manifest.seasons || []).map(Number);
    if (evaluationSeasons.includes(targetSeason)) {
      const needed = [...new Set(schedule(targetSeason)
        .filter((row) => Number(row.week) === targetWeek)
        .map((row) => row.team_key)
        .filter(Boolean))];
      const uncovered = needed.filter(
        (teamKey) => !overlay.has(`${targetSeason}:${targetWeek}:${teamKey}`)
      );
      if (uncovered.length > 0) {
        throw new Error(
          `reconstructed mode for ${targetSeason} week ${targetWeek}: the orientation overlay does `
          + `not cover ${uncovered.length} of ${needed.length} scheduled team(s) `
          + `(${uncovered.slice(0, 6).join(', ')}). ${targetSeason} is an evaluated season, and the `
          + 'overlay is the ONLY orientation those rows have - production stores null. Serving them '
          + 'unpatched would turn the homeAway factor off for this week with no error and no counter.'
        );
      }
    }
  }

  /** Apply the orientation patch to one schedule row (reconstructed mode only). */
  const patchOrientation = (row) => {
    if (mode !== MODES.RECONSTRUCTED) return row;
    const patch = overlay.get(`${Number(row.season)}:${Number(row.week)}:${row.team_key}`);
    if (!patch) return row;
    return { ...row, home_away: patch.home_away, neutral_site: patch.neutral_site };
  };

  /**
   * The reconstructed view of one internal player id for the TARGET week, or
   * `{ omitted: <reason> }`.
   *
   * The reason matters as much as the omission. "Excluded" covers four
   * genuinely different situations - he had no roster row that week, he was on
   * reserve, he played a non-fantasy position, or he is a DEF pseudo-player -
   * and the published report has to distinguish them (preregistration 4.1).
   * Collapsing them into one number would make ~32 expected-by-design DEF
   * omissions per week look identical to a roster-coverage problem.
   */
  const reconstructPlayer = (player) => {
    const gsisId = reconstruction.gsisByPlayerId.get(Number(player.id));
    if (!gsisId) {
      // DEF units have no GSIS identifier by construction: they are not people.
      // They are synthesized per team-week in PHASE 3 from the pinned
      // stats_team_week rows plus games.csv scores, so their absence here is
      // the design working, not a gap.
      return { omitted: player.position === 'DEF' ? 'def-synthesized-in-phase-3' : 'no-gsis-mapping' };
    }
    const view = reconstruction.viewFor({ season: targetSeason, week: targetWeek, gsisId });
    if (!view) return { omitted: 'no-view' };
    if (!view.inCohort) return { omitted: view.reason || 'not-in-cohort' };
    if (view.contradiction && view.contradiction.contradicted) counters.contradictions++;
    return {
      row: {
        ...player,
        // The roster file is the authority for BOTH of these.
        position: view.position,
        nfl_team: view.team,
        team_key: view.teamKey,
        injury_status: view.injuryStatus,
      },
    };
  };

  const handlers = {
    playersById(params) {
      const ids = new Set((params[0] || []).map(Number));
      const rows = [];
      for (const player of snapshot.players) {
        if (!ids.has(Number(player.id))) continue;
        if (mode === MODES.OFF) { rows.push(player); continue; }
        const reconstructed = reconstructPlayer(player);
        // A player the reconstruction cannot place in this week is OMITTED,
        // exactly as if the database held no such row. The preregistration
        // excludes-and-counts rather than falling back to today's position, and
        // the counts - per cause - are on `client.counters`.
        if (reconstructed.omitted) { countOmission(reconstructed.omitted); continue; }
        rows.push(reconstructed.row);
      }
      return rows;
    },

    priorPlayerStats(params) {
      const ids = new Set((params[0] || []).map(Number));
      const firstSeason = Number(params[1]);
      const matched = snapshot.playerStats.filter((row) => ids.has(Number(row.player_id))
        && Number(row.season) >= firstSeason
        && isStrictlyBefore(row, targetSeason, targetWeek));
      return orderSeasonWeekDesc(matched).map((row) => ({
        player_id: row.player_id, season: row.season, week: row.week, stats: row.stats,
      }));
    },

    priorPlayerSeasonStats(params) {
      const ids = new Set((params[0] || []).map(Number));
      return snapshot.playerSeasonStats
        .filter((row) => ids.has(Number(row.player_id)) && Number(row.season) < targetSeason)
        .map((row) => ({
          player_id: row.player_id,
          season: row.season,
          games_played: row.games_played,
          stats: row.stats,
          fantasy_points: row.fantasy_points,
        }));
    },

    targetWeekSchedule() {
      return schedule(targetSeason)
        .filter((row) => Number(row.week) === targetWeek)
        .map(patchOrientation)
        .map((row) => ({
          team_key: row.team_key,
          opponent_key: row.opponent_key,
          nfl_team: row.nfl_team,
          opponent: row.opponent,
          kickoff_at: row.kickoff_at,
          game_key: row.game_key,
          home_away: row.home_away,
          neutral_site: row.neutral_site,
          venue: row.venue,
          roof: row.roof,
          surface: row.surface,
          latitude: row.latitude,
          longitude: row.longitude,
          rest_days: row.rest_days,
        }));
    },

    historyWindowSchedule(params) {
      const firstSeason = Number(params[0]);
      const rows = [];
      for (let s = firstSeason; s <= targetSeason; s++) {
        for (const row of schedule(s)) {
          if (!isStrictlyBefore(row, targetSeason, targetWeek)) continue;
          const patched = patchOrientation(row);
          rows.push({
            season: patched.season,
            week: patched.week,
            team_key: patched.team_key,
            opponent_key: patched.opponent_key,
            home_away: patched.home_away,
            neutral_site: patched.neutral_site,
          });
        }
      }
      return rows;
    },

    /**
     * The league-wide scan.
     *
     * `off` reproduces the SQL join: every prior-week stat row of the target
     * season, joined to today's `players` for position and to the schedule
     * through the player's CURRENT team.
     *
     * `reconstructed` replaces both halves, which is the whole point of the
     * reconstruction: position comes from the ROSTER FILE for that week, and
     * the schedule is joined through `stats.gameTeam` - the team he actually
     * played for that week - rather than through the team he is on today. A row
     * with no `gameTeam` cannot be attributed, so it keeps the LEFT JOIN's null
     * defense and orientation and is counted.
     */
    leagueScan(params) {
      const positions = new Set(params[2] || []);
      const limit = Number(params[3]);
      const playersById = new Map(snapshot.players.map((p) => [Number(p.id), p]));
      const rows = [];

      for (const stat of snapshot.playerStats) {
        if (Number(stat.season) !== targetSeason) continue;
        if (!(Number(stat.week) < targetWeek)) continue;
        const player = playersById.get(Number(stat.player_id));
        if (!player) continue; // the JOIN is inner on players

        let position = player.position;
        let joinTeamKey = player.team_key;

        if (mode === MODES.RECONSTRUCTED) {
          const gsisId = reconstruction.gsisByPlayerId.get(Number(stat.player_id));
          const view = gsisId
            ? reconstruction.viewFor({ season: targetSeason, week: Number(stat.week), gsisId })
            : null;
          if (!view || !view.inCohort) continue;
          position = view.position;
          const gameTeam = stat.stats && stat.stats.gameTeam;
          joinTeamKey = gameTeam ? normalizeTeamKey(gameTeam) : null;
          if (!joinTeamKey) counters.scanRowsUnattributed++;
          if (view.contradiction && view.contradiction.contradicted) counters.contradictions++;
        }

        if (!positions.has(position)) continue;

        const game = joinTeamKey
          ? schedule(targetSeason).find((g) => Number(g.week) === Number(stat.week)
            && g.team_key === joinTeamKey)
          : null;
        const patched = game ? patchOrientation(game) : null;
        rows.push({
          player_id: stat.player_id,
          week: stat.week,
          stats: stat.stats,
          position,
          defense: patched ? patched.opponent_key : null,
          home_away: patched ? patched.home_away : null,
          neutral_site: patched ? patched.neutral_site : null,
        });
      }

      rows.sort((a, b) => Number(a.player_id) - Number(b.player_id) || Number(a.week) - Number(b.week));
      return Number.isFinite(limit) ? rows.slice(0, limit) : rows;
    },

    defenseGameCount() {
      const byTeam = new Map();
      for (const row of schedule(targetSeason)) {
        if (!(Number(row.week) < targetWeek)) continue;
        byTeam.set(row.team_key, (byTeam.get(row.team_key) || 0) + 1);
      }
      return [...byTeam.entries()].map(([team, games]) => ({ team, games }));
    },

    byeWeeks(params) {
      const teams = params[1] || [];
      const upper = Number(params[2]);
      const rows = [];
      for (const team of teams) {
        // DEGENERATE INPUT, handled the way the SQL handles it rather than the
        // way the lookup would.
        //
        // `fn_normalize_nfl_team` is `upper(trim(x))` with a lookup on top, so
        // an empty or whitespace-only team normalizes to `''` - NOT to NULL -
        // and `''` matches no `nfl_games` row, because every schedule row holds
        // a real team code. The join therefore yields nothing. Consulting the
        // captured-normalization lookup for such a string would instead throw
        // (no captured row spells `''`), which would be exploding where SQL
        // stays quiet. Production cannot even reach here - `computeByeWeeks`
        // drops falsy teams with `filter(Boolean)` before querying - so this is
        // belt and braces, but the emulation should not be the fragile one.
        if (team == null || String(team).trim() === '') continue;
        const key = mode === MODES.RECONSTRUCTED
          ? normalizeTeamKey(team)
          : snapshotNormalizeTeamKey(snapshot, team);
        // A NULL key never equals anything in SQL, so it matches no row. Note
        // this is `== null`, not falsy: an empty-string key would have to be
        // COMPARED, exactly as `'' = ''` would be in SQL. It cannot arise here
        // (the guard above already returned), and writing it this way keeps the
        // emulation's three-valued logic honest rather than accidentally right.
        if (key == null) continue;
        for (const game of schedule(targetSeason)) {
          const gameWeek = Number(game.week);
          if (gameWeek < 1 || gameWeek > upper) continue;
          if (game.team_key !== key) continue;
          rows.push({ nfl_team: team, week: game.week });
        }
      }
      return rows;
    },
  };

  /**
   * Off mode has no injected `normalizeTeamKey` (it must not need one - it
   * serves captured rows). The bye query is the one place a CALLER-supplied
   * team string has to be folded, and `computeByeWeeks` is called with
   * `players.nfl_team` values that came out of this very snapshot. So off mode
   * resolves the fold by LOOKUP rather than by computation: find the captured
   * players row with that exact `nfl_team` and reuse the `team_key` the
   * database itself produced for it. That is the same value
   * `fn_normalize_nfl_team` returned during the oracle run, by construction.
   */
  function snapshotNormalizeTeamKey(snap, team) {
    if (snap.teamKeyByNflTeam === undefined) {
      snap.teamKeyByNflTeam = new Map();
      for (const player of snap.players) {
        if (player.nfl_team != null) snap.teamKeyByNflTeam.set(String(player.nfl_team), player.team_key);
      }
      for (const rows of snap.nflGamesBySeason.values()) {
        for (const row of rows) {
          if (row.nfl_team != null && !snap.teamKeyByNflTeam.has(String(row.nfl_team))) {
            snap.teamKeyByNflTeam.set(String(row.nfl_team), row.team_key);
          }
        }
      }
    }
    const key = snap.teamKeyByNflTeam.get(String(team));
    if (key === undefined) {
      // DELIBERATE DIVERGENCE, and it is fail-closed. `fn_normalize_nfl_team`
      // returns NULL for a team it does not recognize; this throws. The
      // difference is unreachable through `computeByeWeeks`, whose only input
      // is `players.nfl_team` values that came out of this very snapshot - so
      // in the real call path every string has a captured normalization. If one
      // ever does not, the snapshot is not the one the caller thinks it is, and
      // silently returning null would drop that team's bye instead of saying so.
      throw new Error(
        `snapshot client: no captured row spells team ${JSON.stringify(team)}, so the database's ` +
        'own normalization of it was never recorded and off mode cannot reproduce it'
      );
    }
    return key;
  }

  return {
    season: targetSeason,
    week: targetWeek,
    mode,
    counters,

    async query(text, params = []) {
      const sql = typeof text === 'string' ? text : (text && text.text);
      const entry = surfaceEntryFor(sql);
      if (!entry) {
        throw new Error(
          'snapshot client: unknown SQL. This client answers exactly the 8 queries ' +
          `generateProjections issues; it will not guess at a ninth. First 160 characters: ` +
          `${normalizeSql(sql).slice(0, 160)}`
        );
      }
      assertBinding({
        entry, params, season: targetSeason, week: targetWeek, historySeasons,
      });
      counters.queries++;
      counters.byQuery[entry.name] = (counters.byQuery[entry.name] || 0) + 1;

      const rows = handlers[entry.name](params);
      return {
        rows: rows.map((row) => rehydrateRow(row, columnTypes)),
        rowCount: rows.length,
        fields: Object.keys(rows[0] || {}).map((name) => ({
          name, dataTypeID: columnTypes.get(name),
        })),
      };
    },
  };
}

/**
 * Pure: assemble the in-memory snapshot a client reads.
 *
 * Kept separate from any filesystem access so tests can build one from literal
 * rows, and so the loader below is the only thing that touches disk.
 */
function assembleSnapshot({
  manifest, players, playerStats, playerSeasonStats, nflGamesBySeason,
}) {
  if (!manifest) throw new Error('assembleSnapshot requires the manifest');
  for (const [name, value] of [
    ['players', players], ['playerStats', playerStats], ['playerSeasonStats', playerSeasonStats],
  ]) {
    if (!Array.isArray(value)) throw new Error(`assembleSnapshot requires ${name} as an array`);
  }
  if (!(nflGamesBySeason instanceof Map)) {
    throw new Error('assembleSnapshot requires nflGamesBySeason as a Map keyed by season');
  }
  return { manifest, players, playerStats, playerSeasonStats, nflGamesBySeason };
}

/**
 * Load a snapshot from disk into the shape `createSnapshotClient` reads.
 *
 * Every read goes through `snapshotStore.loadDataset`, which verifies each
 * dataset's SHA-256 against its sidecar and the manifest's pin, re-runs the
 * 2026 quarantine, and - importantly for this file - is the ONE place in the
 * tree that builds a path. Nothing here constructs a path of its own, so the
 * path-safety reasoning lives in exactly one reviewed function instead of being
 * restated at every call site.
 *
 * The evaluation store is the only one read: `games_csv` is provenance and
 * lives on a path a feature loader cannot address.
 */
function loadSnapshot({ root }) {
  const manifest = store.loadManifest(root);
  const read = (dataset) => store.loadDataset({
    root,
    store: store.STORES.EVALUATION,
    path: store.PATHS.FEATURE,
    dataset,
    expectedSha256: (manifest.datasets.find((d) => d.dataset === dataset) || {}).sha256 || null,
  }).rows;

  const nflGamesBySeason = new Map();
  for (const season of manifest.scheduleSeasons || manifest.seasons) {
    nflGamesBySeason.set(Number(season), read(`nfl_games_${season}`));
  }
  return {
    ...assembleSnapshot({
      manifest,
      players: read('players'),
      playerStats: read('player_stats'),
      playerSeasonStats: read('player_season_stats'),
      nflGamesBySeason,
    }),
    orientationOverlay: read('orientation_overlay'),
    positionRank: read('position_rank'),
    playerNameRank: read('player_name_rank'),
  };
}

/**
 * Load one stored oracle's projections. Outcome path by construction, so this
 * cannot be mistaken for a feature read.
 */
function loadOracle({ root, season, week, manifest }) {
  const dataset = `oracle_${season}_w${week}`;
  const pinned = (manifest.datasets || []).find((d) => d.dataset === dataset);
  if (!pinned) throw new Error(`no oracle dataset ${dataset} in the manifest`);
  return store.loadDataset({
    root,
    store: store.STORES.EVALUATION,
    path: store.PATHS.OUTCOME,
    dataset,
    expectedSha256: pinned.sha256,
  }).rows;
}

module.exports = {
  HISTORY_SEASONS,
  REG_SEASON_WEEKS,
  MODES,
  MODE_NAMES,
  PG_TYPES,
  COMPUTED_COLUMN_TYPES,
  SQL_BY_NAME,
  buildColumnTypes,
  rehydrateValue,
  rehydrateRow,
  assertBinding,
  isStrictlyBefore,
  orderSeasonWeekDesc,
  indexOverlay,
  assembleSnapshot,
  loadSnapshot,
  loadOracle,
  createSnapshotClient,
};
