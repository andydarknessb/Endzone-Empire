import React, { useEffect, useState } from 'react';
import PropTypes from 'prop-types';
import { Box, Typography, Button, alpha } from '@mui/material';
import { useTheme, keyframes } from '@mui/material/styles';
import { Sprite } from './TecmoSprite';
import { getSpriteColors } from '../../lib/nflTeamColors';
import { playLabel } from '../../lib/scoringEvents';
import { RosterPreviewGrid } from './MatchupExtras';

const YARD_LABELS = ['10', '20', '30', '40', '50', '40', '30', '20', '10'];
const LEG_FRAME_MS = 140;
const MOMENT_FLASH_MS = 1800;

// How far into the field (0..100, % from the home goal line) each side's sprite
// sits at homeProb 0 and 1 — never quite at the goal line itself, so a sprite is
// always visible even in a probability blowout.
const HOME_MIN = 8;
const HOME_MAX = 84;
const AWAY_MIN = 16;
const AWAY_MAX = 92;

const dash = keyframes`
  from { transform: translateX(0); }
  to { transform: translateX(var(--dash-distance)); }
`;

const flashIn = keyframes`
  0% { opacity: 0; transform: translate(-50%, -50%) scale(0.9); }
  15% { opacity: 1; transform: translate(-50%, -50%) scale(1); }
  80% { opacity: 1; }
  100% { opacity: 0; }
`;

function GoalPost({ color }) {
  // Upright pole/crossbar/uprights silhouette, standing at the back of the
  // endzone — same shape regardless of side, since a goal post doesn't lean
  // toward the field, it just stands there.
  return (
    <svg
      viewBox="0 0 24 40"
      width="18"
      height="30"
      aria-hidden="true"
      focusable="false"
    >
      <line x1="12" y1="16" x2="12" y2="38" stroke={color} strokeWidth="2" />
      <line x1="2" y1="16" x2="22" y2="16" stroke={color} strokeWidth="2" />
      <line x1="2" y1="2" x2="2" y2="16" stroke={color} strokeWidth="2" />
      <line x1="22" y1="2" x2="22" y2="16" stroke={color} strokeWidth="2" />
    </svg>
  );
}

GoalPost.propTypes = {
  color: PropTypes.string.isRequired,
};

function Endzone({ side, name, bgColor, postColor }) {
  return (
    <Box
      sx={{
        position: 'relative',
        width: { xs: 32, sm: 44 },
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        py: 1,
        borderRadius: 1,
        bgcolor: bgColor,
      }}
    >
      <Typography
        noWrap
        sx={{
          writingMode: 'vertical-rl',
          transform: side === 'home' ? 'rotate(180deg)' : 'none',
          color: 'common.white',
          fontWeight: 700,
          fontSize: { xs: '0.6rem', sm: '0.7rem' },
          letterSpacing: 1,
          maxHeight: { xs: 100, sm: 140 },
        }}
      >
        {(name || '').toUpperCase()}
      </Typography>
      {/* The back line of the endzone is its outer edge (away from the
          field) — the goal post sits centered on that line, same as a real
          endzone, rather than tucked in with the team name. */}
      <Box
        sx={{
          position: 'absolute',
          top: '50%',
          transform: 'translateY(-50%)',
          ...(side === 'home' ? { left: 2 } : { right: 2 }),
        }}
      >
        <GoalPost color={postColor} />
      </Box>
    </Box>
  );
}

Endzone.propTypes = {
  side: PropTypes.oneOf(['home', 'away']).isRequired,
  name: PropTypes.string,
  bgColor: PropTypes.string.isRequired,
  postColor: PropTypes.string.isRequired,
};

