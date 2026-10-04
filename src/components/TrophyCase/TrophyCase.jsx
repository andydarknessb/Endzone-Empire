import React, { useState, useEffect, useMemo, useId } from 'react';
import {
  Typography,
  Box,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
} from '@mui/material';
import { visuallyHidden } from '@mui/utils';
import { Card, TeamAvatar } from '../../shared/ui';
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
  called_shot: 'target',
  win_streak: 'rise',
  comeback: 'rebound',
  draft_grade: 'target',
  fewest_left_on_bench: 'target',
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

// What the tally calls each trophy type. The server's labels carry parameters
// (`Best Draft (A)`, `Longest Win Streak (7)`, `2026 League Champion`), which
// name an award but not a column, so the tally reads the type instead. A type
// a newer server awards falls back to its label with the trailing `(...)`
// removed (see `typeName`), so it still shows up with no client change.
const TYPE_NAMES = {
  top_scorer: 'Top Scorer',
  captain_hindsight: 'Captain Hindsight',
  perfect_lineup: 'Perfect Lineup',
  called_shot: 'Called Shot',
  champion: 'Champion',
  pickem_champion: "Pick'em Champion",
  draft_grade: 'Best Draft',
  win_streak: 'Longest Win Streak',
  comeback: 'Biggest Comeback',
  fewest_left_on_bench: 'Fewest Left on the Bench',
  weekly_high: 'Weekly High',
  closest_game: 'Closest Game',
  biggest_blowout: 'Biggest Blowout',
};

function typeName(trophy) {
  return TYPE_NAMES[trophy.type] || String(trophy.label).replace(/\s*\([^)]*\)\s*$/, '');
}

// Rows shown before "Show all": a phone gets the season's headline awards and
// latest weeks and the top of the leaderboard, not 40-odd award rows and a row
// for every team in the league.
const COLLAPSED_ROWS = 6;
const TALLY_ROWS = 5;

// A season award (champion, best draft, win streak) carries week 0 or none; a
// weekly award carries the week it was won.
const isSeasonAward = (trophy) => !trophy.week;

/**
 * The award rows' order: season awards first, then weekly awards newest week
 * first. A stable sort, so awards of the same week keep the server's order.
 */
function orderAwards(seasonTrophies) {
  const rank = (t) => (isSeasonAward(t) ? Infinity : t.week);
  return [...seasonTrophies].sort((a, b) => rank(b) - rank(a));
}

/**
 * The season's per-team leaderboard: one row per team, ordered by total then
 * name, each with its count of every trophy type it holds (only the types it
 * holds, most first). Types are named by `typeName`, so a type a newer server
 * awards appears with no client change. `teams` (the league's roster, already
 * loaded by the page) supplies teams that won nothing; a team only the
 * trophies know about is still listed, so the tally is complete with or
 * without the roster.
 */
function buildTally(seasonTrophies, teams = []) {
  const byTeam = new Map();
  // One row shape, keyed on the canonical Team identity (`teamId`, `teamName`)
  // rather than the raw `id`/`name` columns the league-detail route leaks
  // beside them. `trophies.team_id` is the same integer as `teamId`.
  teams.forEach((tm) =>
    byTeam.set(tm.teamId, {
      teamId: tm.teamId,
      teamName: tm.teamName,
      avatar_url: tm.avatar_url,
      avatar_static_url: tm.avatar_static_url,
      counts: new Map(),
      total: 0,
    })
  );
  seasonTrophies.forEach((t) => {
    if (!byTeam.has(t.team_id)) {
      byTeam.set(t.team_id, {
        teamId: t.team_id,
        teamName: t.team_name,
        avatar_url: null,
        avatar_static_url: null,
        counts: new Map(),
        total: 0,
      });
    }
    const row = byTeam.get(t.team_id);
    const name = typeName(t);
    row.counts.set(name, (row.counts.get(name) || 0) + 1);
    row.total += 1;
  });
  return Array.from(byTeam.values())
    .map((row) => ({
      ...row,
      breakdown: Array.from(row.counts, ([name, count]) => ({ name, count })).sort(
        (a, b) => b.count - a.count || a.name.localeCompare(b.name)
      ),
    }))
    .sort(
      (a, b) =>
        b.total - a.total || String(a.teamName).localeCompare(String(b.teamName))
    );
}

// Row rules and padding follow the other dashboard cards' lists
// (RecentActivity.jsx): 18px sides, a 1px `dash-line` rule between rows.
const ROW_SX = (first) => ({
  display: 'flex',
  alignItems: 'center',
  gap: '10px',
  px: '18px',
  py: '8px',
  minWidth: 0,
  // Two text lines per row: a tighter leading than the page's 1.5 keeps a row
  // near 50px, which is what lets the capped lists fit a phone's second screen.
  lineHeight: 1.3,
  borderTop: first ? 0 : '1px solid var(--dash-line)',
});

const LIST_SX = { listStyle: 'none', m: 0, p: 0, minWidth: 0 };

