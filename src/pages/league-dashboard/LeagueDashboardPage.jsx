import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Box, useMediaQuery, useTheme } from '@mui/material';
import { useLeague } from '../../hooks/useLeague';
import { ErrorPanel, MENU_PANEL_VARS, psRootSx } from '../../shared/ui/playselect';
import CopyInvite from '../../features/copy-invite';
import MyTeamSummary from '../../widgets/my-team-summary';
import StandingsTable from '../../widgets/standings-table';
import CommissionerStrip from '../../widgets/commissioner-strip';
import AroundTheLeague from '../../widgets/around-the-league';
import RecentActivity from '../../widgets/recent-activity';
import QuickActions from '../../widgets/quick-actions';
import { useMatchupPreview } from '../../widgets/matchup-preview';
import { applyScoreEvent, useLiveScores, useWeekMatchups } from '../../entities/matchup';
import { useActionItems, itemType, lineupProblemFor, playModel } from '../../entities/action-item';
import { adviceNote, useAdvice } from '../../entities/roster';
import { usePickemSettings } from '../../entities/pickem-game';
import { useTrophies } from '../../components/TrophyCase/TrophyCase';
import {
  applyTeamProfileUpdate,
  subscribeToTeamProfileUpdates,
} from '../../lib/teamProfileEvents';
import {
  deriveLeaguePhase,
  useNow,
  isSeasonLive,
  LEAGUE_PHASE,
  LEAGUE_PHASE_META,
  isPickemOnly,
} from '../../shared/lib';
import ChatLauncher, { ChatLaunchButton, useChatLauncher } from './ui/ChatLauncher';
import DraftDay from './ui/DraftDay';
import PageHead from './ui/PageHead';
import { DashboardLoading, DashboardUnavailable } from './ui/PageStates';
import PickemPanel from './ui/PickemPanel';
import PickemStandings from './ui/PickemStandings';
import RecapPanel from './ui/RecapPanel';
import { TrophyRoom, TrophyLink } from '../../widgets/trophy-room';
import VersusPanel from './ui/VersusPanel';
import YourMove from './ui/YourMove';

// Several widgets on this page render null (a member's commissioner strip, a league with no recap, a
// pick'em panel with no row yet), and a wrapper that outlives its content still takes a turn in the
// shell's stack: blank bands came from exactly that. `:empty` matches a wrapper whose child rendered
// nothing, so the gap it would have bought collapses with it.
const EMPTY_HIDDEN_SX = { '&:empty': { display: 'none' } };

// Your move's controls and the foot each one renders. A one-foot card is one link whose foot is a span
// holding the label; a foot of a shared lock is a link that is its label. A focus carry matches on the
// label, not the accessible name: the card's name gains a countdown once its lock turns urgent.
const MOVE_CONTROL = 'a[href], button';
const footLabelOf = (control, labels) => labels.find((label) => (
  [control, ...control.querySelectorAll('*')].some((el) => el.textContent.trim() === label)
)) ?? null;
const controlsLabelled = (host, labels, label) => [...host.querySelectorAll(MOVE_CONTROL)]
  .filter((el) => footLabelOf(el, labels) === label);

// Try again (item 4 of #2990): the danger panel's button leaves the DOM when the read restarts, and the placeholder
// when it settles, so focus follows the slot. The press sets `retryFocus`; the child the press draws (keyed by its
// state, so it mounts fresh) takes focus: the placeholder while the read is out, else the frame or the panel's button.
// A child unmounted with focus inside the slot leaves `retryFocus` set, so the child that replaces it moves focus on
// only then. Focus that went elsewhere clears it.
// The host is this component's own element, so its ref is attached before this effect runs, even when the slot mounts in
// the same commit (a parent's ref is not, which crashed a game-day retry).
function FocusFollow({ retryFocus, children }) {
  const wrapRef = useRef(null);
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (retryFocus.current) {
      const pending = el.querySelector('[data-testid="your-move-pending"]');
      if (pending) pending.focus();
      else {
        retryFocus.current = false;
        (el.querySelector('[data-testid="your-move"]') ?? el.querySelector('button'))?.focus();
      }
    }
    return () => {
      if (retryFocus.current) retryFocus.current = el.contains(document.activeElement);
    };
  }, [retryFocus]);
  return <Box ref={wrapRef} sx={{ display: 'contents' }}>{children}</Box>;
}