/**
 * Persistent retro field: two Tecmo-style sprites tug-of-war across the yard
 * lines as live win probability shifts (there's no real per-play field
 * position for a fantasy matchup, so this is the honest analog — "further
 * into enemy territory" standing in for "more likely to win"). Each side is
 * bookended by an endzone carrying the manager's fantasy team name and a
 * goal post.
 *
 * On an actual touchdown play, the scoring side's sprite gets a quick
 * real-team-colored dash to the endzone before the full-screen TecmoCutscene
 * takes over. Non-touchdown "moment" plays (field goal, sack, interception,
 * fumble recovery, punt return) instead flash a short retro LED banner —
 * there's no meaningful field position to dramatize for those, so a banner
 * reads truer than a fabricated run.
 */
function RetroField({
  homeName,
  awayName,
  homeProb,
  homeStarters,
  awayStarters,
  homeBench,
  awayBench,
  activePlay,
}) {
  const theme = useTheme();
  const [frame, setFrame] = useState(0);
  const [benchOpen, setBenchOpen] = useState(false);

  useEffect(() => {
    const id = setInterval(() => setFrame((f) => (f === 0 ? 1 : 0)), LEG_FRAME_MS);
    return () => clearInterval(id);
  }, []);

  const prob = Math.max(0, Math.min(1, Number(homeProb) || 0.5));
  const homePct = HOME_MIN + prob * (HOME_MAX - HOME_MIN);
  const awayPct = AWAY_MAX - prob * (AWAY_MAX - AWAY_MIN);

  const homeKit = {
    helmet: theme.palette.primary.dark,
    jersey: theme.palette.primary.main,
    pants: theme.palette.primary.contrastText,
    accent: theme.palette.primary.light,
  };
  const awayKit = {
    helmet: theme.palette.secondary.dark,
    jersey: theme.palette.secondary.main,
    pants: theme.palette.secondary.contrastText,
    accent: theme.palette.secondary.light,
  };

  const isTouchdownPlay = !!activePlay && activePlay.isTouchdown !== false;
  const momentPlay = !!activePlay && activePlay.isTouchdown === false ? activePlay : null;

  const dashSide = isTouchdownPlay ? activePlay.side : null;
  const dashKit = isTouchdownPlay
    ? getSpriteColors(activePlay.nflTeam, activePlay.opponent).runner
    : null;

  const fieldGreen = theme.palette.success.dark;
  const stripe = alpha(theme.palette.common.black, 0.05);
  const yardLine = alpha(theme.palette.common.white, 0.35);
  const led = theme.palette.success.light;

  const bench = benchOpen
    ? [
        { label: homeName, players: homeBench || [] },
        { label: awayName, players: awayBench || [] },
      ]
    : null;

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'stretch', gap: 0.5 }}>
        <Endzone side="home" name={homeName} bgColor="primary.dark" postColor={theme.palette.common.white} />

        <Box
          role="img"
          aria-label={`Field position: ${homeName} ${Math.round(prob * 100)}% likely to win`}
          sx={{
            position: 'relative',
            flex: 1,
            minWidth: 0,
            height: { xs: 140, sm: 180 },
            borderRadius: 1,
            overflow: 'hidden',
            bgcolor: fieldGreen,
            backgroundImage: `repeating-linear-gradient(90deg, transparent 0, transparent 9%, ${stripe} 9%, ${stripe} 10%)`,
          }}
        >
          {YARD_LABELS.map((label, i) => (
            <Typography
              key={i}
              aria-hidden="true"
              sx={{
                position: 'absolute',
                left: `${8 + i * 10.5}%`,
                top: 6,
                fontSize: '0.7rem',
                fontWeight: 700,
                color: yardLine,
              }}
            >
              {label}
            </Typography>
          ))}

          <Box
            sx={{
              position: 'absolute',
              left: `${homePct}%`,
              bottom: '20%',
              width: 28,
              height: 28,
              transform: 'translateX(-50%)',
              transition: 'left 1.2s ease',
              ...(dashSide === 'home' && {
                '--dash-distance': `${(96 - homePct) * (280 / 100)}px`,
                animation: `${dash} 0.7s ease-out forwards`,
              }),
            }}
          >
            <Sprite kit={dashSide === 'home' ? dashKit : homeKit} frame={frame} className="retro-field-sprite" />
          </Box>

          <Box
            sx={{
              position: 'absolute',
              left: `${awayPct}%`,
              bottom: '20%',
              width: 28,
              height: 28,
              transform: 'translateX(-50%) scaleX(-1)',
              transition: 'left 1.2s ease',
              ...(dashSide === 'away' && {
                '--dash-distance': `${(4 - awayPct) * (280 / 100)}px`,
                animation: `${dash} 0.7s ease-out forwards`,
              }),
            }}
          >
            <Sprite kit={dashSide === 'away' ? dashKit : awayKit} frame={frame} className="retro-field-sprite" />
          </Box>

          {momentPlay && (
            <Box
              key={`${momentPlay.side}-${momentPlay.type}-${momentPlay.nflTeam}`}
              role="status"
              sx={{
                position: 'absolute',
                top: '50%',
                left: '50%',
                px: 1.5,
                py: 0.5,
                bgcolor: 'common.black',
                borderRadius: 1,
                whiteSpace: 'nowrap',
                animation: `${flashIn} ${MOMENT_FLASH_MS}ms ease-in-out forwards`,
              }}
            >
              <Typography
                sx={{
                  fontFamily: '"Courier New", monospace',
                  letterSpacing: 2,
                  fontWeight: 700,
                  fontSize: { xs: '0.7rem', sm: '0.9rem' },
                  color: led,
                  textShadow: `0 0 6px ${alpha(led, 0.65)}`,
                }}
              >
                {(momentPlay.nflTeam ? `${momentPlay.nflTeam} · ` : '') + playLabel(momentPlay)}
              </Typography>
            </Box>
          )}
        </Box>

        <Endzone side="away" name={awayName} bgColor="secondary.dark" postColor={theme.palette.common.white} />
      </Box>

      <Box sx={{ mt: 2 }}>
        <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 0.5 }}>
          Starting Lineups
        </Typography>
        <RosterPreviewGrid homeStarters={homeStarters} awayStarters={awayStarters} />
      </Box>

      <Box sx={{ display: 'flex', justifyContent: 'center', mt: 1.5 }}>
        <Button
          variant="contained"
          size="small"
          onClick={() => setBenchOpen((o) => !o)}
        >
          {benchOpen ? 'Hide Benches' : 'Show Benches'}
        </Button>
      </Box>

      {bench && (
        <Box sx={{ display: 'flex', gap: 3, mt: 2, flexWrap: 'wrap' }}>
          {bench.map(({ label, players }) => (
            <Box key={label} sx={{ flex: '1 1 260px', maxWidth: 320 }}>
              <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 0.5 }}>
                {label} Bench
              </Typography>
              {players.length === 0 && (
                <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                  No bench players.
                </Typography>
              )}
              {players.map((p) => (
                <Box key={p.id} sx={{ display: 'flex', justifyContent: 'space-between', py: 0.4 }}>
                  <Typography variant="body2" noWrap sx={{ color: 'text.secondary' }}>
                    {p.name} <Typography component="span" variant="caption">({p.position})</Typography>
                  </Typography>
                  <Typography variant="body2" sx={{ color: 'text.secondary', flexShrink: 0, ml: 1 }}>
                    {Number(p.points || 0).toFixed(1)}
                  </Typography>
                </Box>
              ))}
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
}

RetroField.propTypes = {
  homeName: PropTypes.string,
  awayName: PropTypes.string,
  homeProb: PropTypes.number,
  homeStarters: PropTypes.array,
  awayStarters: PropTypes.array,
  homeBench: PropTypes.array,
  awayBench: PropTypes.array,
  activePlay: PropTypes.shape({
    side: PropTypes.oneOf(['home', 'away']),
    type: PropTypes.string,
    isTouchdown: PropTypes.bool,
    nflTeam: PropTypes.string,
    opponent: PropTypes.string,
  }),
};

export default RetroField;
