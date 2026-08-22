import React, { useId, useMemo, useRef, useState, useEffect } from 'react';
import { Paper, Box, Chip, Typography, Table, TableBody, TableCell, TableContainer, TableHead, TableRow } from '@mui/material';
import { keyframes } from '@mui/material/styles';
import PositionChip from '../PlayerQuickView/PositionChip';

// Same technique as the matchup score flash: a CSS var color (theme-aware,
// no hard-coded literal) that fades in and back out.
const pickLandedFlash = keyframes`
  0% { background-color: transparent; }
  35% { background-color: var(--accent-soft); }
  100% { background-color: transparent; }
`;

// Pulsing outline for the next-on-the-clock cell. The outline color itself is
// set via sx (theme-aware); only the opacity animates here so the keyframe
// stays theme-agnostic.
const onClockPulse = keyframes`
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
`;

const TEAM_COL_MIN_WIDTH = 110;

const stickyRoundHeadSx = {
  color: 'primary.contrastText',
  fontWeight: 'bold',
  position: 'sticky',
  left: 0,
  bgcolor: 'primary.main',
  zIndex: 3,
};

const stickyRoundCellSx = {
  position: 'sticky',
  left: 0,
  bgcolor: 'inherit',
  zIndex: 1,
  fontWeight: 'bold',
  color: 'text.secondary',
};

const stripedRowsSx = {
  '& tbody tr': { backgroundColor: 'var(--surface)' },
  '& tbody tr:nth-of-type(even)': { backgroundColor: 'var(--row-stripe)' },
};

/** Remounts (via the returned key) whenever `value` changes after the first render, so a CSS animation can replay. */
function useFlashKey(value) {
  const prevRef = useRef(value);
  const [flashKey, setFlashKey] = useState(0);
  useEffect(() => {
    if (value != null && prevRef.current != null && value !== prevRef.current) {
      setFlashKey((k) => k + 1);
    }
    prevRef.current = value;
  }, [value]);
  return flashKey;
}

/**
 * Classic snake-draft matrix: one column per team (draft-position order), one
 * row per round. Cells are keyed off `round-teamId` and derived straight from
 * the picks array (which already carries the server-assigned team_id) — no
 * client-side re-derivation of snake order is needed to place a landed pick,
 * only to know the round a pick_number falls in (ceil(pick_number / teamCount)).
 */
