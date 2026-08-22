import React, { useCallback, useState, useEffect } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import {
  Dialog,
  DialogContent,
  IconButton,
  Box,
  Typography,
  Chip,
  Alert,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Link,
  Button,
  Tooltip,
  ToggleButtonGroup,
  ToggleButton,
  Card,
  Stack,
  useMediaQuery,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import CloseIcon from '@mui/icons-material/Close';
import apiClient from '../../api/apiClient';
import InjuryBadge from '../InjuryBadge/InjuryBadge';
import PlayerAvatar from './PlayerAvatar';
import PositionChip from './PositionChip';
import { statLine } from './statLine';
import AbbreviationTooltip from '../common/AbbreviationTooltip';
import { MIN_TOUCH_TARGET_SX } from '../../lib/a11y';

// Module-level: persists the last-selected toggle across dialog opens for the
// duration of the session (resets on full page reload). Intentionally not
// localStorage per the component contract.
let lastView = 'current';

// Don't hijack arrow keys while the user is typing or roving the toggle group.
function isTypingTarget(el) {
  if (!el) return false;
  const tag = el.tagName;
  if (el.isContentEditable || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return !!(el.closest && el.closest('.MuiToggleButtonGroup-root'));
}

function comparisonLine(summary) {
  const current = summary?.currentSeason;
  const weekly = Array.isArray(current?.weekly) ? current.weekly : [];
  const latest = [...weekly].sort((a, b) => Number(b.week) - Number(a.week))[0];
  return {
    player: summary?.player,
    projected: summary?.fantasy?.projectedPoints,
    points: current?.points,
    perGame: current?.perGame,
    latest: latest ? statLine(latest.stats) : '',
  };
}

function ComparisonCard({ summary }) {
  const line = comparisonLine(summary);
  return (
    <Paper variant="outlined" sx={{ p: 1.5, minWidth: 0 }}>
      <Typography variant="subtitle2" noWrap>{line.player?.name}</Typography>
      <Typography variant="body2" sx={{ color: 'text.secondary' }}>
        <AbbreviationTooltip term="Projected" />: {line.projected ?? '-'}
      </Typography>
      <Typography variant="body2" sx={{ color: 'text.secondary' }}>
        FPTS: {line.points ?? '-'} · <AbbreviationTooltip term="FPTS/G" />: {line.perGame ?? '-'}
      </Typography>
      <Typography variant="caption" sx={{ display: 'block', mt: 0.5, color: 'text.secondary' }}>
        {line.latest || 'No current-season stat line'}
      </Typography>
    </Paper>
  );
}

/**
 * Mobile presentation of a stat table: one outlined card per row, so a long
 * comma-joined stat line gets the full dialog width instead of crushing the
 * numeric columns to nothing in a 3-5 column table on a 375px screen.
 *
 * `label` deliberately reuses the desktop table's aria-label so both layouts
 * expose the same accessible name; only the role differs. Exactly one of the
 * two layouts renders at a time, so the name is never duplicated in the tree.
 */
function StatCardList({ label, rows }) {
  return (
    <Stack spacing={1.5} role="list" aria-label={label}>
      {rows.map((row) => (
        <Card key={row.key} variant="outlined" role="listitem" sx={{ p: 1.5 }}>
          <Stack direction="row" alignItems="baseline" justifyContent="space-between" spacing={1}>
            {/* component="div" on purpose: subtitle2 renders <h6> by default, and we
                don't want a heading per week competing with the dialog title. */}
            <Typography variant="subtitle2" component="div" sx={{ fontWeight: 700 }}>
              {row.title}
            </Typography>
            <Typography variant="stat" sx={{ fontWeight: 800, whiteSpace: 'nowrap' }}>
              {row.points ?? '-'}{' '}
              <Typography component="span" variant="caption" sx={{ color: 'text.secondary' }}>
                FPTS
              </Typography>
            </Typography>
          </Stack>
          <Typography variant="body2" sx={{ mt: 0.75, color: 'text.secondary' }}>
            {row.statLine}
          </Typography>
          {row.meta && row.meta.length > 0 && (
            <Stack
              direction="row"
              divider={<Box sx={{ borderLeft: '1px solid var(--border-subtle)' }} />}
              sx={{ mt: 1.25, pt: 1, borderTop: '1px solid var(--border-subtle)' }}
            >
              {row.meta.map((item, i) => (
                <Box key={item.id} sx={{ flex: 1, ...(i > 0 && { pl: 2 }) }}>
                  <Typography variant="caption" component="div" sx={{ color: 'text.secondary' }}>
                    {item.label}
                  </Typography>
                  <Typography variant="stat" component="div" sx={{ fontWeight: 800 }}>
                    {item.value ?? '-'}
                  </Typography>
                </Box>
              ))}
            </Stack>
          )}
        </Card>
      ))}
    </Stack>
  );
}

/**
 * @param playerIds  Optional ordered id list the dialog was opened from; enables
 *                   prev/next arrows + Left/Right arrow-key navigation.
 * @param onNavigate (id) => void — called with the new id on prev/next.
 * @param actions    Optional [{ label, onClick, disabled, tooltip, unavailableReason, variant, color }]
 *                   context action(s) (e.g. Add to Roster / Draft / Queue).
 *                   `disabled` is a native, permanent disablement (e.g.
 *                   already queued). `unavailableReason`, when set, renders
 *                   the action as focusable aria-disabled instead - still
 *                   reachable by keyboard, with activation suppressed and
 *                   its text shown as the explanation (issue #120).
 */
function PlayerQuickView({ open, onClose, playerId, leagueId, draftedBy, playerIds, onNavigate, actions }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [view, setView] = useState(lastView);
  const [pinnedComparison, setPinnedComparison] = useState(null);
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

  const navIds = Array.isArray(playerIds) ? playerIds : null;
  const navIndex = navIds ? navIds.indexOf(playerId) : -1;
  const canPrev = navIndex > 0;
  const canNext = navIndex >= 0 && navIds && navIndex < navIds.length - 1;
  const goPrev = useCallback(() => {
    if (canPrev && onNavigate) onNavigate(navIds[navIndex - 1]);
  }, [canPrev, navIds, navIndex, onNavigate]);
  const goNext = useCallback(() => {
    if (canNext && onNavigate) onNavigate(navIds[navIndex + 1]);
  }, [canNext, navIds, navIndex, onNavigate]);

  useEffect(() => {
    if (!open || !navIds) return undefined;
    const onKey = (e) => {
      if (isTypingTarget(e.target)) return;
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        goPrev();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        goNext();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // Recreated when the position in the list changes so the closures stay fresh.
  }, [open, navIds, goPrev, goNext]);

  useEffect(() => {
    if (!open || !playerId) return;
    const fetchSummary = async () => {
      try {
        setLoading(true);
        setError(null);
        const config = leagueId != null ? { params: { leagueId } } : undefined;
        const res = await apiClient.get(`/api/players/${playerId}/summary`, config);
        setData(res.data);

        // Don't open on an empty tab: if the current season has no games yet
        // but prior-season data exists, default to Previous Seasons. When
        // current-season stats exist, honor the session's last-used tab.
        const cs = res.data.currentSeason;
        const hasCurrent = !!(cs && (cs.weekly || []).length > 0);
        const hasPrevious = (res.data.previousSeasons || []).length > 0;
        setView(hasCurrent ? lastView : hasPrevious ? 'previous' : lastView);
      } catch (err) {
        setError(err.response?.data?.error || err.message);
      } finally {
        setLoading(false);
      }
    };
    fetchSummary();
  }, [open, playerId, leagueId]);

  const handleViewChange = (event, newView) => {
    if (!newView) return;
    lastView = newView;
    setView(newView);
  };

  const player = data?.player;
  const fantasy = data?.fantasy || {};
  const currentSeason = data?.currentSeason;
  const previousSeasons = data?.previousSeasons || [];
  const hasFantasy =
    fantasy.adp != null || fantasy.posRank != null
    || fantasy.projectedPoints != null || fantasy.previousSeasonTotal != null;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      aria-labelledby="player-quickview-title"
      fullWidth
      maxWidth="sm"
      fullScreen={isMobile}
      transitionDuration={{ appear: 0, enter: 0, exit: 120 }}
      PaperProps={{ sx: { backgroundImage: 'none' } }}
    >
      <Box
        component="header"
        sx={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: { xs: 1, sm: 2 },
          px: { xs: 2, sm: 3 },
          py: { xs: 1.5, sm: 2 },
          flex: '0 0 auto',
        }}
      >
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: { xs: 1.5, sm: 2 },
            flexWrap: 'wrap',
            minWidth: 0,
          }}
        >
          {player && (
            <>
              <PlayerAvatar
                name={player.name}
                position={player.position}
                photoUrl={player.photo_url}
                size={isMobile ? 48 : 72}
              />
              <Box sx={{ minWidth: 0 }}>
                <Typography
                  id="player-quickview-title"
                  component="h2"
                  sx={{ typography: { xs: 'h6', sm: 'h5' } }}
                >
                  {player.name}
                  {player.jersey_number != null && (
                    <Typography component="span" variant="body1" sx={{ color: 'text.secondary', ml: 1 }}>
                      #{player.jersey_number}
                    </Typography>
                  )}
                </Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', mt: 0.5 }}>
                  <PositionChip position={player.position} size="small" />
                  <Chip label={player.nfl_team || 'Free Agent'} size="small" />
                  <InjuryBadge status={player.injury_status} detail={player.injury_detail} />
                  {player.bye_week != null && (
                    <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                      Bye: Wk {player.bye_week}
                    </Typography>
                  )}
                </Box>
              </Box>
            </>
          )}
          {!player && (
            <Typography
              id="player-quickview-title"
              component="h2"
              sx={{ typography: { xs: 'h6', sm: 'h5' } }}
            >
              Player details
            </Typography>
          )}
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center' }}>
          {navIds && (
            <>
              {navIndex >= 0 && (
                <Typography
                  variant="caption"
                  aria-label={`Player ${navIndex + 1} of ${navIds.length}`}
                  sx={{ color: 'text.secondary', whiteSpace: 'nowrap', px: 0.5 }}
                >
                  {navIndex + 1} of {navIds.length}
                </Typography>
              )}
              <IconButton aria-label="Previous player" onClick={goPrev} disabled={!canPrev} size="small">
                ‹
              </IconButton>
              <IconButton aria-label="Next player" onClick={goNext} disabled={!canNext} size="small">
                ›
              </IconButton>
            </>
          )}
          <IconButton aria-label="Close" onClick={onClose} size="small">
            <CloseIcon fontSize="small" />
          </IconButton>
        </Box>
      </Box>
      <DialogContent dividers aria-busy={loading || undefined}>
        {draftedBy && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            {`Drafted by ${draftedBy}`}
          </Alert>
        )}

        {loading && (
          <Box data-testid="quickview-skeleton" role="status" aria-live="polite">
            <Typography
              sx={{
                position: 'absolute',
                width: 1,
                height: 1,
                p: 0,
                m: -1,
                overflow: 'hidden',
                clip: 'rect(0 0 0 0)',
                whiteSpace: 'nowrap',
                border: 0,
              }}
            >
              Loading player details
            </Typography>
            <Box aria-hidden="true">
              <Skeleton variant="text" width={180} height={32} sx={{ mb: 1 }} />
              <Skeleton variant="rectangular" height={40} sx={{ mb: 1, borderRadius: 1 }} />
              <Skeleton variant="rectangular" height={40} sx={{ mb: 1, borderRadius: 1 }} />
              <Skeleton variant="rectangular" height={40} sx={{ borderRadius: 1 }} />
            </Box>
          </Box>
        )}

        {!loading && error && <Alert severity="error">{error}</Alert>}

        {!loading && !error && player && (
          <>
            {player.news && (
              <Alert severity="info" sx={{ mb: 2 }}>
                {player.news}
              </Alert>
            )}

            {hasFantasy && (
              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 2 }} data-testid="fantasy-strip">
                {fantasy.adp != null && (
                  <Chip size="small" variant="outlined" label={<><AbbreviationTooltip term="ADP" /> {fantasy.adp}</>} />
                )}
                {fantasy.posRank != null && (
                  <Chip
                    size="small"
                    variant="outlined"
                    label={<><AbbreviationTooltip term="Pos rank" /> #{fantasy.posRank}</>}
                  />
                )}
                {fantasy.projectedPoints != null && (
                  <Chip
                    size="small"
                    color="info"
                    label={<><AbbreviationTooltip term="Projected" /> ({fantasy.projectionSeason}): {fantasy.projectedPoints} pts</>}
                  />
                )}
                {fantasy.previousSeasonTotal != null && (
                  <Chip
                    size="small"
                    color="success"
                    label={`${fantasy.previousSeasonYear}: ${fantasy.previousSeasonTotal} pts`}
                  />
                )}
              </Box>
            )}

            <ToggleButtonGroup
              value={view}
              exclusive
              onChange={handleViewChange}
              aria-label="Statistics period"
              size="small"
              color="primary"
              sx={{ mb: 2 }}
            >
              <ToggleButton value="current">Current Season</ToggleButton>
              <ToggleButton value="previous">Previous Seasons</ToggleButton>
            </ToggleButtonGroup>

            {view === 'current' ? (
              !currentSeason || (currentSeason.weekly || []).length === 0 ? (
                <Typography sx={{ color: 'text.secondary' }}>No current-season stats yet</Typography>
              ) : (
                <>
                  <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 2 }}>
                    <Chip label={`Games: ${currentSeason.games}`} />
                    <Chip label={`Points: ${currentSeason.points}`} color="success" />
                    {currentSeason.perGame != null && (
                      <Chip label={<><AbbreviationTooltip term="FPTS/G" />: {currentSeason.perGame}</>} color="info" />
                    )}
                  </Box>
                  {isMobile ? (
                    <StatCardList
                      label={`${player.name} current-season weekly statistics`}
                      rows={currentSeason.weekly.map((row) => ({
                        key: row.week,
                        title: `Week ${row.week}`,
                        points: row.fantasy_points,
                        statLine: statLine(row.stats),
                      }))}
                    />
                  ) : (
                    <TableContainer component={Paper} sx={{ overflowX: 'auto' }}>
                      <Table
                        size="small"
                        aria-label={`${player.name} current-season weekly statistics`}
                        sx={{
                          minWidth: 420,
                          // Only the stat line wraps; the numeric columns stay on one
                          // line so they can't be squeezed to a character per row.
                          '& th, & td': { whiteSpace: 'nowrap' },
                          '& .stat-line-cell': { whiteSpace: 'normal', minWidth: 180 },
                        }}
                      >
                        <TableHead>
                          <TableRow sx={{ bgcolor: 'primary.main' }}>
                            <TableCell sx={{ color: 'primary.contrastText', fontWeight: 'bold' }}>Week</TableCell>
                            <TableCell
                              className="stat-line-cell"
                              sx={{ color: 'primary.contrastText', fontWeight: 'bold' }}
                            >
                              Stat Line
                            </TableCell>
                            <TableCell sx={{ color: 'primary.contrastText', fontWeight: 'bold' }} align="right">
                              Fantasy Pts
                            </TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {currentSeason.weekly.map((row) => (
                            <TableRow key={row.week}>
                              <TableCell>{row.week}</TableCell>
                              <TableCell className="stat-line-cell">{statLine(row.stats)}</TableCell>
                              <TableCell align="right">{row.fantasy_points}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </TableContainer>
                  )}
                </>
              )
            ) : previousSeasons.length === 0 ? (
              <Typography sx={{ color: 'text.secondary' }}>
                No previous-season data available for this player.
              </Typography>
            ) : isMobile ? (
              <StatCardList
                label={`${player.name} previous-season statistics`}
                rows={previousSeasons.map((row) => ({
                  key: row.season,
                  title: String(row.season),
                  points: row.points,
                  statLine: statLine(row.stats),
                  meta: [
                    { id: 'games', label: 'Games', value: row.games },
                    { id: 'perGame', label: <AbbreviationTooltip term="FPTS/G" />, value: row.perGame },
                  ],
                }))}
              />
            ) : (
              <TableContainer component={Paper} sx={{ overflowX: 'auto' }}>
                <Table
                  size="small"
                  aria-label={`${player.name} previous-season statistics`}
                  sx={{
                    minWidth: 560,
                    // Only the stat line wraps; the numeric columns stay on one
                    // line so they can't be squeezed to a character per row.
                    '& th, & td': { whiteSpace: 'nowrap' },
                    '& .stat-line-cell': { whiteSpace: 'normal', minWidth: 180 },
                  }}
                >
                  <TableHead>
                    <TableRow sx={{ bgcolor: 'primary.main' }}>
                      <TableCell sx={{ color: 'primary.contrastText', fontWeight: 'bold' }}>Season</TableCell>
                      <TableCell sx={{ color: 'primary.contrastText', fontWeight: 'bold' }}>G</TableCell>
                      <TableCell
                        className="stat-line-cell"
                        sx={{ color: 'primary.contrastText', fontWeight: 'bold' }}
                      >
                        Stat Line
                      </TableCell>
                      <TableCell sx={{ color: 'primary.contrastText', fontWeight: 'bold' }} align="right">
                        FPTS
                      </TableCell>
                      <TableCell sx={{ color: 'primary.contrastText', fontWeight: 'bold' }} align="right">
                        <AbbreviationTooltip term="FPTS/G" />
                      </TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {previousSeasons.map((row) => (
                      <TableRow key={row.season}>
                        <TableCell>{row.season}</TableCell>
                        <TableCell>{row.games}</TableCell>
                        <TableCell className="stat-line-cell">{statLine(row.stats)}</TableCell>
                        <TableCell align="right">{row.points}</TableCell>
                        <TableCell align="right">{row.perGame}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            )}

            {navIds && navIds.length > 1 && (
              <Box sx={{ mt: 2 }}>
                <Button
                  variant="outlined"
                  size="small"
                  onClick={() => setPinnedComparison((current) => (current ? null : data))}
                >
                  {pinnedComparison ? 'Clear compare' : 'Compare'}
                </Button>
                {pinnedComparison && pinnedComparison.player?.id === player.id && (
                  <Typography variant="caption" sx={{ color: 'text.secondary', ml: 1 }}>
                    {player.name} pinned. Choose another player.
                  </Typography>
                )}
              </Box>
            )}

            {pinnedComparison && pinnedComparison.player?.id !== player.id && (
              <Box component="section" aria-label="Player comparison" data-testid="player-comparison" sx={{ mt: 2 }}>
                <Typography variant="subtitle2" sx={{ mb: 1 }}>Comparison</Typography>
                <Box
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' },
                    gap: 1,
                  }}
                >
                  <ComparisonCard summary={pinnedComparison} />
                  <ComparisonCard summary={data} />
                </Box>
              </Box>
            )}

            {Array.isArray(actions) && actions.length > 0 && (
              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mt: 2 }}>
                {actions.map((action, i) => {
                  const unavailable = !!action.unavailableReason;
                  const tooltipTitle = unavailable
                    ? action.unavailableReason
                    : action.disabled && action.tooltip
                    ? action.tooltip
                    : '';
                  return (
                    <Tooltip key={i} title={tooltipTitle}>
                      <span>
                        <Button
                          variant={action.variant || 'contained'}
                          color={action.color || 'primary'}
                          size="small"
                          disabled={action.disabled}
                          aria-disabled={unavailable || undefined}
                          onClick={(event) => {
                            if (unavailable) return; // suppressed activation
                            action.onClick(event);
                          }}
                          sx={MIN_TOUCH_TARGET_SX}
                        >
                          {action.label}
                        </Button>
                      </span>
                    </Tooltip>
                  );
                })}
              </Box>
            )}

            <Box sx={{ mt: 2, textAlign: 'right' }}>
              <Link
                component={RouterLink}
                to={`/players/${playerId}${leagueId ? `?leagueId=${leagueId}` : ''}`}
                onClick={onClose}
              >
                Full profile →
              </Link>
            </Box>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default PlayerQuickView;
