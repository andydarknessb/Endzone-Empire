import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import apiClient from '../../../api/apiClient';
import { useLeague } from '../../../hooks/useLeague';
import { useStandings } from '../../../hooks/useStandings';
import { computeDefaultWeek } from '../../../lib/matchupWeek';
import { teamNameLabel } from '../../../lib/teamIdentity';
import {
  applyTeamProfileUpdate,
  subscribeToTeamProfileUpdates,
} from '../../../lib/teamProfileEvents';
import { useLeagueMatchups, matchupStatusView } from '../../../entities/matchup';
import { recordsFromStandings } from '../../../widgets/matchup-grid';

/**
 * The Game Center page's data (ADR 0031, #897): everything the page composes
 * its widgets from, derived in one place so the page stays a layout. Four
 * reads, two feeds, and the page's own week state:
 *
 *   - The league, the viewer's Team id and the league's current week, through
 *     the shared league cache (useLeague / ADR 0004). `viewerTeamId` is the
 *     per-viewer answer to "which of these Teams is me" (#112), never an
 *     account field on a league-shared payload.
 *   - The league's Matchups as entity models (entities/matchup, ADR 0029),
 *     with the score feed and the Team identity feed composed inside the hook:
 *     a `scores:updated` event moves a card's score, Expected final, Players
 *     remaining, status and the two week facts with no refetch, and a
 *     reconnect refetches silently (the scoreboard on screen stays up).
 *   - The scoring standings, through the shared week-keyed cache
 *     (useStandings), for the record and rank lookups the hero and the grid
 *     print beneath a Team name: a Team's record does not join the Matchup
 *     wire (spec #890's ruling), so the page passes it down. The read is
 *     held until the league row is on hand, so its cache key carries the
 *     league's current week from the first request (useStandings's stated
 *     precondition) and the standings-table widget one navigation away shares
 *     the entry.
 *   - The league's rosters (a plain fetch, best effort: a failure only
 *     leaves the ticker's plays unattributed, never the page blank), so a
 *     scoring play's `playerId` resolves to the fantasy Team that owns the
 *     player. Real ownership, not a guess. The Team identity feed patches a
 *     rename into the roster rows so a held play never names a stale Team.
 *
 * The week on screen is the page's own state. Its default is the legacy
 * page's rule, unchanged (src/lib/matchupWeek's computeDefaultWeek: the
 * league's current week when Matchups exist for it, else the latest week with
 * an unfinished Matchup, else the latest week, else "All"), picked once when
 * both the Matchup and league reads have settled, whichever lands first.
 *
 * The plays the ticker and the feed show are the whole league's, held newest
 * first with the week they belong to and the clock time they landed (the
 * server sends no clock; the scoring-feed widget's model says the page stamps
 * receipt). They are filtered by the week on screen at render, so switching
 * weeks shows that week's plays and "All" shows every week's; a play whose
 * player no fantasy Team rosters is not a league play and is not shown. Each
 * shown play carries the fantasy Team's name from the roster lookup and,
 * when that Team is one side of the viewer's Matchup, which side, for the
 * feed's home / away dot.
 *
 * The week-at-a-glance facts and the sync line are derived from the list
 * read alone (`weekGlanceFacts`, `syncLineText`, both pure and exported for
 * their table tests).
 */

/** The live score pass's cadence, which the sync line counts down against. */
export const SYNC_CADENCE_MS = 30 * 60 * 1000;

/** How many plays the page holds across every week (the feed shows six at a time). */
export const PLAYS_LIMIT = 50;