// Your move changes parent when a lock crosses one hour (the hero, then the top of the page), so React
// remounts its controls and the focused one leaves the DOM with focus on the body. The old copy records
// which foot held focus in its layout cleanup, while its DOM is still there; the new copy focuses the foot
// with that label (the nth one, when a label repeats). Focus that was never inside Your move is not carried.
function YourMoveSlot({
  carry, labels, retryFocus, kind, children,
}) {
  const hostRef = useRef(null);
  const labelsRef = useRef(labels);
  useLayoutEffect(() => { labelsRef.current = labels; });
  useLayoutEffect(() => () => {
    const host = hostRef.current;
    const active = document.activeElement;
    if (!host || !active || !host.contains(active) || !active.matches(MOVE_CONTROL)) return;
    const label = footLabelOf(active, labelsRef.current);
    if (label) carry.current = { label, index: controlsLabelled(host, labelsRef.current, label).indexOf(active) };
  }, [carry]);
  useLayoutEffect(() => {
    const next = carry.current;
    carry.current = null;
    if (!next) return;
    const matches = controlsLabelled(hostRef.current, labelsRef.current, next.label);
    matches[Math.min(next.index, matches.length - 1)]?.focus();
  }, [carry]);
  return (
    <Box component="section" ref={hostRef} data-testid="slot-your-move" sx={{ minWidth: 0 }}>
      <FocusFollow key={kind} retryFocus={retryFocus}>{children}</FocusFollow>
    </Box>
  );
}

/**
 * League Dashboard page slice (ADR 0020), on the `/league/:leagueId` route since the cutover ticket
 * (#645), on the Play-select look since ADR 0067 wave 1b (#2330). Every state of the approved canvas
 * (docs/design/league/: Main, GameDay, GameDaySet, MainPhone, GameDayPhone, PreDraft, Drafting,
 * Complete, PickemOnly, States) is composed here from the widgets, the features and the page's own
 * Play-select views, and nothing here reads an island token.
 *
 * The head (the league name in Pixel 32, the chip row, "Times in CDT", for a commissioner the
 * Invite control, and below sm the chat button) leads every state. Then the page's product order, which the canvas rulings fix:
 *
 *   - Your move leads: this league's open plays, the one cursor and the one filled action (`ui/YourMove`).
 *     With nothing due it is a calm "You're set" card ("No team in this league" for a viewer with no Team in a league that has Teams);
 *     while its read is in flight a placeholder holds the place. Off game day it is the first row of the page.
 *   - Off game day, the hero follows Your move, with one row in between: in season the League pages row
 *     (Play and Moves); before the draft the pre-draft countdown (Draft Day) once the draft has a date. The
 *     hero is the Matchup (a framed versus panel before kickoff, the Board-black scoreboard once started)
 *     beside My team, with the Pick'em panel under the matchup on a fantasy plus pick'em league in season.
 *   - The commissioner strip, in its own row (it renders nothing for a member), follows the hero in every
 *     fantasy phase.
 *   - The weekly recap (when one exists), Around the league, standings beside Recent activity, and the
 *     Playbook. In season the Playbook is one link row that ends in the trophy case once the league has
 *     trophies; a completed league moves its trophy room up under Your move and keeps the Playbook frame.
 *   - Game day (the viewer's matchup is live) moves the top, in two shapes. With nothing urgent the live
 *     scoreboard leads: Your move sits in the hero between the matchup and My team, and the League pages row
 *     follows the hero. With an urgent item, or a failed items read, Your move and the League pages row lead,
 *     then the hero (the scoreboard, then My team at full width, then the Pick'em panel). Around the league
 *     and Recent activity fold to the three rival games and three rows.
 *   - A pick'em-only league has no fantasy team, matchups or draft, so none of those slices mount (each
 *     would fire a fantasy read that returns an empty or zeroed table): its body is Your move, the pick'em
 *     standings, the commissioner strip, the Playbook trimmed to the pick'em surfaces and the trophy case.
 *
 * Three pieces of the dashboard are shared with later-wave pages, so the dashboard renders its own
 * Play-select view over their model and they keep their look elsewhere until their wave: the matchup
 * (`useMatchupPreview`, Lineup page), the pick'em standings (`usePickemStandingsTable`, Pick'em page)
 * and the recap, trophy case and draft countdown (`useRecap`, `useTrophies`, the Countdown `blocks`
 * variant).
 *
 * The page reads the league through the shared cache (useLeague / ADR 0004), so a subpage reached from
 * here reuses the same payload. Everything phase-shaped derives from the client League-phase helper
 * (src/shared/lib/leaguePhase.js), never from a stored status field: that keeps a single source of
 * phase truth across the widget slices.
 *
 * Team identity is live: a team-profile update (a rename or new avatar published by another manager's
 * session) is written through into the cached league's teams[], so the standings rows and my-team card
 * re-render without a second league GET. teamName is the canonical display field the widgets read
 * (teamIdentity.js), not the raw `name` column the route leaks beside it, so the write-through targets
 * teamName; the avatar rides the snake_case columns the league-detail route serializes.
 *
 * The page paints the Play-select token context (ps-field / ps-ink, the Archivo body face) on a
 * `.ps-root` element, which also scopes the focus ring, the cursor blink and the hover rules.
 */
