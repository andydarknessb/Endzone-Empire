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

function isEligibleForSlot(position, slot, rosterSlots) {
  if (slot === 'BENCH' || slot === 'IR') return true;
  return slotEligiblePositions(rosterSlots, slot).includes(position);
}

// Whether `selectedEntry` may legally land on this row: an empty slot only
// needs the one-way check, but an occupied row is a swap, so both players
// must be eligible for each other's slot. A locked occupant can never be a
// target regardless of position.
function isEligibleTarget(selectedEntry, targetEntry, slotType, rosterSlots) {
  if (!targetEntry) return isEligibleForSlot(selectedEntry.position, slotType, rosterSlots);
  if (targetEntry.locked) return false;
  const aEligible = isEligibleForSlot(selectedEntry.position, targetEntry.slot, rosterSlots);
  const bEligible = isEligibleForSlot(targetEntry.position, selectedEntry.slot, rosterSlots);
  return aEligible && bEligible;
}

function LineupScreen() {
  const { leagueId } = useParams();
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
  const { league } = useLeague(leagueId);
  const bestBall = !!league?.best_ball;

  useEffect(() => {
    fetchLineup();
    // Route/week changes are the only automatic lineup fetch triggers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leagueId, selectedWeek]);

  // Once the lineup for this week is known, load the decision-support
  // panels that ride alongside it. Re-runs whenever `lineup` changes (week
  // switch or a post-save refetch) so suggestions/bench stats stay in sync.
  // Best ball leagues set their optimal lineup automatically, so the
  // start/sit advice panel is skipped entirely — no need to even fetch it.
  useEffect(() => {
    if (!lineup) return;
    if (!bestBall) {
      fetchAdvice();
    } else {
      setAdvice(null);
    }
    fetchSeasonBenchTotal();
    // Advice refreshes when the loaded lineup changes; fetch functions are event helpers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lineup, bestBall]);

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

  const changeWeek = (week) => {
    setSelectedEntry(null);
    setSelectedWeek(Math.min(MAX_WEEK, Math.max(MIN_WEEK, week)));
  };

  const handleWeekChange = (e) => {
    changeWeek(Number(e.target.value));
  };

  const handleExpandAdvice = () => {
    setAdviceExpanded(true);
    advicePanelRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
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
    if (bestBall) return; // best ball lineups are set automatically — no manual moves

    if (entry && entry.locked) {
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
    const disabled = bestBall || (showEligibility && !eligible);
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
              {!selectedEntry && !bestBall && (
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

  const benchRows = (bySlot.BENCH || []).map((entry) =>
    renderRow({
      key: `BENCH-${entry.id}`,
      testId: `slot-row-BENCH-${entry.id}`,
      slotLabel: 'BENCH',
      slotType: 'BENCH',
      entry,
    })
  );

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
  const showLineupWarning = !bestBall && (emptyStarterSlots > 0 || startersOnBye.length > 0);
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
    ? entries.filter((e) => !e.locked && isEligibleForSlot(e.position, quickPick.slotType, lineup?.rosterSlots))
    : [];

  const currentWeekValue = lineup ? selectedWeek ?? lineup.week : null;
  const projectedTotal = advice?.projectedTotal;
  const optimalTotal = advice?.optimalTotal;
  const optimalGain =
    typeof projectedTotal === 'number' && typeof optimalTotal === 'number'
      ? Number((optimalTotal - projectedTotal).toFixed(1))
      : 0;

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      <LeagueBreadcrumb />
      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
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

          {!bestBall && (advice || showLineupWarning) && (
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

          {Array.isArray(advice?.suggestions) && (
            <Paper sx={{ p: 2, mb: 3 }} data-testid="lineup-advice-panel" ref={advicePanelRef}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Typography variant="h6">Start/Sit Suggestions</Typography>
                <Button size="small" onClick={() => setAdviceExpanded((prev) => !prev)}>
                  {adviceExpanded ? 'Hide' : 'Show'}
                </Button>
              </Box>
              <Collapse in={adviceExpanded}>
                <Box sx={{ mt: 2 }}>
                  <Typography variant="body2" sx={{ mb: 2, color: 'text.secondary' }}>
                    Projected {advice.projectedTotal} pts · Optimal {advice.optimalTotal} pts
                  </Typography>
                  {advice.suggestions.length === 0 ? (
                    <Typography sx={{ color: 'text.secondary' }}>
                      {emptyStarterSlots > 0
                        ? 'Fill your starting lineup to unlock live optimization insights.'
                        : 'Your lineup is already optimal'}
                    </Typography>
                  ) : (
                    advice.suggestions.map((s) => (
                      <Box
                        key={s.slot}
                        data-testid={`suggestion-row-${s.slot}`}
                        sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2 }}
                      >
                        <Chip label={s.slot} size="small" sx={{ minWidth: 56 }} />
                        <Box sx={{ flexGrow: 1 }}>
                          <Typography variant="body2">
                            Start {s.suggested.name} ({s.suggested.projection} proj) over{' '}
                            {s.current.name} ({s.current.projection} proj)
                          </Typography>
                          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                            vs {s.suggested.opponent}, {s.suggested.opponentPointsAllowed} pts
                            allowed to {s.slot}
                          </Typography>
                        </Box>
                        <Chip label={`+${s.gain}`} size="small" color="success" />
                        <Button
                          size="small"
                          variant="outlined"
                          onClick={() => handleApplySuggestion(s)}
                        >
                          Apply
                        </Button>
                      </Box>
                    ))
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

export default LineupScreen;
