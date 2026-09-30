import React, { useState, useEffect, useMemo, useId } from 'react';
import {
  Typography,
  Box,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
} from '@mui/material';
import { Card, Badge, TeamAvatar } from '../../shared/ui';
import apiClient from '../../api/apiClient';
import { readHttpFailure } from '../../lib/httpFailure';

// One inline stroke glyph per trophy type on the 20px grid (1.6 stroke, round
// caps, currentColor), replacing the emoji map this module used to export.
// `medal` is the fallback for a type awarded by a server that ships ahead of
// the client, which is why the lookup can never come back empty.
const TROPHY_PATHS = {
  trophy: (
    <>
      <path d="M6.5 3.5h7V7a3.5 3.5 0 0 1-7 0z" />
      <path d="M6.5 4.5h-2v1a2 2 0 0 0 2 2" />
      <path d="M13.5 4.5h2v1a2 2 0 0 1-2 2" />
      <path d="M10 10.5v3" />
      <path d="M7 16.5h6" />
    </>
  ),
  flame: <path d="M10 3s4 3.5 4 7a4 4 0 0 1-8 0c0-1.7 1-3 2-4 0 1.5.6 2.3 1.4 2.6C9.1 6.6 10 5 10 3z" />,
  compress: (
    <>
      <path d="M3 10h14" />
      <path d="M6.5 6.5 3 10l3.5 3.5" />
      <path d="M13.5 6.5 17 10l-3.5 3.5" />
    </>
  ),
  burst: (
    <>
      <path d="M10 3v3M10 14v3M3 10h3M14 10h3" />
      <path d="M5.4 5.4l2.1 2.1M12.5 12.5l2.1 2.1M14.6 5.4l-2.1 2.1M7.5 12.5l-2.1 2.1" />
    </>
  ),
  rise: (
    <>
      <path d="M3 13.5 7.5 9l3 3L16 6.5" />
      <path d="M12.5 6.5H16V10" />
    </>
  ),
  rebound: (
    <>
      <path d="M4.5 15V10a5.5 5.5 0 0 1 11 0v5" />
      <path d="M13 12.5l2.5 2.5 2-2.5" />
    </>
  ),
  target: (
    <>
      <circle cx="10" cy="10" r="6.5" />
      <circle cx="10" cy="10" r="3" />
      <circle cx="10" cy="10" r="0.5" />
    </>
  ),
  medal: (
    <>
      <circle cx="10" cy="12.5" r="4.5" />
      <path d="M7 8.4 5 3.5h10l-2 4.9" />
    </>
  ),
};

const TROPHY_ICON = {
  champion: 'trophy',
  pickem_champion: 'trophy',
  weekly_high: 'flame',
  top_scorer: 'flame',
  closest_game: 'compress',
  biggest_blowout: 'burst',
  perfect_lineup: 'target',
  captain_hindsight: 'rebound',
  win_streak: 'rise',
  comeback: 'rebound',
  draft_grade: 'target',
};

/**
 * The glyph for a trophy type. Decorative in every use: the trophy's own label
 * sits beside it and carries the meaning, so it is aria-hidden and exposes only
 * a `data-icon` for a test to read. Exported because League History paints the
 * same trophies in its per-season list.
 */
export function TrophyIcon({ type, size = 20 }) {
  const name = TROPHY_ICON[type] || 'medal';
  return (
    <Box
      component="svg"
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      data-icon={name}
      sx={{ flex: 'none' }}
    >
      {TROPHY_PATHS[name]}
    </Box>
  );
}

const WEEKLY_TROPHY_TYPES = [
  'weekly_high',
  'top_scorer',
  'closest_game',
  'biggest_blowout',
  'perfect_lineup',
  'captain_hindsight',
];

function trophySubLabel(trophy) {
  if (WEEKLY_TROPHY_TYPES.includes(trophy.type) && trophy.week != null) {
    return `${trophy.team_name} · Week ${trophy.week}`;
  }
  return trophy.team_name;
}

/**
 * The season's per-team tally: one row per team, a count for every trophy type
 * awarded that season, ordered by total then name. Types come from the trophies
 * themselves (label included), so a type a newer server awards appears with no
 * client change. `teams` (the league's roster, already loaded by the page)
 * supplies teams that won nothing; a team only the trophies know about is
 * still listed, so the tally is complete with or without the roster.
 */
function buildTally(seasonTrophies, teams = []) {
  const types = new Map();
  seasonTrophies.forEach((t) => {
    if (!types.has(t.type)) types.set(t.type, { type: t.type, label: t.label, total: 0 });
    types.get(t.type).total += 1;
  });
  const typeList = Array.from(types.values()).sort(
    (a, b) => b.total - a.total || String(a.label).localeCompare(String(b.label))
  );

  const byTeam = new Map();
  teams.forEach((tm) => byTeam.set(tm.id, { ...tm, counts: {}, total: 0 }));
  seasonTrophies.forEach((t) => {
    if (!byTeam.has(t.team_id)) {
      byTeam.set(t.team_id, { id: t.team_id, name: t.team_name, counts: {}, total: 0 });
    }
    const row = byTeam.get(t.team_id);
    row.counts[t.type] = (row.counts[t.type] || 0) + 1;
    row.total += 1;
  });
  const rows = Array.from(byTeam.values()).sort(
    (a, b) => b.total - a.total || String(a.name).localeCompare(String(b.name))
  );
  return { typeList, rows };
}

