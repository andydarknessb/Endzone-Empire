import React, {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { Box } from '@mui/material';
import { readHttpFailure } from '../../lib/httpFailure';
import { useLeague } from '../../hooks/useLeague';
import LeagueBreadcrumb from '../../components/LeagueBreadcrumb/LeagueBreadcrumb';
import { SegmentedControl } from '../../shared/ui';
import {
  Frame, FrameHead, PixelHeading, PixelWarn, PsButton, SR_ONLY_SX, Skel, psRootSx,
} from '../../shared/ui/playselect';
import {
  useEndpoint, isRosterAtCapacity, formatPoints, useNow,
} from '../../shared/lib';
import {
  useWaiverClaims, readClaimTarget, nextClaimRow, clearsUnderHour,
} from '../../entities/waiver-claim';
import { lineupModel } from '../../entities/roster';
import { toDecisionCardEntry } from '../../entities/player';
import { PlayerPool } from '../../widgets/player-pool';
import PlayerRow, { PlayerRowTableHead, playerRowColumnCount } from '../../widgets/player-row';
import WaiverSummary from '../../widgets/waiver-summary';
import WaiverClaims from '../../widgets/waiver-claims';
import WaiverRowDetail from './WaiverRowDetail';
import { useCardReads } from './useCardReads';
import ByeClusterGrid from '../../widgets/bye-cluster';
import PlayerDecisionCard, { waivers } from '../../widgets/player-decision-card';
import { ClaimSheet } from '../../features/claim-player';
import { useManageClaim } from '../../features/manage-claim';

const HOUR_MS = 3600 * 1000;
const TABS = [
  { value: 'waivers', label: 'On waivers' },
  { value: 'claims', label: 'My claims' },
];

/**
 * A failed load: a 2px Danger edge, the warning pictogram and the sentence. The alert holds the text
 * only; the one Retry sits beside it, outside the role element.
 */
function ErrorEdge({ children, onRetry, testId }) {
  return (
    <Box
      data-testid={testId}
      sx={{
        border: '2px solid var(--ps-danger)',
        backgroundColor: 'var(--ps-panel)',
        padding: '16px 20px',
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '12px 20px',
      }}
    >
      <Box role="alert" sx={{
        display: 'flex', gap: '12px', alignItems: 'center', minWidth: 0, fontSize: '16px',
      }}
      >
        <PixelWarn color="var(--ps-danger)" />
        <span>{children}</span>
      </Box>
      {onRetry && <PsButton onClick={onRetry}>Retry</PsButton>}
    </Box>
  );
}

function PoolSkeleton() {
  return (
    <Frame aria-busy="true" head={<FrameHead><Skel width="140px" height={24} /></FrameHead>}>
      {[0, 1, 2, 3].map((i) => (
        <Box key={i} sx={{
          display: 'flex', gap: '20px', alignItems: 'center', padding: '12px 20px', borderTop: i ? '2px solid var(--ps-rule)' : 'none',
        }}
        >
          <Skel width="160px" height={20} />
          <Skel width="40px" height={20} />
          <Skel width="40px" height={20} />
          <Skel width="90px" height={20} />
        </Box>
      ))}
    </Frame>
  );
}

/**
 * The Waivers page slice (ADR 0049, #1613), on the existing
 * `/league/:leagueId/waivers` route, in the Play-select look since ADR 0067 wave 3 (spec #2347;
 * boards docs/design/league/Waivers*.dc.html). It holds no player list of its own: the
 * list is the `player-pool` widget locked to on waivers, so search, position,
 * Bye week, the server-side sort and the pager are the Players page's own,
 * in the URL. The summary strip reads the `waiver-claim` entity and the cards
 * read's roster context; the side panel carries the `bye-cluster` widget. From `md` the list and the
 * side panel sit side by side; below it two tabs, On waivers and My claims, are held in `?tab=`.
 *
 * The cursor is the row `nextClaimRow` picks from the page's own rows (the largest positive Upgrade
 * the manager has not claimed; none in best ball), and that row's Claim is the page's one filled
 * action; every other Claim, and each "Claim #n", is a ghost. The cursor frame turns Danger when
 * that row clears in under an hour.
 *
 * The Claim action opens the claim sheet (#1615, `claim-player`), which the
 * `?playerId=` deep link opens too; the Decision card's claim bar files
 * through the same submission. My claims is the `waiver-claims` widget (#1614):
 * pending claims in Claim order with the reorder, and Results by week.
 *
 * BELOW-ISLAND EDGES (ADR 0031 amendment), each named with its reason:
 *   - `hooks/useLeague`: the league row, whose `best_ball` decides the sort
 *     before the first read (the waivers read does not carry it).
 *   - `components/LeagueBreadcrumb`: the back-link every league subpage shows.
 *   - `lib/httpFailure`: the refusal text of the `claim-target` read (the entity's `readClaimTarget`) behind
 *     the Player Browser's `?playerId=` deep link (and, through `useCardReads`,
 *     the expanded row's Decision-card read).
 */
export default function WaiversPage() {
  const { leagueId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get('tab') === 'claims' ? 'claims' : 'waivers';

  const {
    league, loading: leagueLoading, error: leagueError, refetch: refetchLeague,
  } = useLeague(leagueId);
  const bestBall = !!league?.best_ball;

  const [refreshKey, setRefreshKey] = useState(0);
  const {
    status: claimsStatus, claims, moveClaim, orderError, orderAnnouncement, orderSettled,
  } = useWaiverClaims({ leagueId, refreshKey });
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
  // The under-one-hour state (the cursor frame, a row's Status) flips while the page is open: the clock
  // repaints at the first instant a shown row's Clear time comes within the hour.
  const now = useNow((at) => {
    let next = null;
    players.forEach((player) => {
      const clearAt = player.availability?.availableAt ? new Date(player.availability.availableAt).getTime() : NaN;
      const flips = clearAt - HOUR_MS + 1;
      if (Number.isFinite(clearAt) && flips > at && (next == null || flips < next)) next = flips;
    });
    return next;
  }, players);
  const [quickViewId, setQuickViewId] = useState(null);
  const [claimId, setClaimId] = useState(null);
  // #1617: one expanded row at a time; `cardReads` keeps each expanded player's
  // Decision-card read attempt so a player is read once per page view.
  const [expandedId, setExpandedId] = useState(null);
  const cardReads = useCardReads(leagueId);
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
    readClaimTarget({ leagueId, playerId: targetId })
      .then((response) => {
        if (cancelled) return;
        setTargetPlayer(response.player);
        setClaimId(response.player.id);
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

  const setTab = (value) => setSearchParams(
    (current) => {
      const next = new URLSearchParams(current);
      if (value === 'claims') next.set('tab', 'claims');
      else next.delete('tab');
      return next;
    },
    { replace: true },
  );

  const pendingCount = claims.pending.length;

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

  // Paging collapses the expanded row.
  const pageParam = searchParams.get('page');
  useEffect(() => setExpandedId(null), [pageParam]);

  const refreshAfterAction = useCallback(() => {
    setRefreshKey((key) => key + 1);
    return poolRef.current?.refresh();
  }, []);

  const [editClaimId, setEditClaimId] = useState(null);
  const editingClaim = claims.pending.find((claim) => claim.id === editClaimId) || null;
  const { editClaim, cancelClaim, pending: manageBusy } = useManageClaim({
    leagueId,
    pendingIds: claims.pending.map((claim) => claim.id),
    onDone: refreshAfterAction,
  });

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

  const roster = context?.rosterCount != null
    ? {
      count: context.rosterCount,
      capacity: context.rosterCapacity ?? null,
      atCapacity: isRosterAtCapacity(context),
    }
    : null;

  // The cursor: of the rows shown on this page, the unclaimed one with the largest positive Upgrade
  // (none in best ball). Under the Watching filter only watched rows are shown.
  const watchingOnly = searchParams.get('watching') === 'true';
  const shownPlayers = useMemo(
    () => (watchingOnly ? players.filter((player) => player.watching) : players),
    [players, watchingOnly],
  );
  const cursorRow = useMemo(
    () => (bestBall ? null : nextClaimRow(shownPlayers, claimOrderByPlayer.keys())),
    [bestBall, shownPlayers, claimOrderByPlayer],
  );
  const cursorUrgent = cursorRow ? clearsUnderHour(cursorRow.availability?.availableAt, now) : false;

  // After a claim is filed from the sheet the cursor moves to the next unclaimed row; say so once,
  // politely. The sheet's `onClaimed` arms it, so a pending count that rises another way (the Undo of a
  // cancel) does not announce.
  const [nextNote, setNextNote] = useState('');
  const announceNext = useRef(false);
  const seenPending = useRef(null);
  useEffect(() => {
    if (claimsStatus === 'loading') return;
    const previous = seenPending.current;
    seenPending.current = pendingCount;
    if (previous == null || pendingCount <= previous) return;
    if (!announceNext.current) return;
    announceNext.current = false;
    if (!cursorRow) {
      setNextNote('');
      return;
    }
    const { points, week } = cursorRow.upgrade;
    const later = week != null && cursorRow.projWeek?.week != null && week !== cursorRow.projWeek.week;
    setNextNote(`Next: ${cursorRow.name}, +${formatPoints(points)}${later ? ` Wk ${week}` : ''}`);
  }, [pendingCount, claimsStatus, cursorRow]);

  const isFaab = league?.waiver_type === 'faab' || claims.faab != null;
  const quickViewPlayer = players.find((player) => player.id === quickViewId) || null;
  const claimPlayer = players.find((player) => player.id === claimId) || (targetPlayer && targetPlayer.id === claimId ? targetPlayer : null);
  const availability = {
    rosterCount: context?.rosterCount,
    rosterCapacity: context?.rosterCapacity,
    waiverPriority: !isFaab ? (claims.waiverPriority ?? undefined) : undefined,
    faabRemaining: isFaab && claims.faab ? claims.faab.left : undefined,
  };

  const rowFor = (player, variant) => {
    const order = claimOrderByPlayer.get(player.id);
    const label = order != null ? `Claim #${order}` : 'Claim';
    const isCursor = cursorRow?.id === player.id;
    const inCard = variant === 'card';
    return (
      <PlayerRow
        player={player}
        bestBall={bestBall}
        hideOwnership={!ownershipKnown}
        variant={inCard ? 'card' : undefined}
        cursor={isCursor ? (cursorUrgent ? 'urgent' : 'cursor') : undefined}
        now={now}
        onOpenPlayer={setQuickViewId}
        expansion={{
          expanded: expandedId === player.id,
          onToggle: () => setExpandedId((current) => (current === player.id ? null : player.id)),
          panelId: `waiver-row-detail-${player.id}`,
          panel: (
            <WaiverRowDetail
              id={`waiver-row-detail-${player.id}`}
              player={player}
              isFaab={isFaab}
              reads={cardReads}
              onOpen={setQuickViewId}
              inTable={!inCard}
            />
          ),
        }}
        action={{
          kind: 'button',
          label,
          fill: isCursor && order == null,
          ariaLabel: `${label} ${player.name}`,
          onClick: () => setClaimId(player.id),
          helper: order != null ? 'You already have a pending claim on this player.' : undefined,
        }}
      />
    );
  };

  const pageUnavailable = leagueError && !league;
  const pageBody = !pageUnavailable;

  return (
    <Box className="ps-root" sx={{ ...psRootSx, minHeight: '100%' }}>
      <Box
        sx={{
          width: '100%',
          maxWidth: '1440px',
          marginX: 'auto',
          boxSizing: 'border-box',
          padding: { xs: '24px 16px 48px', sm: '24px 32px 64px' },
          display: 'flex',
          flexDirection: 'column',
          gap: '24px',
        }}
      >
        <Box component="section" aria-labelledby="waivers-h1" sx={{
          display: 'flex', flexDirection: 'column', gap: '4px', minWidth: 0,
        }}
        >
          <LeagueBreadcrumb />
          <Box sx={{
            display: 'flex', flexDirection: 'column', gap: '12px', minWidth: 0,
          }}
          >
            <PixelHeading id="waivers-h1" level={1}>Waivers</PixelHeading>
            {total != null && !poolError && (
              <Box component="p" sx={{
                m: 0, fontSize: { xs: '16px', sm: '17px' }, color: 'var(--ps-dim)',
              }}
              >
                {`${total.toLocaleString()} player${total === 1 ? '' : 's'} on waivers${isFaab ? ' · FAAB league' : ''}`}
              </Box>
            )}
          </Box>
        </Box>

        {pageUnavailable && (
          <ErrorEdge testId="waivers-league-error" onRetry={refetchLeague}>
            We could not load this league. Check your connection and try again.
          </ErrorEdge>
        )}

        {pageBody && (
          <WaiverSummary
            nextClear={claims.nextClear}
            pendingCount={pendingCount}
            faab={claims.faab}
            waiverPriority={claims.waiverPriority}
            roster={roster}
          />
        )}

        {pageBody && poolError && (
          <ErrorEdge testId="waivers-players-error" onRetry={() => poolRef.current?.refresh()}>
            We could not load the players. Check your connection and try again.
          </ErrorEdge>
        )}
        {pageBody && targetError && <ErrorEdge testId="waivers-target-error">{targetError}</ErrorEdge>}

        {pageBody && !poolError && !poolSettled && (
          <Box>
            <Box role="status" sx={{
              fontSize: '14px', color: 'var(--ps-dim)', mb: '12px',
            }}
            >
              Loading players
            </Box>
            <PoolSkeleton />
          </Box>
        )}

        {pageBody && (
          <Box sx={{ display: { xs: 'block', md: 'none' } }}>
            <SegmentedControl
              aria-label="Waivers view"
              options={[
                TABS[0],
                {
                  ...TABS[1],
                  // The count is the radio's description, not part of its name.
                  describedBy: pendingCount > 0 ? 'waivers-claims-count' : undefined,
                  label: (
                    <>
                      My claims
                      {pendingCount > 0 && <span aria-hidden="true" style={{ fontWeight: 400, marginLeft: 8 }}>{pendingCount}</span>}
                    </>
                  ),
                },
              ]}
              value={tab}
              onChange={setTab}
              fill
            />
            <Box id="waivers-claims-count" sx={SR_ONLY_SX}>{`${pendingCount} pending claim${pendingCount === 1 ? '' : 's'}`}</Box>
          </Box>
        )}

        {pageBody && (
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: 'minmax(0, 1fr) 320px', lg: 'minmax(0, 1fr) 384px' },
              gap: '24px',
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
                gap: '16px',
                minWidth: 0,
              }}
            >
              <Frame
                tier="rule"
                labelledBy="waivers-claims-heading"
                data-testid="waivers-claims-card"
                head={<FrameHead><PixelHeading id="waivers-claims-heading">My claims</PixelHeading></FrameHead>}
              >
                {claimsStatus === 'error' ? (
                  <Box component="p" sx={{
                    m: 0, padding: '16px 20px', fontSize: '15px', color: 'var(--ps-dim)',
                  }}
                  >
                    Your claims could not be loaded.
                  </Box>
                ) : (
                  <WaiverClaims
                    claims={claims}
                    onMove={moveClaim}
                    onEdit={(claim) => setEditClaimId(claim.id)}
                    onCancel={cancelClaim}
                    busy={manageBusy}
                    orderError={orderError}
                    orderAnnouncement={orderAnnouncement}
                    orderSettled={orderSettled}
                    showBid={isFaab}
                  />
                )}
              </Frame>
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
        )}
        <Box role="status" aria-live="polite" sx={SR_ONLY_SX}>{nextNote}</Box>
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
        dropSuggestion={context?.dropSuggestion}
        onClose={() => setClaimId(null)}
        onClaimed={() => {
          announceNext.current = true;
          return refreshAfterAction();
        }}
      />
      <ClaimSheet
        open={editingClaim != null}
        player={editingClaim ? { id: editingClaim.playerId, name: editingClaim.playerName } : null}
        claim={editingClaim}
        onSave={(values) => editClaim(editingClaim, values)}
        leagueId={leagueId}
        availability={availability}
        roster={rosterData}
        onClose={() => setEditClaimId(null)}
      />
    </Box>
  );
}
