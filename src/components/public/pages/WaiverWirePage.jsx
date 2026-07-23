import React, { useMemo } from 'react';
import { Box, Card, CardContent, Chip, Stack, Typography } from '@mui/material';
import Grid from '@mui/material/Unstable_Grid2';
import PriorityHighIcon from '@mui/icons-material/PriorityHigh';
import ShieldIcon from '@mui/icons-material/Shield';
import EventBusyIcon from '@mui/icons-material/EventBusy';
import PublicLayout from '../PublicLayout';
import PublicSeo from '../PublicSeo';
import ArticleCard from '../kit/ArticleCard';
import PlayerCard from '../kit/PlayerCard';
import Prose, { P } from '../kit/Prose';
import { LoadingRows, EmptyState, ErrorState } from '../kit/DataState';
import { usePublicResource } from '../kit/usePublicResource';
import { selectWaiverCandidates } from '../kit/waiverCandidates';
import { getArticle } from '../../../content/articles';
import publicApiClient from '../../../api/publicApiClient';

const CARDS = [
  { slug: 'waiver-priority-vs-faab', Icon: PriorityHighIcon },
  { slug: 'streaming-defense-and-kicker', Icon: ShieldIcon },
  { slug: 'playoff-prep', Icon: EventBusyIcon },
];

const KEY_TERMS = [
  ['FAAB', 'A season budget used for blind free-agent bids.'],
  ['Priority', 'A rolling claim order that resets after a successful add.'],
  ['Streaming', 'Rotating volatile positions based on the weekly matchup.'],
];

function AvailableTypeAdds() {
  const { loading, error, data, retry } = usePublicResource(
    () => publicApiClient.get('/api/public/rankings', { params: { limit: 100 } }).then((response) => response.data),
    []
  );
  const rankings = useMemo(() => data?.rankings || [], [data]);
  const candidates = useMemo(() => selectWaiverCandidates(rankings), [rankings]);

  return (
    <Box component="section" sx={{ mt: 6, mb: 6 }} aria-labelledby="available-type-adds-heading">
      <Typography id="available-type-adds-heading" variant="h4" component="h2" sx={{ fontWeight: 800 }}>
        Top Available-Type Adds
      </Typography>
      <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.75, mb: 2.5, maxWidth: 760 }}>
        Flex-relevant RB, WR, and TE depth beyond each position&apos;s leading tiers—the kind of names waiver claims are usually spent on. Actual availability depends on your league, but these are useful players to monitor before claims run.
      </Typography>
      {loading && <LoadingRows rows={3} height={76} />}
      {!loading && error && <ErrorState message="We couldn't load players to monitor." onRetry={retry} />}
      {!loading && !error && candidates.length === 0 && <EmptyState message="Player suggestions aren't available yet." />}
      {!loading && !error && candidates.length > 0 && (
        <Grid container spacing={2}>
          {candidates.map((player) => (
            <Grid xs={12} sm={6} md={4} key={player.playerId}>
              <PlayerCard player={player} stat={player.projectedPoints} statLabel="proj" subtitle={`Rank ${player.positionRank}`} />
            </Grid>
          ))}
        </Grid>
      )}
    </Box>
  );
}

function WaiverWirePage() {
  const cards = CARDS.map((card) => ({ ...card, article: getArticle(card.slug) })).filter((card) => card.article);

  return (
    <PublicLayout ctaContext="waiver">
      <PublicSeo
        title="Fantasy Football Waiver Wire Guide"
        description="Learn waiver priority, FAAB bidding, streaming tactics, and playoff stash strategy for fantasy football."
        path="/waiver-wire"
      />
      <Grid container spacing={3} alignItems="stretch" sx={{ mb: 4 }}>
        <Grid xs={12} md={7}>
          <Box sx={{ height: '100%' }}>
            <Typography variant="h3" component="h1" sx={{ fontWeight: 800 }}>Waiver Wire Guide</Typography>
            <Prose sx={{ mt: 1 }}>
              <P>
                The waiver wire is how free agents are claimed fairly. Instead of a first-come free-for-all, adds
                are processed together at a set time using one of two systems: a rolling <strong>priority</strong>{' '}
                order, or a season-long <strong>FAAB</strong> budget you bid from. Winning it week to week is
                where most championships are actually decided.
              </P>
              <P>
                The guides below cover the two systems, how to stream volatile positions, and how to bank the
                right assets before the playoffs—none of it tied to any single league.
              </P>
            </Prose>
          </Box>
        </Grid>
        <Grid xs={12} md={5}>
          <Card variant="outlined" sx={{ height: '100%' }}>
            <CardContent>
              <Typography variant="h5" component="h2" sx={{ fontWeight: 800, mb: 2 }}>Key terms</Typography>
              <Stack spacing={2}>
                {KEY_TERMS.map(([term, definition]) => (
                  <Box key={term}>
                    <Chip label={term} size="small" color="primary" variant="outlined" sx={{ mb: 0.75 }} />
                    <Typography variant="body2" sx={{ color: 'text.secondary' }}>{definition}</Typography>
                  </Box>
                ))}
              </Stack>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      <AvailableTypeAdds />

      <Typography variant="h4" component="h2" sx={{ fontWeight: 800, mb: 2.5 }}>Waiver strategy guides</Typography>
      <Grid container spacing={3}>
        {cards.map(({ slug, Icon, article }) => (
          <Grid xs={12} md={6} key={slug}>
            <ArticleCard article={article} Icon={Icon} />
          </Grid>
        ))}
      </Grid>
    </PublicLayout>
  );
}

export default WaiverWirePage;