/**
 * One tally row as a grid: the avatar spans both lines, the Team name (one
 * line, ellipsized like the standings' names) and the total share the first,
 * and the type breakdown takes the second across the name and total columns
 * so it can wrap without ever pushing the total.
 */
function TallyRow({ row, first, isViewer }) {
  return (
    <Box
      component="li"
      data-testid={`tally-team-${row.teamId}`}
      data-viewer-team={isViewer || undefined}
      sx={{
        ...ROW_SX(first),
        display: 'grid',
        gridTemplateColumns: '24px minmax(0, 1fr) auto',
        columnGap: '10px',
        rowGap: '1px',
        fontFamily: 'var(--dash-font-body)',
        // The island's one viewer treatment (the standings and Draft Grades
        // paint the same pair): the accent tint plus a 3px inset accent bar.
        // Ink and dim on the tint over a card are registered in
        // tokens.contrast.test.js, so no new pairing is composed here.
        ...(isViewer
          ? {
              position: 'relative',
              backgroundColor: 'var(--dash-accent-soft)',
              boxShadow: 'inset 3px 0 0 var(--dash-accent)',
            }
          : {}),
      }}
    >
      <Box sx={{ gridRow: '1 / span 2', alignSelf: 'center', display: 'inline-flex' }}>
        <TeamAvatar
          name={row.teamName}
          avatarUrl={row.avatar_url}
          avatarStaticUrl={row.avatar_static_url}
          size={24}
        />
      </Box>
      <Box
        component="span"
        title={row.teamName}
        sx={{
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          fontSize: '13.5px',
          fontWeight: 600,
          color: 'var(--dash-ink)',
        }}
      >
        {row.teamName}
      </Box>
      {/* Not colour alone (1.4.1): the tint and bar are the sighted mark. */}
      {isViewer && <Box component="span" sx={visuallyHidden}>your team</Box>}
      <Box
        component="span"
        data-testid="tally-total"
        sx={{ fontSize: '13px', fontWeight: 600, color: 'var(--dash-ink)', whiteSpace: 'nowrap' }}
      >
        {row.total === 1 ? '1 trophy' : `${row.total} trophies`}
      </Box>
      {row.breakdown.length > 0 && (
        <Box
          component="span"
          data-testid="tally-breakdown"
          // Every space inside an item is a non-breaking space, so a type name
          // and its count stay whole and the middots are the only break.
          sx={{ gridColumn: '2 / 4', fontSize: '12px', color: 'var(--dash-dim)' }}
        >
          {row.breakdown.map(({ name, count }) => `${name.replace(/ /g, '\u00a0')}\u00a0×${count}`).join(' · ')}
        </Box>
      )}
    </Box>
  );
}

function TrophyTally({ rows, listId, viewerTeamId }) {
  if (rows.length === 0) return null;
  return (
    <Box
      component="ul"
      // WebKit drops the list mapping from a list-style: none <ul>, so VoiceOver
      // would read the rows as loose text without the explicit role.
      role="list"
      id={listId}
      data-testid="trophy-tally"
      aria-label="Trophies by team"
      sx={LIST_SX}
    >
      {rows.map((row, i) => (
        <TallyRow key={row.teamId} row={row} first={i === 0} isViewer={viewerTeamId != null && row.teamId === viewerTeamId} />
      ))}
    </Box>
  );
}