export default function LeagueDashboardPage() {
  const { leagueId } = useParams();
  const {
    league, teams, viewerTeamId, loading, refetch, updateTeams,
  } = useLeague(leagueId);

  // Live team identity: patch a rename or new avatar into the shared league membership so every
  // consumer reading teams[] reflects it with no request. Deleting this subscription pins a renamed or
  // re-avatared Team to its stale name/picture until the 60s league-cache TTL lapses and a navigation
  // refetches. Matched on teamId. BOTH name columns are patched: the widget slices read the canonical
  // `teamName`, but CommissionerTools composes as-is off the same teams[] and renders the raw `name`
  // column (menu items, the removable-teams list, the remove dialog), so patching only teamName would
  // leave a rename stale in the commissioner panel where the legacy page kept it live. The avatar rides
  // the snake_case columns the widgets read.
  useEffect(
    () => subscribeToTeamProfileUpdates((update) => {
      if (Number(update.leagueId) !== Number(leagueId)) return;
      updateTeams((prev) => prev.map((team) => {
        const withRawName = applyTeamProfileUpdate(team, update, {
          id: 'teamId',
          avatarUrl: 'avatar_url',
          avatarStaticUrl: 'avatar_static_url',
        });
        return applyTeamProfileUpdate(withRawName, update, {
          id: 'teamId',
          name: 'teamName',
          avatarUrl: 'avatar_url',
          avatarStaticUrl: 'avatar_static_url',
        });
      }));
    }),
    [leagueId, updateTeams]
  );

  // First load blanks the page; once the league is on screen a background reload keeps it mounted
  // (the shared cache serves the row it already has).
  if (!league && loading) {
    return (
      <Shell>
        <DashboardLoading />
      </Shell>
    );
  }

  // A failed league read is a dead end for the whole route, so it gets the same h1 the loaded page
  // has, one alerted sentence and a way out, rather than a bare line of error text with nothing to do
  // next. The sentence is fixed and the server's string is deliberately not on screen: useResource
  // collapses the server's `error` field and the transport's own `err.message` into one value
  // (useResource.js:62), so keeping "the server's message" would also put an axios internal ("Network
  // Error") in front of a manager. `refetch` invalidates the shared league key, so every mount on this
  // league reloads from the one request it starts.
  if (!league) {
    return (
      <Shell>
        <DashboardUnavailable onRetry={() => refetch()} />
      </Shell>
    );
  }

  return (
    <Shell chatLauncher>
      <DashboardBody leagueId={leagueId} league={league} teams={teams} viewerTeamId={viewerTeamId} />
    </Shell>
  );
}

