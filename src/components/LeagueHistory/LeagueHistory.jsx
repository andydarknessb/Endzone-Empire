import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import {
  Container,
  Typography,
  Alert,
  Box,
  Stack,
  Skeleton,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Tabs,
  Tab,
  Card,
  Avatar,
  Divider,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Chip,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import EmojiEventsOutlined from '@mui/icons-material/EmojiEventsOutlined';
import EmojiEvents from '@mui/icons-material/EmojiEvents';
import { TROPHY_EMOJI } from '../TrophyCase/TrophyCase';
import { GRADE_COLORS } from '../DraftGradesCard/DraftGradesCard';
import apiClient from '../../api/apiClient';
import { applyTeamProfileUpdate, subscribeToTeamProfileUpdates } from '../../lib/teamProfileEvents';
import LeagueBreadcrumb from '../LeagueBreadcrumb/LeagueBreadcrumb';
import TeamAvatar from '../common/TeamAvatar';

const MEDAL_EMOJI = { 1: '🥇', 2: '🥈', 3: '🥉' };

// Podium placement styling. Gold reuses the theme's `warning` color per the
// existing champion-chip convention; silver/bronze have no MUI palette
// equivalent so they read from the `--medal-*` design tokens (see theme/tokens.js).
const PODIUM_CONFIG = {
  2: { label: '2nd Place', borderColor: 'var(--medal-silver)', minHeight: 170 },
  1: { label: '1st Place', borderColor: 'warning.main', minHeight: 220 },
  3: { label: '3rd Place', borderColor: 'var(--medal-bronze)', minHeight: 150 },
};

/**
 * Placeholder podium card. The multi-season/all-time endpoints this will read
 * from don't exist yet, so every field is an intentional ghost value — this
 * renders the future "Hall of Fame" shape, not real standings.
 */
function PodiumCard({ place }) {
  const config = PODIUM_CONFIG[place];
  return (
    <Card
      variant="outlined"
      data-testid={`podium-card-${place}`}
      sx={{
        width: { xs: 108, sm: 168 },
        minHeight: config.minHeight,
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'flex-start',
        textAlign: 'center',
        gap: 0.5,
        p: { xs: 1.5, sm: 2 },
        pt: place === 1 ? 3 : 2,
        bgcolor: 'background.paper',
        borderWidth: 2,
        borderColor: config.borderColor,
      }}
    >
      {place === 1 && <EmojiEvents sx={{ fontSize: 40, color: 'warning.main' }} />}
      <Avatar sx={{ width: 56, height: 56, bgcolor: 'action.disabledBackground' }} />
      <Typography variant="subtitle2" color="text.secondary" noWrap sx={{ maxWidth: '100%' }}>
        Team Name
      </Typography>
      <Typography variant="caption" color="text.disabled">
        W-L-T
      </Typography>
      <Chip size="small" variant="outlined" label={config.label} sx={{ mt: 0.5, borderColor: config.borderColor }} />
    </Card>
  );
}

function SeasonPanel({ season, defaultExpanded }) {
  const standings = Array.isArray(season.standings) ? season.standings : [];
  const trophies = Array.isArray(season.trophies) ? season.trophies : [];
  const draftGrades = Array.isArray(season.draftGrades) ? season.draftGrades : null;
  const championStanding = season.champion
    ? standings.find((team) => team.teamId === season.champion.teamId)
    : null;

  return (
    <Accordion defaultExpanded={defaultExpanded} data-testid={`season-panel-${season.season}`}>
      <AccordionSummary expandIcon={<ExpandMoreIcon />}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
          <Typography variant="h6">Season {season.season}</Typography>
          {season.champion ? (
            <Chip
              color="warning"
              label={`🏆 Champion: ${season.champion.name}`}
              data-testid={`champion-${season.season}`}
            />
          ) : (
            <Chip label="No champion recorded" variant="outlined" />
          )}
        </Box>
      </AccordionSummary>
      <AccordionDetails>
        {season.champion && (
          <Box
            data-testid={`champion-banner-${season.season}`}
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 2,
              mb: 3,
              p: 2,
              bgcolor: 'var(--accent-soft)',
              borderLeft: '4px solid',
              borderLeftColor: 'warning.main',
              borderRadius: 1,
            }}
          >
            <Box component="span" aria-hidden="true" sx={{ fontSize: '2rem', lineHeight: 1 }}>
              🏆
            </Box>
            <TeamAvatar
              name={season.champion.name}
              avatarUrl={season.champion.avatarUrl}
              avatarStaticUrl={season.champion.avatarStaticUrl}
              size={48}
            />
            <Box>
              <Typography variant="body2" color="text.secondary">
                Season Champion
              </Typography>
              <Typography variant="h5" component="p">
                {season.champion.name}
              </Typography>
              {championStanding && (
                <Typography variant="body2" color="text.secondary">
                  {`${championStanding.wins}-${championStanding.losses} record`}
                </Typography>
              )}
            </Box>
          </Box>
        )}

        <Typography variant="subtitle1" sx={{ mb: 1 }}>
          Final Standings
        </Typography>
        <TableContainer component={Paper} sx={{ mb: 3 }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Rank</TableCell>
                <TableCell>Team</TableCell>
                <TableCell align="right">W-L</TableCell>
                <TableCell align="right">PF</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {standings.map((team) => {
                const medal = MEDAL_EMOJI[team.rank];
                return (
                  <TableRow
                    key={team.teamId}
                    sx={team.rank === 1 ? { '& .MuiTableCell-root': { fontWeight: 'bold' } } : undefined}
                  >
                    <TableCell>
                      {medal && (
                        <Box component="span" aria-hidden="true" sx={{ mr: 0.5 }}>
                          {medal}
                        </Box>
                      )}
                      {team.rank}
                    </TableCell>
                    <TableCell>{team.name}</TableCell>
                    <TableCell align="right">{`${team.wins}-${team.losses}`}</TableCell>
                    <TableCell align="right">{team.pf}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>

        {season.trophiesErrored ? (
          <Typography variant="body2" color="text.secondary" sx={{ mb: 3, fontStyle: 'italic' }}>
            Couldn't load trophies for this season
          </Typography>
        ) : (
          trophies.length > 0 && (
            <>
              <Typography variant="subtitle1" sx={{ mb: 1 }}>
                Trophies
              </Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 3 }}>
                {trophies.map((trophy) => (
                  <Chip
                    key={trophy.id}
                    variant="outlined"
                    label={`${TROPHY_EMOJI[trophy.type] || '🎖️'} ${trophy.label} — ${trophy.team_name}`}
                  />
                ))}
              </Box>
            </>
          )
        )}

        {season.draftGradesErrored ? (
          <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic' }}>
            Couldn't load draft grades for this season
          </Typography>
        ) : (
          draftGrades &&
          draftGrades.length > 0 && (
            <>
              <Typography variant="subtitle1" sx={{ mb: 1 }}>
                Draft Grades
              </Typography>
              <TableContainer component={Paper}>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Rank</TableCell>
                      <TableCell>Team</TableCell>
                      <TableCell align="center">Grade</TableCell>
                      <TableCell align="right">Roster Value</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {draftGrades.map((row) => (
                      <TableRow key={row.teamId}>
                        <TableCell>{row.rank}</TableCell>
                        <TableCell>{row.name}</TableCell>
                        <TableCell align="center">
                          <Box
                            sx={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              width: 28,
                              height: 28,
                              borderRadius: '50%',
                              color: 'common.white',
                              bgcolor: GRADE_COLORS[row.grade] || 'grey.500',
                              fontWeight: 'bold',
                              fontSize: '0.85rem',
                            }}
                          >
                            {row.grade}
                          </Box>
                        </TableCell>
                        <TableCell align="right">{row.rosterValue}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </>
          )
        )}
      </AccordionDetails>
    </Accordion>
  );
}

function LeagueHistory() {
  const { leagueId } = useParams();
  const [seasons, setSeasons] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [yearTab, setYearTab] = useState(0);

  useEffect(() => {
    fetchHistory();
  }, [leagueId]);

  useEffect(() => subscribeToTeamProfileUpdates((update) => {
    if (Number(update.leagueId) !== Number(leagueId)) return;
    setSeasons((prev) => prev.map((season) => ({
      ...season,
      champion: applyTeamProfileUpdate(season.champion, update),
      standings: Array.isArray(season.standings)
        ? season.standings.map((team) => applyTeamProfileUpdate(team, update))
        : season.standings,
      draftGrades: Array.isArray(season.draftGrades)
        ? season.draftGrades.map((team) => applyTeamProfileUpdate(team, update))
        : season.draftGrades,
    })));
  }), [leagueId]);

  const fetchHistory = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await apiClient.get(`/api/league/${leagueId}/history`);
      setSeasons(Array.isArray(res.data?.seasons) ? res.data.seasons : []);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
      setSeasons([]);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <Container maxWidth="lg" sx={{ py: 4 }} data-testid="page-skeleton">
        <Skeleton variant="text" width={220} height={48} sx={{ mb: 3 }} />
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} variant="rectangular" height={72} sx={{ mb: 2, borderRadius: 1 }} />
        ))}
      </Container>
    );
  }

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      <LeagueBreadcrumb />
      <Typography variant="h4" sx={{ mb: 3 }}>
        League History
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {!error && seasons.length === 0 && (
        <Stack
          alignItems="center"
          justifyContent="center"
          spacing={1.5}
          data-testid="history-empty"
          sx={{ minHeight: '60vh', textAlign: 'center', px: 2 }}
        >
          <EmojiEventsOutlined sx={{ fontSize: 96, color: 'text.disabled' }} />
          <Typography variant="h6" color="text.secondary">
            The Hall of Fame is empty.
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 420 }}>
            Complete your first season to cement your legacy.
          </Typography>
        </Stack>
      )}

      {!error && seasons.length > 0 && (
        <>
          <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
            <Chip
              size="small"
              variant="outlined"
              color="info"
              label="Preview"
              data-testid="hall-of-fame-preview-chip"
            />
            <Typography variant="body2" color="text.secondary">
              Multi-season Hall of Fame — full year-by-year and all-time data coming soon
            </Typography>
          </Stack>

          <Tabs
            value={yearTab}
            onChange={(e, newValue) => setYearTab(newValue)}
            variant="scrollable"
            scrollButtons="auto"
            sx={{ mb: 3, borderBottom: 1, borderColor: 'divider' }}
            data-testid="history-year-tabs"
          >
            <Tab label="2025" />
            <Tab label="2024" />
            <Tab label="All-Time Records" />
          </Tabs>

          <Stack
            direction="row"
            alignItems="flex-end"
            justifyContent="center"
            spacing={{ xs: 1.5, sm: 3 }}
            sx={{ mb: 4, overflowX: 'auto', py: 1 }}
          >
            <PodiumCard place={2} />
            <PodiumCard place={1} />
            <PodiumCard place={3} />
          </Stack>

          <TableContainer component={Paper} sx={{ mb: 4 }} data-testid="history-mock-standings">
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Rank</TableCell>
                  <TableCell>Team</TableCell>
                  <TableCell align="right">W-L-T</TableCell>
                  <TableCell align="right">Total Points</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {[1, 2, 3, 4].map((rank) => (
                  <TableRow key={rank}>
                    <TableCell>{rank}</TableCell>
                    <TableCell sx={{ color: 'text.disabled', fontStyle: 'italic' }}>Team Name</TableCell>
                    <TableCell align="right" sx={{ color: 'text.disabled' }}>—</TableCell>
                    <TableCell align="right" sx={{ color: 'text.disabled' }}>—</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>

          <Divider sx={{ mb: 3 }} />
          <Typography variant="h6" sx={{ mb: 2 }}>
            Season Detail
          </Typography>
        </>
      )}

      {seasons.map((season, i) => (
        <SeasonPanel key={season.season} season={season} defaultExpanded={i === 0} />
      ))}
    </Container>
  );
}

export default LeagueHistory;
