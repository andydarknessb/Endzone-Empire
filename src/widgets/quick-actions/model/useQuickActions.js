import { useEffect, useState } from 'react';
import apiClient from '../../../api/apiClient';
import { useLeague } from '../../../hooks/useLeague';
import { deriveLeaguePhase, isSeasonLive, LEAGUE_PHASE } from '../../../lib/leaguePhase';
import { isPickemOnly } from '../../../lib/leagueType';
import { lineupAttention } from '../../../lib/lineupAttention';

/**
 * Data model for the quick-actions widget (League Dashboard, ticket #643): the
 * grouped action cards below the main grid (Play / Moves / League), each card a
 * link to an existing league sub-route with a line of status copy, and the cards
 * that deserve attention carrying a "Recommended" pill.
 *
 * Almost every card's status copy is CHEAP and LOCAL: it comes from the league
 * row the page already holds (phase and current week) or is a fixed descriptive
 * line. The one sanctioned extra read is the viewer's roster, used only for the
 * Set Lineup recommendation.
 *
 *   - The roster read is `/api/team/roster?leagueId=N`, on the service-worker
 *     allowlist (public/service-worker.js). It is a plain useEndpoint read, NOT
 *     a shared useResource resource, because this widget is the SINGLE mount of
 *     that URL on the League Dashboard (ADR 0004: cache through useResource when
 *     the GET is on the allowlist AND read by more than one mount per typical
 *     navigation - here only the first half holds). If a second consumer of the
 *     roster read ever lands on this page, move it to useResource, the way the
 *     league read already is.
 *   - The recommendation is BEST EFFORT and never an error state: a roster read
 *     that fails (or is still loading) simply yields no recommendation and the
 *     Set Lineup card renders its plain copy. It is skipped entirely for a
 *     pick'em-only league, which has no lineup (the Set Lineup card is hidden
 *     there), so the read never fires.
 *
 * The empty-starting-slot count and starters-on-bye come from the shared
 * lineupAttention helper (src/lib/lineupAttention.js), the SAME implementation
 * the lineup screen's warning banner reads, so the dashboard's recommendation
 * and the lineup screen can never disagree about whether a manager is set. This
 * widget supplies the "on bye" predicate the helper leaves to its caller:
 * `bye_week === current_week` on each roster row (the roster route annotates
 * every row with its NFL team's bye for the league's current season).
 */

// The action catalog, grouped by intent. Mirrors the legacy dashboard's
// NAV_GROUPS (slug -> /league/:id/<slug>) so destinations carry over unchanged.
// `fantasyOnly` cards have no surface in a pick'em-only league (no draft,
// rosters or matchups); `commissionerOnly` cards need the league's commissioner
// flag. A group with nothing left after filtering is dropped.
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
      { key: 'draft-settings', label: 'Draft Settings', slug: 'draft-settings', fantasyOnly: true, commissionerOnly: true },
    ],
  },
];

const IDLE = { status: 'loading', data: null };

// One GET bound to a URL, tracking loading -> ready | error. A null url never
// fetches. This widget's own copy of the useEndpoint convention (useEndpoint has
// diverged across the dashboard widgets, #669): it needs only ready-vs-not and
// the payload, never the failure's status code, because a failed roster read and
// a loading one both mean "no recommendation yet".
function useEndpoint(url) {
  const [state, setState] = useState(IDLE);
  useEffect(() => {
    if (!url) {
      setState(IDLE);
      return undefined;
    }
    let cancelled = false;
    setState(IDLE);
    apiClient
      .get(url)
      .then((res) => {
        if (!cancelled) setState({ status: 'ready', data: res?.data ?? null });
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'error', data: null });
      });
    return () => {
      cancelled = true;
    };
  }, [url]);
  return state;
}

// The league's starting-slot config, as the lineupAttention helper wants it.
// `roster_slots` rides on the league row (SELECT leagues.*); it is jsonb, so it
// arrives parsed, but a string is tolerated defensively. When it is absent the
// helper reads 0 empty slots (nothing to compare a fill against) while byes
// still register off the default starter order.
function rosterSlotsOf(league) {
  const raw = league?.roster_slots;
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
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

// Per-card status copy + whether it is Recommended, from local signals only.
// `attention` is null unless the roster read has resolved.
function describeCard(key, ctx) {
  const { phase, pickemOnly, seasonLive, week, attention } = ctx;
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
      if (attention && (attention.emptyStarterSlots > 0 || attention.startersOnBye.length > 0)) {
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
      return { status: 'Claim free agents and place bids', recommended: false };
    case 'trades':
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
  const { league, viewerTeamId } = useLeague(leagueId);
  const pickemOnly = isPickemOnly(league);
  const isCommissioner = !!league?.is_commissioner;
  const phase = league ? deriveLeaguePhase(league) : null;
  const seasonLive = isSeasonLive(league);
  const week = league?.current_week ?? null;

  // The one sanctioned extra read, for the Set Lineup recommendation. Skipped
  // for a pick'em-only league (Set Lineup is hidden there) and until the league
  // id is known.
  const rosterUrl =
    leagueId != null && !pickemOnly ? `/api/team/roster?leagueId=${leagueId}` : null;
  const roster = useEndpoint(rosterUrl);

  // Attention signals only once the roster read has resolved; a failed or
  // pending read yields no recommendation (best effort).
  let attention = null;
  if (roster.status === 'ready') {
    const rows = Array.isArray(roster.data) ? roster.data : [];
    const entries = rows.map((row) => ({
      slot: row.lineup_slot,
      onBye: row.bye_week != null && Number(row.bye_week) === Number(week),
    }));
    attention = lineupAttention({ rosterSlots: rosterSlotsOf(league), entries });
  }

  const ctx = { phase, pickemOnly, seasonLive, week, attention };

  // Resolve each group: filter cards this league/viewer cannot see, attach copy
  // and recommendation, drop empty groups. `count` is the visible-card count the
  // group label carries.
  const groups = GROUPS.map((group) => {
    const cards = group.links
      .filter((link) => !(link.fantasyOnly && pickemOnly))
      .filter((link) => !(link.commissionerOnly && !isCommissioner))
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

  return { ready: league != null, viewerTeamId, groups };
}

export default useQuickActions;