/**
 * The loaded dashboard. A component of its own so the reads the layout depends on (the viewer's
 * matchup, the week's matchups, the pick'em settings and the trophies) are hooks called once the
 * league is known, and a pick'em-only league can be kept off the fantasy reads by passing them null.
 */
function DashboardBody({
  leagueId, league, teams, viewerTeamId,
}) {
  const theme = useTheme();
  const phone = useMediaQuery(theme.breakpoints.down('sm'), { noSsr: true });
  // Set by Recent activity once its feed resolves short of the standings (#1998); false while loading,
  // so the row starts two columns.
  const [feedShort, setFeedShort] = useState(false);
  // The viewer's standings row, reported up by the standings table it already reads (no second request): the Trophy room's "Your season" line.
  const [viewerRow, setViewerRow] = useState(null);
  const chat = useChatLauncher();

  const phase = deriveLeaguePhase(league);
  const phaseLabel = LEAGUE_PHASE_META[phase]?.label ?? '';
  const pickemOnly = isPickemOnly(league);
  const fantasy = !pickemOnly;
  const preDraft = phase === LEAGUE_PHASE.PRE_DRAFT;
  const complete = phase === LEAGUE_PHASE.COMPLETE;
  const seasonLive = isSeasonLive(league);
  const week = league.current_week;
  const hasTeam = viewerTeamId != null;
  // "Week N · <phase label>" while the season is being played (the neutral chip); the bare phase label
  // otherwise (pre-draft, drafting, complete). The draft is done for a fantasy league in every phase
  // past drafting, read from the helper's phase, never the raw draft_status column.
  const phaseChipLabel = seasonLive && week != null ? `Week ${week} · ${phaseLabel}` : phaseLabel;
  const draftComplete = fantasy && phase !== LEAGUE_PHASE.PRE_DRAFT && phase !== LEAGUE_PHASE.DRAFTING;

  // The matchup the page leads with, read once: the pre-kickoff panel, the scoreboard and the game-day
  // order all come from it. A pick'em-only league has no fantasy matchups, so it never reads them.
  // The League's live score feed, subscribed to once here: it moves the scoreboard, the head's live count
  // and the Advance control's readiness with no polling. A reconnect re-reads the week's matchups (the
  // cache key the scoreboard, the strip and the live count share), since events missed while away never
  // arrive.
  const weekMatchups = useWeekMatchups(fantasy ? leagueId : null, week);
  const { scoreEvent } = useLiveScores({ leagueId: fantasy ? leagueId : null, refetch: () => weekMatchups.refetch() });
  const matchup = useMatchupPreview(fantasy ? leagueId : null, { scoreEvent });
  const scored = Array.isArray(scoreEvent?.scored) ? scoreEvent.scored : [];
  const liveCount = weekMatchups.matchups
    .map((m) => {
      const entry = scored.find((e) => e.matchupId === m.id);
      return entry ? applyScoreEvent(m, entry) : m;
    })
    .filter((m) => m.status === 'live').length;
  const gameDay = fantasy && matchup.status === 'ready' && matchup.game.isLive === true;
  // "As of": the later of when the week's matchups were last read (the data's own completion time, so a
  // cached remount is not stamped as current) and the last event for this week that touched the viewer's
  // matchup. It is settled in the render the event arrives in (not an effect after it), so the scoreboard's
  // announcement and its stamp land together; the time is kept per league, so changing leagues starts clean.
  const stamp = useRef({ leagueId, event: null, at: null });
  if (stamp.current.leagueId !== leagueId) stamp.current = { leagueId, event: null, at: null };
  if (stamp.current.event !== scoreEvent) {
    const touchesViewer = scoreEvent
      && Number(scoreEvent.week) === Number(week)
      && scored.some((entry) => entry.matchupId === matchup.matchupId);
    stamp.current = { leagueId, event: scoreEvent, at: touchesViewer ? Date.now() : stamp.current.at };
  }
  const eventAt = stamp.current.at;
  const asOf = matchup.status === 'ready' ? Math.max(weekMatchups.readAt ?? 0, eventAt ?? 0) || null : null;

  const pickemSettings = usePickemSettings(fantasy ? leagueId : null);
  const showPickem = fantasy && seasonLive && pickemSettings.settings?.enabled === true;

  const trophy = useTrophies(leagueId);
  const trophyCount = !trophy.loading && !trophy.error ? trophy.visibleTrophies.length : 0;

  // Your move: this league's open plays from the user's action items (GET /api/user/action-items), the
  // page's one cursor and one filled action. The entity groups them (one Play per shared lock, earliest
  // first); this maps each card to ui/YourMove's plain data. While the read is in flight with nothing cached,
  // its frame holds the place as a placeholder (a "You're set" that then turns into a card would lie). A
  // completed league draws no placeholder, and with nothing due no card at all: the board has none.
  const actions = useActionItems();
  const clock = useNow((at) => at + 30 * 1000);
  const move = useMemo(
    () => playModel(actions.items, { leagueId, now: clock }),
    [actions.items, leagueId, clock]
  );
  const isLineup = (item) => itemType(item) === 'lineup_problem';
  const carriesLineup = move.plays.some((play) => play.feet.some(isLineup));
  const leadCarriesLineup = Boolean(move.lead && move.lead.feet.some(isLineup));
  // The lead lineup card names every move the Forecast would make behind its gain ("Two moves · +23.0 pts:
  // Addison in for Puka Nacua (Out) · Spears into the empty FLEX"). No move, no note (the item's own detail reads).
  const advice = useAdvice({
    leagueId: leadCarriesLineup ? leagueId : null,
    week,
    bestBall: Boolean(league.best_ball),
  });
  const swapNote = leadCarriesLineup ? adviceNote(advice) ?? undefined : undefined;
  const toCard = (play, note) => ({ name: play.name, feet: play.feet, ...(note ? { note } : null) });
  let yourMove = null;
  // Cached items stay on screen while they re-read, so the card does not vanish and jump on a revisit.
  const itemsPending = actions.loading && actions.items.length === 0;
  if (itemsPending) {
    if (!complete) yourMove = { pending: true };
  } else if (!actions.error) {
    if (!move.empty) {
      yourMove = {
        lead: toCard(move.lead, swapNote),
        rest: move.plays.slice(1).map((play) => toCard(play)),
        badge: move.count,
        urgent: move.urgent,
      };
    } else if (!complete) {
      // A pick'em-only league has no Teams to be on, so its calm card stays "You're set".
      yourMove = { empty: true, urgent: false, noTeam: !hasTeam && !pickemOnly };
    }
  }
  // My team's lineup answer: this season-week's lineup_problem item, null for none, undefined while the read is unknown.
  const lineupProblem = itemsPending || actions.error
    ? undefined
    : lineupProblemFor(actions.items, { leagueId, season: league.current_season, week }) ?? null;
  // It sits right under the head; on game day with nothing locking inside the hour the live scoreboard
  // leads and it follows the scoreboard instead.
  const yourMoveOnTop = yourMove != null && (!gameDay || yourMove.urgent === true);
  const focusCarry = useRef(null);
  const footLabels = yourMove?.lead
    ? [yourMove.lead, ...yourMove.rest].flatMap((card) => card.feet.map((foot) => foot.cta?.label)).filter(Boolean)
    : [];
  // Try again sets this before it reloads, so the slot that the press draws takes focus (see YourMoveSlot).
  const retryFocus = useRef(false);
  const tryAgain = () => {
    retryFocus.current = true;
    actions.reload();
  };
  const yourMoveNode = yourMove && (
    <YourMoveSlot kind={yourMove.pending ? 'pending' : 'move'} carry={focusCarry} labels={footLabels} retryFocus={retryFocus}>
      <YourMove {...yourMove} inviteCode={league.invite_code} />
    </YourMoveSlot>
  );
  // A carry belongs to the commit that unmounted its control. The slot that remounts it in that commit has
  // already taken it (a child's layout effects run before its parent's), so a commit that remounts nothing drops it.
  useLayoutEffect(() => { focusCarry.current = null; });
  const yourMoveFailed = !itemsPending && actions.error && !complete && (
    <YourMoveSlot kind="failed" carry={focusCarry} labels={footLabels} retryFocus={retryFocus}>
      <ErrorPanel
        title="Couldn't check what needs you"
        body="Your league is below. Open each page, or try again."
        onRetry={tryAgain}
        retryAriaLabel="Try checking your plays again"
      />
    </YourMoveSlot>
  );

  const showHero = fantasy && !complete;
  const showDraftDay = fantasy && preDraft && Boolean(league.draft_date);
  // On a phone the head has no room for the Invite control on game day: it moves into the strip.
  const inviteInStrip = gameDay && phone;
  const invite = league.invite_code ? <CopyInvite code={league.invite_code} /> : null;
  // Below sm the Chat button shares the head's right slot with the Invite control; on game-day phones the
  // Invite is in the strip, so Chat is alone there. From sm the head keeps only the Invite.
  const headInvite = inviteInStrip ? null : invite;
  const headRight = phone
    ? <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '12px' }}>{headInvite}<ChatLaunchButton chat={chat} /></Box>
    : headInvite;

  const chips = [];
  if (phaseChipLabel) chips.push(phaseChipLabel);
  // A completed league's head is the phase chip alone (spec #2921): the count and the draft are the Trophy room's story now.
  if (!seasonLive && !complete && !pickemOnly) chips.push(`${teams.length} Teams`);
  if (!seasonLive && !complete && draftComplete) chips.push('Draft Complete');

  // The Playbook says each destination once: what another frame on this page already links is dropped. In
  // season the Play and Moves links live in the League pages row under Your move, for every viewer.
  const omit = [];
  if (fantasy) {
    if (seasonLive || showDraftDay) omit.push('draft');
    if (seasonLive || (hasTeam && showHero)) omit.push('lineup', 'waivers', 'trades');
    if (seasonLive) omit.push('game-center', 'pickem');
    omit.push('activity');
  }
  const foldPlaybook = fantasy && seasonLive;
  const trailing = foldPlaybook && trophyCount > 0
    ? [{ key: 'trophies', label: `Trophy case (${trophyCount})`, to: `/league/${leagueId}/trophies` }]
    : undefined;

  const commissionerStrip = (
    <Box component="section" data-testid="slot-commissioner-strip" sx={EMPTY_HIDDEN_SX}>
      <CommissionerStrip leagueId={leagueId} invite={inviteInStrip ? invite : undefined} scoreEvent={scoreEvent} onAdvanced={actions.reload} />
    </Box>
  );

  const matchupSlot = (
    <Box data-testid="slot-matchup-preview" sx={{ display: 'grid', gridArea: gameDay ? undefined : 'v' }}>
      <VersusPanel leagueId={leagueId} model={matchup} asOf={asOf} />
    </Box>
  );
  const myTeamSlot = hasTeam && (
    <Box data-testid="slot-my-team" sx={{ display: 'grid', gridArea: gameDay ? undefined : 'm', ...EMPTY_HIDDEN_SX }}>
      <MyTeamSummary leagueId={leagueId} wide={gameDay} fixLineup={!carriesLineup} lineupProblem={lineupProblem} />
    </Box>
  );
  const pickemSlot = showPickem && (
    <Box data-testid="slot-pickem-panel" sx={{ gridArea: gameDay ? undefined : 'p', ...EMPTY_HIDDEN_SX }}>
      <PickemPanel leagueId={leagueId} week={week} />
    </Box>
  );

  // The hero: the matchup beside My team, the Pick'em panel under the matchup so both columns end
  // level; one column when the viewer has no Team of their own. On game day the same three pieces run
  // full width, one under the other.
  const hero = showHero && (
    <Box
      component="section"
      data-testid="dashboard-hero"
      sx={gameDay
        ? { display: 'flex', flexDirection: 'column', gap: { xs: '24px', sm: '32px' } }
        : {
          display: 'grid',
          gap: '24px',
          alignItems: 'stretch',
          gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: hasTeam ? 'minmax(0, 1.2fr) minmax(0, 1fr)' : 'minmax(0, 1fr)' },
          // Only the areas that render get a row, so no empty track adds a gap or soaks up the stretch.
          gridTemplateAreas: {
            xs: ['"v"', hasTeam && '"m"', showPickem && '"p"'].filter(Boolean).join(' '),
            md: hasTeam
              ? (showPickem ? '"v m" "p m"' : '"v m"')
              : ['"v"', showPickem && '"p"'].filter(Boolean).join(' '),
          },
          gridTemplateRows: { md: hasTeam && showPickem ? '1fr auto' : undefined },
        }}
    >
      {matchupSlot}
      {gameDay && !yourMoveOnTop && yourMoveNode}
      {myTeamSlot}
      {pickemSlot}
    </Box>
  );

  const recap = fantasy && (
    <Box component="section" data-testid="slot-recap" sx={EMPTY_HIDDEN_SX}>
      <RecapPanel leagueId={leagueId} />
    </Box>
  );

  const around = fantasy && !complete && (
    // `contain: paint` closes the ink overflow of the scroller inside (measured in Chromium at 390: the
    // document went 684 wide with nothing visibly broken; plain overflow clip did not close it).
    <Box component="section" data-testid="slot-around-the-league" sx={{ minWidth: 0, contain: 'paint', ...EMPTY_HIDDEN_SX }}>
      <AroundTheLeague leagueId={leagueId} />
    </Box>
  );

  // Standings beside Recent activity; a feed too short to fill its column stacks under the standings.
  const main = fantasy && (
    <Box
      component="section"
      data-testid="dashboard-main"
      sx={{
        display: 'grid',
        gap: '24px',
        gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: feedShort ? 'minmax(0, 1fr)' : 'minmax(0, 1.55fr) minmax(0, 1fr)' },
        alignItems: gameDay ? 'start' : 'stretch',
      }}
    >
      <Box data-testid="slot-standings" sx={{ minWidth: 0, display: 'grid', contain: 'paint' }}>
        <StandingsTable leagueId={leagueId} onViewerRow={setViewerRow} />
      </Box>
      <Box data-testid="dashboard-rail" sx={{ minWidth: 0, display: 'grid' }}>
        <Box data-testid="slot-recent-activity" sx={{ display: 'grid' }}>
          <RecentActivity
            leagueId={leagueId}
            rowLimit={gameDay ? 3 : Math.ceil((teams.length * 3) / 4)}
            compact={!feedShort}
            onFeedShort={setFeedShort}
          />
        </Box>
      </Box>
    </Box>
  );

  // The Playbook: one frame of play tiles, or in season one line of links that ends in the trophy case.
  const playbook = (
    <Box component="section" data-testid="dashboard-quick-actions" sx={EMPTY_HIDDEN_SX}>
      <QuickActions leagueId={leagueId} omit={pickemOnly ? [] : omit} variant={foldPlaybook ? 'row' : 'frame'} trailing={trailing} />
    </Box>
  );

  // In season the Play and Moves links are a second row right under Your move: the Draft Room is over, and
  // Pick'em is in it only on a league with pick'em on.
  const leaguePages = foldPlaybook && (
    <QuickActions
      leagueId={leagueId}
      variant="row"
      name="League pages"
      lead={null}
      only={['Play', 'Moves']}
      omit={showPickem ? ['draft'] : ['draft', 'pickem']}
      testId="quick-actions-pages"
    />
  );
  // On game day with nothing urgent Your move sits inside the hero, so the row follows the hero instead.
  const pagesUnderHero = gameDay && !yourMoveOnTop && !yourMoveFailed;

  // The trophy case: the completed season's trophy room, or one link row (merged into the Playbook line
  // in season). It self-hides on an empty list, so a league with no trophies renders nothing.
  const trophies = (
    <Box component="section" data-testid="slot-trophy-case" sx={EMPTY_HIDDEN_SX}>
      {complete
        ? (
          <TrophyRoom
            trophy={trophy}
            teams={teams}
            viewerTeamId={viewerTeamId}
            standing={viewerRow && { ...viewerRow, season: league.current_season }}
          />
        )
        : !foldPlaybook && <TrophyLink leagueId={leagueId} count={trophyCount} />}
    </Box>
  );

  // The page's sections in order. They are keyed, so the layout can reorder them (game day puts the
  // scoreboard first) without remounting a widget and re-reading what it reads.
  let sections;
  if (pickemOnly) {
    // PICK'EM-ONLY BODY. A pick'em league has no fantasy team, matchups or draft, so the hero and
    // main-grid slices never mount: each of them (my-team, matchup, standings table, activity) fires a
    // fantasy read that would come back an empty or zeroed table. The pool standings stand in their place.
    sections = [
      ['your-move', yourMoveOnTop ? yourMoveNode : yourMoveFailed],
      ['pickem-standings', (
        <Box data-testid="dashboard-pickem-standings" sx={{ minWidth: 0, contain: 'paint' }}>
          <PickemStandings leagueId={leagueId} />
        </Box>
      )],
      ['strip', commissionerStrip],
      ['playbook', playbook],
      ['trophies', trophies],
    ];
  } else if (gameDay) {
    sections = [
      ['your-move', yourMoveOnTop ? yourMoveNode : yourMoveFailed],
      // Fixed slots, so the hero keeps its index when the row moves between the two positions (a shifted
      // index makes React move the hero's DOM and drop focus inside it). Each position has its own key.
      ['league-pages', pagesUnderHero ? null : leaguePages],
      ['hero', hero],
      ['league-pages-hero', pagesUnderHero ? leaguePages : null],
      ['strip', commissionerStrip],
      ['recap', recap],
      ['around', around],
      ['main', main],
      ['playbook', playbook],
      ['trophies', trophies],
    ];
  } else {
    sections = [
      ['your-move', yourMoveOnTop ? yourMoveNode : yourMoveFailed],
      ['league-pages', leaguePages],
      ['draft-day', showDraftDay && <DraftDay league={league} leagueId={leagueId} />],
      ...(complete ? [['trophies', trophies]] : []),
      ['hero', hero],
      ['strip', commissionerStrip],
      ['recap', recap],
      ['around', around],
      ['main', main],
      ['playbook', playbook],
      ...(complete ? [] : [['trophies', trophies]]),
    ];
  }

  return (
    <>
      <PageHead
        title={league.name}
        chips={chips}
        live={liveCount > 0 ? `${liveCount} ${liveCount === 1 ? 'matchup' : 'matchups'} live` : undefined}
        right={headRight}
      />

      {sections.map(([key, node]) => (node ? <React.Fragment key={key}>{node}</React.Fragment> : null))}

      {!phone && <ChatLaunchButton chat={chat} />}
      <ChatLauncher leagueId={leagueId} chat={chat} />
    </>
  );
}

