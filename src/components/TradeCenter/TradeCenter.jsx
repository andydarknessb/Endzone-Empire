import React, { useState, useEffect, useRef } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { Box, useMediaQuery } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import apiClient from '../../api/apiClient';
import { readHttpFailure } from '../../lib/httpFailure';
import { applyTeamProfileUpdate, subscribeToTeamProfileUpdates } from '../../lib/teamProfileEvents';
import LeagueBreadcrumb from '../LeagueBreadcrumb/LeagueBreadcrumb';
import { useLeague } from '../../hooks/useLeague';
import { isLeagueCreator } from '../../shared/lib/teamIdentity';
import { formatInstant } from '../../shared/lib/instantFormat';
import PlayerDecisionCard, { myTeam, rostered } from '../../widgets/player-decision-card';
import { toDecisionCardEntry } from '../../entities/player';
import '../../shared/ui/playselect/playselect.css';
import { PsButton, Skel } from '../../shared/ui/playselect/Controls';
import { Frame } from '../../shared/ui/playselect/Frame';
import { psRootSx } from '../../shared/ui/playselect/root';
import { pixelSx } from '../../shared/ui/playselect/type';
import TradeProposalCard from './TradeProposalCard';
import TradeDialog from './TradeDialog';
import TradeTabs from './TradeTabs';
import TradeAlert from './TradeAlert';
import { useSnackbar } from '../Snackbar/SnackbarProvider';

// Trades still awaiting a final outcome — active either because a decision
// is pending or because they're inside the post-accept league review window.
const ACTIVE_STATUSES = new Set(['pending', 'accepted']);

const PANEL_ID = 'trade-panel';

function toggleInSet(set, id) {
  const next = new Set(set);
  if (next.has(id)) {
    next.delete(id);
  } else {
    next.add(id);
  }
  return next;
}

function Shell({ children }) {
  return (
    <Box className="ps-root" sx={{ ...psRootSx, minHeight: '100%' }}>
      <Box
        data-testid="trade-center"
        sx={{
          maxWidth: '1280px',
          marginX: 'auto',
          boxSizing: 'border-box',
          padding: { xs: '14px 16px 48px', sm: '24px 32px 64px' },
          display: 'flex',
          flexDirection: 'column',
          gap: { xs: '16px', sm: '24px' },
        }}
      >
        {children}
      </Box>
    </Box>
  );
}

// A tertiary frame with a Pixel 16 title and a Dim sentence: the empty states and the Trade Block tab.
function Notice({ id, title, children }) {
  return (
    <Frame tier="rule" labelledBy={id} sx={{ padding: '32px 20px', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '8px' }}>
      <Box component="h2" id={id} sx={{ m: 0, ...pixelSx(16) }}>{title}</Box>
      <Box component="p" sx={{ m: 0, fontSize: '16px', color: 'var(--ps-dim)', maxWidth: '60ch', textWrap: 'pretty' }}>{children}</Box>
    </Frame>
  );
}

