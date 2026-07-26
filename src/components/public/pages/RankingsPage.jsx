import React, { useMemo, useState } from 'react';
import {
  Box, Stack, Typography, ToggleButton, ToggleButtonGroup, FormControl,
  InputLabel, Select, MenuItem, TextField, InputAdornment,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import PublicLayout from '../PublicLayout';
import PublicSeo from '../PublicSeo';
import FeaturePromos from '../kit/FeaturePromos';
import RankingTable from '../kit/RankingTable';
import { usePublicResource } from '../kit/usePublicResource';
import publicApiClient from '../../../api/publicApiClient';

const POSITIONS = ['ALL', 'QB', 'RB', 'WR', 'TE', 'K', 'DEF'];

function RankingsPage() {
  const [position, setPosition] = useState('ALL');
  const [week, setWeek] = useState(''); // '' = server default (latest)
  const [search, setSearch] = useState('');

  const { loading, error, data, retry } = usePublicResource(
    () =>
      publicApiClient
        .get('/api/public/rankings', {
          params: { position, limit: 100, ...(week ? { week } : {}) },
        })
        .then((r) => r.data),
    [position, week]
  );

  const rankings = useMemo(() => data?.rankings || [], [data]);
  const positionRankings = useMemo(
    () => position === 'ALL' ? rankings : rankings.filter((row) => row.position === position),
    [rankings, position]
  );
  const filteredRankings = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    if (!query) return positionRankings;
    return positionRankings.filter((row) =>
      String(row.name || '').toLocaleLowerCase().includes(query) ||
      String(row.nflTeam || '').toLocaleLowerCase().includes(query)
    );
  }, [positionRankings, search]);
  const season = data?.season;
  const currentWeek = data?.week;
  const weekOptions = currentWeek ? Array.from({ length: currentWeek }, (_, i) => i + 1) : [];
  const updated = new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

  return (
    <PublicLayout ctaContext="rankings">
      <PublicSeo
        title="NFL Fantasy Football Rankings"
        description="Weekly NFL fantasy football rankings with projections, season points, recent production, and position filters."
        path="/rankings"
      />
      <Box sx={{ mb: 3 }}>
        <Typography variant="h3" component="h1" sx={{ fontWeight: 800 }}>
          NFL Fantasy Rankings
        </Typography>
        <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5 }}>
          Updated {updated}
          {currentWeek ? ` · Week ${currentWeek}` : ''}
          {season ? ` · ${season} season` : ''}
        </Typography>
      </Box>

      <FeaturePromos />

      {/* Sticky filter bar */}
      <Stack
        direction={{ xs: 'column', md: 'row' }}
        spacing={2}
        alignItems={{ xs: 'stretch', md: 'center' }}
        justifyContent="space-between"
        sx={{
          position: 'sticky',
          top: 64,
          zIndex: 1,
          py: 1.5,
          bgcolor: 'background.default',
          borderBottom: '1px solid var(--border-subtle)',
          mb: 2,
        }}
      >
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ flexGrow: 1 }}>
          <TextField
            size="small"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            label="Search players or teams"
            inputProps={{ 'aria-label': 'Search players or teams' }}
            InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }}
            sx={{ minWidth: { sm: 240 } }}
          />
          <ToggleButtonGroup
            value={position}
            exclusive
            size="small"
            onChange={(_e, val) => val && setPosition(val)}
            aria-label="Filter by position"
            sx={{ flexWrap: 'wrap' }}
          >
            {POSITIONS.map((pos) => (
              <ToggleButton key={pos} value={pos} aria-label={pos}>{pos}</ToggleButton>
            ))}
          </ToggleButtonGroup>
        </Stack>

        <FormControl size="small" sx={{ minWidth: 130 }} disabled={!weekOptions.length}>
          <InputLabel id="week-label">Week</InputLabel>
          <Select labelId="week-label" label="Week" value={week} onChange={(e) => setWeek(e.target.value)}>
            <MenuItem value="">Latest{currentWeek ? ` (Wk ${currentWeek})` : ''}</MenuItem>
            {weekOptions.map((w) => <MenuItem key={w} value={w}>Week {w}</MenuItem>)}
          </Select>
        </FormControl>
      </Stack>

      {!loading && !error && search.trim() && (
        <Typography variant="body2" sx={{ color: 'text.secondary', mb: 1.5 }} aria-live="polite">
          {filteredRankings.length} result{filteredRankings.length === 1 ? '' : 's'}
        </Typography>
      )}
      <RankingTable
        rows={filteredRankings}
        tierRows={positionRankings}
        loading={loading}
        error={error}
        onRetry={retry}
        emptyMessage={positionRankings.length ? 'No players match that search.' : undefined}
      />
    </PublicLayout>
  );
}

export default RankingsPage;
