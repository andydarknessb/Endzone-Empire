import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Link as RouterLink,
  useSearchParams,
} from "react-router-dom";
import {
  Alert,
  Box,
  Button,
  FormControl,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Typography,
  Chip,
} from "@mui/material";
import apiClient from "../../api/apiClient";
import { readHttpFailure } from "../../lib/httpFailure";
import PlayerDecisionCard, { myTeam, freeAgent, waivers, rostered } from "../../widgets/player-decision-card";
import { toDecisionCardEntry } from "../../entities/player";
import { PlayerPool } from "../../widgets/player-pool";
import { useAddPlayer } from "../../features/add-player";
import { useClaimPlayer } from "../../features/claim-player";
import { useWatchPlayer } from "../../features/watch-player";
import { proposeTradeHref } from "../../features/propose-trade";
import { rosterActionForPhase } from "../../shared/lib/leaguePhase";
import { isRosterAtCapacity } from "../../shared/lib/rosterCapacity";
import { isPickemOnly } from "../../shared/lib/leagueType";

const actionSx = {
  minHeight: 44,
  minWidth: 104,
  borderRadius: 2,
  fontWeight: 800,
};

function availabilityOf(player) {
  return player.availability?.state || "free_agent";
}

// The list itself (search, filters, sort, pager, rows) is the player-pool
// widget (#1610); this page owns the league picker, the market context, and
// the row / Decision card actions the widget renders.
function PlayerManagement() {
  const [leagues, setLeagues] = useState([]);
  const [leaguesLoaded, setLeaguesLoaded] = useState(false);
  const [players, setPlayers] = useState([]);
  const [context, setContext] = useState(null);
  const [error, setError] = useState(null);
  const [quickViewId, setQuickViewId] = useState(null);
  const poolRef = useRef(null);
  // Formal review round 1, f3: the Decision card's free-agent action bar
  // needs the caller's own roster for its at-capacity drop pick.
  const [roster, setRoster] = useState([]);
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedLeague = searchParams.get("league") || "";
  const activeLeague = leagues.find(
    (league) => String(league.id) === selectedLeague,
  );
  const rosterAction = rosterActionForPhase(activeLeague);
  const bestBall = !!activeLeague?.best_ball;

  const updateParams = useCallback(
    (updates) => {
      setSearchParams((previous) => {
        const next = new URLSearchParams(previous);
        Object.entries(updates).forEach(([key, value]) => {
          if (
            value === "" ||
            value == null ||
            value === false ||
            value === "all"
          )
            next.delete(key);
          else next.set(key, String(value));
        });
        return next;
      });
    },
    [setSearchParams],
  );
  const report = useCallback(
    (err) => setError(readHttpFailure(err).message || err.message),
    [],
  );

  useEffect(() => {
    (async () => {
      try {
        const response = await apiClient.get("/api/league");
        const rosterLeagues = response.data.filter(
          (league) => !isPickemOnly(league),
        );
        setLeagues(rosterLeagues);
        setLeaguesLoaded(true);
        if (
          rosterLeagues.length > 0 &&
          !rosterLeagues.some((league) => String(league.id) === selectedLeague)
        )
          updateParams({ league: rosterLeagues[0].id, page: 1 });
      } catch (err) {
        report(err);
      }
    })();
  }, [report, selectedLeague, updateParams]);

  const fetchRoster = useCallback(async () => {
    if (!selectedLeague) {
      setRoster([]);
      return;
    }
    try {
      const response = await apiClient.get(
        `/api/team/roster?leagueId=${Number(selectedLeague)}`,
      );
      setRoster(response.data || []);
    } catch (err) {
      // Best-effort, like WaiverWire's own upgrade suggestions: a failed
      // roster read only means the at-capacity drop pick has no options,
      // never a page-level error.
      setRoster([]);
    }
  }, [selectedLeague]);
  useEffect(() => {
    fetchRoster();
  }, [fetchRoster]);

  // #1575: the manager's own pending waiver claim count, read once per
  // league from the same `GET /api/waivers?leagueId=N` WaiverWire makes
  // (`myClaims`, filtered to pending client-side). null = unknown/hidden;
  // best ball leagues have no waivers, so they never read it. Re-read in
  // `refreshAfterAction` so every claim path (row one-tap, Decision card)
  // moves it, without Add/Watch blindly bumping a counter.
  const [pendingClaimCount, setPendingClaimCount] = useState(null);
  const fetchPendingClaimCount = useCallback(async () => {
    if (!selectedLeague || bestBall) return;
    try {
      const response = await apiClient.get(`/api/waivers?leagueId=${Number(selectedLeague)}`);
      const claims = response.data?.myClaims || [];
      setPendingClaimCount(claims.filter((claim) => claim.status === "pending").length);
    } catch (err) {
      // Best-effort: without the count the link simply stays hidden (or
      // keeps its last known value after an action-time re-read fails).
    }
  }, [selectedLeague, bestBall]);
  useEffect(() => {
    setPendingClaimCount(null);
    fetchPendingClaimCount();
  }, [fetchPendingClaimCount]);

  // Formal review round 2, f11: an add or a drop-and-add both change the
  // caller's own roster, so the drop pick a LATER at-capacity add offers
  // must be refreshed alongside the players list.
  const refreshAfterAction = useCallback(
    () => Promise.all([poolRef.current?.refresh(), fetchRoster(), fetchPendingClaimCount()]),
    [fetchRoster, fetchPendingClaimCount],
  );
  // Formal review formal-1310-f3: `useAddPlayer`/`useClaimPlayer` each hold
  // ONE page-wide `pending` boolean, so applying it to every row's action
  // (the original risk-review fix for the double-submit gap) relabeled and
  // disabled every waivers/free-agent row at once - a screen-reader user on
  // player B heard a claim in progress for a player they never touched.
  // Tracked here instead, by the ONE player id whose request is in flight,
  // so only that row's button goes busy.
  const [pendingPlayerId, setPendingPlayerId] = useState(null);
  // Formal review round 1, f4: the row's own Add action now consumes the
  // SAME implementation the Decision card's free-agent bar does, rather than
  // a parallel POST that could drift from it (the lead correction's own
  // wording: "PlayerManagement then consumes the feature").
  const { addPlayer } = useAddPlayer({ leagueId: selectedLeague, onDone: refreshAfterAction });
  const addToRoster = useCallback(
    async (player) => {
      setError(null);
      setPendingPlayerId(player.id);
      const { ok, message } = await addPlayer({ playerId: player.id, playerName: player.name });
      setPendingPlayerId(null);
      if (!ok) setError(message);
    },
    [addPlayer],
  );
  // #1310, ADR 0040 Lead correction item 6: the row's Claim action goes
  // through the SAME claim-player feature WaiverWire's own claim dialog
  // submits with - a one-tap claim (no drop pick, no bid) straight from the
  // list, the row-level counterpart to Add's own direct call above. A
  // manager who wants a FAAB bid still reaches the fuller Decision card
  // action bar by opening the row's own Quick view.
  //
  // At roster capacity the one-tap claim cannot succeed: the server 409s
  // with "choose a player to drop" and the row had nowhere to choose one.
  // `actionForPlayer` below routes that case to the Decision card's claim
  // bar, whose drop pick is required there, the same gate `AddPlayerAction`
  // gives a free-agent add.
  const rosterAtCapacity = isRosterAtCapacity(context);
  const { submitClaim } = useClaimPlayer({ leagueId: selectedLeague, onDone: refreshAfterAction });
  const claimFromRow = useCallback(
    async (player) => {
      setError(null);
      setPendingPlayerId(player.id);
      const { ok, message } = await submitClaim({ playerId: player.id, dropPlayerId: null, bid: 0 });
      setPendingPlayerId(null);
      if (!ok) setError(message);
    },
    [submitClaim],
  );
  // #1312, ADR 0040 follow-up (grill ruling Q6): the row's own Watch toggle,
  // the same one-tap shape `claimFromRow` already gives the row - its own
  // per-row busy id, scoped separately from `pendingPlayerId` (Claim/Add's
  // own tracker) since the two actions are independent and a manager may
  // watch a row while an unrelated claim is still in flight.
  const { toggleWatch } = useWatchPlayer({ leagueId: selectedLeague, onDone: refreshAfterAction });
  const [pendingWatchPlayerId, setPendingWatchPlayerId] = useState(null);
  const watchActionForPlayer = useCallback(
    (player) => {
      if (!selectedLeague) return null;
      return {
        watching: Boolean(player.watching),
        pending: pendingWatchPlayerId === player.id,
        onClick: async () => {
          setPendingWatchPlayerId(player.id);
          await toggleWatch({ playerId: player.id, watching: Boolean(player.watching) });
          setPendingWatchPlayerId(null);
        },
      };
    },
    [pendingWatchPlayerId, selectedLeague, toggleWatch],
  );
  const actionForPlayer = useCallback(
    (player) => {
      const state = availabilityOf(player);
      // Formal review formal-1310-f3: busy state is scoped to THIS row's own
      // player id, never the page-wide pending booleans the hooks return.
      const rowPending = pendingPlayerId === player.id;
      const faabLeague = activeLeague?.waiver_type === "faab";
      const opensClaimCard = rosterAtCapacity || faabLeague;
      if (!selectedLeague)
        return {
          kind: "button",
          label: "Select league",
          disabled: true,
          helper: "Select a fantasy league to manage players.",
        };
      if (state === "waivers")
        return {
          kind: "button",
          // Risk-review finding: a one-tap claim with no busy state let a
          // repeated Enter/click fire the same waiver claim twice before the
          // first request's snackbar ever appeared - disabling for the
          // request's own duration is the same guard Add already gets below
          // from `rosterAction.disabled`. At capacity the tap opens the
          // Decision card's claim bar instead (see `rosterAtCapacity`). In a
          // FAAB league (#1576) a one-tap claim would post a silent $0 bid that
          // loses to any $1 bid, so the tap opens the card, which collects the bid.
          label: rowPending ? "Claiming…" : "Claim",
          onClick: opensClaimCard ? () => setQuickViewId(player.id) : () => claimFromRow(player),
          disabled: rowPending,
          helper: rosterAtCapacity
            ? "Your roster is full. Choose a player to drop in the claim card."
            : faabLeague
              ? "Place a FAAB bid for this player in the claim card."
              : "Submit a waiver claim for this player.",
        };
      if (state === "my_team")
        return {
          kind: "link",
          to: `/league/${selectedLeague}/lineup`,
          label: "Lineup",
          variant: "text",
          helper: "Manage this player in Team Lineup.",
        };
      if (state === "rostered")
        return {
          kind: "link",
          to: proposeTradeHref({
            leagueId: selectedLeague,
            receivingTeamId: player.availability?.teamId,
            playerId: player.id,
          }),
          label: "Trade",
          variant: "outlined",
          helper: player.availability?.teamName
            ? `Propose a trade with ${player.availability.teamName}.`
            : "Propose a trade for this player.",
        };
      return {
        kind: "button",
        label: rowPending ? "Adding…" : rosterAction.label,
        onClick: () => addToRoster(player),
        disabled: rosterAction.disabled || rowPending,
        variant: "contained",
        helper: rosterAction.helper,
      };
    },
    [activeLeague, addToRoster, claimFromRow, pendingPlayerId, rosterAction, rosterAtCapacity, selectedLeague],
  );
  const quickViewPlayer = players.find((player) => player.id === quickViewId);
  const marketContext =
    context ||
    (activeLeague
      ? {
          leagueName: activeLeague.name,
          waiverType: activeLeague.waiver_type,
          faabRemaining: activeLeague.my_team_faab_remaining,
          waiverPriority: activeLeague.my_team_waiver_priority,
        }
      : null);
  const quickViewContext = quickViewPlayer ? availabilityOf(quickViewPlayer) : "my_team";
  // #1307, ADR 0040: the free-agent/waivers action bar's own copy (roster
  // count for the drop-pick gate, priority/FAAB for a claim). `rostered`'s
  // own availability (below, `quickViewPlayer.availability`) already carries
  // `teamName` when known - #1515 (T19) is what lets the card actually show
  // it now that `context.availability` is read for every kind, not only the
  // loose prop the free_agent/waivers branches used before.
  const quickViewAvailability =
    quickViewContext === "free_agent"
      ? { rosterCount: marketContext?.rosterCount, rosterCapacity: marketContext?.rosterCapacity }
      : quickViewContext === "waivers"
      ? {
          rosterCount: marketContext?.rosterCount,
          rosterCapacity: marketContext?.rosterCapacity,
          waiverPriority: marketContext?.waiverType === "priority" ? marketContext?.waiverPriority : undefined,
          faabRemaining: marketContext?.waiverType === "faab" ? marketContext?.faabRemaining : undefined,
        }
      : undefined;
  // #1513, ADR 0040 follow-up: the built context, picked by the same
  // `quickViewContext` state above. `rostered` reads the row's own
  // `availability` fact directly (it already carries `teamName` when known,
  // same as the Trade action's helper text below). #1515 (T19): every
  // builder here also carries the prev/next pair over this page's own
  // player list. Formal review f1: `onActionDone` (the Watch toggle's
  // refresh, spec #1494's action-done callback for the two acquire builders
  // too) goes to all four now - AC4 ("every surface's card behaviour is
  // unchanged") means the own-player and rostered opens keep the SAME
  // refresh-after-Watch they had before this ticket, via the loose prop
  // every context shared.
  const quickViewShared = {
    playerIds: players.map((player) => player.id),
    onNavigate: setQuickViewId,
    onActionDone: refreshAfterAction,
  };
  const quickViewBuiltContext =
    !quickViewPlayer
      ? myTeam({ managed: false, ...quickViewShared })
      : quickViewContext === "free_agent"
      ? freeAgent({ availability: quickViewAvailability, roster, ...quickViewShared })
      : quickViewContext === "waivers"
      ? waivers({ availability: quickViewAvailability, roster, ...quickViewShared })
      : quickViewContext === "rostered"
      ? rostered({ availability: quickViewPlayer.availability || {}, ...quickViewShared })
      : myTeam({ managed: false, ...quickViewShared });
  return (
    <Box
      component="main"
      sx={{
        width: "100%",
        maxWidth: 1280,
        mx: "auto",
        px: { xs: 1.5, sm: 3 },
        py: { xs: 2, md: 4 },
      }}
    >
      <Paper
        component="header"
        elevation={0}
        sx={{
          p: { xs: 2, sm: 3 },
          mb: 2,
          color: "var(--on-accent)",
          background: "var(--gradient-brand)",
          borderRadius: 4,
        }}
      >
        <Stack
          direction={{ xs: "column", sm: "row" }}
          justifyContent="space-between"
          spacing={2}
          alignItems={{ sm: "center" }}
        >
          <Box>
            <Typography
              component="h1"
              variant="h4"
              sx={{ fontWeight: 900, letterSpacing: "-.03em" }}
            >
              Player Browser
            </Typography>
            <Typography variant="body2" sx={{ opacity: 0.82, mt: 0.5 }}>
              League-scoped player discovery and acquisition.
            </Typography>
          </Box>
          {selectedLeague && (
            <Button
              component={RouterLink}
              to={`/league/${selectedLeague}/lineup`}
              variant="outlined"
              color="inherit"
              sx={{ ...actionSx, borderColor: "var(--on-accent)" }}
            >
              Manage lineup
            </Button>
          )}
        </Stack>
      </Paper>
      {error && (
        <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}
      {leaguesLoaded && leagues.length === 0 && (
        <Alert
          severity="info"
          sx={{ mb: 2 }}
          action={
            <Button component={RouterLink} to="/league" color="inherit">
              Go to Leagues
            </Button>
          }
        >
          You&apos;re not in a fantasy league yet, so players can be browsed but
          not acquired.
        </Alert>
      )}
      {marketContext && (
        <Paper variant="outlined" sx={{ mb: 2, p: 1.5, borderRadius: 3 }}>
          <Stack
            direction={{ xs: "column", sm: "row" }}
            alignItems={{ sm: "center" }}
            justifyContent="space-between"
            spacing={1}
          >
            <Box>
              <Typography variant="subtitle2" component="p" sx={{ fontWeight: 800 }}>
                {marketContext.leagueName}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Your player marketplace
              </Typography>
            </Box>
            <Stack direction="row" useFlexGap flexWrap="wrap" spacing={0.75}>
              {marketContext.rosterCount != null && (
                <Chip
                  size="small"
                  label={`${marketContext.rosterCount} / ${marketContext.rosterCapacity ?? "-"} rostered`}
                />
              )}
              {marketContext.waiverType === "faab" && (
                <Chip
                  size="small"
                  color="secondary"
                  label={`FAAB $${marketContext.faabRemaining ?? "-"}`}
                />
              )}
              {marketContext.waiverType === "priority" && (
                <Chip
                  size="small"
                  color="secondary"
                  label={`Waiver priority ${marketContext.waiverPriority ?? "-"}`}
                />
              )}
            </Stack>
          </Stack>
        </Paper>
      )}
      <PlayerPool
        ref={poolRef}
        leagueId={selectedLeague}
        bestBall={bestBall}
        ready={leaguesLoaded}
        actionForPlayer={actionForPlayer}
        watchActionForPlayer={watchActionForPlayer}
        onOpenPlayer={setQuickViewId}
        onLoaded={({ players: nextPlayers, context: nextContext }) => {
          setPlayers(nextPlayers);
          setContext(nextContext);
        }}
        onError={setError}
        leadingControl={(layout) => {
          const row = layout === "row";
          return (
            <FormControl size="small" fullWidth={!row} sx={row ? { minWidth: 170 } : undefined}>
              <InputLabel id="pm-league-label">League</InputLabel>
              <Select
                labelId="pm-league-label"
                label="League"
                value={
                  leagues.some((league) => String(league.id) === selectedLeague)
                    ? selectedLeague
                    : ""
                }
                onChange={(event) => updateParams({ league: event.target.value, page: 1 })}
              >
                {leagues.map((league) => (
                  <MenuItem key={league.id} value={String(league.id)}>
                    {league.name}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          );
        }}
        afterAvailabilityControl={() =>
          pendingClaimCount !== null && !bestBall ? (
            <Button
              component={RouterLink}
              to={`/league/${Number(selectedLeague)}/waivers`}
              variant="text"
              size="small"
              sx={{ minHeight: 44, whiteSpace: "nowrap" }}
            >
              {`Pending claims (${pendingClaimCount})`}
            </Button>
          ) : null
        }
      />

      <PlayerDecisionCard
        open={quickViewId != null}
        onClose={() => setQuickViewId(null)}
        entry={toDecisionCardEntry(quickViewPlayer)}
        leagueId={selectedLeague ? Number(selectedLeague) : undefined}
        context={quickViewBuiltContext}
      />
    </Box>
  );
}

export default PlayerManagement;
