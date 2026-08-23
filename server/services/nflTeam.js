/**
 * ONE NFL team vocabulary for JavaScript, mirroring the database's
 * `fn_normalize_nfl_team(text)` exactly (#227).
 *
 * THE PROBLEM IT ANSWERS. Team identity is written into this database in
 * three vocabularies and no column says which one it is holding:
 *
 *   - `nfl_games.nfl_team` is Tank01's abbreviation, and Tank01's own
 *     abbreviations have drifted (`WSH` where the rest of the app says `WAS`);
 *   - `players.nfl_team` is an abbreviation for a skill player but a FULL
 *     TEAM NAME for a DEF unit, because `syncTeamDefenses` seeds the 32 units
 *     from a name list (`Denver Broncos`) - Tank01 never returns DEF rows;
 *   - historical rows can still carry a pre-relocation code (`SD`, `OAK`,
 *     `STL`).
 *
 * So `players.nfl_team = nfl_games.nfl_team` is not a join, it is a coin
 * flip, and it comes up wrong for every DEF unit in every league.
 *
 * WHY THIS EXISTS IN JS WHEN THE SQL FUNCTION ALREADY EXISTS. Both are
 * needed, and which one a consumer uses is decided by where the comparison
 * happens rather than by preference:
 *
 *   - a consumer that JOINS two tables normalises IN SQL, through
 *     `fn_normalize_nfl_team` on both sides - `bye.service`'s
 *     `computeByeWeeks`, `gameRecap.service`, the backtest surface;
 *   - a consumer that has already read one side into memory and matches in
 *     JavaScript normalises HERE, on both sides, for the same reason: the
 *     lineup lock and the kickoff spare hold a player row and a schedule row
 *     and compare them in the service.
 *
 * Pushing the lineup lock's comparison into SQL was considered and rejected.
 * Every suite that covers it drives the service through a fake pool, so a SQL
 * predicate would have to be re-implemented by each fake - and a fake that
 * answers a normalisation question from its own re-implementation reports on
 * the fixture, not on the code (the warning at the head of
 * `test/helpers/tenureFakes.js`, and the day #190 lost to exactly that).
 * Normalising in JS puts the real function under the real assertions.
 *
 * THE DRIFT THAT COSTS. Two tables of 32 names and 13 aliases that must agree
 * forever is a standing invitation to divergence, so it is not left to
 * discipline: `test/nflTeam.test.js` reads the VALUES lists out of the
 * migration that defines `fn_normalize_nfl_team` and fails if this file and
 * that one have stopped saying the same thing. Add a relocation to one and
 * the guard names the other.
 */

// Full NFL team name -> canonical abbreviation. Mirrors the `full_names`
// VALUES list in server/db/migrations/20260719000003_view_matchup_nfl_games.js.
const NFL_TEAM_FULL_NAMES = {
  'ARIZONA CARDINALS': 'ARI', 'ATLANTA FALCONS': 'ATL', 'BALTIMORE RAVENS': 'BAL',
  'BUFFALO BILLS': 'BUF', 'CAROLINA PANTHERS': 'CAR', 'CHICAGO BEARS': 'CHI',
  'CINCINNATI BENGALS': 'CIN', 'CLEVELAND BROWNS': 'CLE', 'DALLAS COWBOYS': 'DAL',
  'DENVER BRONCOS': 'DEN', 'DETROIT LIONS': 'DET', 'GREEN BAY PACKERS': 'GB',
  'HOUSTON TEXANS': 'HOU', 'INDIANAPOLIS COLTS': 'IND', 'JACKSONVILLE JAGUARS': 'JAX',
  'KANSAS CITY CHIEFS': 'KC', 'LAS VEGAS RAIDERS': 'LV', 'LOS ANGELES CHARGERS': 'LAC',
  'LOS ANGELES RAMS': 'LAR', 'MIAMI DOLPHINS': 'MIA', 'MINNESOTA VIKINGS': 'MIN',
  'NEW ENGLAND PATRIOTS': 'NE', 'NEW ORLEANS SAINTS': 'NO', 'NEW YORK GIANTS': 'NYG',
  'NEW YORK JETS': 'NYJ', 'PHILADELPHIA EAGLES': 'PHI', 'PITTSBURGH STEELERS': 'PIT',
  'SAN FRANCISCO 49ERS': 'SF', 'SEATTLE SEAHAWKS': 'SEA', 'TAMPA BAY BUCCANEERS': 'TB',
  'TENNESSEE TITANS': 'TEN', 'WASHINGTON COMMANDERS': 'WAS',
};

// Legacy / alternate abbreviation -> canonical abbreviation. Mirrors the
// `aliases` VALUES list in the same migration.
const NFL_TEAM_ALIASES = {
  // Washington has cycled through several Tank01/legacy codes
  WSH: 'WAS', WFT: 'WAS',
  GNB: 'GB', KAN: 'KC', JAC: 'JAX', NWE: 'NE',
  NOR: 'NO', TAM: 'TB', SFO: 'SF',
  // pre-relocation abbreviations that may still linger in stale rows
  SD: 'LAC', OAK: 'LV', STL: 'LAR', LA: 'LAR',
};

/**
 * A team string in ANY of the three vocabularies -> the one canonical
 * abbreviation, or `null` when there is nothing to compare.
 *
 * An unrecognised non-empty string passes through upper-cased and trimmed
 * rather than failing, exactly as the SQL function does: an unknown code is
 * still an identity, and folding it onto something real would be worse than
 * leaving it alone. Two rows that were already spelled the same still match;
 * a genuinely unknown team simply matches only itself.
 *
 * THE ONE DELIBERATE DIVERGENCE FROM THE SQL. `fn_normalize_nfl_team('')`
 * returns `''`, which in SQL is harmless because no `nfl_games` row holds a
 * blank team. Here it returns `null`, so a player whose `nfl_team` was never
 * populated can never be matched against anything - including another blank.
 * Absence of a team is absence of a game, which is the same answer this
 * module gives for a bye, and it must not become "locked" by accident.
 */
function normalizeNflTeam(rawTeam) {
  if (rawTeam === null || rawTeam === undefined) return null;
  const value = String(rawTeam).trim().toUpperCase();
  if (value === '') return null;
  return NFL_TEAM_FULL_NAMES[value] || NFL_TEAM_ALIASES[value] || value;
}

/**
 * Do these two team strings name the same NFL team? The predicate `players`
 * and `nfl_games` should always have been compared with. Two unknowns match
 * only when they are spelled the same; a blank matches nothing at all.
 */
function sameNflTeam(a, b) {
  const left = normalizeNflTeam(a);
  return left !== null && left === normalizeNflTeam(b);
}

module.exports = {
  NFL_TEAM_FULL_NAMES,
  NFL_TEAM_ALIASES,
  normalizeNflTeam,
  sameNflTeam,
};
