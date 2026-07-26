import React, { useEffect, useState } from 'react';
import { Link as RouterLink, useParams, useSearchParams } from 'react-router-dom';
import {
  Box, Card, CardContent, Chip, Stack, Typography, Avatar, Table, TableBody,
  TableCell, TableContainer, TableHead, TableRow, Breadcrumbs, Link, Tooltip,
  ToggleButton, ToggleButtonGroup,
} from '@mui/material';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import Grid from '@mui/material/Unstable_Grid2';
import PublicLayout from '../PublicLayout';
import PublicSeo from '../PublicSeo';
import { usePublicResource } from '../kit/usePublicResource';
import { LoadingRows, EmptyState, ErrorState } from '../kit/DataState';
import { positionColorVar } from '../kit/positionColor';
import { sortGamesByWeek } from '../kit/gameLog';
import { SCORING_FORMATS, DEFAULT_FORMAT, formatLabel, pointsFor, hasFormatVariants } from '../kit/scoringFormat';
import publicApiClient from '../../../api/publicApiClient';
import { STAT_DEFINITIONS } from '../../common/AbbreviationTooltip';

function StatCard({ label, value, tooltip }) {
  return (
    <Card variant="outlined" sx={{ height: '100%' }}>
      <CardContent sx={{ textAlign: 'center', py: 2 }}>
        <Typography variant="stat" component="div" sx={{ fontSize: '1.6rem', fontWeight: 800 }}>
          {value ?? '—'}
        </Typography>
        <Stack direction="row" spacing={0.5} alignItems="center" justifyContent="center">
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>{label}</Typography>
          {tooltip && (
            <Tooltip title={tooltip}>
              <InfoOutlinedIcon tabIndex={0} aria-label={`${label} definition`} sx={{ fontSize: 15, color: 'text.secondary' }} />
            </Tooltip>
          )}
        </Stack>
      </CardContent>
    </Card>
  );
}

