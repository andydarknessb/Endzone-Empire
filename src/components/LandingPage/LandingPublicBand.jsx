import React, { useEffect, useState } from 'react';
import { Box, Button, Container, Typography, Card, CardContent, Stack, Link, Divider } from '@mui/material';
import Grid from '@mui/material/Unstable_Grid2';
import publicApiClient from '../../api/publicApiClient';
import { featuredArticles } from '../../content/articles';

/**
 * "Free tools & NFL coverage, no account needed" band on the landing page.
 *
 * Lives inside the hash app, so every link into the public layer is a plain
 * <a href> (a real document navigation that hands off to the public
 * BrowserRouter shell), never a RouterLink. Each teaser degrades independently:
 * a failed or empty fetch simply hides that column — the band (and the landing
 * page) never breaks. The articles teaser is static content, so it always shows.
 */
function useTeaser(fetcher) {
  const [items, setItems] = useState(null); // null = loading, [] = empty/failed
  useEffect(() => {
    let alive = true;
    fetcher()
      .then((data) => alive && setItems(data))
      .catch(() => alive && setItems([]));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return items;
}

function TeaserCard({ title, viewAllHref, viewAllLabel = 'View all →', children }) {
  return (
    <Card variant="outlined" sx={{ height: '100%' }}>
      <CardContent sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        <Stack direction="row" justifyContent="space-between" alignItems="baseline" sx={{ mb: 1.5 }}>
          <Typography variant="h6" component="h3" sx={{ fontWeight: 700 }}>{title}</Typography>
          <Link href={viewAllHref} underline="hover" sx={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{viewAllLabel}</Link>
        </Stack>
        <Box sx={{ flexGrow: 1 }}>{children}</Box>
      </CardContent>
    </Card>
  );
}

function LandingPublicBand() {
  const rankings = useTeaser(() =>
    publicApiClient.get('/api/public/rankings', { params: { limit: 10 } }).then((r) => r.data?.rankings || [])
  );
  const recaps = useTeaser(() =>
    publicApiClient.get('/api/public/recaps', { params: { limit: 3 } }).then((r) => r.data?.recaps || [])
  );
  const articles = featuredArticles(3);

  const hasRankings = rankings && rankings.length > 0;
  const hasRecaps = recaps && recaps.length > 0;

  return (
    <Box component="section" sx={{ py: { xs: 6, md: 8 }, bgcolor: 'background.default', borderTop: '1px solid var(--border-subtle)' }}>
      <Container maxWidth="lg">
        <Stack spacing={1} alignItems="center" textAlign="center" sx={{ mb: 4 }}>
          <Typography variant="h4" component="h2" sx={{ fontWeight: 800 }}>
            Free tools &amp; NFL coverage, no account needed
          </Typography>
          <Typography variant="body1" sx={{ color: 'text.secondary', maxWidth: 620 }}>
            Browse rankings, player profiles, auto-generated game recaps, and fantasy strategy without
            signing up. Bring the whole thing to your league when you&apos;re ready.
          </Typography>
          {/* Plain <a href>: the simulator lives in the public BrowserRouter tree. */}
          <Button component="a" href="/draft-simulator" variant="contained" sx={{ mt: 1, fontWeight: 700 }}>
            Try the Mock Draft Simulator
          </Button>
        </Stack>

        <Grid container spacing={3} alignItems="stretch">
          {hasRankings && (
            <Grid xs={12} md={4}>
              <TeaserCard title="Top rankings" viewAllHref="/rankings">
                <Stack divider={<Divider flexItem />} spacing={0.5}>
                  {rankings.slice(0, 8).map((row) => (
                    <Stack key={row.playerId} direction="row" justifyContent="space-between" alignItems="center" sx={{ py: 0.25 }}>
                      <Link href={`/players/${row.playerId}`} underline="hover" sx={{ color: 'text.primary', fontWeight: 600, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        <Box component="span" sx={{ color: 'text.secondary', mr: 1 }}>{row.rank}</Box>
                        {row.name}
                      </Link>
                      <Typography variant="stat" component="span" sx={{ color: 'text.secondary', ml: 1 }}>
                        {row.projectedPoints}
                      </Typography>
                    </Stack>
                  ))}
                </Stack>
              </TeaserCard>
            </Grid>
          )}

          {hasRecaps && (
            <Grid xs={12} md={4}>
              <TeaserCard title="Latest recaps" viewAllHref="/recaps">
                <Stack spacing={1.5}>
                  {recaps.slice(0, 3).map((recap) => (
                    <Link key={recap.gameId} href={`/recaps/${recap.gameId}`} underline="none" sx={{ display: 'block', color: 'text.primary' }}>
                      <Stack direction="row" justifyContent="space-between" alignItems="center">
                        <Typography sx={{ fontWeight: 700 }}>
                          {recap.awayTeam} {recap.awayScore}–{recap.homeScore} {recap.homeTeam}
                        </Typography>
                        <Typography variant="caption" sx={{ color: 'text.secondary' }}>Wk {recap.week}</Typography>
                      </Stack>
                      {recap.hook && (
                        <Typography variant="body2" sx={{ color: 'text.secondary' }} noWrap>{recap.hook}</Typography>
                      )}
                    </Link>
                  ))}
                </Stack>
              </TeaserCard>
            </Grid>
          )}

          <Grid xs={12} md={4}>
            <TeaserCard title="Strategy" viewAllHref="/strategy">
              <Stack spacing={1.5}>
                {articles.map((article) => (
                  <Link key={article.slug} href={`/strategy/${article.slug}`} underline="none" sx={{ display: 'block', color: 'text.primary' }}>
                    <Typography sx={{ fontWeight: 700 }}>{article.title}</Typography>
                    <Typography variant="body2" sx={{ color: 'text.secondary' }} noWrap>{article.excerpt}</Typography>
                  </Link>
                ))}
              </Stack>
            </TeaserCard>
          </Grid>
        </Grid>
      </Container>
    </Box>
  );
}

export default LandingPublicBand;
