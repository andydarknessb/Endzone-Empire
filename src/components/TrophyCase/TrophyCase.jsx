import React, { useState, useEffect, useMemo } from 'react';
import {
  Paper,
  Typography,
  Box,
  Chip,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
} from '@mui/material';
import apiClient from '../../api/apiClient';

export const TROPHY_EMOJI = {
  champion: '🏆',
  pickem_champion: '🏆',
  weekly_high: '🔥',
  top_scorer: '🔥',
  closest_game: '🤝',
  biggest_blowout: '💥',
  win_streak: '📈',
  comeback: '💪',
  draft_grade: '🎯',
};

function trophySubLabel(trophy) {
  if (['weekly_high', 'top_scorer', 'closest_game', 'biggest_blowout'].includes(trophy.type) && trophy.week != null) {
    return `${trophy.team_name} · Week ${trophy.week}`;
  }
  return trophy.team_name;
}

function TrophyCase({ leagueId }) {
  const [trophies, setTrophies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [season, setSeason] = useState('');

  useEffect(() => {
    let cancelled = false;

    const fetchTrophies = async () => {
      try {
        setLoading(true);
        setError(null);
        const res = await apiClient.get(`/api/league/${leagueId}/trophies`);
        const data = Array.isArray(res.data) ? res.data : [];
        if (!cancelled) {
          setTrophies(data);
          const seasons = Array.from(new Set(data.map((t) => t.season))).sort((a, b) => b - a);
          setSeason(seasons.length ? seasons[0] : '');
        }
      } catch (err) {
        if (!cancelled) {
          setTrophies([]);
          setError(err.response?.data?.error || err.message);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchTrophies();
    return () => {
      cancelled = true;
    };
  }, [leagueId]);

  const seasonOptions = useMemo(
    () => Array.from(new Set(trophies.map((t) => t.season))).sort((a, b) => b - a),
    [trophies]
  );

  const visibleTrophies = useMemo(
    () => (season === '' ? trophies : trophies.filter((t) => t.season === season)),
    [trophies, season]
  );

  if (loading || error || trophies.length === 0) {
    return null;
  }

  return (
    <Paper sx={{ p: 2, mb: 3 }} data-testid="trophy-case">
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2, flexWrap: 'wrap', gap: 2 }}>
        <Typography variant="h6">Trophy Case</Typography>
        {seasonOptions.length > 1 && (
          <FormControl size="small" sx={{ minWidth: 140 }}>
            <InputLabel id="trophy-season-select-label">Season</InputLabel>
            <Select
              labelId="trophy-season-select-label"
              id="trophy-season-select"
              value={season}
              label="Season"
              onChange={(e) => setSeason(e.target.value)}
            >
              {seasonOptions.map((s) => (
                <MenuItem key={s} value={s}>
                  {s}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        )}
      </Box>
      {visibleTrophies.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          No trophies for this season yet
        </Typography>
      ) : (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5 }}>
          {visibleTrophies.map((trophy) => (
            <Chip
              key={trophy.id}
              data-testid={`trophy-${trophy.id}`}
              variant="outlined"
              sx={{ height: 'auto', py: 1, '& .MuiChip-label': { whiteSpace: 'normal' } }}
              label={
                <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    {TROPHY_EMOJI[trophy.type] || '🎖️'} {trophy.label}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {trophySubLabel(trophy)}
                  </Typography>
                </Box>
              }
            />
          ))}
        </Box>
      )}
    </Paper>
  );
}

export default TrophyCase;