/** A finite number from a wire value (pg DECIMAL strings included), else null. */
function finite(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Epoch ms for an ISO instant, or null when it cannot be read. */
function toMs(iso) {
  if (iso == null || iso === '') return null;
  const ms = new Date(iso).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/** A margin to a tenth, so two scores 0.04 apart never print as a lead. */
function tenth(value) {
  return Math.round(value * 10) / 10;
}

/**
 * "Scores synced 3:42 PM · next pass in 8 min" for the week's `syncedAt`
 * (#892), or null when the week has not been synced (the page omits the
 * line). The clock time is the viewer's own locale; the next pass is the
 * cadence after the sync, in whole minutes rounded up, floored at zero once
 * the pass is due. `now` (epoch ms) exists so a test can pin the countdown.
 */
export function syncLineText(syncedAt, now = Date.now()) {
  const syncedMs = toMs(syncedAt);
  if (syncedMs == null) return null;
  const time = new Date(syncedMs).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
  const remaining = Math.max(0, Math.ceil((syncedMs + SYNC_CADENCE_MS - now) / 60000));
  return `Scores synced ${time} · next pass in ${remaining} min`;
}

/**
 * The week-at-a-glance rows from the week's Matchups alone, in the canvas's
 * order: the top score, the closest Matchup, the biggest lead, and the
 * starters still to play league-wide. Each row is `{ key, label, text,
 * value }` with `value` already formatted; a row whose fact is not derivable
 * is left out rather than printed as a zero.
 *
 *   - Top score is the highest SCORE among the sides of the Matchups that
 *     have started (the server's status fact, ADR 0030): a projected total is
 *     not a score, so Expected final never feeds this row, and a scheduled
 *     Matchup's stored 0.0 is not a top score.
 *   - Closest is the started Matchup with the smallest margin, both Team
 *     names middot-separated; biggest lead is the largest margin, "<leader>
 *     over <trailer>", and is not derivable when no one leads (every started
 *     Matchup tied).
 *   - Still to play sums Players remaining across every side of the week,
 *     scheduled Matchups included (their starters are still to play), and is
 *     not derivable when no side reports a count.
 */
export function weekGlanceFacts(matchups) {
  const list = Array.isArray(matchups) ? matchups.filter(Boolean) : [];
  const started = list.filter((m) => matchupStatusView(m.status).hasStarted === true);

  let top = null;
  let closest = null;
  let lead = null;
  for (const m of started) {
    const home = m.home || {};
    const away = m.away || {};
    const homeScore = finite(home.score);
    const awayScore = finite(away.score);
    for (const [name, score] of [[home.name, homeScore], [away.name, awayScore]]) {
      if (score != null && (!top || score > top.score)) top = { name: teamNameLabel(name), score };
    }
    if (homeScore == null || awayScore == null) continue;
    const margin = tenth(Math.abs(homeScore - awayScore));
    const homeName = teamNameLabel(home.name);
    const awayName = teamNameLabel(away.name);
    if (!closest || margin < closest.margin) {
      closest = { text: `${homeName} · ${awayName}`, margin };
    }
    if (margin > 0 && (!lead || margin > lead.margin)) {
      const leader = homeScore > awayScore ? homeName : awayName;
      const trailer = homeScore > awayScore ? awayName : homeName;
      lead = { text: `${leader} over ${trailer}`, margin };
    }
  }

  let remaining = null;
  for (const m of list) {
    for (const side of [m.home, m.away]) {
      const n = finite(side?.playersRemaining);
      if (n != null) remaining = (remaining ?? 0) + n;
    }
  }

  const rows = [];
  if (top) rows.push({ key: 'top-score', label: 'Top score', text: top.name, value: top.score.toFixed(1) });
  if (closest) rows.push({ key: 'closest', label: 'Closest', text: closest.text, value: closest.margin.toFixed(1) });
  if (lead) rows.push({ key: 'biggest-lead', label: 'Biggest lead', text: lead.text, value: lead.margin.toFixed(1) });
  if (remaining != null) {
    rows.push({ key: 'still-to-play', label: 'Still to play', text: 'Starters league-wide', value: String(remaining) });
  }
  return rows;
}

/** The week filter applied to a week value: "All" and an unset filter keep everything. */
function inWeek(week, value) {
  return week === 'All' || week == null || Number(value) === Number(week);
}

export function useGameCenter(leagueId) {
  const { league, viewerTeamId, loading: leagueLoading, error: leagueError } = useLeague(leagueId);
  const [rosters, setRosters] = useState([]);
  const [week, setWeek] = useState(null);
  const [plays, setPlays] = useState([]);
  const weekInitialized = useRef(false);

  // Every play the score feed delivers is held with the week it belongs to
  // and stamped at receipt. The filter by the week on screen happens at
  // render (below), so a play is never dropped because of the week the page
  // happened to be showing when it landed.
  const handleScores = useCallback((event) => {
    const eventWeek = finite(event?.week);
    const at = Date.now();
    const adds = (event?.plays || [])
      .filter((p) => p && p.playerId != null)
      .map((p) => ({ ...p, week: eventWeek, at }));
    if (adds.length) setPlays((prev) => [...adds, ...prev].slice(0, PLAYS_LIMIT));
  }, []);

  const { matchups, loading, error } = useLeagueMatchups(leagueId, { onScores: handleScores });

  // Best-effort roster load: only needed to attribute a play to a Team, so a
  // failure here never takes down the rest of the screen.
  useEffect(() => {
    let cancelled = false;
    setRosters([]);
    apiClient
      .get(`/api/league/${leagueId}/rosters`)
      .then((res) => { if (!cancelled) setRosters(Array.isArray(res.data) ? res.data : []); })
      .catch(() => { if (!cancelled) setRosters([]); });
    return () => { cancelled = true; };
  }, [leagueId]);

  // A Team rename reaches the roster rows, so a held play names the new Team.
  // The Matchup models get their own identity patch inside the entity hook.
  useEffect(() => subscribeToTeamProfileUpdates((update) => {
    if (Number(update.leagueId) !== Number(leagueId)) return;
    setRosters((prev) => prev.map((team) => applyTeamProfileUpdate(team, update, { name: 'teamName' })));
  }), [leagueId]);

  const weeks = useMemo(
    () => Array.from(new Set(matchups.map((m) => m.week).filter((w) => w != null))).sort((a, b) => a - b),
    [matchups]
  );

  // The default week, once both the Matchup fetch and the shared league fetch
  // have settled, whichever order they resolve in (the legacy page's rule).
  useEffect(() => {
    if (weekInitialized.current || loading || leagueLoading) return;
    weekInitialized.current = true;
    setWeek(computeDefaultWeek(league, matchups, weeks));
    // weeks/matchups are derived from the same settled fetch; leaving them off
    // avoids re-picking the week on every later live update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, leagueLoading, league]);

  // Standings, held until the league row (and so its current week) is on
  // hand: useStandings keys its shared cache entry by that week, and a read
  // that started without it would key twice and fetch twice.
  const standings = useStandings(league ? leagueId : null, league?.current_week);
  const standingsRows = useMemo(
    () => (Array.isArray(standings.data?.standings) ? standings.data.standings : []),
    [standings.data]
  );
  const records = useMemo(
    () => (standingsRows.length ? Object.fromEntries(recordsFromStandings(standingsRows)) : null),
    [standingsRows]
  );
  // The rank is the standings row's own when it carries one (the endpoint
  // numbers its ordered rows), else the row's position in that order.
  const ranks = useMemo(() => {
    if (!standingsRows.length) return null;
    const out = {};
    standingsRows.forEach((row, index) => {
      if (!row || row.teamId == null) return;
      const rank = finite(row.rank);
      out[row.teamId] = rank != null && rank >= 1 ? rank : index + 1;
    });
    return out;
  }, [standingsRows]);

  const weekMatchups = useMemo(
    () => matchups.filter((m) => inWeek(week, m.week)),
    [matchups, week]
  );

  const hero = useMemo(() => {
    if (viewerTeamId == null) return null;
    return weekMatchups.find(
      (m) => m.home?.teamId === viewerTeamId || m.away?.teamId === viewerTeamId
    ) || null;
  }, [weekMatchups, viewerTeamId]);
  const rest = useMemo(
    () => (hero ? weekMatchups.filter((m) => m.id !== hero.id) : weekMatchups),
    [weekMatchups, hero]
  );

  // The week's sync instant (#892): the latest across its rows, so a row an
  // older event left behind never reads as the week's.
  const syncedAt = useMemo(() => {
    let best = null;
    for (const m of weekMatchups) {
      const ms = toMs(m.syncedAt);
      if (ms != null && (best == null || ms > best.ms)) best = { ms, iso: m.syncedAt };
    }
    return best ? best.iso : null;
  }, [weekMatchups]);

  // The next kickoff: the earliest first kickoff among the week's Matchups
  // that have not started (the server's status fact), or null.
  const nextKickoffAt = useMemo(() => {
    let best = null;
    for (const m of weekMatchups) {
      if (matchupStatusView(m.status).hasStarted !== false) continue;
      const ms = toMs(m.firstKickoffAt);
      if (ms != null && (best == null || ms < best.ms)) best = { ms, iso: m.firstKickoffAt };
    }
    return best ? best.iso : null;
  }, [weekMatchups]);

  // playerId -> the fantasy Team that rosters the player.
  const playerTeams = useMemo(() => {
    const map = new Map();
    for (const team of rosters) {
      for (const p of team?.players || []) {
        if (p && p.id != null) map.set(p.id, { teamId: team.teamId, teamName: team.teamName });
      }
    }
    return map;
  }, [rosters]);

  const items = useMemo(() => {
    const homeId = hero?.home?.teamId ?? null;
    const awayId = hero?.away?.teamId ?? null;
    return plays
      .filter((p) => inWeek(week, p.week) && playerTeams.has(p.playerId))
      .map((p) => {
        const team = playerTeams.get(p.playerId);
        const side =
          homeId != null && team.teamId === homeId
            ? 'home'
            : awayId != null && team.teamId === awayId
              ? 'away'
              : null;
        return { ...p, teamName: team.teamName, side };
      });
  }, [plays, week, playerTeams, hero]);

  const glance = useMemo(() => weekGlanceFacts(weekMatchups), [weekMatchups]);

  return {
    league,
    viewerTeamId,
    // Only a first load without a league row blanks the page: a reload of the
    // shared league entry keeps the page up with the row it already has.
    pending: loading || (!league && leagueLoading),
    error: error || leagueError || null,
    weeks,
    week,
    setWeek,
    hero,
    rest,
    records,
    ranks,
    syncedAt,
    nextKickoffAt,
    items,
    glance,
  };
}

export default useGameCenter;
