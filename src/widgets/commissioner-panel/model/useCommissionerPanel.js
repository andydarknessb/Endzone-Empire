import { useLeague } from '../../../hooks/useLeague';
import { useEndpoint } from '../../../shared/lib';
import { isPickemOnly } from '../../../lib/leagueType';
import { receptionFormatLabel } from '../../../lib/leagueRulesFormat';
import { isLeagueCreator } from '../../../lib/teamIdentity';

/**
 * Data model for the commissioner-panel widget (League Dashboard rail, ticket
 * #644). It reads the shared league cache (useLeague / ADR 0004) that the page
 * shell already warmed, so it costs no extra request, and derives the three
 * questions the panel asks of the payload:
 *
 *   - `isCommissioner`: the panel's whole presence gate. Read from the league
 *     payload's own `is_commissioner` flag, the SAME field useQuickActions
 *     gates its commissionerOnly card on - not `invite_code`, which the shell's
 *     CopyInvite reads and which answers a different question (a code being
 *     present, not a role). A single spelling keeps the two commissioner gates
 *     on this page from drifting apart.
 *   - `isOwner`: whether the viewer created this league, by Team identity
 *     (isLeagueCreator: `ownerTeamId === viewerTeamId`, never an account id).
 *     Passed straight through to the legacy commissioner tools, which gate the
 *     two owner-only powers (deleting the league, managing co-commissioners) on
 *     it. It defaults FALSE in the tools, so a null-vs-null match is refused.
 *   - `pickemOnly` and `currentWeek`: together decide whether the advance-week
 *     control shows. A pick'em-only league advances on the NFL calendar (the
 *     scheduler's job), and a league with no current week has no week to
 *     advance from, so neither renders the control.
 *
 * `refetch` is the cached league refetch the advance-week feature and the
 * legacy tools both trigger after a successful mutation: it re-reads the league
 * row, which re-keys the week-scoped standings read for the mounted tables.
 */

// Waiver type in the words a 120px tile can hold. Not WAIVER_TYPE_LABELS from
// leagueRulesFormat: those are the League Rules page's full phrasings ("FAAB
// (Bidding)"), which wrap to three lines in a tile.
const WAIVER_TILE_LABELS = { faab: 'FAAB', priority: 'Priority' };

// An hours column as a tile value. The null check comes FIRST because
// `Number(null)` is 0, which would print a settled "0h" for a column that is
// simply absent.
function hoursLabel(value) {
  if (value == null) return null;
  const hours = Number(value);
  return Number.isFinite(hours) ? `${hours}h` : null;
}

/**
 * The facts the panel states without expanding anything, each one a field the
 * league payload already carries (SELECT leagues.*, plus the teams[] select in
 * league.router.js). No request is made for any of them.
 *
 * A fact whose source field is ABSENT is not rendered. The columns behind these
 * are NOT NULL with server defaults, so an absent field means a payload that
 * never carried it, and printing the column default would state a setting the
 * commissioner never chose. `trade_deadline_week` is the one nullable source:
 * there null IS the answer ("None"), not an absence.
 *
 * Every fact here is a fantasy-league concept - transactions, roster freezes,
 * waivers, trades, lineup slots, scoring - so a pick'em-only league gets none,
 * the same rule CommissionerTools already applies to its own transactions lock
 * and its roster and scoring tabs (`!pickemOnly`).
 */
