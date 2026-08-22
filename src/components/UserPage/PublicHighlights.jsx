import React, { useEffect, useState } from 'react';
import {
  Box, Card, CardContent, Link, List, ListItem, ListItemText,
  Skeleton, Stack, Typography,
} from '@mui/material';
import Grid from '@mui/material/Unstable_Grid2';
import apiClient from '../../api/apiClient';
import { listArticles } from '../../content/articles';

/**
 * Public-layer content surfaced on the authed dashboard: rankings, game
 * recaps, and the strategy library, with quick links into the rest of the
 * public site (waiver wire included).
 *
 * Two deliberate mechanics:
 * - Links are plain hrefs, not RouterLinks. The authed app lives in the hash
 *   router, so a public path is a full page load that RootRouter hands to the
 *   public BrowserRouter tree — exactly how the dual-router shell is meant to
 *   be crossed.
 * - This module is React.lazy'd from UserPage. It imports the strategy-article
 *   registry (whose bodies are real JSX), and an eager import would push all
 *   of that prose into the initial main bundle; as a lazy chunk it stays
 *   outside the 250 KiB initial-JS budget.
 */

const STRATEGY_TEASER_COUNT = 3;

function WidgetSkeleton() {
  return (
    <Stack spacing={1}>
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} variant="text" width={`${85 - i * 10}%`} />
      ))}
    </Stack>
  );
}

function PublicHighlights() {
  const [rankings, setRankings] = useState([]);
  const [loadingRankings, setLoadingRankings] = useState(true);
  const [rankingsError, setRankingsError] = useState(false);

  const [recaps, setRecaps] = useState([]);
  const [loadingRecaps, setLoadingRecaps] = useState(true);
  const [recapsError, setRecapsError] = useState(false);

  const articles = listArticles().slice(0, STRATEGY_TEASER_COUNT);

  useEffect(() => {
    // Each widget fetches independently (mirroring the news/activity cards)
    // so a slow or failed one never blanks the others.
    apiClient
      .get('/api/public/rankings', { params: { limit: 5 } })
      .then((res) => {
        setRankings(Array.isArray(res.data && res.data.rankings) ? res.data.rankings : []);
        setRankingsError(false);
      })
      .catch(() => setRankingsError(true))
      .finally(() => setLoadingRankings(false));

    apiClient
      .get('/api/public/recaps', { params: { limit: 3 } })
      .then((res) => {
        setRecaps(Array.isArray(res.data && res.data.recaps) ? res.data.recaps : []);
        setRecapsError(false);
      })
      .catch(() => setRecapsError(true))
      .finally(() => setLoadingRecaps(false));
  }, []);

  return (
    <Box component="section" aria-labelledby="public-highlights-heading" sx={{ mt: 5 }}>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        justifyContent="space-between"
        alignItems={{ xs: 'flex-start', sm: 'baseline' }}
        spacing={1}
        sx={{ mb: 2 }}
      >
        <Typography id="public-highlights-heading" variant="h5" sx={{ fontWeight: 700 }}>
          Around the League
        </Typography>
        <Stack direction="row" spacing={2} flexWrap="wrap">
          <Link href="/rankings" underline="hover">Rankings</Link>
          <Link href="/waiver-wire" underline="hover">Waiver Wire</Link>
          <Link href="/strategy" underline="hover">Strategy</Link>
          <Link href="/recaps" underline="hover">Recaps</Link>
        </Stack>
      </Stack>

      <Grid container spacing={2}>
        <Grid xs={12} md={4}>
          <Card variant="outlined" sx={{ height: '100%', bgcolor: 'background.paper' }}>
            <CardContent>
              <Typography variant="h6" sx={{ fontWeight: 700, mb: 1 }}>
                Top Players
              </Typography>
              {loadingRankings ? (
                <WidgetSkeleton />
              ) : rankingsError ? (
                <Typography variant="body2" color="text.secondary">
                  Couldn&apos;t load the rankings right now.
                </Typography>
              ) : rankings.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  Rankings aren&apos;t available yet.
                </Typography>
              ) : (
                <List dense disablePadding>
                  {rankings.map((row) => (
                    <ListItem key={row.playerId} disableGutters>
                      <ListItemText
                        primary={
                          <Link href={`/players/${row.playerId}`} underline="hover" color="text.primary">
                            {`#${row.rank} ${row.name}`}
                          </Link>
                        }
                        secondary={[
                          [row.position, row.nflTeam].filter(Boolean).join(' '),
                          row.seasonPoints != null ? `${row.seasonPoints} pts` : null,
                        ].filter(Boolean).join(' · ')}
                      />
                    </ListItem>
                  ))}
                </List>
              )}
              <Link href="/rankings" underline="hover" variant="body2">
                Full rankings
              </Link>
            </CardContent>
          </Card>
        </Grid>

        <Grid xs={12} md={4}>
          <Card variant="outlined" sx={{ height: '100%', bgcolor: 'background.paper' }}>
            <CardContent>
              <Typography variant="h6" sx={{ fontWeight: 700, mb: 1 }}>
                Latest Game Recaps
              </Typography>
              {loadingRecaps ? (
                <WidgetSkeleton />
              ) : recapsError ? (
                <Typography variant="body2" color="text.secondary">
                  Couldn&apos;t load recaps right now.
                </Typography>
              ) : recaps.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  No recaps published yet.
                </Typography>
              ) : (
                <List dense disablePadding>
                  {recaps.map((recap) => (
                    <ListItem key={recap.gameId} disableGutters>
                      <ListItemText
                        primary={
                          <Link href={`/recaps/${recap.gameId}`} underline="hover" color="text.primary">
                            {`${recap.awayTeam} ${recap.awayScore} @ ${recap.homeTeam} ${recap.homeScore}`}
                          </Link>
                        }
                        secondary={[`Week ${recap.week}`, recap.hook].filter(Boolean).join(' · ')}
                        secondaryTypographyProps={{
                          sx: {
                            display: '-webkit-box',
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: 'vertical',
                            overflow: 'hidden',
                          },
                        }}
                      />
                    </ListItem>
                  ))}
                </List>
              )}
              <Link href="/recaps" underline="hover" variant="body2">
                All recaps
              </Link>
            </CardContent>
          </Card>
        </Grid>

        <Grid xs={12} md={4}>
          <Card variant="outlined" sx={{ height: '100%', bgcolor: 'background.paper' }}>
            <CardContent>
              <Typography variant="h6" sx={{ fontWeight: 700, mb: 1 }}>
                Strategy Library
              </Typography>
              <List dense disablePadding>
                {articles.map((article) => (
                  <ListItem key={article.slug} disableGutters>
                    <ListItemText
                      primary={
                        <Link href={`/strategy/${article.slug}`} underline="hover" color="text.primary">
                          {article.title}
                        </Link>
                      }
                      secondary={`${article.category} · ${article.readMinutes} min read`}
                    />
                  </ListItem>
                ))}
              </List>
              <Link href="/strategy" underline="hover" variant="body2">
                All strategy articles
              </Link>
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Box>
  );
}

export default PublicHighlights;
