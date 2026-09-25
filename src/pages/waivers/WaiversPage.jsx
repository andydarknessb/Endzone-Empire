import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { Alert, Box, Button, Typography } from '@mui/material';
import apiClient from '../../api/apiClient';
import { readHttpFailure } from '../../lib/httpFailure';
import { useLeague } from '../../hooks/useLeague';
import LeagueBreadcrumb from '../../components/LeagueBreadcrumb/LeagueBreadcrumb';
import { Card, SegmentedControl } from '../../shared/ui';
import { useEndpoint, isRosterAtCapacity } from '../../shared/lib';
import { useWaiverClaims } from '../../entities/waiver-claim';
import { lineupModel } from '../../entities/roster';
import { toDecisionCardEntry } from '../../entities/player';
import { PlayerPool } from '../../widgets/player-pool';
import PlayerRow, { PlayerRowTableHead, playerRowColumnCount } from '../../widgets/player-row';
import WaiverSummary from '../../widgets/waiver-summary';
import WaiverClaims from '../../widgets/waiver-claims';
import ByeClusterGrid from '../../widgets/bye-cluster';
import PlayerDecisionCard, { waivers } from '../../widgets/player-decision-card';
import { ClaimSheet } from '../../features/claim-player';

const TABS = [
  { value: 'waivers', label: 'On waivers' },
  { value: 'claims', label: 'My claims' },
];

/**
 * The Waivers page slice (ADR 0049, #1613), on the existing
 * `/league/:leagueId/waivers` route. It holds no player list of its own: the
 * list is the `player-pool` widget locked to on waivers, so search, position,
 * Bye week, the server-side sort and the pager are the Players page's own,
 * in the URL. The summary strip reads the `waiver-claim` entity and the cards
 * read's roster context; the side panel carries the `bye-cluster` widget,
 * unchanged. From `md` the list and the side panel sit side by side; below it
 * two tabs, On waivers and My claims, are held in `?tab=`.
 *
 * The Claim action opens the claim sheet (#1615, `claim-player`), which the
 * `?playerId=` deep link opens too; the Decision card's claim bar files
 * through the same submission. My claims is the `waiver-claims` widget (#1614):
 * pending claims in Claim order with the reorder, and Results by week.
 *
 * BELOW-ISLAND EDGES (ADR 0031 amendment), each named with its reason:
 *   - `hooks/useLeague`: the league row, whose `best_ball` decides the sort
 *     before the first read (`GET /api/waivers` does not carry it).
 *   - `components/LeagueBreadcrumb`: the back-link every league subpage shows.
 *   - `api/apiClient` and `lib/httpFailure`: the one `claim-target` read behind
 *     the Player Browser's `?playerId=` deep link.
 */
