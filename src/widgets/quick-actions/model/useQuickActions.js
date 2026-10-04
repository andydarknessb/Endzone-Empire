import {
  parseRosterSlots,
  deriveLeaguePhase,
  isSeasonLive,
  LEAGUE_PHASE,
  isPickemOnly,
  lineupAttention,
} from '../../../shared/lib';
import { useLeague } from '../../../hooks/useLeague';
import { useTeamLineup } from '../../../entities/roster';

/**
 * Data model for the quick-actions widget (League Dashboard, ticket #643): the
 * grouped action cards below the main grid (Play / Moves / League), each card a
 * link to an existing league sub-route with a line of status copy, and the cards
 * that deserve attention carrying a "Recommended" pill.
 *
 * Almost every card's status copy is CHEAP and LOCAL: it comes from the league
 * row the page already holds (phase and current week) or is a fixed descriptive
 * line. The one sanctioned extra read is the viewer's lineup, used only for the
 * Set Lineup recommendation.
 *
 *   - The lineup read is `useTeamLineup` from `entities/roster`, the SAME read
 *     My Team's Starters section makes (#1981): both mounts are on this page
 *     and share one `/api/team/lineup` request through the `useResource` cache
 *     (ADR 0004), so the two can never disagree about an empty slot or a spent
 *     one. It replaced a `/api/team/roster` read, whose query joins from
 *     `team_players` and drops a departed starter's row, so a spent slot read
 *     as empty here and as filled on My Team.
 *   - The recommendation is BEST EFFORT and never an error state: a lineup read
 *     that fails (or is still loading) simply yields no recommendation and the
 *     Set Lineup card renders its plain copy. It is skipped entirely for a
 *     pick'em-only league, which has no lineup (the Set Lineup card is hidden
 *     there), so the read never fires.
 *
 * The Set Lineup recommendation is only made while the season is live (in
 * season or playoffs, `isSeasonLive`): before the draft finishes the card reads
 * `Lineups open after the draft` and is never recommended (#1979 L25).
 *
 * The empty-starting-slot count and starters-on-bye come from the shared
 * lineupAttention helper (src/shared/lib/lineupAttention.js), the SAME implementation
 * the lineup screen's warning banner reads, so the dashboard's recommendation
 * and the lineup screen can never disagree about whether a manager is set. This
 * widget supplies the "on bye" predicate the helper leaves to its caller: the
 * lineup wire's own per-entry `onBye` (annotateLineupEntries computes it against
 * the requested week and never sets it on a spent row), passed through the
 * entity's read model rather than re-derived from a bye week here.
 */

// The phases in which the draft can still be configured (#1981 L11). After the
// draft the card would invite a settings page with nothing left to change.
const DRAFT_TIME_PHASES = [LEAGUE_PHASE.PRE_DRAFT, LEAGUE_PHASE.DRAFTING];

// The action catalog, grouped by intent. Mirrors the legacy dashboard's
// NAV_GROUPS (slug -> /league/:id/<slug>) so destinations carry over unchanged.
// `fantasyOnly` cards have no surface in a pick'em-only league (no draft,
// rosters or matchups); `commissionerOnly` cards need the league's commissioner
// flag; `phases`, when present, limits a card to those league phases. A group
// with nothing left after filtering is dropped.
const GROUPS = [
  {
    label: 'Play',
    links: [
      { key: 'draft', label: 'Draft Room', slug: 'draft', fantasyOnly: true },
      { key: 'lineup', label: 'Set Lineup', slug: 'lineup', fantasyOnly: true },
      { key: 'game-center', label: 'Game Center', slug: 'game-center', fantasyOnly: true },
      { key: 'pickem', label: "Pick'em", slug: 'pickem' },
    ],
  },
  {
    label: 'Moves',
    links: [
      { key: 'waivers', label: 'Waivers', slug: 'waivers', fantasyOnly: true },
      { key: 'trades', label: 'Trades', slug: 'trades', fantasyOnly: true },
    ],
  },
  {
    label: 'League',
    links: [
      { key: 'activity', label: 'Activity', slug: 'activity' },
      { key: 'power-rankings', label: 'Power Rankings', slug: 'power-rankings', fantasyOnly: true },
      { key: 'history', label: 'History', slug: 'history' },
      { key: 'rules', label: 'League Rules', slug: 'rules' },
      {
        key: 'draft-settings',
        label: 'Draft Settings',
        slug: 'draft-settings',
        fantasyOnly: true,
        commissionerOnly: true,
        phases: DRAFT_TIME_PHASES,
      },
    ],
  },
];

