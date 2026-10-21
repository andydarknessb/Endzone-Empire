import React, { useState, useEffect, useMemo } from 'react';
import { Box } from '@mui/material';
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

// Rows shown before "Show all": a phone gets the season's headline awards and
// latest weeks and the top of the leaderboard, not 40-odd award rows and a row
// for every team in the league.
export const COLLAPSED_ROWS = 6;

// A season award (champion, best draft, win streak) carries week 0 or none; a
// weekly award carries the week it was won.
export const isSeasonAward = (trophy) => !trophy.week;

/**
 * The award rows' order: season awards first, then weekly awards newest week
 * first. A stable sort, so awards of the same week keep the server's order.
 */
export function orderAwards(seasonTrophies) {
  const rank = (t) => (isSeasonAward(t) ? Infinity : t.week);
  return [...seasonTrophies].sort((a, b) => rank(b) - rank(a));
}

/**
 * The league's trophies and the season they are read for (the newest by default), read by the
 * League Dashboard's Play-select view (src/pages/league-dashboard).
 */
export function useTrophies(leagueId) {
  const [trophies, setTrophies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [season, setSeason] = useState('');

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

  return {
    trophies, loading, error, season, setSeason, seasonOptions, visibleTrophies,
  };
}
