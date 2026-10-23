import { useState, useEffect } from 'react';
import apiClient from '../../api/apiClient';
import { useLeague } from '../../hooks/useLeague';
import { readHttpFailure } from '../../lib/httpFailure';

// The fact rows (#1988 L22): a bold label and a value, joined by middots where
// the old pills used parentheses, hyphens and "margin N" (ADR 0016). The two
// halves stay separate so the row can lay the value under the label at phone
// width. At most four rows, in this order. "by" and the margin are joined by a
// non-breaking space so a wrapped value never strands the number alone.
const MIDDOT = ' · ';

export function buildFactRows(facts) {
  if (!facts) return [];
  const rows = [];
  if (facts.highestScorer) {
    rows.push({
      key: 'highestScorer',
      icon: 'flame',
      label: 'High score',
      value: [facts.highestScorer.team, facts.highestScorer.points].join(MIDDOT),
    });
  }
  if (facts.benchBlunder) {
    rows.push({
      key: 'benchBlunder',
      icon: 'fall',
      label: 'Bench blunder',
      value: [facts.benchBlunder.team, `${facts.benchBlunder.pointsLeftOnBench} left on the bench`].join(MIDDOT),
    });
  }
  if (facts.waiverSteal) {
    rows.push({
      key: 'waiverSteal',
      icon: 'gem',
      label: 'Waiver steal',
      value: [facts.waiverSteal.player, facts.waiverSteal.team, `${facts.waiverSteal.points} pts`].join(MIDDOT),
    });
  }
  if (facts.closestMatchup && rows.length < 4) {
    rows.push({
      key: 'closestMatchup',
      icon: 'compress',
      label: 'Closest game',
      value: [`${facts.closestMatchup.home} vs ${facts.closestMatchup.away}`, `by\u00a0${facts.closestMatchup.margin}`].join(
        MIDDOT
      ),
    });
  }
  if (facts.biggestBlowout && rows.length < 4) {
    rows.push({
      key: 'biggestBlowout',
      icon: 'burst',
      label: 'Biggest blowout',
      value: [`${facts.biggestBlowout.home} vs ${facts.biggestBlowout.away}`, `by\u00a0${facts.biggestBlowout.margin}`].join(
        MIDDOT
      ),
    });
  }
  return rows.slice(0, 4);
}

// "Dec 29, 3:00 AM": month short, day, hour, minute. No seconds and no year, so
// the stamp reads as a fact and not a log line.
const GENERATED_FORMAT = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

/** "Dec 29, 3:00 AM" for a recap's `generatedAt`, or null without one. */
export const formatGenerated = (generatedAt) => (generatedAt ? GENERATED_FORMAT.format(new Date(generatedAt)) : null);

/**
 * The recap read and the commissioner's rebuild, read by the League Dashboard's
 * Play-select view (src/pages/league-dashboard). It returns `recap` null until a recap exists (a 404
 * leaves it null, so a caller renders nothing).
 */
export function useRecap(leagueId) {
  const [recap, setRecap] = useState(null);
  const [hidden, setHidden] = useState(true);
  const [rebuilding, setRebuilding] = useState(false);
  const [rebuildError, setRebuildError] = useState(null);
  // The commissioner flag rides the same shared league cache the page itself
  // reads (useLeague / ADR 0004, the useCommissionerStrip pattern): no new
  // endpoint and no second request in practice, since the page's own
  // useLeague(leagueId) call already primed this key. Read from
  // `is_commissioner`, the one field GET /api/league/:id adds for the viewer's
  // role - never `invite_code`, which answers a different question.
  const { league } = useLeague(leagueId);
  const isCommissioner = !!league?.is_commissioner;
  // The rebuild is scoped to "a chosen finalized week of the CURRENT season"
  // (#1412's acceptance criteria). GET /recap has no current-season filter
  // (getLatestRecap orders by season DESC), so between a rollover and that
  // league's first recap of the new season the card can be showing an OLDER
  // season's recap; offering the control there would rebuild the wrong
  // season's week (the route resolves season from leagues.current_season,
  // not from what's on screen). Gated off league.current_season, the same
  // payload the commissioner flag above already reads.
  const isCurrentSeasonRecap = league?.current_season != null && recap?.season === league.current_season;

  useEffect(() => {
    let cancelled = false;

    const fetchRecap = async () => {
      try {
        const res = await apiClient.get(`/api/scoring/league/${leagueId}/recap`);
        if (!cancelled) {
          setRecap(res.data);
          setHidden(false);
        }
      } catch (err) {
        if (!cancelled) {
          setRecap(null);
          setHidden(true);
        }
      }
    };

    fetchRecap();
    return () => {
      cancelled = true;
    };
  }, [leagueId]);

  // Commissioner-only: rebuilds the recap currently on screen from current
  // data (#1412), the silent compute-and-store path - no feed entry, no
  // member notification. The response is the same { season, week, data }
  // shape the GET returns, so it replaces the displayed recap outright.
  const handleRebuild = async () => {
    if (!recap || recap.week == null || !isCurrentSeasonRecap || rebuilding) return;
    setRebuilding(true);
    setRebuildError(null);
    try {
      const res = await apiClient.post(`/api/scoring/league/${leagueId}/recap`, {
        week: recap.week,
        season: recap.season,
      });
      setRecap(res.data);
    } catch (err) {
      setRebuildError(readHttpFailure(err).message || err?.message || 'Could not rebuild the recap.');
    } finally {
      setRebuilding(false);
    }
  };

  return {
    recap: hidden ? null : recap,
    isCommissioner,
    isCurrentSeasonRecap,
    rebuilding,
    rebuildError,
    handleRebuild,
  };
}