// The league's starting-slot config, as the lineupAttention helper wants it.
// `roster_slots` rides on the league row (SELECT leagues.*); it is jsonb, so it
// arrives parsed, but a string is tolerated defensively (shared/lib's
// parseRosterSlots, #1165). When it is absent the helper has no starting slot
// to inspect at all (#1210 deleted its fantasy-standard default), so both
// signals read empty - 0 empty slots and no starter flagged on bye - until the
// league's own slots arrive, never a guess at which keys are starters.
function rosterSlotsOf(league) {
  return parseRosterSlots(league?.roster_slots);
}

// The Set Lineup recommendation copy. Empty starting slots read first, then
// starters on bye; the "fix before Sunday" call to action rides on the bye case,
// which is the deadline-bearing one (a bye is fixed by kickoff). Middot
// separators, never em-dashes (house style).
function lineupRecommendationCopy({ emptyStarterSlots, startersOnBye }) {
  const parts = [];
  if (emptyStarterSlots > 0) {
    parts.push(`${emptyStarterSlots} empty starting slot${emptyStarterSlots > 1 ? 's' : ''}`);
  }
  const byes = startersOnBye.length;
  if (byes > 0) {
    parts.push(`${byes} starter${byes > 1 ? 's' : ''} on bye`);
  }
  let copy = parts.join(' · ');
  if (byes > 0) copy += ' · fix before Sunday';
  return copy;
}

// The two states in which the server REFUSES a move, mirrored here so a card
// stops inviting an action that comes back a 409:
//
//   - Waivers are gated on `transactions_locked` alone (waiver.service.js:143
//     on claimTarget, :177 on submitClaim). The other refusal, the viewer's own
//     `teams.locked`, is a team-row field this widget never reads, so the card
//     deliberately says nothing about it rather than guessing.
//   - Trades check that SAME lock first (trade.service.js:82) and only then the
//     deadline (assertBeforeDeadline, trade.service.js:59).
//
// Neither card is ever `recommended`: pointing at a refused move is exactly
// what this change exists to stop.
const TRANSACTIONS_LOCKED_COPY = 'Transactions locked by your commissioner';

// `trade_deadline_week` is nullable and null means "no deadline at all", so
// both sides are guarded rather than leaning on `3 > null` being false by
// accident. The comparison itself is the server's: strictly greater, so the
// deadline week is still an open week.
function tradeDeadlinePassed(week, tradeDeadlineWeek) {
  return week != null && tradeDeadlineWeek != null && week > tradeDeadlineWeek;
}

