import React from 'react';
import PropTypes from 'prop-types';
import { Box, Typography, alpha } from '@mui/material';
import { useTheme } from '@mui/material/styles';

/**
 * Dot-matrix-style scoreboard header. A CSS approximation (monospace, wide
 * letter-spacing, a soft glow) rather than a pixel-accurate LED font/asset.
 */
function RetroScoreboard({ leagueName, homeName, awayName, homeScore, awayScore, isFinal, isLive }) {
  const theme = useTheme();
  const led = theme.palette.success.light;
  const glow = alpha(led, 0.65);

  const textStyle = (size, opacity = 1) => ({
    fontFamily: '"Courier New", monospace',
    letterSpacing: { xs: 1, sm: 2 },
    fontSize: size,
    color: led,
    opacity,
    textShadow: `0 0 6px ${glow}`,
    lineHeight: 1.2,
  });

  return (
    <Box sx={{ bgcolor: 'common.black', borderRadius: 1, p: { xs: 2, sm: 3 } }}>
      <Typography sx={{ ...textStyle('0.7rem', 0.8), textAlign: 'center', mb: 2 }}>
        {(leagueName || '').toUpperCase()}
      </Typography>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <Box sx={{ minWidth: 0 }}>
          <Typography noWrap sx={{ ...textStyle({ xs: '0.85rem', sm: '1.25rem' }) }}>
            {(homeName || '').toUpperCase()}
          </Typography>
          <Typography sx={{ ...textStyle({ xs: '2rem', sm: '3rem' }), fontWeight: 700 }}>
            {Number(homeScore || 0).toFixed(0)}
          </Typography>
        </Box>
        <Typography sx={{ ...textStyle('0.85rem', 0.7), px: 1 }}>
          {isFinal ? 'FINAL' : isLive ? 'LIVE' : 'NOT STARTED'}
        </Typography>
        <Box sx={{ minWidth: 0, textAlign: 'right' }}>
          <Typography noWrap sx={{ ...textStyle({ xs: '0.85rem', sm: '1.25rem' }) }}>
            {(awayName || '').toUpperCase()}
          </Typography>
          <Typography sx={{ ...textStyle({ xs: '2rem', sm: '3rem' }), fontWeight: 700 }}>
            {Number(awayScore || 0).toFixed(0)}
          </Typography>
        </Box>
      </Box>
    </Box>
  );
}

RetroScoreboard.propTypes = {
  leagueName: PropTypes.string,
  homeName: PropTypes.string,
  awayName: PropTypes.string,
  homeScore: PropTypes.number,
  awayScore: PropTypes.number,
  isFinal: PropTypes.bool,
  isLive: PropTypes.bool,
};

export default RetroScoreboard;
