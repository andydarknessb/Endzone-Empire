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
  CircularProgress,
  Box,
  List,
  ListItemButton,
  Chip,
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

  useEffect(() => {
    fetchLineup();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leagueId, selectedWeek]);

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
      <Container sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
        <CircularProgress />
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
          <Typography variant="subtitle1" sx={{ mb: 3, color: 'text.secondary' }}>
            Week {lineup.week}
          </Typography>

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
