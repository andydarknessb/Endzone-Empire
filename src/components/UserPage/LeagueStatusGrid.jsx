import React, { useState } from 'react';
import { Box, Button, Stack } from '@mui/material';
import Grid from '@mui/material/Unstable_Grid2';
import LeagueStatusCard, { leagueFilterKeys } from '../common/LeagueStatusCard';
import { MIN_TOUCH_TARGET_SX } from '../../shared/lib/a11y';

// Home v2 slice 3: the My leagues grid with its filter chips. The filters are
// toggle buttons (aria-pressed), not tabs: they narrow one list in place.
const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'live', label: 'Live' },
  { key: 'pickem', label: "Pick'em" },
  { key: 'drafting', label: 'Drafting' },
];

// More than this many leagues shows the first ones and a Show all button
// (Handoff edge cases: "More than 6 leagues: show 6, then Show all 14").
const VISIBLE_LIMIT = 6;

function LeagueStatusGrid({ leagues }) {
  const [filter, setFilter] = useState('all');
  const [showAll, setShowAll] = useState(false);

  const keyed = leagues.map((league) => ({ league, keys: leagueFilterKeys(league) }));
  const counts = FILTERS.reduce((acc, { key }) => ({
    ...acc,
    [key]: key === 'all' ? keyed.length : keyed.filter(({ keys }) => keys.includes(key)).length,
  }), {});
  // A chip with nothing behind it is not offered; a filter that a refetch
  // emptied falls back to All rather than showing an empty grid.
  const offered = FILTERS.filter(({ key }) => key === 'all' || counts[key] > 0);
  const active = counts[filter] > 0 ? filter : 'all';
  const filtered = active === 'all' ? keyed : keyed.filter(({ keys }) => keys.includes(active));
  const visible = showAll ? filtered : filtered.slice(0, VISIBLE_LIMIT);

  const choose = (key) => {
    setFilter(key);
    setShowAll(false);
  };

  return (
    <>
      {leagues.length > 1 && offered.length > 1 && (
        <Stack
          direction="row"
          role="group"
          aria-label="Filter leagues"
          spacing={0.5}
          useFlexGap
          flexWrap="wrap"
          sx={{ mb: 2, p: 0.5, borderRadius: 3, border: 1, borderColor: 'divider', bgcolor: 'background.paper', width: 'fit-content', maxWidth: '100%' }}
        >
          {offered.map(({ key, label }) => {
            const pressed = active === key;
            return (
              <Button
                key={key}
                type="button"
                aria-pressed={pressed}
                onClick={() => choose(key)}
                variant={pressed ? 'contained' : 'text'}
                color={pressed ? 'primary' : 'inherit'}
                disableElevation
                sx={{ ...MIN_TOUCH_TARGET_SX, px: 2, fontWeight: 600, color: pressed ? undefined : 'text.secondary' }}
              >
                {label}
                {' '}
                <Box component="span" sx={{ ml: 0.75, fontVariantNumeric: 'tabular-nums' }}>{counts[key]}</Box>
              </Button>
            );
          })}
        </Stack>
      )}

      <Grid container spacing={2}>
        {visible.map(({ league }) => (
          <Grid xs={12} sm={6} key={league.id}>
            <LeagueStatusCard league={league} />
          </Grid>
        ))}
      </Grid>

      {!showAll && filtered.length > VISIBLE_LIMIT && (
        <Box sx={{ mt: 2, display: 'flex', justifyContent: 'center' }}>
          <Button variant="outlined" onClick={() => setShowAll(true)} sx={MIN_TOUCH_TARGET_SX}>
            {`Show all ${filtered.length} leagues`}
          </Button>
        </Box>
      )}
    </>
  );
}

export default LeagueStatusGrid;
