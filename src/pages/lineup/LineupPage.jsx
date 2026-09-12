import React, { useState } from 'react';
import { Link as RouterLink, useSearchParams } from 'react-router-dom';
import { Box, Button, FormControl, InputLabel, MenuItem, Select, Typography, useMediaQuery, useTheme } from '@mui/material';
import { Badge, Card, SegmentedControl, Skeleton, TeamAvatar } from '../../shared/ui';
import { useLeague } from '../../hooks/useLeague';
import { useLiveGameStates } from '../../entities/matchup';
import { deriveLeaguePhase, LEAGUE_PHASE } from '../../lib/leaguePhase';
import { computeByeClusters, worstByeCluster } from '../../shared/lib';
import PickWeek from '../../features/pick-week';
import LineupLedger from '../../widgets/lineup-ledger';
import TeamSummaryStrip from '../../widgets/team-summary-strip';
import MatchupPreview from '../../widgets/matchup-preview';
import StartSitPanel from '../../widgets/start-sit-panel';
import ByeClusterGrid from '../../widgets/bye-cluster';
import { useSwapPlayers, QuickPickMenu } from '../../features/swap-players';
import { useDropPlayer, DropConfirmationDialog } from '../../features/drop-player';
import { useApplyAdvice } from '../../features/apply-advice';
import PlayerDecisionCard from '../../widgets/player-decision-card';
import { useLineupLeagues } from './model/useLineupLeagues';
import { useLineupData } from './model/useLineupData';
import { useLiveScores } from './model/useLiveScores';
import { useAdvice } from './model/useAdvice';
import { readRequestedSwap, resolveRequestedSwap } from './model/requestedSwap';

const MIN_WEEK = 1;
const MAX_WEEK = 18;
const WEEKS = Array.from({ length: MAX_WEEK }, (_, i) => i + 1);

/**
 * The Lineup page slice (ADR 0037, #1237): replaces the legacy
 * `src/components/LineupScreen` (`LineupScreen`/`TeamLineup`), still mounted
 * at `/team` (App.jsx; the route itself does not change). Composes the
 * lineup-ledger and team-summary-strip widgets, the swap-players and
 * drop-player features, the existing pick-week feature and the existing
 * matchup-preview widget in the rail; every widget reads only `entities` and
 * `shared` (ADR 0020/0029). The page itself owns the one thing two slices
 * both need: the fetched lineup (`model/useLineupData.js`), handed down to
 * both the Ledger and the summary strip rather than each fetching it again.
 *
 * Ticket 6 (#1238) lands the advice tile and the phone Outlook tab: the
 * start-sit-panel widget and the apply-advice feature, both composed here,
 * plus a page-owned "Roster / Outlook" segmented control below `sm` that
 * shows either the Ledger (Starters/Bench, its own existing tab bar
 * unchanged) or the rail (start-sit-panel and matchup-preview, otherwise
 * hidden below `md`).
 *
 * Ticket 7 (#1239) stacks the bye-cluster widget's grid into the same
 * Outlook tab, under start-sit-panel, computed off `lineup.entries` with no
 * new endpoint (`shared/lib`'s `computeByeClusters`/`worstByeCluster` -
 * promoted there, not kept below the island, since it is domain-meaningful
 * and this page and the bye-cluster widget both reach it, ADR 0031). The
 * page and the widget each call that shared pure function independently
 * (the widget already holds the raw entries and computes its own grid); the
 * page's OWN answer is handed only to the team-summary-strip's attention
 * chip, which has no other way to reach a bye-cluster widget's internals.
 * Hidden entirely on a past week (`isPastWeek` below): a settled week is a
 * record, not an outlook.
 *
 * Deliberately deferred, per the issue's own scope: the live Game cell's
 * full Situation treatment (ticket 9 - this ticket's Game cell shows clock
 * and score only).
 *
 * The player name and the empty-roster "Browse Players" action - both
 * legacy controls this page dropped in an earlier revision with no
 * acceptance criterion authorising either - are restored (formal review
 * finding legacy-controls-dropped-without-a-criterion): the name reopens
 * the Decision card this page now owns (#1240, replacing the earlier
 * `PlayerQuickView` wiring here - that dialog itself is untouched and still
 * serves every other surface), and `emptyRoster` below gates a dedicated
 * empty state distinct from the draft-in-progress one. Team Record/Rank
 * stays dropped: it is reachable elsewhere (the Dashboard's
 * my-team-summary), and restoring it here would be new surface this page's
 * own criteria do not ask for. The per-row Trade control stays dropped too -
 * Trade now lives on the Decision card (#1240 AC2/AC5), not as a second
 * per-row control this page would otherwise need to keep in sync with it.
 */
