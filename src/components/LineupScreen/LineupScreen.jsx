import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import {
  Container,
  Paper,
  Typography,
  Select,
  MenuItem,
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
} from '@mui/material';
import apiClient from '../../api/apiClient';
import InjuryBadge from '../InjuryBadge/InjuryBadge';

const STARTER_SLOT_ORDER = ['QB', 'RB', 'WR', 'TE', 'FLEX', 'K', 'DEF'];
const FLEX_ELIGIBLE_POSITIONS = ['RB', 'WR', 'TE'];
const WEEK_OPTIONS = Array.from({ length: 18 }, (_, i) => i + 1);

function isEligibleForSlot(position, slot) {
  if (slot === 'FLEX') return FLEX_ELIGIBLE_POSITIONS.includes(position);
  if (slot === 'BENCH' || slot === 'IR') return true;
  return position === slot;
}

function LineupScreen() {
  const { leagueId } = useParams();
  const [lineup, setLineup] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [successMessage, setSuccessMessage] = useState(null);
  const [selectedWeek, setSelectedWeek] = useState(null);
  const [selectedEntry, setSelectedEntry] = useState(null);
  const [advice, setAdvice] = useState(null);
  const [adviceExpanded, setAdviceExpanded] = useState(true);
  const [benchSeasonTotal, setBenchSeasonTotal] = useState(null);
  const [bestBall, setBestBall] = useState(false);

  useEffect(() => {
    fetchLineup();
  }, [leagueId, selectedWeek]);

  // GET /api/team/lineup doesn't carry the league's best_ball flag, and no
  // league object is otherwise available to this screen (it's reached
  // directly at /league/:leagueId/lineup with no league context passed
  // in). Rather than growing the lineup payload, fetch the league once per
  // mount — the same GET /api/league/:id LeagueDashboard already uses — and
  // read best_ball off of it. This is a small one-time request, not tied to
  // week switches.
  useEffect(() => {
    fetchLeagueBestBall();
  }, [leagueId]);

  const fetchLeagueBestBall = async () => {
    try {
      const res = await apiClient.get(`/api/league/${leagueId}`);
      setBestBall(!!res.data?.league?.best_ball);
    } catch (err) {
      setBestBall(false);
    }
  };

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

  const handleWeekChange = (e) => {
    setError(null);
    setSuccessMessage(null);
    setSelectedEntry(null);
    setSelectedWeek(Number(e.target.value));
  };

  const performMove = async (moves) => {
    try {
      setError(null);
      setSuccessMessage(null);
      await apiClient.put('/api/team/lineup', {
        leagueId: Number(leagueId),
        week: lineup.week,
        moves,
      });
      setSuccessMessage('Lineup saved');
      await fetchLineup();
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    }
  };

  const handleRowClick = (entry, slotType) => {
    if (bestBall) return; // best ball lineups are set automatically — no manual moves

    if (entry && entry.locked) {
      setError("Locked players can't be moved");
      setSuccessMessage(null);
      setSelectedEntry(null);
      return;
    }

    if (!selectedEntry) {
      if (!entry) return;
      setError(null);
      setSuccessMessage(null);
      setSelectedEntry(entry);
      return;
    }

    if (entry && entry.id === selectedEntry.id) {
      setSelectedEntry(null);
      return;
    }

    setSuccessMessage(null);

    if (!entry) {
      if (!isEligibleForSlot(selectedEntry.position, slotType)) {
        setError("That player can't go in that slot");
        setSelectedEntry(null);
        return;
      }
      setError(null);
      setSelectedEntry(null);
      performMove([{ playerId: selectedEntry.id, slot: slotType }]);
      return;
    }

    const aEligible = isEligibleForSlot(selectedEntry.position, entry.slot);
    const bEligible = isEligibleForSlot(entry.position, selectedEntry.slot);
    if (!aEligible || !bEligible) {
      setError("That player can't go in that slot");
      setSelectedEntry(null);
      return;
    }
    setError(null);
    setSelectedEntry(null);
    performMove([
      { playerId: selectedEntry.id, slot: entry.slot },
      { playerId: entry.id, slot: selectedEntry.slot },
    ]);
  };

  const renderRow = ({ key, testId, slotLabel, slotType, entry }) => {
    const isSelected = !!(entry && selectedEntry && selectedEntry.id === entry.id);
    return (
      <ListItemButton
        key={key}
        data-testid={testId}
        selected={isSelected}
        disabled={bestBall}
        onClick={() => handleRowClick(entry, slotType)}
        sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, mb: 1 }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, width: '100%' }}>
          <Chip label={slotLabel} size="small" sx={{ minWidth: 56 }} />
          {entry ? (
            <>
              <Box sx={{ flexGrow: 1 }}>
                <Typography variant="body1">{entry.name}</Typography>
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                  {entry.position} — {entry.nfl_team}
                  {entry.projected_points != null && ` — proj ${entry.projected_points}`}
                </Typography>
              </Box>
              <InjuryBadge status={entry.injury_status} />
              {entry.onBye && <Chip label="BYE" size="small" color="warning" />}
              {entry.locked && <Chip label="LOCKED" size="small" color="error" />}
            </>
          ) : (
            <Typography sx={{ flexGrow: 1, color: 'text.secondary' }}>Empty</Typography>
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

  const starterRows = lineup
    ? STARTER_SLOT_ORDER.flatMap((type) => {
        const count = lineup.lineupSlots?.[type] || 0;
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

  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}
      {successMessage && (
        <Alert severity="success" sx={{ mb: 2 }}>
          {successMessage}
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

          <Box sx={{ mb: 3 }}>
            <FormControl sx={{ minWidth: 150 }}>
              <InputLabel id="lineup-week-select-label">Week</InputLabel>
              <Select
                labelId="lineup-week-select-label"
                id="lineup-week-select"
                value={selectedWeek ?? lineup.week}
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
          </Box>

          {Array.isArray(advice?.suggestions) && (
            <Paper sx={{ p: 2, mb: 3 }} data-testid="lineup-advice-panel">
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Typography variant="h6">Start/Sit Suggestions</Typography>
                <Button size="small" onClick={() => setAdviceExpanded((prev) => !prev)}>
                  {adviceExpanded ? 'Hide' : 'Show'}
                </Button>
              </Box>
              <Collapse in={adviceExpanded}>
                <Box sx={{ mt: 2 }}>
                  <Typography variant="body2" sx={{ mb: 2, color: 'text.secondary' }}>
                    Projected {advice.projectedTotal} pts — Optimal {advice.optimalTotal} pts
                  </Typography>
                  {advice.suggestions.length === 0 ? (
                    <Typography sx={{ color: 'text.secondary' }}>
                      Your lineup is already optimal
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

          <Paper sx={{ p: 2, mb: 3 }} data-testid="lineup-starters">
            <Typography variant="h6" sx={{ mb: 2 }}>
              Starters
            </Typography>
            <List disablePadding>{starterRows}</List>
          </Paper>

          <Paper sx={{ p: 2, mb: 3 }} data-testid="lineup-ir">
            <Typography variant="h6" sx={{ mb: 2 }}>
              IR
            </Typography>
            <List disablePadding>{irRows}</List>
          </Paper>

          <Paper sx={{ p: 2, mb: 3 }} data-testid="lineup-bench">
            <Typography variant="h6" sx={{ mb: 2 }}>
              Bench
            </Typography>
            <List disablePadding>{benchRows}</List>
          </Paper>
        </>
      )}
    </Container>
  );
}

export default LineupScreen;