function AwardRow({ trophy, first }) {
  return (
    <Box component="li" data-testid={`trophy-${trophy.id}`} sx={{ ...ROW_SX(first), fontFamily: 'var(--dash-font-body)' }}>
      <Box sx={{ display: 'inline-flex', flex: 'none', color: 'var(--dash-dim)' }}>
        <TrophyIcon type={trophy.type} />
      </Box>
      <Box sx={{ display: 'grid', gap: '1px', flex: '1 1 0', minWidth: 0 }}>
        <Box component="span" sx={{ fontSize: '13.5px', fontWeight: 600, color: 'var(--dash-ink)', overflowWrap: 'anywhere' }}>
          {trophy.label}
        </Box>
        {/* The Team ellipsizes (as the standings' names do) so the week suffix
            never wraps onto a second line of its own (the leading non-breaking space
            survives the flex item, which a plain space would not). */}
        <Box component="span" sx={{ display: 'flex', minWidth: 0, fontSize: '12.5px', color: 'var(--dash-dim)' }}>
          <Box component="span" sx={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {trophy.team_name}
          </Box>
          {!isSeasonAward(trophy) && (
            <Box component="span" sx={{ flex: 'none', whiteSpace: 'nowrap' }}>
              {`\u00a0· Week ${trophy.week}`}
            </Box>
          )}
        </Box>
      </Box>
    </Box>
  );
}

function TrophyAwards({ awards, listId }) {
  return (
    <Box
      sx={{
        minWidth: 0,
        // Under the tally on a phone, beside it from md.
        borderTop: { xs: '1px solid var(--dash-line)', md: 0 },
        borderLeft: { xs: 0, md: '1px solid var(--dash-line)' },
      }}
    >
      <Box component="ul" role="list" id={listId} aria-label="Awards" sx={LIST_SX}>
        {awards.map((trophy, i) => (
          <AwardRow key={trophy.id} trophy={trophy} first={i === 0} />
        ))}
      </Box>
    </Box>
  );
}

/** The one text button that opens or closes both capped lists. */
function ShowAllToggle({ expanded, onToggle, label, controls }) {
  return (
    <Box
      component="button"
      type="button"
      data-testid="trophy-show-all"
      aria-expanded={expanded}
      aria-controls={controls}
      onClick={onToggle}
      sx={{
        display: 'block',
        width: '100%',
        minHeight: 44,
        px: '18px',
        border: 0,
        borderTop: '1px solid var(--dash-line)',
        background: 'none',
        font: 'inherit',
        fontFamily: 'var(--dash-font-body)',
        fontSize: '13px',
        fontWeight: 600,
        textAlign: 'left',
        color: 'var(--dash-dim)',
        cursor: 'pointer',
        '&:hover': { color: 'var(--dash-ink)' },
        '&:focus-visible': { outline: '2px solid var(--focus-ring)', outlineOffset: -2 },
      }}
    >
      {label}
    </Box>
  );
}

/**
 * `viewerTeamId` (optional) marks the viewer's own tally row, and keeps it on
 * screen while the tally is collapsed. League History mounts no tally and
 * passes nothing.
 */
function TrophyCase({ leagueId, teams, viewerTeamId }) {
  const [trophies, setTrophies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [season, setSeason] = useState('');
  const [expanded, setExpanded] = useState(false);
  const tallyId = useId();
  const awardsId = useId();

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

  // A different season is a different pair of lists: start it collapsed.
  useEffect(() => setExpanded(false), [season]);

  const seasonOptions = useMemo(
    () => Array.from(new Set(trophies.map((t) => t.season))).sort((a, b) => b - a),
    [trophies]
  );

  const visibleTrophies = useMemo(
    () => (season === '' ? trophies : trophies.filter((t) => t.season === season)),
    [trophies, season]
  );

  const tallyRows = useMemo(() => buildTally(visibleTrophies, teams), [visibleTrophies, teams]);
  const awards = useMemo(() => orderAwards(visibleTrophies), [visibleTrophies]);

  if (loading || error || trophies.length === 0) {
    return null;
  }

  // Both lists are capped so the card does not grow with the league or the
  // season: the top TALLY_ROWS teams and the first COLLAPSED_ROWS awards, with
  // one toggle for the pair. It names only the list(s) that are actually cut.
  const tallyCapped = tallyRows.length > TALLY_ROWS;
  const awardsCapped = awards.length > COLLAPSED_ROWS;
  const capped = tallyCapped || awardsCapped;
  // Collapsed, the viewer's own Team stays visible even when it ranks below the
  // top TALLY_ROWS: it is appended as one more row, in its true rank order.
  const viewerIndex = viewerTeamId == null ? -1 : tallyRows.findIndex((r) => r.teamId === viewerTeamId);
  const collapsedTally =
    viewerIndex >= TALLY_ROWS
      ? [...tallyRows.slice(0, TALLY_ROWS), tallyRows[viewerIndex]]
      : tallyRows.slice(0, TALLY_ROWS);
  const hiddenNouns = [
    tallyCapped && `${tallyRows.length} teams`,
    awardsCapped && `${awards.length} awards`,
  ]
    .filter(Boolean)
    .join(' and ');

  return (
    <Card
      data-testid="trophy-case"
      title="Trophy Case"
      count={String(visibleTrophies.length)}
      tail={
        seasonOptions.length > 1 ? (
          <FormControl size="small" sx={{ minWidth: 110 }}>
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
        ) : undefined
      }
    >
      {visibleTrophies.length === 0 ? (
        <Typography variant="body2" sx={{ p: '18px', color: 'var(--dash-dim)', fontFamily: 'var(--dash-font-body)' }}>
          No trophies for this season yet
        </Typography>
      ) : (
        <>
          {/* The tally and the awards stack on a phone and sit side by side
              from md, so a wide card is not two screens of single-column rows. */}
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: 'repeat(2, minmax(0, 1fr))' }, alignItems: 'start' }}>
            <TrophyTally rows={expanded ? tallyRows : collapsedTally} listId={tallyId} viewerTeamId={viewerTeamId} />
            <TrophyAwards awards={expanded ? awards : awards.slice(0, COLLAPSED_ROWS)} listId={awardsId} />
          </Box>
          {capped && (
            <ShowAllToggle
              expanded={expanded}
              onToggle={() => setExpanded((open) => !open)}
              label={expanded ? 'Show fewer' : `Show all ${hiddenNouns}`}
              controls={`${tallyId} ${awardsId}`}
            />
          )}
        </>
      )}
    </Card>
  );
}

export default TrophyCase;