// Per-card status copy + whether it is Recommended, from local signals only.
// `attention` is null unless the lineup read has resolved.
function describeCard(key, ctx) {
  const {
    phase, pickemOnly, seasonLive, week, attention, transactionsLocked, tradeDeadlineWeek,
  } = ctx;
  const weekLabel = week != null ? `Week ${week}` : null;

  switch (key) {
    case 'draft':
      if (phase === LEAGUE_PHASE.DRAFTING) {
        return { status: 'Draft is live now · make your picks', recommended: true };
      }
      if (phase === LEAGUE_PHASE.PRE_DRAFT) {
        return { status: 'Draft has not started yet', recommended: false };
      }
      return { status: 'Draft complete · review the board', recommended: false };
    case 'lineup': {
      // Before the draft finishes the roster is empty, so every starting slot
      // reads empty and a recommendation would nag about a lineup nobody can
      // set yet (#1979 L25). Recommend only while the season is live.
      if (phase === LEAGUE_PHASE.PRE_DRAFT || phase === LEAGUE_PHASE.DRAFTING) {
        return { status: 'Lineups open after the draft', recommended: false };
      }
      if (seasonLive && attention && (attention.emptyStarterSlots > 0 || attention.startersOnBye.length > 0)) {
        return { status: lineupRecommendationCopy(attention), recommended: true };
      }
      return {
        status: weekLabel ? `Set your ${weekLabel} lineup` : 'Set your lineup',
        recommended: false,
      };
    }
    case 'game-center':
      return {
        status: weekLabel ? `${weekLabel} live scores` : 'Live scores and matchups',
        recommended: false,
      };
    case 'pickem':
      return {
        status: weekLabel ? `${weekLabel} picks lock at kickoff` : 'Make your weekly picks',
        // Parity with today's highlight: a pick'em-only league in season points
        // at Pick'em the way a drafting league points at the Draft Room.
        recommended: pickemOnly && seasonLive,
      };
    case 'waivers':
      if (transactionsLocked) {
        return { status: TRANSACTIONS_LOCKED_COPY, recommended: false };
      }
      return { status: 'Claim free agents and place bids', recommended: false };
    case 'trades':
      // Lock first, then deadline: that is the order trade.service.js answers
      // in, so the card names the refusal the server would actually give.
      if (transactionsLocked) {
        return { status: TRANSACTIONS_LOCKED_COPY, recommended: false };
      }
      if (tradeDeadlinePassed(week, tradeDeadlineWeek)) {
        return { status: `Trade deadline passed · week ${tradeDeadlineWeek}`, recommended: false };
      }
      return { status: 'Propose and review trades', recommended: false };
    case 'activity':
      return { status: 'Recent roster and league moves', recommended: false };
    case 'power-rankings':
      return { status: 'See where your team stacks up', recommended: false };
    case 'history':
      return { status: 'Past seasons and champions', recommended: false };
    case 'rules':
      return { status: 'Scoring and roster settings', recommended: false };
    case 'draft-settings':
      return { status: 'Configure the upcoming draft', recommended: false };
    default:
      return { status: '', recommended: false };
  }
}

export function useQuickActions(leagueId) {
  const { league } = useLeague(leagueId);
  const pickemOnly = isPickemOnly(league);
  const isCommissioner = !!league?.is_commissioner;
  const phase = league ? deriveLeaguePhase(league) : null;
  const seasonLive = isSeasonLive(league);
  const week = league?.current_week ?? null;
  // Both ride on the league row this hook already holds (SELECT leagues.*), so
  // the refusal states cost no request.
  const transactionsLocked = !!league?.transactions_locked;
  const tradeDeadlineWeek = league?.trade_deadline_week ?? null;

  // The one sanctioned extra read, for the Set Lineup recommendation. Skipped
  // for a pick'em-only league (Set Lineup is hidden there) and until the league
  // and its week are known. It ignores the read's `error`: a failed read and a
  // loading one both mean "no recommendation yet" (best effort), which is a
  // decision, not an oversight.
  const { lineup } = useTeamLineup(
    leagueId != null && !pickemOnly ? leagueId : null,
    week,
  );

  // Attention signals only once the lineup read has resolved. Fed `entries`, not
  // `starters`, for the reason My Team gives: a spent row keeps its original
  // starting slot and must count as filled.
  const attention = lineup
    ? lineupAttention({
        rosterSlots: rosterSlotsOf(league),
        entries: lineup.entries.map((e) => ({ slot: e.slot, onBye: e.onBye })),
      })
    : null;

  const ctx = {
    phase, pickemOnly, seasonLive, week, attention, transactionsLocked, tradeDeadlineWeek,
  };

  // Resolve each group: filter cards this league/viewer cannot see, attach copy
  // and recommendation, drop empty groups. `count` is the visible-card count the
  // group label carries.
  const groups = GROUPS.map((group) => {
    const cards = group.links
      .filter((link) => !(link.fantasyOnly && pickemOnly))
      .filter((link) => !(link.commissionerOnly && !isCommissioner))
      .filter((link) => !link.phases || link.phases.includes(phase))
      .map((link) => {
        const { status, recommended } = describeCard(link.key, ctx);
        return {
          key: link.key,
          label: link.label,
          href: leagueId != null ? `/league/${leagueId}/${link.slug}` : null,
          status,
          recommended,
        };
      });
    return { label: group.label, count: cards.length, cards };
  }).filter((group) => group.count > 0);

  return { ready: league != null, groups };
}

export default useQuickActions;
