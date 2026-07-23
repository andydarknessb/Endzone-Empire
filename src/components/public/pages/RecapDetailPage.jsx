import React from 'react';
import { useParams } from 'react-router-dom';
import { Box, Card, CardContent, Chip, Divider, Stack, Typography } from '@mui/material';
import Grid from '@mui/material/Unstable_Grid2';
import PublicLayout from '../PublicLayout';
import PublicSeo from '../PublicSeo';
import PlayerCard from '../kit/PlayerCard';
import { LoadingRows, EmptyState, ErrorState } from '../kit/DataState';
import { usePublicResource } from '../kit/usePublicResource';
import publicApiClient from '../../../api/publicApiClient';

function ScoreboardSide({ team, score, winner }) {
  return (
    <Stack alignItems="center" spacing={0.5} sx={{ flex: 1 }}>
      <Typography variant="h5" component="div" sx={{ fontWeight: winner ? 800 : 600, color: winner ? 'text.primary' : 'text.secondary' }}>
        {team}
      </Typography>
      <Typography variant="stat" component="div" sx={{ fontSize: '2.75rem', fontWeight: 800, lineHeight: 1, color: winner ? 'var(--accent)' : 'text.secondary' }}>
        {score}
      </Typography>
    </Stack>
  );
}

function Scoreboard({ recap }) {
  const homeWon = recap.homeScore > recap.awayScore;
  const awayWon = recap.awayScore > recap.homeScore;
  return (
    <Card variant="outlined" sx={{ mb: 3 }}>
      <CardContent>
        <Stack direction="row" justifyContent="center" sx={{ mb: 1 }}>
          <Chip label="Final" size="small" color="primary" />
        </Stack>
        <Stack direction="row" alignItems="center" spacing={2}>
          <ScoreboardSide team={recap.awayTeam} score={recap.awayScore} winner={awayWon} />
          <Typography variant="h6" sx={{ color: 'text.secondary' }}>@</Typography>
          <ScoreboardSide team={recap.homeTeam} score={recap.homeScore} winner={homeWon} />
        </Stack>
        <Typography variant="caption" component="div" sx={{ textAlign: 'center', color: 'text.secondary', mt: 1 }}>
          Week {recap.week} · {recap.season}
        </Typography>
      </CardContent>
    </Card>
  );
}

function ScoringTimeline({ plays }) {
  if (!plays?.length) return null;
  // Group chronologically by quarter.
  const groups = [];
  for (const play of plays) {
    const q = play.quarter || '—';
    let group = groups.find((g) => g.quarter === q);
    if (!group) {
      group = { quarter: q, plays: [] };
      groups.push(group);
    }
    group.plays.push(play);
  }
  return (
    <Box sx={{ mb: 4 }}>
      <Typography variant="h5" component="h2" sx={{ fontWeight: 700, mb: 1.5 }}>Scoring timeline</Typography>
      <Stack spacing={2}>
        {groups.map((group) => (
          <Box key={group.quarter}>
            <Typography variant="overline" sx={{ color: 'text.secondary' }}>{group.quarter}</Typography>
            <Stack spacing={1} sx={{ mt: 0.5 }}>
              {group.plays.map((play, i) => (
                <Stack key={i} direction="row" spacing={1.5} alignItems="baseline" sx={{ borderLeft: '3px solid var(--border-strong)', pl: 1.5 }}>
                  {play.clock && <Typography variant="caption" sx={{ color: 'text.secondary', minWidth: 42 }}>{play.clock}</Typography>}
                  {play.team && <Chip label={play.team} size="small" variant="outlined" />}
                  <Typography variant="body2" sx={{ flexGrow: 1 }}>{play.description}</Typography>
                  <Typography variant="stat" component="span" sx={{ color: 'text.secondary' }}>
                    {play.awayScore}–{play.homeScore}
                  </Typography>
                </Stack>
              ))}
            </Stack>
          </Box>
        ))}
      </Stack>
    </Box>
  );
}

function RecapBody({ recap }) {
  return (
    <>
      <Scoreboard recap={recap} />
      {recap.narrative && (
        <Typography variant="body1" sx={{ mb: 4, lineHeight: 1.7 }}>{recap.narrative}</Typography>
      )}
      <ScoringTimeline plays={recap.scoringPlays} />
      {recap.topPerformers?.length > 0 && (
        <Box>
          <Divider sx={{ mb: 3 }} />
          <Typography variant="h5" component="h2" sx={{ fontWeight: 700, mb: 1.5 }}>Top fantasy performers</Typography>
          <Grid container spacing={2}>
            {recap.topPerformers.map((p) => (
              <Grid xs={12} sm={6} key={p.playerId}>
                <PlayerCard player={p} subtitle={p.statLine} />
              </Grid>
            ))}
          </Grid>
        </Box>
      )}
    </>
  );
}

function RecapDetailPage() {
  const { gameId } = useParams();
  const { loading, error, data, retry } = usePublicResource(
    () => publicApiClient.get(`/api/public/recaps/${gameId}`).then((r) => r.data),
    [gameId]
  );
  const scoreline = data
    ? `${data.awayTeam} ${data.awayScore}\u2013${data.homeScore} ${data.homeTeam}`
    : `NFL Game ${gameId}`;
  const description = data
    ? `Final score: ${data.awayTeam} ${data.awayScore}, ${data.homeTeam} ${data.homeScore}. Week ${data.week} of the ${data.season} NFL season.${data.narrative ? ` ${data.narrative}` : ''}`
    : `Final score, scoring timeline, and top fantasy performers for NFL game ${gameId}.`;

  return (
    <PublicLayout maxWidth="md" ctaContext="recaps">
      <PublicSeo
        title={`${scoreline} Final`}
        description={description}
        path={`/recaps/${encodeURIComponent(gameId)}`}
        type="article"
        imageAlt={data ? `${scoreline} final score` : 'Endzone Empire NFL game recap'}
      />
      {loading && <LoadingRows rows={5} height={80} />}
      {!loading && error && <ErrorState message="We couldn't load this recap." onRetry={retry} />}
      {!loading && !error && !data && <EmptyState message="Recap not found." />}
      {!loading && !error && data && <RecapBody recap={data} />}
    </PublicLayout>
  );
}

export default RecapDetailPage;
