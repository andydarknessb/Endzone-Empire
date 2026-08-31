import React, { useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import {
  Container,
  Paper,
  Typography,
  Select,
  MenuItem,
  Menu,
  FormControl,
  InputLabel,
  Alert,
  Box,
  List,
  ListItemButton,
  Chip,
  Skeleton,
  Button,
  Collapse,
  IconButton,
  Divider,
  Tooltip,
} from '@mui/material';
import Grid from '@mui/material/Unstable_Grid2';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import AddIcon from '@mui/icons-material/Add';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import apiClient from '../../api/apiClient';
import LeagueBreadcrumb from '../LeagueBreadcrumb/LeagueBreadcrumb';
import { useLeague } from '../../hooks/useLeague';
import useResilientLineupMutation from '../../hooks/useResilientLineupMutation';
import { useSnackbar } from '../Snackbar/SnackbarProvider';
import InjuryBadge from '../InjuryBadge/InjuryBadge';
import PlayerQuickView from '../PlayerQuickView/PlayerQuickView';
import PlayerNameLink from '../PlayerQuickView/PlayerNameLink';
import { prefersReducedMotion } from '../../lib/reducedMotionMedia';

// Mirrors POSITION_GROUPS in server/services/lineup.service.js — group keys
// (DL/LB/DB) usable in a slot's eligiblePositions expand to every specific
// defensive position Tank01 reports in that group.
const POSITION_GROUPS = {
  DL: ['DL', 'DE', 'DT', 'NT'],
  LB: ['LB', 'ILB', 'OLB'],
  DB: ['DB', 'CB', 'S', 'FS', 'SS'],
};
const DEFAULT_STARTER_SLOT_ORDER = ['QB', 'RB', 'WR', 'TE', 'FLEX', 'K', 'DEF'];
const MIN_WEEK = 1;
const MAX_WEEK = 18;
const WEEK_OPTIONS = Array.from({ length: MAX_WEEK }, (_, i) => i + 1);
const PROJECTION_ENGINE_NAME = 'Endzone Forecast';
const IR_ELIGIBLE_DESIGNATIONS = new Set(['O', 'IR']);
const BEST_BALL_MANAGED_SLOTS = new Set(['BENCH', 'IR']);

/** A slot's configured eligiblePositions, with any group key expanded to its member positions. */
function slotEligiblePositions(rosterSlots, slotKey) {
  const slot = (rosterSlots || []).find((s) => s.key === slotKey);
  if (!slot) return [];
  const out = new Set();
  for (const p of slot.eligiblePositions || []) {
    (POSITION_GROUPS[p] || [p]).forEach((m) => out.add(m));
  }
  return [...out];
}

function isEligibleForSlot(position, slot, rosterSlots, injuryDesignation) {
  if (slot === 'BENCH') return true;
  if (slot === 'IR') return IR_ELIGIBLE_DESIGNATIONS.has(injuryDesignation);
  return slotEligiblePositions(rosterSlots, slot).includes(position);
}

function isValidIrStash(entry) {
  return Boolean(entry?.valid_stash);
}

function canResolveLockedIrStash(entry, targetSlot) {
  return entry?.locked
    && entry.slot === 'IR'
    && !isValidIrStash(entry)
    && targetSlot === 'BENCH';
}

// --- start/sit projection presentation -------------------------------------
//
// Everything below renders ONLY what the server actually sent. A factor the
// model could not evaluate arrives as null and is simply not drawn — the panel
// never prints "vs null", a 0 that looks like a measurement, or an opponent
// difficulty nobody computed.

const UNAVAILABLE_LABELS = { bye: 'on bye', out: 'out', ir: 'on IR' };

/**
 * What goes in the parentheses after a player's name. A player who cannot play
 * gets the REASON, not a projection: "0 proj" invites the reader to compare a
 * number that does not mean what a projection means. Every caller wraps this in
 * parentheses of its own, so the p10-p90 range is spelled out inline rather
 * than parenthesized again; the range is omitted when unknown.
 */
function describeSide(side) {
  const availability = side && side.availability;
  if (availability && availability.available === false) {
    return UNAVAILABLE_LABELS[availability.reason] || 'unavailable';
  }
  if (!side || side.projection == null) return null;
  const range = side.distribution;
  if (!range || range.p10 == null || range.p90 == null) return `${side.projection} proj`;
  return `${side.projection} proj, range ${range.p10}–${range.p90}`;
}

/**
 * Whole-percent odds text, or null when the server declined to calibrate one.
 * Both players are named: "he outscores him" is ambiguous read aloud and in a
 * caption that sits two lines below the headline naming them.
 */
function formatProbability(probability, suggestedName, currentName) {
  if (probability == null) return null;
  return `${Math.round(probability * 100)}% chance ${suggestedName} outscores ${currentName}`;
}

/**
 * Concise, factual chips for the factors that actually contributed. An
 * unavailable factor produces nothing at all rather than a chip claiming a
 * neutral result we never measured.
 */
function factorChipsFor(side) {
  const factors = side && side.factors;
  if (!factors) return [];
  const chips = [];
  const signed = (value) => `${value > 0 ? '+' : ''}${value}`;
  const { opponent, homeAway, versusOpponent, weather, availability } = factors;
  // The opponent's identity is already in the caption below the headline, so
  // this chip carries only what the caption cannot: how many points the
  // matchup actually moved the projection.
  if (opponent && opponent.available && opponent.pointsContribution != null) {
    chips.push({
      key: 'opponent',
      label: `Matchup ${signed(opponent.pointsContribution)}`,
      title: `Opponent difficulty, measured over ${opponent.games} games and capped`,
    });
  }
  if (homeAway && homeAway.available) {
    chips.push({
      key: 'homeAway',
      label: homeAway.isHome ? 'Home' : 'Away',
      title: 'Schedule orientation, measured from prior results at this position',
    });
  }
  if (versusOpponent && versusOpponent.available) {
    chips.push({
      key: 'versusOpponent',
      label: `${versusOpponent.meetings} prior meetings`,
      title: 'Head-to-head history, weighted very lightly',
    });
  }
  if (weather && weather.available && weather.shortForecast) {
    chips.push({
      key: 'weather',
      label: weather.shortForecast,
      title: 'Forecast context only. It is not scored into the projection.',
    });
  }
  if (availability && availability.status) {
    chips.push({
      key: 'availability',
      label: availability.status === 'Q' ? 'Questionable' : availability.status,
      title: availability.activeProbability == null
        ? 'Designation only. There is no reliable chance-to-play data behind it.'
        : 'Injury designation',
    });
  }
  return chips;
}

// Whether `selectedEntry` may legally land on this row: an empty slot only
// needs the one-way check, but an occupied row is a swap, so both players
// must be eligible for each other's slot. A locked occupant can never be a
// target regardless of position.
function isEligibleTarget(selectedEntry, targetEntry, slotType, rosterSlots) {
  if (selectedEntry.locked && !canResolveLockedIrStash(selectedEntry, slotType)) return false;
  if (!targetEntry) {
    return isEligibleForSlot(
      selectedEntry.position,
      slotType,
      rosterSlots,
      selectedEntry.injury_status
    );
  }
  if (targetEntry.locked) return false;
  const aEligible = isEligibleForSlot(
    selectedEntry.position,
    targetEntry.slot,
    rosterSlots,
    selectedEntry.injury_status
  );
  const bEligible = isEligibleForSlot(
    targetEntry.position,
    selectedEntry.slot,
    rosterSlots,
    targetEntry.injury_status
  );
  return aEligible && bEligible;
}

export function LineupEditor({ leagueId, showLeagueBreadcrumb = true }) {
  const notify = useSnackbar();
  const { saveLineup } = useResilientLineupMutation({
    onReplaySuccess: () => notify('Lineup saved'),
  });
  const [lineup, setLineup] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedWeek, setSelectedWeek] = useState(null);
  const [selectedEntry, setSelectedEntry] = useState(null);
  const [advice, setAdvice] = useState(null);
  const [adviceExpanded, setAdviceExpanded] = useState(true);
  const [benchSeasonTotal, setBenchSeasonTotal] = useState(null);
  const [quickViewId, setQuickViewId] = useState(null);
  const [quickPick, setQuickPick] = useState(null); // { anchorEl, slotType }
  const advicePanelRef = useRef(null);

  // GET /api/team/lineup doesn't carry the league's best_ball flag, and no
  // league object is otherwise available to this screen (it's reached
  // directly at /league/:leagueId/lineup with no league context passed
  // in) — read best_ball off the shared league fetch instead.
  const { league, loading: leagueLoading, error: leagueError } = useLeague(leagueId);

  // One tri-state read of the league's best-ball status (#217), replacing
  // the boolean `bestBall` that used to collapse "not loaded yet" AND
  // "the request failed" into "not best ball" — every consumer in this file
  // read that as a standard league, permanently in the failure case.
  //   - 'loading': the league request has not settled and never has, for
  //     this render — no answer exists yet.
  //   - 'error': the league request settled and failed. From every
  //     consumer's point of view this is the same as 'loading' (nothing is
  //     known), plus a message worth showing for it.
  //   - 'bestBall' / 'standard': the league settled and best_ball is known.
  // `league != null` is checked first, deliberately, for the same reason
  // #167's `leagueKnown` checked it first: useLeague's shared cache does a
  // stale-while-revalidate refresh (`loading` flips true, then false again,
  // with the same settled `data`) whenever another mount on this league
  // invalidates it or its TTL lapses, without ever clearing `league` for the
  // duration. Checking `league != null` first means a background
  // revalidation (or one that itself errors) never demotes an
  // already-known league back to 'loading' or 'error' — it stays exactly
  // what it was already known to be. This also self-corrects when
  // `leagueId` changes: useResource's key-switch effect resets `data` to
  // null for the new id before its request starts, so a stale `league` from
  // the previous id cannot make the new one look known.
  const leagueMode = league != null
    ? (league.best_ball ? 'bestBall' : 'standard')
    : (leagueLoading ? 'loading' : 'error');

  // Derived convenience booleans. Every direct `league?.best_ball` /
  // `!bestBall` read in this file goes through one of these two instead, so
  // "not yet known" can never be mistaken for "known standard" again.
  const bestBall = leagueMode === 'bestBall';
  const isStandardLeague = leagueMode === 'standard';
  // The ruling's "commit to nothing" state: still loading, or never going
  // to resolve for this render because the request failed. Rows are inert
  // and no best-ball-or-not decision may be made while this is true.
  const leagueUnsettled = leagueMode === 'loading' || leagueMode === 'error';

  useEffect(() => {
    fetchLineup();
    // Route/week changes are the only automatic lineup fetch triggers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leagueId, selectedWeek]);

  // Bench-total isn't gated on best_ball at all, so it doesn't need to wait
  // on the league request the way the advice decision below does.
  useEffect(() => {
    if (!lineup) return;
    fetchSeasonBenchTotal();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lineup]);

  // Once the lineup for this week is known, decide whether to fetch
  // start/sit advice. This only fires once the league is settled AND known
  // to be standard (#167, extended by #217): the lineup response commonly
  // lands before the league response does, and a failed league request
  // never resolves at all, so gating on `bestBall` alone (false in both the
  // loading and the error case) would fire the request — and once for a
  // failed league, keep firing it forever — before or without ever learning
  // the real best_ball value. Best ball leagues set their optimal lineup
  // automatically, so the start/sit advice panel is skipped entirely (no
  // fetch) once that is genuinely known, exactly like the loading/error
  // states are skipped for not yet being known at all.
  useEffect(() => {
    if (!lineup) return;
    if (isStandardLeague) {
      fetchAdvice();
    } else {
      setAdvice(null);
    }
    // Advice refreshes when the loaded lineup changes; fetch functions are event helpers.
    // `isStandardLeague` is a pure function of `leagueMode`, so it isn't
    // listed separately here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lineup, leagueMode]);

  const fetchLineup = async () => {
    try {
      setLoading(true);
      setError(null);
      let url = `/api/team/lineup?leagueId=${leagueId}`;
      if (selectedWeek !== null) {
        url += `&week=${selectedWeek}`;
      }
      const res = await apiClient.get(url);
      setLineup(res.data);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setLoading(false);
    }
  };

  const fetchAdvice = async () => {
    try {
      const res = await apiClient.get(
        `/api/team/lineup/advice?leagueId=${leagueId}&season=${lineup.season}&week=${lineup.week}`
      );
      setAdvice(res.data);
    } catch (err) {
      // Suggestions are supplementary — hide the panel rather than surface an error.
      setAdvice(null);
    }
  };

  const fetchSeasonBenchTotal = async () => {
    try {
      const res = await apiClient.get(
        `/api/team/hindsight?leagueId=${leagueId}&teamId=${lineup.teamId}&season=${lineup.season}`
      );
      setBenchSeasonTotal(
        typeof res.data?.totalPointsLeftOnBench === 'number' ? res.data.totalPointsLeftOnBench : null
      );
    } catch (err) {
      setBenchSeasonTotal(null);
    }
  };

  const handleApplySuggestion = (suggestion) => {
    const list = lineup?.entries || [];
    const suggestedEntry = list.find((e) => e.id === suggestion.suggested.playerId);
    const currentEntry = list.find((e) => e.id === suggestion.current.playerId);
    if (!suggestedEntry || !currentEntry) return;
    // Same two-move payload a manual click-click swap would produce.
    performMove([
      { playerId: currentEntry.id, slot: suggestedEntry.slot },
      { playerId: suggestedEntry.id, slot: currentEntry.slot },
    ]);
  };

  // An empty starting slot needs only the one move a manual slot-first pick
  // would produce, so it reuses the same save path as everything else.
  const handleFillSlot = (fill) => {
    const entry = (lineup?.entries || []).find((e) => e.id === fill.playerId);
    if (!entry) return;
    performMove([{ playerId: entry.id, slot: fill.slot }]);
  };

  const changeWeek = (week) => {
    setSelectedEntry(null);
    setSelectedWeek(Math.min(MAX_WEEK, Math.max(MIN_WEEK, week)));
  };

  const handleWeekChange = (e) => {
    changeWeek(Number(e.target.value));
  };

  const handleExpandAdvice = () => {
    setAdviceExpanded(true);
    advicePanelRef.current?.scrollIntoView?.({
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
      block: 'start',
    });
  };

  // Applies `moves` to local state immediately so swaps feel instant, fires
  // the PUT in the background, and rolls back to the pre-move snapshot if it
  // fails. No refetch on success — the optimistic state is the new truth.
  const performMove = async (moves) => {
    const snapshot = lineup;
    const slotByPlayer = new Map(moves.map((m) => [m.playerId, m.slot]));
    setLineup((prev) =>
      prev
        ? {
            ...prev,
            entries: prev.entries.map((e) =>
              slotByPlayer.has(e.id) ? { ...e, slot: slotByPlayer.get(e.id) } : e
            ),
          }
        : prev
    );

    try {
      const result = await saveLineup({
        leagueId: Number(leagueId),
        week: snapshot.week,
        moves,
      });
      if (result.queued) {
        notify('Lineup change saved offline. It will sync when you reconnect', { severity: 'info' });
      } else {
        notify('Lineup saved');
      }
    } catch (err) {
      setLineup(snapshot);
      notify(err.response?.data?.error || err.message, { severity: 'error' });
    }
  };

  const handleRowClick = (entry, slotType, event) => {
    // Commit to nothing while the league isn't known (#217): no selection,
    // no locked notice, no quick-pick — those all depend on knowing whether
    // this is a best-ball league.
    if (leagueUnsettled) return;
    if (bestBall && !BEST_BALL_MANAGED_SLOTS.has(slotType)) return;

    if (entry && entry.locked && (bestBall || !canResolveLockedIrStash(entry, 'BENCH'))) {
      notify("Locked players can't be moved", { severity: 'warning' });
      setSelectedEntry(null);
      return;
    }

    if (!selectedEntry) {
      if (!entry) {
        // Slot-first flow: no player selected yet, so offer a quick-pick of
        // eligible players instead of the two-click select-then-target swap.
        setQuickPick({ anchorEl: event.currentTarget, slotType });
        return;
      }
      setSelectedEntry(entry);
      return;
    }

    if (entry && entry.id === selectedEntry.id) {
      setSelectedEntry(null);
      return;
    }

    setSelectedEntry(null);

    if (!entry) {
      performMove([{ playerId: selectedEntry.id, slot: slotType }]);
      return;
    }

    performMove([
      { playerId: selectedEntry.id, slot: entry.slot },
      { playerId: entry.id, slot: selectedEntry.slot },
    ]);
  };

  const closeQuickPick = () => setQuickPick(null);

  const handleQuickPickSelect = (chosenEntry) => {
    const slotType = quickPick?.slotType;
    closeQuickPick();
    if (!slotType) return;
    performMove([{ playerId: chosenEntry.id, slot: slotType }]);
  };

  const renderRow = ({ key, testId, slotLabel, slotType, entry }) => {
    const isSelected = !!(entry && selectedEntry && selectedEntry.id === entry.id);
    const showEligibility = !!selectedEntry && !isSelected;
    const eligible = showEligibility && isEligibleTarget(selectedEntry, entry, slotType, lineup?.rosterSlots);
    // Every row is inert while the league isn't known yet (#217) — the same
    // disabled treatment a locked slot already gets, not just the slots a
    // best-ball league would manage.
    const disabled = leagueUnsettled
      || (bestBall && !BEST_BALL_MANAGED_SLOTS.has(slotType))
      || (showEligibility && !eligible);
    const isEmpty = !entry;
    return (
      <ListItemButton
        key={key}
        data-testid={testId}
        selected={isSelected}
        disabled={disabled}
        onClick={(e) => handleRowClick(entry, slotType, e)}
        sx={{
          border: '1px solid',
          borderStyle: isEmpty ? 'dashed' : 'solid',
          borderColor:
            showEligibility && eligible ? 'primary.main' : isEmpty ? 'text.secondary' : 'divider',
          borderRadius: 1,
          mb: 1,
          ...(showEligibility && eligible && { bgcolor: 'var(--accent-soft)' }),
          ...(showEligibility && !eligible && { opacity: 0.45 }),
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, width: '100%' }}>
          <Chip label={slotLabel} size="small" sx={{ minWidth: 56 }} />
          {entry ? (
            <>
              <Box sx={{ flexGrow: 1 }}>
                <Typography variant="body1">
                  <PlayerNameLink name={entry.name} playerId={entry.id} onOpen={setQuickViewId} />
                </Typography>
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                  {entry.position} · {entry.nfl_team}
                  {entry.opponent && ` · vs ${entry.opponent}`}
                  {entry.projected_points != null && ` · proj ${entry.projected_points}`}
                </Typography>
              </Box>
              <InjuryBadge status={entry.injury_status} />
              {slotType === 'IR' && entry.ir_attested && (
                <Tooltip title="Attested by the commissioner: this stash stays valid even though the injury feed disagrees. Any slot move you make on him ends the attestation.">
                  <Chip label="ATTESTED" size="small" color="success" variant="outlined" />
                </Tooltip>
              )}
              {entry.onBye && (
                <Chip
                  label={`BYE Wk ${lineup?.week ?? ''}`.trim()}
                  size="small"
                  color={lineup && lineup.week === lineup.currentWeek ? 'error' : 'warning'}
                />
              )}
              {entry.locked && <Chip label="LOCKED" size="small" color="error" />}
            </>
          ) : (
            <>
              <Typography sx={{ flexGrow: 1, color: 'text.secondary' }}>Empty</Typography>
              {!selectedEntry && isStandardLeague && (
                <IconButton
                  size="small"
                  component="span"
                  tabIndex={-1}
                  aria-hidden="true"
                  sx={{ color: 'text.secondary' }}
                >
                  <AddIcon fontSize="small" />
                </IconButton>
              )}
            </>
          )}
        </Box>
      </ListItemButton>
    );
  };

  if (loading && !lineup) {
    return (
      <Container maxWidth="md" sx={{ py: 4 }} data-testid="page-skeleton">
        <Skeleton variant="text" width={220} height={48} sx={{ mb: 1 }} />
        <Skeleton variant="text" width={120} sx={{ mb: 3 }} />
        <Skeleton variant="rectangular" width={150} height={56} sx={{ mb: 3, borderRadius: 1 }} />
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton
            key={i}
            variant="rectangular"
            height={140}
            sx={{ mb: 3, borderRadius: 1 }}
          />
        ))}
      </Container>
    );
  }

  const entries = lineup?.entries || [];
  const bySlot = {};
  entries.forEach((e) => {
    (bySlot[e.slot] = bySlot[e.slot] || []).push(e);
  });

  const rosterSlots = lineup?.rosterSlots || [];
  const starterSlotOrder = rosterSlots.length > 0 ? rosterSlots.map((s) => s.key) : DEFAULT_STARTER_SLOT_ORDER;

  const starterRows = lineup
    ? starterSlotOrder.flatMap((type) => {
        const count = rosterSlots.find((s) => s.key === type)?.count || 0;
        const filled = bySlot[type] || [];
        return Array.from({ length: count }, (_, i) =>
          renderRow({
            key: `${type}-${i}`,
            testId: `slot-row-${type}-${i}`,
            slotLabel: type,
            slotType: type,
            entry: filled[i] || null,
          })
        );
      })
    : [];

  const irRows = lineup
    ? Array.from({ length: lineup.irSlots || 0 }, (_, i) =>
        renderRow({
          key: `IR-${i}`,
          testId: `slot-row-IR-${i}`,
          slotLabel: 'IR',
          slotType: 'IR',
          entry: (bySlot.IR || [])[i] || null,
        })
      )
    : [];

  const benchEntries = bySlot.BENCH || [];
  // Only meaningful for a known-standard league: while the league isn't
  // known (#217), whether to offer this recovery row is undecidable, and
  // the row would be inert anyway (rows are non-interactive until settled).
  const needsZeroBenchRecoveryTarget = isStandardLeague
    && lineup?.benchSlots === 0
    && (bySlot.IR || []).some((entry) => canResolveLockedIrStash(entry, 'BENCH'));
  const benchRowCount = bestBall
    ? Math.max(
        lineup?.benchSlots || 0,
        benchEntries.length + ((bySlot.IR || []).length > 0 ? 1 : 0)
      )
    : isStandardLeague
      ? Math.max(lineup?.benchSlots || 0, needsZeroBenchRecoveryTarget ? 1 : 0)
      // Loading/error: neither formula above is knowable yet, so just show
      // the configured bench slots with no best-ball or recovery boost.
      : lineup?.benchSlots || 0;
  const benchRows = lineup
    ? Array.from({ length: benchRowCount }, (_, i) => {
        const entry = benchEntries[i] || null;
        return renderRow({
          key: entry ? `BENCH-${entry.id}` : `BENCH-empty-${i}`,
          testId: entry ? `slot-row-BENCH-${entry.id}` : `slot-row-BENCH-empty-${i}`,
          slotLabel: 'BENCH',
          slotType: 'BENCH',
          entry,
        });
      })
    : [];

  // Lineup guardrails: a persistent warning (never a block — moves auto-save)
  // when a starting slot is empty or a starter is on this week's bye.
  const emptyStarterSlots = lineup
    ? starterSlotOrder.reduce((acc, type) => {
        const count = rosterSlots.find((s) => s.key === type)?.count || 0;
        const filled = (bySlot[type] || []).length;
        return acc + Math.max(0, count - filled);
      }, 0)
    : 0;
  const startersOnBye = lineup
    ? starterSlotOrder.flatMap((type) => bySlot[type] || []).filter((e) => e.onBye)
    : [];
  const showLineupWarning = isStandardLeague && (emptyStarterSlots > 0 || startersOnBye.length > 0);
  const lineupWarningText = [
    emptyStarterSlots > 0 &&
      `${emptyStarterSlots} empty starting slot${emptyStarterSlots > 1 ? 's' : ''}.`,
    startersOnBye.length > 0 &&
      `${startersOnBye.map((e) => e.name).join(', ')} on a bye this week.`,
  ]
    .filter(Boolean)
    .join(' ');

  // TODO(bye-week clustering): the guardrail above is single-week — it only
  // flags starters on THIS week's bye via the per-entry `onBye` boolean. A
  // clustering warning would extend the same lineup-warning banner to look
  // across upcoming byes and flag when too many rostered players at one
  // position share a future bye week (e.g. "3 of your RBs are on bye in
  // Week 7"), so managers can plan waivers ahead. That needs a per-player
  // bye-week NUMBER, which we don't have yet: `onBye` is derived server-side
  // for the selected week only (lineup.service), and bye week itself is
  // schedule-derived (computeByeWeek from nfl_games) and is included in
  // neither the lineup entries nor the /api/team/roster payload. Plumbing a
  // per-player bye week through first is the prerequisite; the roster view
  // (TeamManagement) already renders a Bye column awaiting the same data.

  const quickPickEligible = quickPick
    ? entries.filter((e) => {
      const bestBallSourceAllowed = isStandardLeague
        || (BEST_BALL_MANAGED_SLOTS.has(e.slot) && e.slot !== quickPick.slotType);
      const lockAllowsMove = !e.locked
        || (isStandardLeague && canResolveLockedIrStash(e, quickPick.slotType));
      return bestBallSourceAllowed && lockAllowsMove && isEligibleForSlot(
        e.position,
        quickPick.slotType,
        lineup?.rosterSlots,
        e.injury_status
      );
    })
    : [];

  const currentWeekValue = lineup ? selectedWeek ?? lineup.week : null;
  const projectedTotal = advice?.projectedTotal;
  const optimalTotal = advice?.optimalTotal;
  // Additive advice fields. Older responses (a cached tab mid-deploy, or the
  // legacy fixture shape) simply do not carry them, and every consumer below
  // degrades to rendering nothing rather than to rendering "undefined".
  const openSlotFills = Array.isArray(advice?.openSlotFills) ? advice.openSlotFills : [];
  const unavailablePlayers = Array.isArray(advice?.unavailable) ? advice.unavailable : [];
  const expertUnavailable = advice?.sourceCoverage?.expertConsensus?.status === 'unavailable';
  const weatherUnavailable = advice?.sourceCoverage?.weather?.status === 'unavailable';
  const generatedAtText = (() => {
    if (!advice?.generatedAt) return null;
    const when = new Date(advice.generatedAt);
    // Short date and time only: seconds are noise in a freshness stamp.
    return Number.isNaN(when.getTime())
      ? null
      : when.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
  })();
  const provenanceText = [
    advice?.modelVersion && `Version ${advice.modelVersion}`,
    generatedAtText && `updated ${generatedAtText}`,
    expertUnavailable && 'expert consensus unavailable',
    weatherUnavailable && 'weather unavailable',
  ]
    .filter(Boolean)
    .join(' · ');
  const optimalGain =
    typeof projectedTotal === 'number' && typeof optimalTotal === 'number'
      ? Number((optimalTotal - projectedTotal).toFixed(1))
      : 0;

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      {showLeagueBreadcrumb && <LeagueBreadcrumb />}
      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}
      {/* Same pattern as the lineup-fetch error above, for the league's own
          failure (#217): the screen must not sit silently frozen forever
          in what looks like a loading state that will never resolve. */}
      {leagueMode === 'error' && (
        <Alert severity="error" sx={{ mb: 2 }} data-testid="league-error-alert">
          {leagueError}
        </Alert>
      )}

      {lineup && (
        <>
          <Typography variant="h4" sx={{ mb: 1 }}>
            Set Lineup
          </Typography>
          <Typography variant="subtitle1" sx={{ mb: 1, color: 'text.secondary' }}>
            Week {lineup.week}
          </Typography>
          {bestBall && (
            <Alert severity="info" sx={{ mb: 2 }} data-testid="best-ball-alert">
              Best ball: your optimal lineup is computed automatically each week.
            </Alert>
          )}
          {benchSeasonTotal != null && (
            <Typography
              variant="body2"
              sx={{ mb: 3, color: 'text.secondary' }}
              data-testid="season-bench-stat"
            >
              Bench points this season: {benchSeasonTotal}
            </Typography>
          )}

          {isStandardLeague && (advice || showLineupWarning) && (
            <Box sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }} data-testid="lineup-summary-header">
              {advice && (
                <Typography variant="h6">
                  Projected {projectedTotal} · Optimal {optimalTotal}
                </Typography>
              )}
              {optimalGain > 0 && (
                <Button size="small" color="success" onClick={handleExpandAdvice}>
                  (+{optimalGain})
                </Button>
              )}
              {showLineupWarning && (
                <Tooltip title={`${lineupWarningText} Changes save automatically. Set your lineup before kickoff.`}>
                  <Chip
                    icon={<WarningAmberIcon fontSize="small" />}
                    label="Needs attention"
                    size="small"
                    color="warning"
                    data-testid="lineup-warning-chip"
                  />
                </Tooltip>
              )}
            </Box>
          )}

          <Box sx={{ mb: 3, display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <IconButton
              aria-label="Previous week"
              onClick={() => changeWeek(currentWeekValue - 1)}
              disabled={currentWeekValue <= MIN_WEEK}
            >
              <ChevronLeftIcon />
            </IconButton>
            <FormControl sx={{ minWidth: 150 }}>
              <InputLabel id="lineup-week-select-label">Week</InputLabel>
              <Select
                labelId="lineup-week-select-label"
                id="lineup-week-select"
                value={currentWeekValue}
                label="Week"
                onChange={handleWeekChange}
              >
                {WEEK_OPTIONS.map((w) => (
                  <MenuItem key={w} value={w}>
                    Week {w}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <IconButton
              aria-label="Next week"
              onClick={() => changeWeek(currentWeekValue + 1)}
              disabled={currentWeekValue >= MAX_WEEK}
            >
              <ChevronRightIcon />
            </IconButton>
          </Box>

          {isStandardLeague && Array.isArray(advice?.suggestions) && (
            <Paper sx={{ p: 2, mb: 3 }} data-testid="lineup-advice-panel" ref={advicePanelRef}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Typography variant="h6">{PROJECTION_ENGINE_NAME}</Typography>
                <Button size="small" onClick={() => setAdviceExpanded((prev) => !prev)}>
                  {adviceExpanded ? 'Hide' : 'Show'}
                </Button>
              </Box>
              <Collapse in={adviceExpanded}>
                <Box sx={{ mt: 2 }}>
                  <Typography variant="body2" sx={{ mb: 2, color: 'text.secondary' }}>
                    Projected {advice.projectedTotal} pts · Optimal {advice.optimalTotal} pts
                  </Typography>
                  {advice.suggestions.length === 0 && openSlotFills.length === 0 ? (
                    <Typography sx={{ color: 'text.secondary' }}>
                      {emptyStarterSlots > 0
                        ? 'Fill your starting lineup to unlock live optimization insights.'
                        : 'Your lineup is already optimal'}
                    </Typography>
                  ) : (
                    advice.suggestions.map((s) => {
                      const suggestedText = describeSide(s.suggested);
                      const currentText = describeSide(s.current);
                      const probabilityText = formatProbability(
                        s.probabilityBetter,
                        s.suggested.name,
                        s.current.name
                      );
                      const chips = factorChipsFor(s.suggested);
                      const tossUp = s.verdict === 'tossup';
                      return (
                        <Box
                          key={`${s.slot}-${s.current.playerId}-${s.suggested.playerId}`}
                          data-testid={`suggestion-row-${s.slot}`}
                          role="group"
                          // Confidence belongs in the group label too: the chip
                          // carries only the level, and its full phrasing lives
                          // in a hover tooltip a virtual cursor never reaches.
                          aria-label={`${s.slot}: start ${s.suggested.name} over ${s.current.name}, ${s.gain} projected points${
                            s.confidence ? `, ${s.confidence} confidence` : ''
                          }`}
                          sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5, mb: 2 }}
                        >
                          <Chip label={s.slot} size="small" sx={{ minWidth: 56, mt: 0.25 }} />
                          <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                            <Typography variant="body2">
                              Start {s.suggested.name} ({suggestedText}) over{' '}
                              {s.current.name} ({currentText})
                            </Typography>
                            {/* Only rendered when the server actually resolved
                                both halves — the previous version printed
                                "vs null, null pts allowed" for any player
                                whose game or defensive sample was unknown. */}
                            {s.suggested.opponent && s.suggested.opponentPointsAllowed != null && (
                              <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary' }}>
                                vs {s.suggested.opponent}, {s.suggested.opponentPointsAllowed} pts
                                allowed to {s.slot}
                              </Typography>
                            )}
                            {probabilityText && (
                              <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary' }}>
                                {probabilityText}
                              </Typography>
                            )}
                            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.5 }}>
                              {/* Just the level, not "medium confidence": at
                                  390px the longer label truncated to
                                  "medium confi…", which is worse than a chip
                                  that needs its tooltip to be unambiguous. */}
                              {s.confidence && (
                                <Tooltip title={`${PROJECTION_ENGINE_NAME} confidence in this projection: ${s.confidence}`}>
                                  <Chip
                                    data-testid={`suggestion-confidence-${s.slot}`}
                                    label={s.confidence}
                                    size="small"
                                    variant="outlined"
                                  />
                                </Tooltip>
                              )}
                              {tossUp && (
                                <Chip label="Toss-up" size="small" variant="outlined" color="warning" />
                              )}
                              {chips.map((chip) => (
                                <Tooltip key={chip.key} title={chip.title}>
                                  <Chip label={chip.label} size="small" variant="outlined" />
                                </Tooltip>
                              ))}
                            </Box>
                          </Box>
                          <Chip label={`+${s.gain}`} size="small" color="success" sx={{ mt: 0.25 }} />
                          <Button
                            size="small"
                            variant="outlined"
                            sx={{ mt: 0.25 }}
                            onClick={() => handleApplySuggestion(s)}
                          >
                            Apply
                          </Button>
                        </Box>
                      );
                    })
                  )}

                  {openSlotFills.length > 0 && (
                    <Box sx={{ mt: 1 }} data-testid="lineup-open-slot-fills">
                      <Typography variant="subtitle2" sx={{ mb: 1 }}>
                        Empty starting slots
                      </Typography>
                      {openSlotFills.map((fill) => (
                        <Box
                          key={`${fill.slot}-${fill.playerId}`}
                          data-testid={`open-slot-fill-${fill.slot}`}
                          role="group"
                          aria-label={`${fill.slot} is empty: start ${fill.name}`}
                          sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1 }}
                        >
                          <Chip label={fill.slot} size="small" sx={{ minWidth: 56 }} />
                          <Typography variant="body2" sx={{ flexGrow: 1 }}>
                            Start {fill.name} ({describeSide(fill)}) in your empty{' '}
                            {fill.slot}
                          </Typography>
                          <Button
                            size="small"
                            variant="outlined"
                            onClick={() => handleFillSlot(fill)}
                          >
                            Start
                          </Button>
                        </Box>
                      ))}
                    </Box>
                  )}

                  {unavailablePlayers.length > 0 && (
                    <Typography
                      variant="caption"
                      sx={{ display: 'block', mt: 1, color: 'text.secondary' }}
                      data-testid="lineup-unavailable-note"
                    >
                      Not available this week:{' '}
                      {unavailablePlayers.map((u) => `${u.name} (${u.reason})`).join(', ')}
                    </Typography>
                  )}

                  {provenanceText && (
                    <Typography
                      variant="caption"
                      sx={{ display: 'block', mt: 2, color: 'text.secondary' }}
                      data-testid="lineup-advice-provenance"
                    >
                      {provenanceText}
                    </Typography>
                  )}
                </Box>
              </Collapse>
            </Paper>
          )}

          <Grid container spacing={3}>
            <Grid xs={12} md={6}>
              {selectedEntry && (
                <Box
                  data-testid="lineup-move-strip"
                  sx={{
                    position: 'sticky',
                    top: 0,
                    zIndex: (theme) => theme.zIndex.appBar - 1,
                    bgcolor: 'background.paper',
                    border: '1px solid',
                    borderColor: 'primary.main',
                    borderRadius: 1,
                    p: 1.5,
                    mb: 2,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 1,
                  }}
                >
                  <Typography variant="body2">
                    Moving {selectedEntry.name}: tap a highlighted slot
                  </Typography>
                  <Button size="small" onClick={() => setSelectedEntry(null)}>
                    Cancel
                  </Button>
                </Box>
              )}

              <Paper sx={{ p: 2, mb: 3, height: '100%' }} data-testid="lineup-starters">
                <Divider sx={{ mb: 2 }}>
                  <Chip label="Starters" size="small" variant="outlined" />
                </Divider>
                <List disablePadding>{starterRows}</List>
              </Paper>
            </Grid>

            <Grid xs={12} md={6}>
              <Paper sx={{ p: 2, mb: 3, height: '100%' }} data-testid="lineup-bench-ir">
                {lineup.irSlots > 0 && (
                  <Box data-testid="lineup-ir" sx={{ mb: 3 }}>
                    <Divider sx={{ mb: 2 }}>
                      <Chip label="IR" size="small" variant="outlined" />
                    </Divider>
                    <List disablePadding>{irRows}</List>
                  </Box>
                )}

                <Box data-testid="lineup-bench">
                  <Divider sx={{ mb: 2 }}>
                    <Chip label="Bench" size="small" variant="outlined" />
                  </Divider>
                  <List disablePadding>{benchRows}</List>
                </Box>
              </Paper>
            </Grid>
          </Grid>
        </>
      )}

      <Menu
        anchorEl={quickPick?.anchorEl}
        open={!!quickPick}
        onClose={closeQuickPick}
        data-testid="quick-pick-menu"
      >
        {quickPickEligible.length === 0 ? (
          <MenuItem disabled>No eligible players available</MenuItem>
        ) : (
          quickPickEligible.map((e) => (
            <MenuItem key={e.id} onClick={() => handleQuickPickSelect(e)}>
              {e.name} · {e.position} ·{' '}
              {e.slot === 'BENCH' ? 'Bench' : e.slot === 'IR' ? 'IR' : `Starting ${e.slot}`}
            </MenuItem>
          ))
        )}
      </Menu>

      <PlayerQuickView
        open={quickViewId != null}
        onClose={() => setQuickViewId(null)}
        playerId={quickViewId}
        leagueId={Number(leagueId)}
      />
    </Container>
  );
}

function LineupScreen() {
  const { leagueId } = useParams();
  return <LineupEditor leagueId={leagueId} />;
}

export default LineupScreen;