function commissionerFacts(league, teams) {
  const facts = [];
  if (!league || isPickemOnly(league)) return facts;

  if (typeof league.transactions_locked === 'boolean') {
    facts.push({
      key: 'transactions',
      label: 'Transactions',
      value: league.transactions_locked ? 'Locked' : 'Open',
    });
  }

  // teams[].locked is the per-team roster freeze, distinct from the league-wide
  // transactions lock above; the commissioner's question is how many managers
  // are frozen right now, which is why this counts rows rather than reading a
  // league flag.
  const rows = Array.isArray(teams) ? teams : [];
  if (rows.some((team) => typeof team?.locked === 'boolean')) {
    facts.push({
      key: 'teams-locked',
      label: 'Teams locked',
      value: `${rows.filter((team) => team?.locked).length} of ${rows.length}`,
    });
  }

  if ('trade_deadline_week' in league) {
    facts.push({
      key: 'trade-deadline',
      label: 'Trade deadline',
      value: league.trade_deadline_week == null ? 'None' : `Week ${league.trade_deadline_week}`,
    });
  }

  if (league.waiver_type) {
    const type = WAIVER_TILE_LABELS[league.waiver_type] || league.waiver_type;
    const period = hoursLabel(league.waiver_period_hours);
    facts.push({ key: 'waivers', label: 'Waivers', value: period ? `${type} · ${period}` : type });
  }

  const review = hoursLabel(league.trade_review_hours);
  if (review) facts.push({ key: 'trade-review', label: 'Trade review', value: review });

  // roster_slots is jsonb, so it arrives parsed; anything else reads as an
  // absent fact rather than a guessed one.
  if (Array.isArray(league.roster_slots)) {
    const starters = league.roster_slots.reduce((sum, slot) => sum + (Number(slot?.count) || 0), 0);
    const bench = Number(league.bench_slots) || 0;
    const ir = Number(league.ir_slots) || 0;
    const parts = [`${starters} starters`, `${bench} bench`];
    // A league with no IR slot reads exactly as it did before IR existed (#96),
    // rather than carrying a "0 IR" that means nothing to its commissioner.
    if (ir > 0) parts.push(`${ir} IR`);
    facts.push({ key: 'roster', label: 'Roster', value: parts.join(' · ') });
  }

  // The format the league actually plays, off its reception rate and never the
  // stored `scoring_preset` (null on a new league, 'custom' after any override,
  // so it says less than the rate does). Only the league's OWN stored rules are
  // read: naming the format of a league that stores none would take the scoring
  // defaults, which is a request this panel does not make, so such a league
  // renders no scoring fact rather than a guessed one.
  const format = receptionFormatLabel(league.scoring_rules);
  if (format) facts.push({ key: 'scoring', label: 'Scoring', value: format });

  return facts;
}

export function useCommissionerPanel(leagueId) {
  const { league, teams, viewerTeamId, refetch } = useLeague(leagueId);

  // The pending join queue: the panel's ONE request, and the count a
  // commissioner would otherwise have to expand the tools and find on a tab.
  //
  // The null URL is load-bearing, not a formality. This hook runs on every
  // member's dashboard - the panel's `isCommissioner` gate returns null AFTER
  // it - so a URL built without the `is_commissioner` clause would fire a read
  // the route answers 403 to, on every member's page load. The other two
  // clauses are the pair GeneralSettingsPanel gates its own copy of this queue
  // on: a private league takes no join requests, and a public league that does
  // not screen joins admits them without ever queueing one.
  const showJoinQueue = !!league?.is_commissioner && !!league?.is_public && !!league?.join_approval;
  const joinRequests = useEndpoint(
    showJoinQueue && leagueId != null ? `/api/league/${leagueId}/join-requests` : null
  );
  // Null until the read lands, and null if it fails: "0 pending" is a different
  // statement from "not read yet", and the panel states nothing rather than a
  // zero it cannot stand behind.
  const pendingJoinRequests =
    joinRequests.status === 'ready' && Array.isArray(joinRequests.data)
      ? joinRequests.data.length
      : null;

  return {
    league,
    teams,
    viewerTeamId,
    isCommissioner: !!league?.is_commissioner,
    isOwner: isLeagueCreator(league, viewerTeamId),
    pickemOnly: isPickemOnly(league),
    currentWeek: league?.current_week ?? null,
    facts: commissionerFacts(league, teams),
    pendingJoinRequests,
    // The creator plus every co-commissioner grant. `co_commissioners` rides on
    // the payload for a commissioner (league.router.js), and the creator is
    // named on the league itself rather than flagged inside that list, which is
    // why the count is length + 1.
    commissionerCount:
      (Array.isArray(league?.co_commissioners) ? league.co_commissioners.length : 0) + 1,
    refetch,
  };
}

export default useCommissionerPanel;
