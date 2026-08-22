import React, { useState, useEffect } from 'react';
import { Paper, Typography, Chip, Box } from '@mui/material';
import apiClient from '../../api/apiClient';

function buildStatChips(facts) {
  if (!facts) return [];
  const chips = [];
  if (facts.highestScorer) {
    chips.push({
      key: 'highestScorer',
      label: `🔥 High score: ${facts.highestScorer.team} (${facts.highestScorer.points})`,
    });
  }
  if (facts.benchBlunder) {
    chips.push({
      key: 'benchBlunder',
      label: `🪦 Bench blunder: ${facts.benchBlunder.team} left ${facts.benchBlunder.pointsLeftOnBench} on the bench`,
    });
  }
  if (facts.waiverSteal) {
    chips.push({
      key: 'waiverSteal',
      label: `💎 Waiver steal: ${facts.waiverSteal.player} (${facts.waiverSteal.team}) - ${facts.waiverSteal.points} pts`,
    });
  }
  if (facts.closestMatchup && chips.length < 4) {
    chips.push({
      key: 'closestMatchup',
      label: `📏 Closest game: ${facts.closestMatchup.home} vs ${facts.closestMatchup.away} (margin ${facts.closestMatchup.margin})`,
    });
  }
  if (facts.biggestBlowout && chips.length < 4) {
    chips.push({
      key: 'biggestBlowout',
      label: `💥 Biggest blowout: ${facts.biggestBlowout.home} vs ${facts.biggestBlowout.away} (margin ${facts.biggestBlowout.margin})`,
    });
  }
  return chips.slice(0, 4);
}

function RecapCard({ leagueId }) {
  const [recap, setRecap] = useState(null);
  const [hidden, setHidden] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const fetchRecap = async () => {
      try {
        const res = await apiClient.get(`/api/scoring/league/${leagueId}/recap`);
        if (!cancelled) {
          setRecap(res.data);
          setHidden(false);
        }
      } catch (err) {
        if (!cancelled) {
          setRecap(null);
          setHidden(true);
        }
      }
    };

    fetchRecap();
    return () => {
      cancelled = true;
    };
  }, [leagueId]);

  if (hidden || !recap || !recap.data) {
    return null;
  }

  const { data } = recap;
  const chips = buildStatChips(data.facts);

  return (
    <Paper
      data-testid="recap-card"
      sx={{
        p: 2,
        mb: 3,
        bgcolor: (theme) => (theme.palette.mode === 'dark' ? 'grey.900' : 'grey.50'),
        borderLeft: '4px solid',
        borderColor: 'primary.main',
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
        <Typography variant="h6">Weekly Recap</Typography>
        {recap.week != null && <Chip size="small" label={`Week ${recap.week}`} />}
      </Box>
      <Typography variant="body1" sx={{ mb: chips.length ? 2 : 0, whiteSpace: 'pre-line' }}>
        {data.narrative}
      </Typography>
      {chips.length > 0 && (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
          {chips.map((chip) => (
            <Chip key={chip.key} label={chip.label} color="primary" variant="outlined" />
          ))}
        </Box>
      )}
    </Paper>
  );
}

export default RecapCard;