function TrophyTally({ seasonTrophies, teams }) {
  const { typeList, rows } = useMemo(() => buildTally(seasonTrophies, teams), [seasonTrophies, teams]);
  if (rows.length === 0) return null;
  return (
    <Box
      component="ul"
      // WebKit drops the list mapping from a list-style: none <ul>, so VoiceOver
      // would read the rows as loose text without the explicit role.
      role="list"
      data-testid="trophy-tally"
      aria-label="Trophies by team"
      sx={{ listStyle: 'none', m: 0, mb: 2, p: 0, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}
    >
      {rows.map((row) => (
        <Box
          component="li"
          key={row.id}
          data-testid={`tally-team-${row.id}`}
          sx={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            columnGap: 1.5,
            rowGap: 0.5,
            minWidth: 0,
            fontFamily: 'var(--dash-font-body)',
          }}
        >
          <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
            <TeamAvatar name={row.name} avatarUrl={row.avatar_url} avatarStaticUrl={row.avatar_static_url} size={24} />
            <Typography variant="body2" sx={{ fontWeight: 600, color: 'var(--dash-ink)', overflowWrap: 'anywhere' }}>
              {row.name}
            </Typography>
          </Box>
          <Typography variant="caption" sx={{ color: 'var(--dash-ink)', fontWeight: 600 }}>
            Total {row.total}
          </Typography>
          {typeList.map(({ type, label }) => (
            <Typography
              key={type}
              variant="caption"
              sx={{ color: row.counts[type] ? 'var(--dash-ink)' : 'var(--dash-dim)' }}
            >
              {label} {row.counts[type] || 0}
            </Typography>
          ))}
        </Box>
      ))}
    </Box>
  );
}

function TrophyCase({ leagueId, teams }) {
  const [trophies, setTrophies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [season, setSeason] = useState('');
  // Named from its own heading rather than from an id plumbed out to whichever
  // page wrapper mounts it (RecapCard does the same).
  const headingId = useId();

  useEffect(() => {
    let cancelled = false;

    const fetchTrophies = async () => {
      try {
        setLoading(true);
        setError(null);
        const res = await apiClient.get(`/api/league/${leagueId}/trophies`);
        const data = Array.isArray(res.data) ? res.data : [];
        if (!cancelled) {
          setTrophies(data);
          const seasons = Array.from(new Set(data.map((t) => t.season))).sort((a, b) => b - a);
          setSeason(seasons.length ? seasons[0] : '');
        }
      } catch (err) {
        if (!cancelled) {
          setTrophies([]);
          setError(readHttpFailure(err).message || err.message);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchTrophies();
    return () => {
      cancelled = true;
    };
  }, [leagueId]);

  const seasonOptions = useMemo(
    () => Array.from(new Set(trophies.map((t) => t.season))).sort((a, b) => b - a),
    [trophies]
  );

  const visibleTrophies = useMemo(
    () => (season === '' ? trophies : trophies.filter((t) => t.season === season)),
    [trophies, season]
  );

  if (loading || error || trophies.length === 0) {
    return null;
  }

  return (
    <Card sx={{ p: 2 }} aria-labelledby={headingId} data-testid="trophy-case">
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2, flexWrap: 'wrap', gap: 2 }}>
        <Typography
          id={headingId}
          variant="h6"
          component="h2"
          sx={{ fontFamily: 'var(--dash-font-display)' }}
        >
          Trophy Case
        </Typography>
        {seasonOptions.length > 1 && (
          <FormControl size="small" sx={{ minWidth: 140 }}>
            <InputLabel id="trophy-season-select-label">Season</InputLabel>
            <Select
              labelId="trophy-season-select-label"
              id="trophy-season-select"
              value={season}
              label="Season"
              onChange={(e) => setSeason(e.target.value)}
            >
              {seasonOptions.map((s) => (
                <MenuItem key={s} value={s}>
                  {s}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        )}
      </Box>
      {visibleTrophies.length > 0 && <TrophyTally seasonTrophies={visibleTrophies} teams={teams} />}
      {visibleTrophies.length === 0 ? (
        <Typography variant="body2" sx={{ color: 'var(--dash-dim)', fontFamily: 'var(--dash-font-body)' }}>
          No trophies for this season yet
        </Typography>
      ) : (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5 }}>
          {visibleTrophies.map((trophy) => (
            <Badge
              key={trophy.id}
              data-testid={`trophy-${trophy.id}`}
              sx={{
                height: 'auto',
                '& .MuiChip-label': { px: 1.25, py: 1, whiteSpace: 'normal' },
              }}
            >
              <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 1 }}>
                <TrophyIcon type={trophy.type} />
                <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                  <Typography
                    variant="body2"
                    sx={{ fontWeight: 600, fontFamily: 'var(--dash-font-body)', color: 'var(--dash-ink)' }}
                  >
                    {trophy.label}
                  </Typography>
                  <Typography
                    variant="caption"
                    sx={{ fontFamily: 'var(--dash-font-body)', color: 'var(--dash-dim)' }}
                  >
                    {trophySubLabel(trophy)}
                  </Typography>
                </Box>
              </Box>
            </Badge>
          ))}
        </Box>
      )}
    </Card>
  );
}

export default TrophyCase;
