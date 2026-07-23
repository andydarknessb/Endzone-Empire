import React, { useState } from 'react';
import { Box, Stack, Typography, FormControl, InputLabel, Select, MenuItem } from '@mui/material';
import Grid from '@mui/material/Unstable_Grid2';
import PublicLayout from '../PublicLayout';
import PublicSeo from '../PublicSeo';
import RecapCard from '../kit/RecapCard';
import PlayerCard from '../kit/PlayerCard';
import { LoadingRows, EmptyState, ErrorState } from '../kit/DataState';
import { usePublicResource } from '../kit/usePublicResource';
import publicApiClient from '../../../api/publicApiClient';

function RecapEmptyState() {
  const { loading, error, data, retry } = usePublicResource(
    () => publicApiClient.get('/api/public/rankings', { params: { limit: 3 } }).then((response) => response.data),
    []
  );
  const leaders = data?.rankings || [];

  return (
    <Box>
      <EmptyState
        message="No recaps yet."
        hint="Recaps post automatically after NFL games go final. Until then, start with the latest projected leaders."
      />
      <Typography variant="h5" component="h2" sx={{ fontWeight: 700, mb: 2 }}>Latest ranking leaders</Typography>
      {loading && <LoadingRows rows={3} height={76} />}
      {!loading && error && <ErrorState message="We couldn't load ranking leaders." onRetry={retry} />}
      {!loading && !error && leaders.length === 0 && <EmptyState message="Ranking leaders aren't available yet." />}
      {!loading && !error && leaders.length > 0 && (
        <Grid container spacing={2}>
          {leaders.map((player) => (
            <Grid xs={12} sm={4} key={player.playerId}>
              <PlayerCard player={player} stat={player.projectedPoints} statLabel="proj" subtitle={`#${player.rank}`} />
            </Grid>
          ))}
        </Grid>
      )}
    </Box>
  );
}

function RecapsPage() {
  const [week, setWeek] = useState('');
  const { loading, error, data, retry } = usePublicResource(
    () => publicApiClient.get('/api/public/recaps', { params: { limit: 60 } }).then((r) => r.data),
    []
  );

  const recaps = data?.recaps || [];
  const weeks = [...new Set(recaps.map((r) => r.week))].sort((a, b) => b - a);
  const shown = week ? recaps.filter((r) => r.week === Number(week)) : recaps;
  const grouped = shown.reduce((groups, recap) => {
    const key = recap.week;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(recap);
    return groups;
  }, new Map());

  return (
    <PublicLayout ctaContext="recaps">
      <PublicSeo
        title="NFL Game Recaps"
        description="NFL final scores, scoring timelines, game summaries, and top fantasy football performers by week."
        path="/recaps"
      />
      <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ xs: 'flex-start', sm: 'flex-end' }} spacing={2} sx={{ mb: 3 }}>
        <Box>
          <Typography variant="h3" component="h1" sx={{ fontWeight: 800 }}>NFL Game Recaps</Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5 }}>
            Final scores, scoring timelines, and top fantasy performers from around the league.
          </Typography>
        </Box>
        {weeks.length > 0 && (
          <FormControl size="small" sx={{ minWidth: 140 }}>
            <InputLabel id="recap-week-label">Week</InputLabel>
            <Select labelId="recap-week-label" label="Week" value={week} onChange={(e) => setWeek(e.target.value)}>
              <MenuItem value="">All weeks</MenuItem>
              {weeks.map((w) => (
                <MenuItem key={w} value={w}>Week {w}</MenuItem>
              ))}
            </Select>
          </FormControl>
        )}
      </Stack>

      {loading && <LoadingRows rows={6} height={120} />}
      {!loading && error && <ErrorState message="We couldn't load recaps." onRetry={retry} />}
      {!loading && !error && shown.length === 0 && (
        recaps.length === 0
          ? <RecapEmptyState />
          : <EmptyState message="No recaps for that week." hint="Choose another week to see available finals." />
      )}
      {!loading && !error && shown.length > 0 && (
        <Stack spacing={5}>
          {[...grouped.entries()].sort(([a], [b]) => b - a).map(([groupWeek, weekRecaps]) => (
            <Box component="section" key={groupWeek} aria-labelledby={`week-${groupWeek}-heading`}>
              <Typography id={`week-${groupWeek}-heading`} variant="h5" component="h2" sx={{ fontWeight: 800, mb: 2 }}>
                Week {groupWeek}
              </Typography>
              <Grid container spacing={3}>
                {weekRecaps.map((recap) => (
                  <Grid xs={12} sm={6} md={4} key={recap.gameId}>
                    <RecapCard recap={recap} />
                  </Grid>
                ))}
              </Grid>
            </Box>
          ))}
        </Stack>
      )}
    </PublicLayout>
  );
}

export default RecapsPage;