function GameLogSparkline({ games, format }) {
  // Callers pass games already ordered oldest-to-newest, so plot left-to-right as-is.
  const values = games.map((game) => Number(pointsFor(game.points, format, game.fantasyPoints)) || 0);
  const max = Math.max(...values, 1);
  const width = 320;
  const height = 88;
  const padding = 10;
  const step = values.length > 1 ? (width - padding * 2) / (values.length - 1) : 0;
  const points = values.map((value, index) => {
    const x = padding + index * step;
    const y = height - padding - (value / max) * (height - padding * 2);
    return `${x},${y}`;
  }).join(' ');

  return (
    <Card variant="outlined" sx={{ mb: 2 }}>
      <CardContent sx={{ pb: 1.5 }}>
        <Stack direction="row" justifyContent="space-between" alignItems="baseline" sx={{ mb: 1 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>Points by week</Typography>
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>Oldest to newest</Typography>
        </Stack>
        <Box
          component="svg"
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={`Fantasy points over ${values.length} recent games`}
          sx={{ display: 'block', width: '100%', height: 96, color: 'var(--accent)', overflow: 'visible' }}
        >
          <line x1={padding} y1={height - padding} x2={width - padding} y2={height - padding} stroke="var(--border-subtle)" />
          <polyline points={points} fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
          {points.split(' ').map((point, index) => {
            const [cx, cy] = point.split(',');
            return <circle key={point} cx={cx} cy={cy} r="4" fill="var(--surface)" stroke="currentColor" strokeWidth="2"><title>{`Game ${index + 1}: ${values[index]} points`}</title></circle>;
          })}
        </Box>
      </CardContent>
    </Card>
  );
}

function PeerLinks({ player }) {
  const { loading, error, data, retry } = usePublicResource(
    () => publicApiClient.get('/api/public/rankings', { params: { position: player.position, limit: 20 } }).then((response) => response.data),
    [player.position]
  );
  const peers = (data?.rankings || []).filter((row) => row.playerId !== player.playerId).slice(0, 5);

  return (
    <Box component="section" sx={{ mt: 5 }}>
      <Typography variant="h5" component="h2" sx={{ fontWeight: 700, mb: 1.5 }}>Other {player.position}s</Typography>
      {loading && <LoadingRows rows={1} height={42} />}
      {!loading && error && <ErrorState message="We couldn't load related players." onRetry={retry} />}
      {!loading && !error && peers.length === 0 && <EmptyState message="No related players available yet." />}
      {!loading && !error && peers.length > 0 && (
        <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
          {peers.map((peer) => (
            <Chip
              key={peer.playerId}
              component={RouterLink}
              to={`/players/${peer.playerId}`}
              clickable
              avatar={<Avatar src={peer.photoUrl || undefined} alt="" />}
              label={`${peer.name} · ${peer.projectedPoints ?? '—'} proj`}
              variant="outlined"
            />
          ))}
        </Stack>
      )}
    </Box>
  );
}

/** Season switcher: complete seasons are selectable; a pending upcoming season
 * is shown so users see it's coming, and selecting it reveals a not-started state. */
function SeasonToggle({ seasons, active, onChange }) {
  // Only complete seasons and the upcoming pending season are selectable; a
  // requested no-data season (status 'unavailable') is echoed in the contract
  // but never offered as a button.
  const selectable = (Array.isArray(seasons) ? seasons : []).filter(
    (s) => s.status === 'complete' || s.status === 'pending'
  );
  // A single valid season still needs to be shown when the active URL points
  // at an unavailable season, otherwise the empty state has no recovery path.
  const activeIsSelectable = selectable.some((s) => s.season === active);
  if (selectable.length === 0 || (selectable.length === 1 && activeIsSelectable)) return null;
  return (
    <ToggleButtonGroup
      exclusive
      size="small"
      value={active}
      onChange={(_e, value) => { if (value != null && value !== active) onChange(value); }}
      aria-label="Season"
    >
      {selectable.map((s) => (
        <ToggleButton key={s.season} value={s.season} sx={{ px: 1.5, textTransform: 'none' }}>
          {s.season}{s.status === 'pending' ? ' · soon' : ''}
        </ToggleButton>
      ))}
    </ToggleButtonGroup>
  );
}

/** Scoring-format switcher (standard / half-PPR / full PPR). Pure client pick —
 * every points value already arrives in all three formats. */
function FormatToggle({ value, onChange }) {
  return (
    <ToggleButtonGroup
      exclusive
      size="small"
      value={value}
      onChange={(_e, next) => { if (next != null) onChange(next); }}
      aria-label="Scoring format"
    >
      {SCORING_FORMATS.map((f) => (
        <ToggleButton key={f.id} value={f.id} sx={{ px: 1.5, textTransform: 'none' }}>
          {f.label}
        </ToggleButton>
      ))}
    </ToggleButtonGroup>
  );
}

export function ProfileBody({
  player,
  onSeasonChange,
  initialFormat = DEFAULT_FORMAT,
  breadcrumbLabel = 'Rankings',
  breadcrumbTo = '/rankings',
}) {
  const [format, setFormat] = useState(initialFormat);
  useEffect(() => {
    setFormat(initialFormat);
  }, [initialFormat, player.playerId]);
  const s = player.seasonSummary;
  const isEmptySeason = !s; // pending or not-available -> no summary to show
  // Status of the season currently being viewed (echoed even when not selectable).
  const activeSeasonEntry = (player.seasons || []).find((x) => x.season === player.season) || null;
  const seasonStatus = activeSeasonEntry ? activeSeasonEntry.status : (s ? 'complete' : 'pending');
  // Real per-format payload (not a scalar/mock), and a position whose formats
  // actually differ — a DEF/IDP toggle would offer three identical numbers.
  const multiFormat = !!(s && s.points) && hasFormatVariants(player.position);
  // Endpoint returns newest-first; render oldest-to-newest to match the label.
  const orderedGames = sortGamesByWeek(player.recentGames || []);
  const seasonPoints = pointsFor(s?.points, format, s?.fantasyPoints);
  const perGame = pointsFor(s?.pointsPerGame, format, s?.pointsPerGame);

  return (
    <>
      <Breadcrumbs aria-label="Breadcrumb" sx={{ mb: 2 }}>
        <Link component={RouterLink} to={breadcrumbTo} underline="hover">{breadcrumbLabel}</Link>
        <Typography color="text.primary">{player.name}</Typography>
      </Breadcrumbs>
      {/* Hero band */}
      <Card variant="outlined" sx={{ mb: 3 }}>
        <CardContent>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={3} alignItems={{ xs: 'flex-start', sm: 'center' }}>
            <Avatar src={player.photoUrl || undefined} alt="" sx={{ width: 96, height: 96, bgcolor: 'var(--surface-sunken)', color: 'text.primary', fontSize: 32 }}>
              {String(player.name || '').slice(0, 1)}
            </Avatar>
            <Box sx={{ flexGrow: 1 }}>
              <Typography variant="h3" component="h1" sx={{ fontWeight: 800 }}>{player.name}</Typography>
              <Stack direction="row" spacing={1} sx={{ mt: 1 }} flexWrap="wrap" rowGap={1}>
                {player.position && <Chip label={player.position} size="small" sx={{ bgcolor: positionColorVar(player.position), color: 'var(--text-inverse)' }} />}
                {player.nflTeam && <Chip label={player.nflTeam} size="small" variant="outlined" />}
                {player.jerseyNumber && <Chip label={`#${player.jerseyNumber}`} size="small" variant="outlined" />}
                {player.injuryStatus && <Chip label={player.injuryStatus} size="small" color="error" />}
              </Stack>
              {player.injuryDetail && (
                <Typography variant="body2" sx={{ color: 'error.main', mt: 1 }}>{player.injuryDetail}</Typography>
              )}
            </Box>
            {s && (
              <Box sx={{ textAlign: { xs: 'left', sm: 'right' } }}>
                <Typography variant="stat" component="div" sx={{ fontSize: '2.5rem', fontWeight: 800, color: 'var(--accent)', lineHeight: 1 }}>
                  {seasonPoints ?? '—'}
                </Typography>
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                  {s.season} fantasy points{multiFormat ? ` · ${formatLabel(format)}` : ''}
                </Typography>
              </Box>
            )}
          </Stack>
          {player.news && (
            <Typography variant="body2" sx={{ color: 'text.secondary', mt: 2 }}>{player.news}</Typography>
          )}
        </CardContent>
      </Card>

      {/* Season + scoring-format controls */}
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={1.5}
        justifyContent="space-between"
        alignItems={{ xs: 'stretch', sm: 'center' }}
        sx={{ mb: 2.5 }}
      >
        <SeasonToggle seasons={player.seasons} active={player.season} onChange={onSeasonChange} />
        {multiFormat && (
          <Stack direction="row" spacing={1} alignItems="center" sx={{ ml: { sm: 'auto' } }}>
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>Scoring</Typography>
            <FormatToggle value={format} onChange={setFormat} />
          </Stack>
        )}
      </Stack>

      {isEmptySeason ? (
        seasonStatus === 'unavailable' ? (
          <EmptyState
            message={`No ${player.season} data for ${player.name}.`}
            hint="This player has no stats on file for that season. Try another season above."
          />
        ) : (
          <EmptyState
            message={`The ${player.season} season hasn’t started yet.`}
            hint="Rankings, stats, and game logs appear here once games are played."
          />
        )
      ) : (
        <>
          {/* Stat cards */}
          <Grid container spacing={2} sx={{ mb: 3 }}>
            <Grid xs={6} md={3}><StatCard label="Games" value={s?.gamesPlayed} /></Grid>
            <Grid xs={6} md={3}><StatCard label="FPTS/G" value={perGame} tooltip={STAT_DEFINITIONS['FPTS/G']} /></Grid>
            <Grid xs={6} md={3}><StatCard label="Season points" value={seasonPoints} /></Grid>
            <Grid xs={6} md={3}><StatCard label="ADP" value={player.adp} tooltip={STAT_DEFINITIONS.ADP} /></Grid>
          </Grid>

          {/* Full-season game log (the API's recentGames field is uncapped) */}
          <Typography variant="h5" component="h2" sx={{ fontWeight: 700, mb: 1.5 }}>Game log</Typography>
          {player.weeklyLogPartial && (
            <Typography variant="body2" sx={{ color: 'text.secondary', mb: 1.5 }}>
              Weekly breakdown is partial — the season total above reflects all {s.gamesPlayed} games.
            </Typography>
          )}
          {orderedGames.length ? (
            <>
              <GameLogSparkline games={orderedGames} format={format} />
              <TableContainer sx={{ overflowX: 'auto' }}>
                <Table size="small" aria-label="Game log">
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 700 }}>Wk</TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>Opp</TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>Stat line</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 700 }}>Pts</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {orderedGames.map((g, index) => (
                    <TableRow key={`${g.season}-${g.week}-${index}`} hover>
                      <TableCell>{g.week}</TableCell>
                      <TableCell>{g.opponent || '—'}</TableCell>
                      <TableCell sx={{ color: 'text.secondary' }}>{g.statLine || '—'}</TableCell>
                      <TableCell align="right"><Typography variant="stat" component="span">{pointsFor(g.points, format, g.fantasyPoints)}</Typography></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                </Table>
              </TableContainer>
            </>
          ) : (
            <EmptyState message="No game log yet." hint="Weekly stats appear once the player has played." />
          )}
        </>
      )}
      <PeerLinks player={player} />
    </>
  );
}

function PlayerProfilePage() {
  const { id } = useParams();
  // Season lives in the URL so a shared/crawled link like ?season=2024 is
  // honored (and the server echoes it back, not the default). Absent = default.
  const [searchParams, setSearchParams] = useSearchParams();
  const seasonParam = searchParams.get('season');
  const season = seasonParam != null && /^\d+$/.test(seasonParam) ? Number(seasonParam) : null;
  const setSeason = (next) => {
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      if (next == null) params.delete('season'); else params.set('season', String(next));
      return params;
    }, { replace: true });
  };
  const { loading, error, data, retry } = usePublicResource(
    () => publicApiClient
      .get(`/api/public/players/${id}`, { params: season == null ? {} : { season } })
      .then((r) => r.data),
    [id, season]
  );
  const seasonPoints = data?.seasonSummary?.fantasyPoints;
  const title = data
    ? `${data.name} \u2014 ${seasonPoints == null ? 'Fantasy Profile' : `${seasonPoints} Fantasy Points`}`
    : `NFL Player ${id} Fantasy Profile`;
  const description = data
    ? `${data.name} has ${seasonPoints == null ? 'a public fantasy profile' : `${seasonPoints} fantasy points${data.seasonSummary?.season ? ` in the ${data.seasonSummary.season} season` : ''}`}. View team, position, per-game production, and recent results.`
    : `Fantasy football profile, season production, and recent game results for NFL player ${id}.`;

  return (
    <PublicLayout ctaContext="player">
      <PublicSeo
        title={title}
        description={description}
        path={`/players/${encodeURIComponent(id)}`}
        type="profile"
        imageAlt={data ? `${data.name} fantasy football profile` : 'Endzone Empire player profile'}
      />
      {loading && <LoadingRows rows={6} height={60} />}
      {!loading && error && <ErrorState message="We couldn't load this player." onRetry={retry} />}
      {!loading && !error && !data && <EmptyState message="Player not found." />}
      {!loading && !error && data && <ProfileBody player={data} onSeasonChange={setSeason} />}
    </PublicLayout>
  );
}

export default PlayerProfilePage;