/**
 * The page frame: the Play-select token context (Field ground, Ink text, the Archivo body face) on a
 * `.ps-root` element, plus the stacking gap between the head and the frames. Every state (loading,
 * error, loaded) renders inside it so the ground is constant.
 */
function Shell({ children, chatLauncher = false }) {
  return (
    <Box className="ps-root" sx={{ ...psRootSx, ...MENU_PANEL_VARS, minHeight: '100%' }}>
      {/* A column flex container, NOT a grid. A grid has one implicit `auto` track, so the widest
          min-content anywhere inside sets the document's width and a wide table inside a narrow
          viewport pushes every frame sideways. In a column flex container the automatic minimum
          applies to the block axis, so every child resolves to a zero inline minimum with no
          per-child `minWidth: 0` and no `minmax` to maintain. Only the loaded page renders the fixed
          chat launcher, and only from sm up, so only it reserves the launcher's clearance at the bottom. */}
      <Box
        data-testid="dashboard-shell"
        sx={{
          maxWidth: '1280px',
          marginX: 'auto',
          boxSizing: 'border-box',
          px: { xs: '16px', sm: '32px' },
          pt: { xs: '24px', sm: '40px' },
          // From sm the fixed launcher takes 80px of the viewport (56 + 24) and the page keeps 8px clear, so 88px minimum; 96 is the padding. Below sm the chat is in the head.
          pb: { xs: '24px', sm: chatLauncher ? '96px' : '64px' },
          display: 'flex',
          flexDirection: 'column',
          gap: { xs: '24px', sm: '32px' },
        }}
      >
        {children}
      </Box>
    </Box>
  );
}
