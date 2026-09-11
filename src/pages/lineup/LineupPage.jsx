import React, { useState } from 'react';
import { Link as RouterLink, useSearchParams } from 'react-router-dom';
import { Box, Button, FormControl, InputLabel, MenuItem, Select, Typography, useMediaQuery, useTheme } from '@mui/material';
import { Badge, Card, Skeleton, TeamAvatar } from '../../shared/ui';
import { useLeague } from '../../hooks/useLeague';
import { useLiveGameStates } from '../../entities/matchup';
import { deriveLeaguePhase, LEAGUE_PHASE } from '../../lib/leaguePhase';
import PickWeek from '../../features/pick-week';
import LineupLedger from '../../widgets/lineup-ledger';
import TeamSummaryStrip from '../../widgets/team-summary-strip';
import MatchupPreview from '../../widgets/matchup-preview';
import { useSwapPlayers, QuickPickMenu } from '../../features/swap-players';
import { useDropPlayer, DropConfirmationDialog } from '../../features/drop-player';
import { useLineupLeagues } from './model/useLineupLeagues';
import { useLineupData } from './model/useLineupData';
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
 * Deliberately deferred, per the issue's own scope: the advice tile (ticket
 * 6), the narrow-width Outlook rail (ticket 6), and the live Game cell's full
 * Situation treatment (ticket 9 - this ticket's Game cell shows clock and
 * score only). The Decision card (glossary: "Tapping a row opens the
 * Decision card") is not built by this ticket either - no acceptance
 * criterion here names it, and Trade/acquisition-detail/quick-view stay off
 * this page until it lands; Drop keeps its own row control in the meantime,
 * matching AC6's "Swap, quick pick, drop and undo behave as today".
 */
export default function LineupPage() {
  const { leagues, selectedLeagueId, setSelectedLeagueId, loading: leaguesLoading, error: leaguesError } =
    useLineupLeagues();
  const { league, teams, viewerTeamId, loading: leagueLoading, error: leagueError } = useLeague(selectedLeagueId);
  const [searchParams, setSearchParams] = useSearchParams();
  const [week, setWeek] = useState(null);
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

  const swap = useSwapPlayers({
    leagueId: selectedLeagueId,
    raw,
    setRaw,
    entries: lineup?.entries || [],
    bestBall,
    leagueUnsettled,
  });
  const drop = useDropPlayer({ leagueId: selectedLeagueId, refresh: refetch });

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

          {!draftInProgress && (
            <>
              {bestBall && (
                <Badge variant="live" sx={{ mb: 2 }} data-testid="best-ball-notice">
                  Best ball: your optimal lineup is computed automatically each week.
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

              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '2fr 1fr' }, gap: '16px', alignItems: 'start' }}>
                <Box sx={{ display: 'grid', gap: '16px' }}>
                  <TeamSummaryStrip leagueId={selectedLeagueId} lineup={lineup} />

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
                    />
                  )}
                </Box>

                <Box sx={{ display: { xs: 'none', md: 'grid' }, gap: '16px' }}>
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
    </Box>
  );
}