function Loading() {
  return (
    <Shell>
      <Box aria-busy="true" data-testid="page-skeleton" sx={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Skel width="200px" height={48} />
          <Skel width="140px" height={44} />
        </Box>
        {[0, 1, 2].map((n) => (
          <Frame key={n} tier="rule" component="div" sx={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <Skel width="60%" height={20} />
            <Skel width="100%" height={56} />
            <Skel width="40%" height={20} />
          </Frame>
        ))}
      </Box>
    </Shell>
  );
}

function TradeCenter() {
  const { leagueId } = useParams();
  const notify = useSnackbar();
  const theme = useTheme();
  const compact = useMediaQuery(theme.breakpoints.down('sm'), { noSsr: true });
  const [searchParams, setSearchParams] = useSearchParams();

  const [trades, setTrades] = useState(null);
  const [myTeamId, setMyTeamId] = useState(null);
  const [rosters, setRosters] = useState([]);
  const {
    league, viewerTeamId, loading: leagueLoading, error: leagueError, refetch: refetchLeague,
  } = useLeague(leagueId);

  const [loading, setLoading] = useState(true);
  // A failed read (Retry) and a refused action (the server's sentence) are different alerts.
  const [loadError, setLoadError] = useState(null);
  const [error, setError] = useState(null);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [sendError, setSendError] = useState(null);
  // One request at a time: an offer in flight, and the trade whose action is in flight. The refs guard the
  // press that lands before the disabled button has rendered.
  const [sending, setSending] = useState(false);
  const [busyTradeId, setBusyTradeId] = useState(null);
  const sendingRef = useRef(false);
  const busyRef = useRef(null);
  const [selectedTeamId, setSelectedTeamId] = useState('');
  const [sendIds, setSendIds] = useState(new Set());
  const [receiveIds, setReceiveIds] = useState(new Set());
  const [counterTradeId, setCounterTradeId] = useState(null);
  const [decisionCardPlayerId, setDecisionCardPlayerId] = useState(null);
  const [tab, setTab] = useState(0);

  // Focus: the h1 takes it back when a deep-linked dialog (no opener) closes; a card action that
  // moves its trade lands on that card's heading, the next one's, or the Pending tab.
  const titleRef = useRef(null);
  const tabsRef = useRef(null);
  const headingRefs = useRef(new Map());
  const deepLinkOpenRef = useRef(false);
  const [focusAfter, setFocusAfter] = useState(null);

  useEffect(() => {
    fetchAll();
    // fetchAll closes over leagueId, which is the explicit trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leagueId]);

  useEffect(() => subscribeToTeamProfileUpdates((update) => {
    if (Number(update.leagueId) !== Number(leagueId)) return;
    setRosters((prev) => prev.map((team) => applyTeamProfileUpdate(team, update, { name: 'teamName' })));
    setTrades((prev) => prev?.map((trade) => {
      let next = trade;
      if (Number(trade.proposing_team_id) === Number(update.teamId)) {
        next = {
          ...next,
          ...(Object.prototype.hasOwnProperty.call(update, 'name') ? { proposing_team_name: update.name } : {}),
          ...(Object.prototype.hasOwnProperty.call(update, 'avatarUrl') ? { proposing_team_avatar_url: update.avatarUrl } : {}),
          ...(Object.prototype.hasOwnProperty.call(update, 'avatarStaticUrl')
            ? { proposing_team_avatar_static_url: update.avatarStaticUrl }
            : {}),
        };
      }
      if (Number(trade.receiving_team_id) === Number(update.teamId)) {
        next = {
          ...next,
          ...(Object.prototype.hasOwnProperty.call(update, 'name') ? { receiving_team_name: update.name } : {}),
          ...(Object.prototype.hasOwnProperty.call(update, 'avatarUrl') ? { receiving_team_avatar_url: update.avatarUrl } : {}),
          ...(Object.prototype.hasOwnProperty.call(update, 'avatarStaticUrl')
            ? { receiving_team_avatar_static_url: update.avatarStaticUrl }
            : {}),
        };
      }
      return next;
    }) ?? prev);
  }), [leagueId]);

  // The Players list row's Trade action deep-links here as
  // `?receivingTeamId=&playerId=` (#1310, `src/features/propose-trade`):
  // once rosters have loaded, preselect that team in the propose dialog and
  // check the player in "You receive" - the row's Trade action only ever
  // fires for a player rostered by ANOTHER team, so the deep link's player
  // belongs on the RECEIVING side, never "You send". Applied once per visit
  // (dealLinkAppliedRef) and the params are then dropped from the URL so
  // closing and reopening the dialog by hand doesn't resurrect it.
  const dealLinkAppliedRef = useRef(false);
  useEffect(() => {
    if (dealLinkAppliedRef.current) return;
    const receivingTeamIdParam = searchParams.get('receivingTeamId');
    if (!receivingTeamIdParam || rosters.length === 0) return;
    const teamId = Number(receivingTeamIdParam);
    const team = rosters.find((r) => r.teamId === teamId && r.teamId !== myTeamId);
    if (!team) return;
    dealLinkAppliedRef.current = true;
    const playerIdParam = searchParams.get('playerId');
    // Formal review formal-1310-f4: a stale or mistyped playerId (the player
    // has since been traded/dropped) must not land in `receiveIds` uncheck-
    // able - RosterColumn only renders a checkbox for a player actually on
    // `team.players`, so a playerId that fails this same test would sit in
    // receiveIds with no checkbox to represent it, yet still ride along in
    // handleSendOffer's `[...sendIds, ...receiveIds]`. Preselect it only when
    // the receiving team's own roster actually carries that id.
    const playerId = playerIdParam ? Number(playerIdParam) : null;
    const playerOnTeam = playerId != null && (team.players || []).some((p) => p.id === playerId);
    setSelectedTeamId(teamId);
    setSendIds(new Set());
    setReceiveIds(playerOnTeam ? new Set([playerId]) : new Set());
    setCounterTradeId(null);
    setSendError(null);
    deepLinkOpenRef.current = true;
    setDialogOpen(true);
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.delete('receivingTeamId');
      next.delete('playerId');
      return next;
    }, { replace: true });
  }, [rosters, myTeamId, searchParams, setSearchParams]);

  // A deep link has no opener to give focus back to, so the h1 takes it when the dialog closes.
  useEffect(() => {
    if (dialogOpen || !deepLinkOpenRef.current) return;
    deepLinkOpenRef.current = false;
    titleRef.current?.focus();
  }, [dialogOpen]);

  const fetchTrades = async () => {
    const res = await apiClient.get(`/api/trades?leagueId=${leagueId}`);
    setMyTeamId(res.data.myTeamId);
    setTrades(res.data.trades || []);
  };

  const fetchAll = async () => {
    try {
      setLoading(true);
      setLoadError(null);
      const [tradesRes, rostersRes] = await Promise.all([
        apiClient.get(`/api/trades?leagueId=${leagueId}`),
        apiClient.get(`/api/league/${leagueId}/rosters`),
      ]);
      setMyTeamId(tradesRes.data.myTeamId);
      setTrades(tradesRes.data.trades || []);
      setRosters(rostersRes.data || []);
    } catch (err) {
      setLoadError(readHttpFailure(err).message || err.message);
    } finally {
      setLoading(false);
    }
  };

  const retry = () => {
    fetchAll();
    if (leagueError) refetchLeague();
  };

  const handleOpenDialog = () => {
    setSelectedTeamId('');
    setSendIds(new Set());
    setReceiveIds(new Set());
    setCounterTradeId(null);
    setSendError(null);
    setDialogOpen(true);
  };

  // Opens the propose dialog pre-filled with the trade inverted: the team
  // that sent the original offer, with the sides swapped from the viewer's
  // perspective, so the user only has to adjust before sending.
  const handleOpenCounter = (trade) => {
    const requestedFromMe = (trade.items || []).filter((i) => i.from_team_id === trade.receiving_team_id);
    const offeredToMe = (trade.items || []).filter((i) => i.from_team_id === trade.proposing_team_id);
    setSelectedTeamId(trade.proposing_team_id);
    setSendIds(new Set(requestedFromMe.map((i) => i.player_id)));
    setReceiveIds(new Set(offeredToMe.map((i) => i.player_id)));
    setCounterTradeId(trade.id);
    setSendError(null);
    setDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setDialogOpen(false);
    setCounterTradeId(null);
    setSendError(null);
  };

  const handleTeamChange = (teamId) => {
    setSelectedTeamId(teamId);
    setSendIds(new Set());
    setReceiveIds(new Set());
  };

  const visibleTrades = (list = trades) => (list || []).filter(
    (t) => (tab === 0 ? ACTIVE_STATUSES.has(t.status) : tab === 1 && !ACTIVE_STATUSES.has(t.status))
  );

  // The card's footer button is gone once its action lands: focus goes to that card's heading (it
  // stays Pending as Accepted), else the next card's, else the Pending tab.
  const markMoved = (tradeId) => {
    const order = visibleTrades().map((t) => t.id);
    return () => setFocusAfter({ tradeId, order });
  };

  useEffect(() => {
    if (!focusAfter) return;
    const { tradeId, order } = focusAfter;
    setFocusAfter(null);
    const stillThere = new Set(visibleTrades().map((t) => t.id));
    const after = order.slice(order.indexOf(tradeId) + 1);
    const before = order.slice(0, order.indexOf(tradeId)).reverse();
    const targetId = [tradeId, ...after, ...before].find((id) => stillThere.has(id));
    const target = targetId != null ? headingRefs.current.get(targetId) : tabsRef.current?.querySelector('[role="tab"]');
    target?.focus();
    // visibleTrades reads the render this effect was created in, which is the one that carries the new list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusAfter]);

  const handleSendOffer = async () => {
    if (sendingRef.current) return;
    sendingRef.current = true;
    setSending(true);
    try {
      setSendError(null);
      const playerIds = [...sendIds, ...receiveIds];
      const settled = counterTradeId ? markMoved(counterTradeId) : null;
      if (counterTradeId) {
        await apiClient.post(`/api/trades/${counterTradeId}/counter`, { playerIds });
      } else {
        await apiClient.post('/api/trades', {
          leagueId: Number(leagueId),
          receivingTeamId: selectedTeamId,
          playerIds,
        });
      }
      setDialogOpen(false);
      notify(counterTradeId ? 'Counter offer sent' : 'Trade offer sent');
      setCounterTradeId(null);
      await fetchTrades();
      if (settled) settled();
    } catch (err) {
      // The refusal stays with the dialog, which stays open: the same press is the retry.
      setSendError(readHttpFailure(err).message || err.message);
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  };

  const performAction = async (trade, url, body, message) => {
    if (busyRef.current === trade.id) return;
    busyRef.current = trade.id;
    setBusyTradeId(trade.id);
    try {
      setError(null);
      const settled = markMoved(trade.id);
      await apiClient.post(url, body);
      notify(message);
      await fetchTrades();
      settled();
    } catch (err) {
      const failure = readHttpFailure(err).message || err.message;
      setError(failure);
      notify(failure, { severity: 'error' });
    } finally {
      busyRef.current = null;
      setBusyTradeId(null);
    }
  };

  const handleAccept = (trade) =>
    performAction(trade, `/api/trades/${trade.id}/respond`, { action: 'accept' }, 'Trade accepted');

  const handleReject = (trade) =>
    performAction(trade, `/api/trades/${trade.id}/respond`, { action: 'reject' }, 'Trade rejected');

  const handleCancel = (trade) =>
    performAction(trade, `/api/trades/${trade.id}/cancel`, {}, 'Trade cancelled');

  const handleVeto = (trade) =>
    performAction(trade, `/api/trades/${trade.id}/veto`, {}, 'Veto vote recorded');

  const handleForceApprove = (trade) =>
    performAction(trade, `/api/trades/${trade.id}/decide`, { approve: true }, 'Trade approved');

  const handleCommissionerVeto = (trade) =>
    performAction(trade, `/api/trades/${trade.id}/decide`, { approve: false }, 'Trade vetoed');

  if ((loading || leagueLoading) && trades === null) return <Loading />;

  const myRoster = rosters.find((r) => r.teamId === myTeamId);
  const otherTeams = rosters.filter((r) => r.teamId !== myTeamId);
  const theirRoster = rosters.find((r) => r.teamId === selectedTeamId);

  // The Decision card's entry for whichever player a name button opened
  // (#1311, ADR 0040 ruling d): looked up first off a roster row (the fuller
  // shape the dialog's roster columns read), falling back to the
  // trade item itself (name/position/nfl_team, all a trade row carries) for
  // a player on neither roster the viewer has loaded (e.g. a third team's in
  // a veto vote). The built context is `myTeam({ managed: false })` only
  // when the player sits on the viewer's own roster, else `rostered({ ... })`
  // (#1513) - TradeCenter never opens the card for a free agent or a waivers
  // player.
  const decisionCardPlayer = decisionCardPlayerId == null
    ? null
    : rosters.flatMap((r) => r.players || []).find((p) => p.id === decisionCardPlayerId)
      || (() => {
        const item = trades?.flatMap((t) => t.items || []).find((i) => i.player_id === decisionCardPlayerId);
        return item
          ? { id: item.player_id, name: item.name, position: item.position, nfl_team: item.nfl_team }
          : null;
      })();
  const decisionCardEntry = toDecisionCardEntry(decisionCardPlayer);
  const decisionCardIsMyPlayer = (myRoster?.players || []).some((p) => p.id === decisionCardPlayerId);
  // #1513, ADR 0040 follow-up: the built context - myTeam({ managed: false })
  // read-only (TradeCenter wires no lineup handlers), rostered otherwise,
  // named off the owning roster already loaded here. #1515 (T19): the card
  // now reads "Rostered by" off `context.availability` - `rostered(...)`
  // already carries this same value, so the loose `availability` prop below
  // was redundant and is gone.
  const decisionCardOwnerRoster = decisionCardIsMyPlayer
    ? null
    : rosters.find((r) => (r.players || []).some((p) => p.id === decisionCardPlayerId));
  const decisionCardAvailability = decisionCardOwnerRoster?.teamName
    ? { teamName: decisionCardOwnerRoster.teamName }
    : {};
  const decisionCardBuiltContext = decisionCardIsMyPlayer
    ? myTeam({ managed: false })
    : rostered({ availability: decisionCardAvailability });
  // The creator's Team against the reader's own, both from league detail
  // (#113): the same question as before, with no account id in the client.
  const isCommissioner = !!(league && (league.is_commissioner || isLeagueCreator(league, viewerTeamId)));

  const pendingTrades = (trades || []).filter((t) => ACTIVE_STATUSES.has(t.status));
  const completedTrades = (trades || []).filter((t) => !ACTIVE_STATUSES.has(t.status));

  // The one cursor: the oldest incoming pending offer. Nothing else on the page asks for the viewer.
  const cursorTrade = pendingTrades
    .filter((t) => t.status === 'pending' && myTeamId != null && t.receiving_team_id === myTeamId)
    .reduce((oldest, t) => {
      if (!oldest) return t;
      const a = new Date(t.created_at).getTime();
      const b = new Date(oldest.created_at).getTime();
      return (Number.isFinite(a) ? a : Infinity) < (Number.isFinite(b) ? b : Infinity) ? t : oldest;
    }, null);

  const renderTradeCard = (trade) => {
    const itemsFromProposing = (trade.items || []).filter(
      (i) => i.from_team_id === trade.proposing_team_id
    );
    const itemsFromReceiving = (trade.items || []).filter(
      (i) => i.from_team_id === trade.receiving_team_id
    );
    const isReceivingTeam = myTeamId === trade.receiving_team_id;
    const isProposingTeam = myTeamId === trade.proposing_team_id;
    const notInTrade = !isReceivingTeam && !isProposingTeam;
    const isPendingOrAccepted = trade.status === 'pending' || trade.status === 'accepted';

    // The left column is always "You Receive" when the viewer is a party to
    // the trade; an uninvolved league member (e.g. voting to veto) sees both
    // sides labeled by team name instead, each naming what that team RECEIVES
    // (the players the other side sends).
    let leftLabel;
    let leftItems;
    let rightLabel;
    let rightItems;
    if (isReceivingTeam) {
      leftLabel = 'You Receive';
      leftItems = itemsFromProposing;
      rightLabel = `${trade.proposing_team_name} Receives`;
      rightItems = itemsFromReceiving;
    } else if (isProposingTeam) {
      leftLabel = 'You Receive';
      leftItems = itemsFromReceiving;
      rightLabel = `${trade.receiving_team_name} Receives`;
      rightItems = itemsFromProposing;
    } else {
      leftLabel = `${trade.proposing_team_name} Receives`;
      leftItems = itemsFromReceiving;
      rightLabel = `${trade.receiving_team_name} Receives`;
      rightItems = itemsFromProposing;
    }

    const actions = [];
    if (isReceivingTeam && trade.status === 'pending') {
      actions.push({ key: 'accept', label: 'Accept Trade', onClick: () => handleAccept(trade) });
      actions.push({ key: 'reject', label: 'Decline', onClick: () => handleReject(trade) });
      actions.push({ key: 'counter', label: 'Counter', onClick: () => handleOpenCounter(trade) });
    }
    if (isProposingTeam && trade.status === 'pending') {
      actions.push({ key: 'cancel', label: 'Cancel', onClick: () => handleCancel(trade) });
    }
    if (notInTrade && trade.status === 'accepted') {
      actions.push({ key: 'veto', label: 'Vote to Veto', onClick: () => handleVeto(trade) });
    }
    // Integrity: a commissioner never overrides a trade their own team is in.
    const commissionerActions = isCommissioner && isPendingOrAccepted && notInTrade
      ? [
        { key: 'force-approve', label: 'Force Approve', onClick: () => handleForceApprove(trade) },
        { key: 'commissioner-veto', label: 'Commissioner Veto', onClick: () => handleCommissionerVeto(trade) },
      ]
      : [];

    return (
      <TradeProposalCard
        key={trade.id}
        trade={trade}
        leagueId={leagueId}
        viewerTeamId={myTeamId}
        leftLabel={leftLabel}
        leftItems={leftItems}
        rightLabel={rightLabel}
        rightItems={rightItems}
        onOpenPlayer={setDecisionCardPlayerId}
        actions={actions}
        commissionerActions={commissionerActions}
        cursor={tab === 0 && cursorTrade?.id === trade.id}
        busy={busyTradeId === trade.id}
        headingRef={(el) => {
          if (el) headingRefs.current.set(trade.id, el);
          else headingRefs.current.delete(trade.id);
        }}
      />
    );
  };

  const zone = formatInstant(new Date(), 'zone') || 'your time zone';
  const subLine = league?.trade_deadline_week != null
    ? `Trade deadline Week ${league.trade_deadline_week} · times in ${zone}`
    : `Times in ${zone}`;

  return (
    <Shell>
      <Box component="section" aria-labelledby="trade-center-title" sx={{ display: 'flex', flexDirection: 'column', gap: '4px', minWidth: 0 }}>
        <LeagueBreadcrumb name={league?.name} />
        <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: '12px 24px' }}>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: '12px', minWidth: 0 }}>
            <Box
              component="h1"
              id="trade-center-title"
              ref={titleRef}
              tabIndex={-1}
              sx={{
                m: 0, ...pixelSx(16), fontSize: { xs: '24px', md: '32px' }, lineHeight: 1.3, overflowWrap: 'break-word',
              }}
            >
              Trade Center
            </Box>
            <Box component="p" sx={{ m: 0, fontSize: { xs: '16px', sm: '17px' }, color: 'var(--ps-dim)', textWrap: 'pretty' }}>{subLine}</Box>
          </Box>
          <PsButton variant="ghost" onClick={handleOpenDialog}>Propose Trade</PsButton>
        </Box>
      </Box>

      <TradeTabs ref={tabsRef} value={tab} onChange={setTab} panelId={PANEL_ID} />

      {(loadError || leagueError) && (
        <TradeAlert detail={loadError || leagueError} onRetry={retry}>We could not load trades.</TradeAlert>
      )}
      {error && <TradeAlert>{error}</TradeAlert>}

      <Box
        component="section"
        id={PANEL_ID}
        role="tabpanel"
        aria-labelledby={`trade-tab-${tab}`}
        sx={{ display: 'flex', flexDirection: 'column', gap: '12px', minWidth: 0 }}
      >
        {tab === 0 && (pendingTrades.length === 0
          ? <Notice id="trade-empty-pending" title="No Pending Trades">Trades proposed by you or to you will appear here.</Notice>
          : pendingTrades.map(renderTradeCard))}

        {tab === 1 && (completedTrades.length === 0
          ? <Notice id="trade-empty-completed" title="No Completed Trades">Executed, declined, and cancelled trades will show up here.</Notice>
          : completedTrades.map(renderTradeCard))}

        {tab === 2 && (
          <Notice id="trade-block" title="Trade Block">
            Mark players as available so the rest of the league can make an offer. Coming soon.
          </Notice>
        )}
      </Box>

      {dialogOpen && (
        <TradeDialog
          open
          onClose={handleCloseDialog}
          title={counterTradeId ? 'Counter Trade' : 'Propose Trade'}
          leagueId={leagueId}
          counter={counterTradeId != null}
          otherTeams={otherTeams}
          selectedTeamId={selectedTeamId}
          onTeamChange={handleTeamChange}
          myRoster={myRoster}
          theirRoster={theirRoster}
          sendIds={sendIds}
          receiveIds={receiveIds}
          onToggleSend={(id) => setSendIds((prev) => toggleInSet(prev, id))}
          onToggleReceive={(id) => setReceiveIds((prev) => toggleInSet(prev, id))}
          onSend={handleSendOffer}
          sendError={sendError}
          sending={sending}
          onOpenPlayer={setDecisionCardPlayerId}
          compact={compact}
        />
      )}

      {/* #1515 (T19): `availability` rides inside the built context now (the
          rostered() builder already carries it) - no loose prop beside it. */}
      <PlayerDecisionCard
        open={decisionCardPlayerId != null}
        onClose={() => setDecisionCardPlayerId(null)}
        entry={decisionCardEntry}
        leagueId={Number(leagueId)}
        context={decisionCardBuiltContext}
      />
    </Shell>
  );
}

export default TradeCenter;
