import React from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Card, CardActionArea, Avatar, Box, Chip, Stack, Typography } from '@mui/material';
import { positionColorVar } from './positionColor';

/** Initials fallback for a missing headshot (mirrors the authed TeamAvatar convention). */
function initials(name) {
  return String(name || '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
}

/**
 * Compact player tile: headshot, name, position/team, and an optional stat
 * (e.g. fantasy points on recap top-performers). Links to the public profile.
 * The headshot's alt is empty (decorative) because the name sits right beside
 * it — a screen reader would otherwise read the name twice.
 */
function PlayerCard({ player, stat, statLabel = 'pts', subtitle }) {
  const { playerId, name, position, nflTeam, photoUrl, fantasyPoints } = player;
  const statValue = stat != null ? stat : fantasyPoints;
  return (
    <Card variant="outlined" sx={{ height: '100%' }}>
      <CardActionArea component={RouterLink} to={`/players/${playerId}`} sx={{ p: 1.5, height: '100%' }}>
        <Stack direction="row" spacing={1.5} alignItems="center">
          <Avatar src={photoUrl || undefined} alt="" sx={{ width: 48, height: 48, bgcolor: 'var(--surface-sunken)', color: 'text.primary' }}>
            {initials(name)}
          </Avatar>
          <Box sx={{ minWidth: 0, flexGrow: 1 }}>
            <Typography variant="subtitle2" component="span" noWrap sx={{ fontWeight: 700 }}>
              {name}
            </Typography>
            <Stack direction="row" spacing={0.75} alignItems="center" sx={{ mt: 0.25 }}>
              {position && (
                <Chip
                  label={position}
                  size="small"
                  sx={{ bgcolor: positionColorVar(position), color: 'var(--text-inverse)', height: 18, fontSize: 11 }}
                />
              )}
              {nflTeam && (
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                  {nflTeam}
                </Typography>
              )}
              {subtitle && (
                <Typography variant="caption" sx={{ color: 'text.secondary' }} noWrap>
                  {subtitle}
                </Typography>
              )}
            </Stack>
          </Box>
          {statValue != null && (
            <Box sx={{ textAlign: 'right', flexShrink: 0 }}>
              <Typography variant="stat" component="div" sx={{ fontWeight: 800, color: 'var(--accent)', fontSize: '1.15rem' }}>
                {statValue}
              </Typography>
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                {statLabel}
              </Typography>
            </Box>
          )}
        </Stack>
      </CardActionArea>
    </Card>
  );
}

export default PlayerCard;
