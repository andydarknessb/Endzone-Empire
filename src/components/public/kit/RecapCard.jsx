import React from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Avatar, Card, CardActionArea, CardContent, Box, Chip, Stack, Typography } from '@mui/material';

/** One team's abbreviation + score row, winner emphasized. */
function ScoreRow({ team, score, winner }) {
  return (
    <Stack direction="row" justifyContent="space-between" alignItems="center">
      <Typography sx={{ fontWeight: winner ? 800 : 500, color: winner ? 'text.primary' : 'text.secondary' }}>
        {team}
      </Typography>
      <Typography variant="stat" component="span" sx={{ fontWeight: winner ? 800 : 500, color: winner ? 'text.primary' : 'text.secondary' }}>
        {score}
      </Typography>
    </Stack>
  );
}

/**
 * A public NFL game-recap card: away/home abbrevs with the final score (winner
 * bold), a "Week N" label, and the one-line narrative hook. Links to the recap
 * detail page. Distinct from the authed league RecapCard.
 */
function RecapCard({ recap }) {
  const { gameId, week, homeTeam, awayTeam, homeScore, awayScore, hook, topPerformer } = recap;
  const homeWon = homeScore > awayScore;
  const awayWon = awayScore > homeScore;
  return (
    <Card variant="outlined" sx={{ height: '100%' }}>
      <CardActionArea component={RouterLink} to={`/recaps/${gameId}`} sx={{ height: '100%', alignItems: 'stretch' }}>
        <CardContent sx={{ height: '100%', display: 'flex', flexDirection: 'column', gap: 1 }}>
          <Stack direction="row" justifyContent="space-between" alignItems="center">
            <Chip label={`Week ${week}`} size="small" variant="outlined" />
            <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 700, letterSpacing: 0.5 }}>
              FINAL
            </Typography>
          </Stack>
          <Box sx={{ py: 0.5 }}>
            <ScoreRow team={awayTeam} score={awayScore} winner={awayWon} />
            <ScoreRow team={homeTeam} score={homeScore} winner={homeWon} />
          </Box>
          {hook && (
            <Typography variant="body2" sx={{ color: 'text.secondary', flexGrow: 1 }}>
              {hook}
            </Typography>
          )}
          {topPerformer && (
            <Stack direction="row" spacing={1} alignItems="center" sx={{ pt: 1, mt: 'auto', borderTop: '1px solid var(--border-subtle)' }}>
              <Avatar src={topPerformer.photoUrl || undefined} alt="" sx={{ width: 30, height: 30, bgcolor: 'var(--surface-sunken)', color: 'text.primary', fontSize: 12 }}>
                {String(topPerformer.name || '').slice(0, 1)}
              </Avatar>
              <Box sx={{ minWidth: 0, flexGrow: 1 }}>
                <Typography variant="caption" component="div" sx={{ color: 'text.secondary' }}>Top fantasy performer</Typography>
                <Typography variant="body2" noWrap sx={{ fontWeight: 700 }}>{topPerformer.name}</Typography>
              </Box>
              <Typography variant="stat" sx={{ fontWeight: 800, color: 'var(--accent)' }}>{topPerformer.fantasyPoints}</Typography>
            </Stack>
          )}
        </CardContent>
      </CardActionArea>
    </Card>
  );
}

export default RecapCard;
