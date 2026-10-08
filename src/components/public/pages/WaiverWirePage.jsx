import React from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Avatar, Box, Card, CardActionArea, CardContent, Chip, Stack, Typography } from '@mui/material';
import Grid from '@mui/material/Unstable_Grid2';
import LeaderboardIcon from '@mui/icons-material/Leaderboard';
import PriorityHighIcon from '@mui/icons-material/PriorityHigh';
import ShieldIcon from '@mui/icons-material/Shield';
import SportsFootballIcon from '@mui/icons-material/SportsFootball';
import PublicLayout from '../PublicLayout';
import PublicSeo from '../PublicSeo';
import ArticleCard from '../kit/ArticleCard';
import Prose, { P } from '../kit/Prose';
import { LoadingRows, EmptyState, ErrorState } from '../kit/DataState';
import { positionColorVar } from '../kit/positionColor';
import { usePublicResource } from '../kit/usePublicResource';
import { getArticle } from '../../../content/articles';
import publicApiClient from '../../../api/publicApiClient';

const CARDS = [
  { slug: 'week5-waiver-wire-darkness-report', Icon: LeaderboardIcon },
  { slug: 'week5-start-sit-darkness-report', Icon: SportsFootballIcon },
  { slug: 'waiver-priority-vs-faab', Icon: PriorityHighIcon },
  { slug: 'streaming-defense-and-kicker', Icon: ShieldIcon },
];

const KEY_TERMS = [
  ['FAAB', 'A season budget used for blind free-agent bids.'],
  ['Priority', 'A rolling claim order that resets after a successful add.'],
  ['Streaming', 'Rotating volatile positions based on the weekly matchup.'],
];

/** Initials fallback for a missing headshot. */
function initials(name) {
  return String(name || '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0])
    .join('')
    .toUpperCase();
}

function WaiverTargetCard({ target }) {
  const { playerId, name, position, nflTeam, photoUrl, opponent, ownership, bidMin, bidMax, reason, projection } = target;
  return (
    <Card variant="outlined" sx={{ height: '100%' }}>
      <CardActionArea component={RouterLink} to={`/players/${playerId}`} sx={{ p: 1.5, height: '100%' }}>
        <Stack direction="row" spacing={1.5} alignItems="center">
          <Avatar src={photoUrl || undefined} alt="" sx={{ width: 48, height: 48, bgcolor: 'var(--surface-sunken)', color: 'text.primary' }}>
            <span aria-hidden="true">{initials(name)}</span>
          </Avatar>
          <Box sx={{ minWidth: 0, flexGrow: 1 }}>
            <Typography variant="subtitle2" component="p" noWrap sx={{ fontWeight: 700 }}>{name}</Typography>
            <Stack direction="row" spacing={0.75} alignItems="center" sx={{ mt: 0.25 }}>
              {position && (
                <Chip
                  label={position}
                  size="small"
                  sx={{ bgcolor: positionColorVar(position), color: 'var(--text-inverse)', height: 18, fontSize: 11 }}
                />
              )}
              {nflTeam && <Typography variant="caption" sx={{ color: 'text.secondary' }}>{nflTeam}</Typography>}
              {/* A null opponent is a bye, a free agent or an unsynced schedule, and
                  the payload cannot tell them apart, so nothing is claimed. */}
              {opponent && (
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>{`Opp ${opponent}`}</Typography>
              )}
            </Stack>
          </Box>
          {/* Ownership is null when the feed is stale (#1831): the block is left
              out rather than rendering "null%" or an empty figure. */}
          {ownership != null && (
            <Box sx={{ textAlign: 'right', flexShrink: 0 }}>
              <Typography variant="stat" component="div" sx={{ fontWeight: 800, color: 'var(--accent)', fontSize: '1.15rem' }}>
                {`${ownership}%`}
              </Typography>
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>owned</Typography>
            </Box>
          )}
        </Stack>
        {/* A computed target (no board this week) carries the projection instead
            of an editorial bid range and reason. */}
        {projection != null ? (
          <Typography variant="body2" sx={{ mt: 1.25, fontWeight: 700 }}>
            {`${projection} proj`}
          </Typography>
        ) : (
          <>
            <Typography variant="body2" sx={{ mt: 1.25, fontWeight: 700 }}>
              {`Bid ${bidMin} to ${bidMax}% of budget`}
            </Typography>
            <Typography variant="body2" sx={{ mt: 0.5, color: 'text.secondary' }}>{reason}</Typography>
          </>
        )}
      </CardActionArea>
    </Card>
  );
}

function WaiverTargets() {
  const { loading, error, data, retry } = usePublicResource(
    () => publicApiClient.get('/api/public/waiver-targets').then((response) => response.data),
    []
  );
  const targets = data?.targets || [];
  const title = data?.week ? `Week ${data.week} Waiver Targets` : 'Waiver Targets';
  // Every Ownership % null means the feed is stale (#1831): the picks stand, but
  // the "under half of public leagues" claim cannot be made for them.
  const ownershipUnknown = targets.length > 0 && targets.every((target) => target.ownership == null);

  return (
    <Box component="section" sx={{ mt: 6, mb: 6 }} aria-labelledby="waiver-targets-heading">
      <Typography id="waiver-targets-heading" variant="h4" component="h2" sx={{ fontWeight: 800, ...(targets.length === 0 && { mb: 2.5 }) }}>
        {title}
      </Typography>
      {targets.length > 0 && (
        <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.75, mb: 2.5, maxWidth: 760 }}>
          {data?.source === 'computed'
            ? 'No Darkness Report is posted for this week yet, so these are the highest-projected players rostered in under half of public leagues, at most two per position. Actual availability depends on your league, but these are useful players to monitor before claims run.'
            : ownershipUnknown
              ? 'This week’s picks from our Darkness Report. The share of public leagues rostering each player is out of date, so it is not shown right now. Bids are a percent of a $100 budget. Actual availability depends on your league, but these are useful players to monitor before claims run.'
              : 'This week’s picks from our Darkness Report, limited to players rostered in under half of public leagues. Bids are a percent of a $100 budget. Actual availability depends on your league, but these are useful players to monitor before claims run.'}
        </Typography>
      )}
      {loading && <LoadingRows rows={3} height={76} />}
      {!loading && error && <ErrorState message="We couldn't load this week's waiver targets." onRetry={retry} />}
      {!loading && !error && targets.length === 0 && <EmptyState message="This week's waiver targets aren't posted yet." />}
      {!loading && !error && targets.length > 0 && (
        <Grid container spacing={2}>
          {targets.map((target) => (
            <Grid xs={12} sm={6} md={4} key={target.playerId}>
              <WaiverTargetCard target={target} />
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
                right assets before the playoffs, none of it tied to any single league.
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

      <WaiverTargets />

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