export default function LineupPage() {
  const { leagues, selectedLeagueId, setSelectedLeagueId, loading: leaguesLoading, error: leaguesError } =
    useLineupLeagues();
  const { league, teams, viewerTeamId, loading: leagueLoading, error: leagueError } = useLeague(selectedLeagueId);
  const [searchParams, setSearchParams] = useSearchParams();
  const [week, setWeek] = useState(null);
  // The Decision card (#1240, ADR 0037): which rostered player's card is
  // open, replacing the player quick view on Lineup only (the ruling on the
  // issue thread) - `components/PlayerQuickView` itself is untouched and
  // still serves every other surface.
  const [decisionCardEntryId, setDecisionCardEntryId] = useState(null);
  // The phone Outlook tab (AC5, #1238): which half of the page a narrow
  // viewport shows, the Ledger (Roster) or the rail (Outlook). Irrelevant at
  // `sm` and up, where both already show side by side.
  const [mobileSection, setMobileSection] = useState('roster');
  const theme = useTheme();
  const compact = useMediaQuery(theme.breakpoints.down('sm'), { noSsr: true });

  // The tri-state best-ball read (LineupScreen.jsx's own #217 ruling):
  // "loading"/"error" both commit to nothing until the league is genuinely
  // known, so a background revalidation of an already-known league can never
  // demote it back to unsettled.
  const leagueMode = league != null ? (league.best_ball ? 'bestBall' : 'standard') : (leagueLoading ? 'loading' : 'error');
  const bestBall = leagueMode === 'bestBall';
  const leagueUnsettled = leagueMode === 'loading' || leagueMode === 'error';

  const { lineup, raw, setRaw, loading: lineupLoading, error: lineupError, refetch } = useLineupData({
    leagueId: selectedLeagueId,
    week,
  });

  // The Game cell's placeholder live state (AC2, ADR 0037: clock and score
  // only, no Situation - ticket 9): one Realtime subscription for every
  // distinct NFL game the lineup's own entries name (`gameKey`, #1235),
  // through the Matchup entity's existing `useLiveGameStates` (the same
  // `live_game_states` channel Game Center and Matchup Detail already read)
  // rather than a second live-games mechanism.
  const gameKeys = Array.from(new Set((lineup?.entries || []).map((e) => e.gameKey).filter(Boolean)));
  const liveGames = useLiveGameStates(selectedLeagueId, gameKeys);
  const liveGamesByKey = new Map(liveGames.map((row) => [String(row.tank01_game_id), row]));

  // Live points (AC2, #1241, ADR 0037 ticket 9): the same scores socket Game
  // Center and Matchup Detail already read, subscribed once here and handed
  // to both the Ledger (a per-player delta patched onto `raw`, below) and
  // the team-summary-strip's live totals (`scoreEvent`, applied by that
  // widget's own model).
  const { scoreEvent } = useLiveScores({ leagueId: selectedLeagueId, setRaw, refetch });

  const swap = useSwapPlayers({
    leagueId: selectedLeagueId,
    raw,
    setRaw,
    entries: lineup?.entries || [],
    bestBall,
    leagueUnsettled,
  });
  const drop = useDropPlayer({ leagueId: selectedLeagueId, refresh: refetch });

  // Start/sit advice (#1238, ADR 0037): one page-level read shared by the
  // start-sit-panel widget, the team-summary-strip widget's advice tile and
  // the apply-advice feature below - the same "value two widgets both need
  // is passed down by the page" rule `useLineupData` already follows for the
  // lineup itself. Best ball never calls the endpoint at all.
  const advice = useAdvice({ leagueId: selectedLeagueId, week: lineup?.week, bestBall });
  const applyAdvice = useApplyAdvice({ leagueId: selectedLeagueId, raw, setRaw });

  // The Bench what-if swap (#910), read once and resolved against whichever
  // lineup actually loaded.
  const [requestedSwap, setRequestedSwapState] = useState(() => readRequestedSwap(searchParams));
  const swapOffer = resolveRequestedSwap(requestedSwap, lineup?.entries);
  const consumeRequestedSwap = () => {
    setRequestedSwapState(null);
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete('swapOut');
        next.delete('swapIn');
        return next;
      },
      { replace: true }
    );
  };
  const applyRequestedSwap = () => {
    if (!swapOffer) return;
    const { outEntry, inEntry } = swapOffer;
    consumeRequestedSwap();
    swap.performMove([
      { playerId: outEntry.playerId, slot: inEntry.slot },
      { playerId: inEntry.playerId, slot: outEntry.slot },
    ]);
  };

  const changeWeek = (w) => {
    if (typeof w !== 'number') return; // "All weeks" does not apply to a single-week Lineup
    swap.cancelSelection();
    setWeek(Math.min(MAX_WEEK, Math.max(MIN_WEEK, w)));
  };

  const currentWeekValue = lineup ? week ?? lineup.week ?? MIN_WEEK : null;
  const viewerTeam = viewerTeamId != null && Array.isArray(teams) ? teams.find((t) => t.teamId === viewerTeamId) : null;
  const phase = deriveLeaguePhase(league);
  const draftInProgress = phase === LEAGUE_PHASE.PRE_DRAFT || phase === LEAGUE_PHASE.DRAFTING;
  const canDropEntry = () => Boolean(lineup && lineup.week != null && lineup.week === lineup.currentWeek);
  const emptyRoster = !lineupLoading && lineup != null && lineup.entries.length === 0;

  // The Bye cluster grid (#1239, AC5): "past weeks show no grid (the week as
  // played has no outlook)" - a week strictly before the league's current
  // week is a settled record, never an outlook. `worstCluster` is computed
  // here, not inside team-summary-strip, because that widget cannot reach
  // the bye-cluster widget's own internals (a widget may not import
  // another widget's - ADR 0020/0029); it calls the SAME shared pure
  // function (`shared/lib`'s `computeByeClusters`/`worstByeCluster`) the
  // bye-cluster widget itself independently calls on the raw entries this
  // page already passes it.
  const isPastWeek = Boolean(lineup && lineup.week != null && lineup.currentWeek != null && lineup.week < lineup.currentWeek);
  const byeClusters = !isPastWeek && lineup ? computeByeClusters({ entries: lineup.entries, fromWeek: lineup.week }) : [];
  const worstCluster = worstByeCluster(byeClusters);

  return (
    <Box sx={{ maxWidth: 1180, mx: 'auto', px: { xs: 2, sm: 3 }, py: { xs: 2, sm: 3 } }}>
      {leaguesError && (
        <Typography role="alert" sx={{ mb: 2, color: 'var(--dash-danger)' }} data-testid="leagues-error">
          {leaguesError}
        </Typography>
      )}
      {leagueMode === 'error' && (
        <Typography role="alert" sx={{ mb: 2, color: 'var(--dash-danger)' }} data-testid="league-error">
          {leagueError}
        </Typography>
      )}
      {lineupError && (
        <Typography role="alert" sx={{ mb: 2, color: 'var(--dash-danger)' }} data-testid="lineup-error">
          {lineupError}
        </Typography>
      )}

      {!leaguesLoading && leagues.length === 0 && (
        <Card data-testid="lineup-no-leagues">
          <Box sx={{ p: 3, display: 'grid', gap: 1.5, justifyItems: 'start' }}>
            <Typography>You&apos;re not in a fantasy league yet. Create or join one to start building your team.</Typography>
            <Button component={RouterLink} to="/league" variant="contained">Go to Leagues</Button>
          </Box>
        </Card>
      )}

      {leagues.length > 0 && (
        <>
          {/* Team header: avatar, Team name, and (when the manager holds more
              than one fantasy league) the league picker - the route carries
              no leagueId of its own. */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap', mb: 2 }}>
            <TeamAvatar
              name={viewerTeam?.teamName || 'My Team'}
              avatarUrl={viewerTeam?.avatar_url}
              avatarStaticUrl={viewerTeam?.avatar_static_url}
              size={56}
            />
            <Box sx={{ minWidth: 0 }}>
              <Typography component="h1" sx={{ m: 0, fontSize: '26px', fontWeight: 700 }}>
                {viewerTeam?.teamName || 'Lineup'}
              </Typography>
              {bestBall && <Badge variant="neutral">Best ball</Badge>}
            </Box>
            {leagues.length > 1 && (
              <FormControl size="small" sx={{ ml: { sm: 'auto' }, minWidth: 200 }}>
                <InputLabel id="lineup-league-select-label">League</InputLabel>
                <Select
                  labelId="lineup-league-select-label"
                  label="League"
                  value={selectedLeagueId ?? ''}
                  onChange={(e) => setSelectedLeagueId(e.target.value)}
                >
                  {leagues.map((l) => (
                    <MenuItem key={l.id} value={l.id}>{l.name}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            )}
          </Box>

          {draftInProgress && (
            <Card data-testid="lineup-draft-in-progress">
              <Box sx={{ p: 3, display: 'grid', gap: 1.5, justifyItems: 'start' }}>
                <Typography>Your roster fills during the draft. Head to the Draft Room when it is time to pick.</Typography>
                <Button component={RouterLink} to={`/league/${selectedLeagueId}/draft`} variant="contained">
                  Draft Room
                </Button>
              </Box>
            </Card>
          )}

          {/* Restored per formal review (finding
              legacy-controls-dropped-without-a-criterion): TeamLineup.jsx's
              own empty-roster action, "no players rostered yet, Browse
              Players", distinct from the draft-in-progress card above. Only
              once the lineup has actually loaded and named zero entries, so
              a background reload never flashes this over real rows. */}
          {!draftInProgress && emptyRoster && (
            <Card data-testid="lineup-empty-roster">
              <Box sx={{ p: 3, display: 'grid', gap: 1.5, justifyItems: 'start' }}>
                <Typography>No players rostered yet. Head to the player pool to add players to your team.</Typography>
                <Button component={RouterLink} to="/player" variant="contained">Browse Players</Button>
              </Box>
            </Card>
          )}

          {!draftInProgress && !emptyRoster && (
            <>
              {bestBall && (
                <Badge variant="live" sx={{ mb: 2 }} data-testid="best-ball-notice">
                  Best ball: your best legal lineup is set automatically each week.
                </Badge>
              )}

              {swapOffer && (
                <Box
                  data-testid="lineup-swap-offer"
                  role="group"
                  aria-label="Bench what-if swap"
                  sx={{ mb: 2, p: 1.5, border: '1px solid var(--dash-accent-line)', borderRadius: 'var(--dash-radius-sm)', display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}
                >
                  <Typography sx={{ flexGrow: 1, fontSize: '13px' }}>
                    {`Bench what-if · Start ${swapOffer.inEntry.name} over ${swapOffer.outEntry.name}`}
                  </Typography>
                  <Button size="small" variant="outlined" onClick={applyRequestedSwap}>Swap</Button>
                  <Button size="small" onClick={consumeRequestedSwap}>Dismiss</Button>
                </Box>
              )}

              <Box sx={{ mb: 2 }}>
                <PickWeek weeks={WEEKS} value={currentWeekValue ?? MIN_WEEK} onChange={changeWeek} fill={compact} />
              </Box>

              {/* The phone Outlook tab (AC5, #1238): below `sm`, where the
                  rail is otherwise hidden entirely, this picks between the
                  Ledger (Roster) and the rail (Outlook: start-sit-panel,
                  matchup-preview, and ticket 7's Bye cluster grid). It is a
                  page-level control, separate from the Ledger's own
                  Starters/Bench tab bar (widgets/lineup-ledger), because the
                  Outlook content is page-composed from widgets the Ledger
                  itself never imports (ADR 0020). */}
              <Box sx={{ display: { xs: 'block', sm: 'none' }, mb: 2 }}>
                <SegmentedControl
                  aria-label="Lineup view"
                  fill
                  value={mobileSection}
                  onChange={setMobileSection}
                  data-testid="lineup-mobile-view"
                  // Mobile-only control (this Box is hidden at `sm` and up):
                  // grows each segment to the 44px touch target, the same
                  // override PickWeek's own `fill` usage of this component
                  // applies (src/features/pick-week/ui/PickWeek.jsx).
                  sx={{ '& [role="radio"]': { minHeight: 44 } }}
                  options={[
                    { value: 'roster', label: 'Roster' },
                    { value: 'outlook', label: 'Outlook' },
                  ]}
                />
              </Box>

              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '2fr 1fr' }, gap: '16px', alignItems: 'start' }}>
                <Box data-testid="lineup-roster-column" sx={{ display: { xs: mobileSection === 'outlook' ? 'none' : 'grid', sm: 'grid' }, gap: '16px' }}>
                  <TeamSummaryStrip
                    leagueId={selectedLeagueId}
                    week={league?.current_week ?? null}
                    viewerTeamId={viewerTeamId}
                    lineup={lineup}
                    advice={advice}
                    worstByeCluster={worstCluster}
                    scoreEvent={scoreEvent}
                  />

                  {swap.selectedEntry && (
                    <Box
                      data-testid="lineup-move-strip"
                      sx={{ p: 1.5, border: '1px solid var(--dash-accent-line)', borderRadius: 'var(--dash-radius-sm)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                    >
                      <Typography sx={{ fontSize: '13px' }}>{`Moving ${swap.selectedEntry.name}: tap a highlighted slot`}</Typography>
                      <Button size="small" onClick={swap.cancelSelection}>Cancel</Button>
                    </Box>
                  )}

                  {(lineupLoading && !lineup) ? (
                    <Box sx={{ display: 'grid', gap: 1 }} data-testid="lineup-skeleton">
                      <Skeleton variant="rounded" height={220} />
                      <Skeleton variant="rounded" height={220} />
                    </Box>
                  ) : (
                    <LineupLedger
                      leagueId={selectedLeagueId}
                      lineup={lineup}
                      league={league}
                      liveGamesByKey={liveGamesByKey}
                      disabled={leagueUnsettled}
                      showEligibility={Boolean(swap.selectedEntry)}
                      isEligibleTarget={swap.isEligibleTarget}
                      isSwapHighlighted={(entry) =>
                        Boolean(swapOffer && (entry.playerId === swapOffer.outEntry.playerId || entry.playerId === swapOffer.inEntry.playerId))
                      }
                      selectedEntryId={swap.selectedEntry?.playerId ?? null}
                      onRowClick={swap.onRowClick}
                      canDropEntry={canDropEntry}
                      onRequestDrop={drop.requestDrop}
                      onOpenDecisionCard={setDecisionCardEntryId}
                    />
                  )}
                </Box>

                <Box data-testid="lineup-outlook-column" sx={{ display: { xs: mobileSection === 'outlook' ? 'grid' : 'none', sm: 'grid' }, gap: '16px' }}>
                  <StartSitPanel
                    advice={advice}
                    entries={lineup?.entries}
                    bestBall={bestBall}
                    onApply={applyAdvice.apply}
                  />
                  <ByeClusterGrid
                    entries={lineup?.entries}
                    fromWeek={lineup?.week}
                    isPastWeek={isPastWeek}
                    waiverPeriodHours={league?.waiver_period_hours}
                  />
                  <MatchupPreview leagueId={selectedLeagueId} />
                </Box>
              </Box>
            </>
          )}
        </>
      )}

      <QuickPickMenu
        quickPick={swap.quickPick}
        eligible={swap.quickPickEligible}
        onClose={swap.closeQuickPick}
        onSelect={swap.handleQuickPickSelect}
      />
      <DropConfirmationDialog entry={drop.dropCandidate} onClose={drop.closeDropConfirmation} onConfirm={drop.confirmDrop} />
      <PlayerDecisionCard
        open={decisionCardEntryId != null}
        onClose={() => setDecisionCardEntryId(null)}
        entry={(lineup?.entries || []).find((e) => e.playerId === decisionCardEntryId) || null}
        entries={lineup?.entries}
        leagueId={selectedLeagueId}
        week={lineup?.week}
        bestBall={bestBall}
        leagueUnsettled={leagueUnsettled}
        onSwap={swap.performMove}
        onRequestDrop={drop.requestDrop}
        canDropEntry={canDropEntry}
      />
    </Box>
  );
}