export default function WaiversPage() {
  const { leagueId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get('tab') === 'claims' ? 'claims' : 'waivers';

  const { league, loading: leagueLoading, error: leagueError } = useLeague(leagueId);
  const bestBall = !!league?.best_ball;

  const [refreshKey, setRefreshKey] = useState(0);
  const { status: claimsStatus, claims, moveClaim, orderError, orderAnnouncement, orderSettled } =useWaiverClaims({ leagueId, refreshKey });
  const { data: rosterData } = useEndpoint(`/api/team/roster?leagueId=${leagueId}`);
  const { data: lineupData } = useEndpoint(`/api/team/lineup?leagueId=${leagueId}`);
  const lineup = useMemo(() => (lineupData ? lineupModel(lineupData) : null), [lineupData]);

  const poolRef = useRef(null);
  const [players, setPlayers] = useState([]);
  const [context, setContext] = useState(null);
  const [total, setTotal] = useState(null);
  const [poolError, setPoolError] = useState(null);
  // True once a players read has landed: until then (or on any page error) the
  // pool is kept out of sight so its empty copy never shows for a list that
  // has not been read.
  const [poolSettled, setPoolSettled] = useState(false);
  const [quickViewId, setQuickViewId] = useState(null);
  const [claimId, setClaimId] = useState(null);
  const [targetPlayer, setTargetPlayer] = useState(null);
  const [targetError, setTargetError] = useState(null);

  // The Player Browser's blanket-waiver deep link: the server validates the
  // target, then its Decision card opens. The param is spent either way.
  const targetParam = searchParams.get('playerId');
  const targetId = /^\d+$/.test(targetParam || '') ? Number(targetParam) : null;
  const requestedTargetRef = useRef(null);
  useEffect(() => {
    if (!targetId || requestedTargetRef.current === targetId) return undefined;
    requestedTargetRef.current = targetId;
    let cancelled = false;
    apiClient
      .get(`/api/waivers/claim-target?leagueId=${leagueId}&playerId=${targetId}`)
      .then((response) => {
        if (cancelled) return;
        setTargetPlayer(response.data.player);
        setClaimId(response.data.player.id);
      })
      .catch((err) => {
        if (!cancelled) setTargetError(readHttpFailure(err).message || err.message);
      })
      .finally(() => {
        if (cancelled) return;
        setSearchParams(
          (current) => {
            const next = new URLSearchParams(current);
            next.delete('playerId');
            return next;
          },
          { replace: true },
        );
      });
    return () => {
      cancelled = true;
    };
  }, [targetId, leagueId, setSearchParams]);

  const setTab = (value) =>
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (value === 'claims') next.set('tab', 'claims');
        else next.delete('tab');
        return next;
      },
      { replace: true },
    );

  // A read that fails keeps the error up until a read succeeds: the pool
  // reports `null` when a read STARTS, which must not flash the (empty) list.
  const handleLoaded = useCallback(({ players: nextPlayers, context: nextContext, total: nextTotal }) => {
    setPlayers(nextPlayers);
    setContext(nextContext);
    setTotal(nextTotal);
    setPoolError(null);
    setPoolSettled(true);
  }, []);
  const handleError = useCallback((message) => {
    if (message) setPoolError(message);
  }, []);

  const refreshAfterAction = useCallback(() => {
    setRefreshKey((key) => key + 1);
    return poolRef.current?.refresh();
  }, []);

  const claimOrderByPlayer = useMemo(() => {
    const map = new Map();
    claims.pending.forEach((claim, index) => {
      if (claim.playerId != null) map.set(claim.playerId, claim.claimOrder ?? index + 1);
    });
    return map;
  }, [claims.pending]);

  const ownershipKnown = players.some((player) => {
    const value = typeof player.ownership === 'number' ? player.ownership : player.ownership?.share;
    return value != null;
  });

  const roster =
    context?.rosterCount != null
      ? {
          count: context.rosterCount,
          capacity: context.rosterCapacity ?? null,
          atCapacity: isRosterAtCapacity(context),
        }
      : null;

  const isFaab = league?.waiver_type === 'faab' || claims.faab != null;
  const quickViewPlayer = players.find((player) => player.id === quickViewId) || null;
  const claimPlayer =
    players.find((player) => player.id === claimId) || (targetPlayer && targetPlayer.id === claimId ? targetPlayer : null);
  const availability = {
    rosterCount: context?.rosterCount,
    rosterCapacity: context?.rosterCapacity,
    waiverPriority: !isFaab ? (claims.waiverPriority ?? undefined) : undefined,
    faabRemaining: isFaab && claims.faab ? claims.faab.left : undefined,
  };

  const rowFor = (player, variant) => {
    const order = claimOrderByPlayer.get(player.id);
    return (
      <PlayerRow
        player={player}
        bestBall={bestBall}
        hideOwnership={!ownershipKnown}
        variant={variant === 'card' ? 'card' : undefined}
        onOpenPlayer={setQuickViewId}
        action={{
          kind: 'button',
          label: order != null ? `Claim #${order}` : 'Claim',
          variant: order != null ? 'outlined' : 'contained',
          ariaLabel: `${order != null ? `Claim #${order}` : 'Claim'} ${player.name}`,
          onClick: () => setClaimId(player.id),
          helper: order != null ? 'You already have a pending claim on this player.' : undefined,
        }}
      />
    );
  };

  const error = (leagueError ? 'Could not load the league.' : null) || poolError || targetError;
  const pendingCount = claims.pending.length;

  return (
    <Box
      component="main"
      sx={{
        width: '100%',
        maxWidth: 1440,
        mx: 'auto',
        px: { xs: 2, sm: 3, md: 5 },
        py: { xs: 2, md: 3.5 },
        color: 'var(--dash-ink)',
      }}
    >
      <LeagueBreadcrumb />
      <Box sx={{ mb: 2 }}>
        <Typography
          component="h1"
          sx={{
            fontFamily: 'var(--dash-font-display)',
            fontWeight: 800,
            fontSize: { xs: 40, md: 56 },
            lineHeight: 0.95,
            letterSpacing: '0.5px',
            textTransform: 'uppercase',
          }}
        >
          Waivers
        </Typography>
        {total != null && !poolError && (
          <Typography sx={{ fontSize: 14, color: 'var(--dash-dim)', mt: 0.75 }}>
            {`${total.toLocaleString()} player${total === 1 ? '' : 's'} on waivers${isFaab ? ' · FAAB league' : ''}`}
          </Typography>
        )}
      </Box>

      <Box sx={{ mb: 2.5 }}>
        <WaiverSummary
          nextClear={claims.nextClear}
          pendingCount={pendingCount}
          faab={claims.faab}
          waiverPriority={claims.waiverPriority}
          roster={roster}
        />
      </Box>

      {error && (
        <Alert
          severity="error"
          sx={{ mb: 2 }}
          action={
            poolError ? (
              <Button color="inherit" size="small" onClick={() => poolRef.current?.refresh()} sx={{ minHeight: 44 }}>
                Try again
              </Button>
            ) : null
          }
        >
          {error}
        </Alert>
      )}

      {!poolError && !leagueError && !poolSettled && (
        <Typography role="status" sx={{ fontSize: 14, color: 'var(--dash-dim)', mb: 2 }}>
          Loading players
        </Typography>
      )}

      <Box sx={{ display: { xs: 'block', md: 'none' }, mb: 2 }}>
        <SegmentedControl
          aria-label="Waivers view"
          options={TABS}
          value={tab}
          onChange={setTab}
          fill
          sx={{ "& [role='radio']": { minHeight: 44 } }}
        />
      </Box>

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: 'minmax(0, 1fr) 320px', lg: 'minmax(0, 1fr) 384px' },
          gap: 3,
          alignItems: 'start',
        }}
      >
        <Box
          sx={{
            display: poolError || leagueError || !poolSettled ? 'none' : { xs: tab === 'waivers' ? 'block' : 'none', md: 'block' },
            minWidth: 0,
          }}
        >
          <PlayerPool
            ref={poolRef}
            leagueId={leagueId}
            bestBall={bestBall}
            ready={!leagueLoading && !!league}
            availabilityLock="waivers"
            byeWeekFilter
            cardsBelow="sm"
            emptyCopy="No players are on waivers"
            columnCount={playerRowColumnCount(bestBall, !ownershipKnown)}
            renderTableHead={(headProps) => <PlayerRowTableHead {...headProps} hideOwnership={!ownershipKnown} />}
            renderRow={rowFor}
            onLoaded={handleLoaded}
            onError={handleError}
          />
        </Box>

        <Box
          component="aside"
          aria-label="Waivers side panel"
          sx={{
            display: { xs: tab === 'claims' ? 'flex' : 'none', md: 'flex' },
            flexDirection: 'column',
            gap: 2,
            minWidth: 0,
          }}
        >
          <Card title="My claims" data-testid="waivers-claims-card">
            {claimsStatus === 'error' ? (
              <Typography sx={{ p: 2, fontSize: 14, color: 'var(--dash-dim)' }}>
                Your claims could not be loaded.
              </Typography>
            ) : (
              <WaiverClaims
                claims={claims}
                onMove={moveClaim}
                orderError={orderError}
                orderAnnouncement={orderAnnouncement}
                orderSettled={orderSettled}
                showBid={isFaab}
              />
            )}
          </Card>
          {lineup && (lineup.currentWeek ?? lineup.week) != null && (
            <ByeClusterGrid
              entries={lineup.entries}
              fromWeek={lineup.currentWeek ?? lineup.week}
              isPastWeek={false}
              waiverPeriodHours={league?.waiver_period_hours}
            />
          )}
        </Box>
      </Box>

      <PlayerDecisionCard
        open={quickViewId != null}
        onClose={() => setQuickViewId(null)}
        entry={toDecisionCardEntry(quickViewPlayer)}
        leagueId={Number(leagueId)}
        context={waivers({
          availability,
          roster: Array.isArray(rosterData) ? rosterData : [],
          onActionDone: refreshAfterAction,
          playerIds: players.map((player) => player.id),
          onNavigate: setQuickViewId,
        })}
      />
      <ClaimSheet
        open={claimId != null}
        player={claimPlayer}
        leagueId={leagueId}
        availability={availability}
        roster={rosterData}
        onClose={() => setClaimId(null)}
        onClaimed={refreshAfterAction}
      />
    </Box>
  );
}
