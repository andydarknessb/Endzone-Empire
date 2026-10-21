import React, { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Box,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
} from "@mui/material";
import apiClient from "../../api/apiClient";
import { readHttpFailure } from "../../lib/httpFailure";
import PlayerDecisionCard, { myTeam, freeAgent, waivers, rostered } from "../../widgets/player-decision-card";
import { toDecisionCardEntry } from "../../entities/player";
import { useWaiverClaims } from "../../entities/waiver-claim";
import { PlayerPool } from "../../widgets/player-pool";
import PlayerRow, { PlayerRowTableHead, playerRowColumnCount } from "../../widgets/player-row";
import { AddDropSheet, useAddPlayer } from "../../features/add-player";
import { DropConfirmationDialog, useDropPlayer } from "../../features/drop-player";
import { useClaimPlayer } from "../../features/claim-player";
import { useWatchPlayer } from "../../features/watch-player";
import { proposeTradeHref } from "../../features/propose-trade";
import { rosterActionForPhase } from "../../shared/lib/leaguePhase";
import { isRosterAtCapacity } from "../../shared/lib/rosterCapacity";
import { isPickemOnly } from "../../shared/lib/leagueType";
import {
  ErrorPanel, PixelHeading, PsButton, PsLink, psRootSx,
} from "../../shared/ui/playselect";

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

  // #1575: the manager's own pending waiver claim count, read through the
  // `waiver-claim` entity (#1671). null = unknown/hidden: best ball leagues
  // have no waivers so they never read it. A failed read or first read that
  // fails keeps the link hidden (no body for the league has been shown).
  // Re-read in `refreshAfterAction` (a new `refreshKey`) so every claim path
  // (row one-tap, Decision card) moves it, without Add/Watch blindly bumping a
  // counter. During a re-read the count keeps the last known value (#1686).
  const [claimsRefresh, setClaimsRefresh] = useState(0);
  const { claims: waiverClaims, loaded: claimsLoaded } = useWaiverClaims({
    leagueId: selectedLeague && !bestBall ? Number(selectedLeague) : null,
    refreshKey: claimsRefresh,
  });
  const pendingClaimCount =
    selectedLeague && !bestBall && claimsLoaded ? waiverClaims.pending.length : null;

  // Formal review round 2, f11: an add or a drop-and-add both change the
  // caller's own roster, so the drop pick a LATER at-capacity add offers
  // must be refreshed alongside the players list.
  const refreshAfterAction = useCallback(
    () => {
      setClaimsRefresh((n) => n + 1);
      return Promise.all([poolRef.current?.refresh(), fetchRoster()]);
    },
    [fetchRoster],
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
  // #1974, spec #1973 P1/P2: a full roster's Add opens the add and drop sheet
  // for that player, and a My team row's Drop confirms through the
  // drop-player feature (its Undo toast included).
  const [addDropPlayer, setAddDropPlayer] = useState(null);
  const { dropCandidate, requestDrop, closeDropConfirmation, confirmDrop } = useDropPlayer({
    leagueId: selectedLeague,
    refresh: refreshAfterAction,
  });
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
          kind: "button",
          label: "Drop",
          ariaLabel: `Drop ${player.name}`,
          onClick: () => requestDrop({ playerId: player.id, name: player.name }),
          disabled: rosterAction.disabled,
          helper: rosterAction.disabled ? rosterAction.helper : undefined,
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
          helper: player.availability?.teamName
            ? `Propose a trade with ${player.availability.teamName}.`
            : "Propose a trade for this player.",
        };
      return {
        kind: "button",
        // #1974 P5: the live label is the short "Add", named per player; the
        // disabled phases keep the phase's own label and helper.
        label: rosterAction.disabled ? rosterAction.label : rowPending ? "Adding…" : "Add",
        // WCAG 2.5.3: the busy state is in the name, not only the visible label.
        ariaLabel: rosterAction.disabled ? undefined : `${rowPending ? "Adding" : "Add"} ${player.name}`,
        // At a full roster a plain add is refused, so the tap opens the
        // add and drop sheet (#1974 P1).
        onClick: rosterAtCapacity ? () => setAddDropPlayer(player) : () => addToRoster(player),
        disabled: rosterAction.disabled || rowPending,
        helper: rosterAction.disabled
          ? rosterAction.helper
          : rosterAtCapacity
            ? "Your roster is full. Choose a player to drop."
            : rosterAction.helper,
      };
    },
    [activeLeague, addToRoster, claimFromRow, pendingPlayerId, requestDrop, rosterAction, rosterAtCapacity, selectedLeague],
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
  const contextLine = marketContext
    ? [
        marketContext.rosterCount != null && `${marketContext.rosterCount} / ${marketContext.rosterCapacity ?? "-"} rostered`,
        marketContext.waiverType === "faab" && `FAAB $${marketContext.faabRemaining ?? "-"}`,
        marketContext.waiverType === "priority" && `Waiver priority ${marketContext.waiverPriority ?? "-"}`,
      ].filter(Boolean).join(" · ")
    : "";
  return (
    <Box className="ps-root" sx={{ ...psRootSx, minHeight: "100%" }}>
      <Box
        sx={{
          width: "100%",
          maxWidth: "1440px",
          marginX: "auto",
          boxSizing: "border-box",
          padding: { xs: "24px 16px 48px", sm: "24px 32px 64px" },
          display: "flex",
          flexDirection: "column",
          gap: "24px",
        }}
      >
      <Box
        component="header"
        sx={{ display: "flex", flexWrap: "wrap", alignItems: "center", columnGap: "12px", rowGap: "8px" }}
      >
        <Box sx={{ display: "flex", flexDirection: "column", gap: "4px", minWidth: 0, flex: 1 }}>
          <PixelHeading level={1}>Players</PixelHeading>
          {/* Below md the League select lives in the Filters drawer, so the
              header names the league there. */}
          {activeLeague?.name && (
            <Box component="p" sx={{ display: { xs: "block", md: "none" }, m: 0, minWidth: 0, fontSize: "16px", color: "var(--ps-dim)" }}>
              {activeLeague.name}
            </Box>
          )}
          {contextLine && (
            <Box component="p" sx={{ m: 0, fontSize: { xs: "16px", sm: "17px" }, color: "var(--ps-dim)" }}>
              {contextLine}
            </Box>
          )}
        </Box>
        {selectedLeague && (
          <PsButton to={`/league/${selectedLeague}/lineup`}>Manage lineup</PsButton>
        )}
      </Box>
      {error && (
        <ErrorPanel title="Something went wrong" body={error} />
      )}
      {leaguesLoaded && leagues.length === 0 && (
        <Box component="p" sx={{ m: 0, fontSize: "16px", color: "var(--ps-dim)" }}>
          You&apos;re not in a fantasy league yet, so players can be browsed but
          not acquired. <PsLink to="/league">Go to Leagues</PsLink>
        </Box>
      )}
      <PlayerPool
        ref={poolRef}
        look="playselect"
        leagueId={selectedLeague}
        bestBall={bestBall}
        stickyHead
        ready={leaguesLoaded}
        columnCount={playerRowColumnCount(bestBall)}
        renderTableHead={(headProps) => <PlayerRowTableHead {...headProps} look="playselect" />}
        renderRow={(player, variant) => (
          <PlayerRow
            look="playselect"
            player={player}
            action={actionForPlayer(player)}
            watchAction={watchActionForPlayer(player)}
            bestBall={bestBall}
            variant={variant === "card" ? "card" : undefined}
            onOpenPlayer={setQuickViewId}
          />
        )}
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
            <PsLink to={`/league/${Number(selectedLeague)}/waivers`}>
              {`Pending claims (${pendingClaimCount})`}
            </PsLink>
          ) : null
        }
      />

      <PlayerDecisionCard
        look="playselect"
        open={quickViewId != null}
        onClose={() => setQuickViewId(null)}
        entry={toDecisionCardEntry(quickViewPlayer)}
        leagueId={selectedLeague ? Number(selectedLeague) : undefined}
        context={quickViewBuiltContext}
      />

      <AddDropSheet
        look="playselect"
        open={addDropPlayer != null}
        player={addDropPlayer}
        leagueId={selectedLeague}
        roster={roster}
        dropSuggestion={context?.dropSuggestion}
        onClose={() => setAddDropPlayer(null)}
        onAdded={refreshAfterAction}
      />
      <DropConfirmationDialog look="playselect" entry={dropCandidate} onClose={closeDropConfirmation} onConfirm={confirmDrop} />
      </Box>
    </Box>
  );
}

export default PlayerManagement;