function DraftBoardMatrix({
  teams, picks, onTheClock, draftRounds, onOpenQuickView, readOnly = false,
  // Shared with DraftPresenter.jsx and the mock draft simulator, each with
  // their own heading hierarchy - defaults to h2 for this issue's target
  // (DraftBoard.jsx, directly under the page's H1), overridable so a caller
  // with a different structure isn't forced to accept a level that creates
  // its own skipped-level problem.
  titleComponent = 'h2',
}) {
  const headingId = useId();
  const orderedTeams = useMemo(
    () => [...teams].sort((a, b) => (a.draft_position ?? Infinity) - (b.draft_position ?? Infinity)),
    [teams]
  );
  const teamCount = orderedTeams.length;

  const pickByCell = useMemo(() => {
    const map = new Map();
    if (teamCount === 0) return map;
    picks.forEach((pick) => {
      const round = Math.ceil(pick.pick_number / teamCount);
      map.set(`${round}-${pick.team_id}`, pick);
    });
    return map;
  }, [picks, teamCount]);

  const totalRounds = useMemo(() => {
    if (draftRounds > 0) return draftRounds;
    if (teamCount === 0) return 0;
    const observedRounds = picks.map((p) => Math.ceil(p.pick_number / teamCount));
    return Math.max(1, ...observedRounds);
  }, [draftRounds, teamCount, picks]);

  // The most recently landed pick (picks is newest-first) drives the one-shot
  // landing flash; `useFlashKey` only fires on a change *after* mount, so
  // picks already on the board when this view opens don't flash retroactively.
  const newestPick = picks.length > 0 ? picks[0] : null;
  const newestPickSignature = newestPick ? `${newestPick.pick_number}:${newestPick.player_id}` : null;
  const flashKey = useFlashKey(newestPickSignature);
  const flashCellKey =
    newestPick && teamCount > 0 ? `${Math.ceil(newestPick.pick_number / teamCount)}-${newestPick.team_id}` : null;

  const nextPickNumber = picks.length + 1;
  const onClockCellKey =
    onTheClock && teamCount > 0 ? `${Math.ceil(nextPickNumber / teamCount)}-${onTheClock.id}` : null;

  if (teamCount === 0) {
    return (
      <Paper component="section" aria-labelledby={headingId} sx={{ p: 2 }}>
        <Typography id={headingId} variant="h6" component={titleComponent} sx={{ mb: 1 }}>
          Draft Board
        </Typography>
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          Draft order isn&apos;t set yet.
        </Typography>
      </Paper>
    );
  }

  const rounds = Array.from({ length: totalRounds }, (_, i) => i + 1);

  return (
    <Paper component="section" aria-labelledby={headingId} sx={{ p: 2 }}>
      <Typography id={headingId} variant="h6" component={titleComponent} sx={{ mb: 2 }}>
        Draft Board
      </Typography>
      <TableContainer sx={{ overflowX: 'auto' }}>
        <Table size="small" sx={stripedRowsSx}>
          <TableHead>
            <TableRow sx={{ bgcolor: 'primary.main' }}>
              <TableCell component="th" scope="col" sx={stickyRoundHeadSx}>
                Rd
              </TableCell>
              {orderedTeams.map((team) => {
                const isOnClockTeam = !!(onTheClock && onTheClock.id === team.id);
                return (
                  <TableCell
                    key={team.id}
                    component="th"
                    scope="col"
                    sx={{
                      color: 'primary.contrastText',
                      fontWeight: 'bold',
                      bgcolor: isOnClockTeam ? 'primary.dark' : 'primary.main',
                      minWidth: TEAM_COL_MIN_WIDTH,
                    }}
                  >
                    {team.name}
                    {isOnClockTeam && <Box component="span" sx={{ ml: 0.5 }}>⏱</Box>}
                  </TableCell>
                );
              })}
            </TableRow>
          </TableHead>
          <TableBody>
            {rounds.map((round) => (
              <TableRow key={round}>
                <TableCell component="th" scope="row" sx={stickyRoundCellSx}>
                  {round}
                </TableCell>
                {orderedTeams.map((team) => {
                  const cellKey = `${round}-${team.id}`;
                  const pick = pickByCell.get(cellKey);
                  const isOnClockCell = cellKey === onClockCellKey;
                  const isFlashing = flashKey > 0 && cellKey === flashCellKey;

                  if (pick) {
                    const pickContent = (
                      <>
                        <Typography variant="body2" noWrap title={pick.name} sx={{ maxWidth: '100%' }}>
                          {pick.name}
                        </Typography>
                        {pick.is_keeper && <Chip label="Keeper" size="small" color="secondary" />}
                        <PositionChip position={pick.position} size="small" />
                      </>
                    );

                    return (
                      <TableCell key={team.id} sx={{ minWidth: TEAM_COL_MIN_WIDTH, p: 0.5 }}>
                        {readOnly ? (
                          <Box
                            aria-label={`Round ${round} pick ${pick.pick_number}, ${team.name}: ${pick.name}`}
                            sx={{
                              width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'flex-start',
                              gap: 0.5, textAlign: 'left', borderRadius: 1, p: 0.75,
                              animation: isFlashing ? `${pickLandedFlash} 1.2s ease-out` : 'none',
                              '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
                            }}
                          >
                            {pickContent}
                          </Box>
                        ) : (
                          <Box
                            component="button"
                            type="button"
                            onClick={() => onOpenQuickView(pick.player_id)}
                            aria-label={`Round ${round} pick ${pick.pick_number}, ${team.name}: ${pick.name}`}
                            sx={{
                              width: '100%', minHeight: 44, display: 'flex', flexDirection: 'column',
                              alignItems: 'flex-start',
                              gap: 0.5, textAlign: 'left', border: 'none', bgcolor: 'transparent', borderRadius: 1,
                              p: 0.75, cursor: 'pointer', font: 'inherit', color: 'inherit',
                              '&:hover': { bgcolor: 'action.hover' },
                              // Same shared token every other focus-visible ring
                              // uses (see base.css); the offset is negative
                              // (inward) rather than the usual +2px so the ring
                              // stays inside this cell instead of bleeding into
                              // the next column over.
                              '&:focus-visible': { outline: '2px solid var(--focus-ring)', outlineOffset: -2 },
                              animation: isFlashing ? `${pickLandedFlash} 1.2s ease-out` : 'none',
                              '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
                            }}
                          >
                            {pickContent}
                          </Box>
                        )}
                      </TableCell>
                    );
                  }

                  return (
                    <TableCell
                      key={team.id}
                      sx={{ minWidth: TEAM_COL_MIN_WIDTH }}
                      aria-label={
                        isOnClockCell ? `Round ${round}, ${team.name}: on the clock` : undefined
                      }
                    >
                      <Box
                        sx={{
                          height: 40,
                          borderRadius: 1,
                          ...(isOnClockCell
                            ? {
                                outline: 2,
                                outlineStyle: 'solid',
                                outlineColor: 'primary.main',
                                outlineOffset: -2,
                                animation: `${onClockPulse} 1.4s ease-in-out infinite`,
                                '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
                              }
                            : { bgcolor: 'action.hover' }),
                        }}
                      />
                    </TableCell>
                  );
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </Paper>
  );
}

export default DraftBoardMatrix;
