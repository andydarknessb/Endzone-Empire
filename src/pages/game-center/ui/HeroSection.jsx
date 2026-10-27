import React, { useEffect, useMemo, useRef } from 'react';
import { Box } from '@mui/material';
import MatchupHero from '../../../widgets/matchup-hero';
import { LineupNote } from '../../../features/bench-what-if';
import {
  matchupBoard, playersRemaining, useMatchup, yetToPlay,
} from '../../../entities/matchup';
import {
  adviceGain, adviceNote, lineupNote, nextLockAt, parseRosterTemplate, useAdvice,
} from '../../../entities/roster';
import { lineupProblemFor } from '../../../entities/action-item';
import { parseRosterSlots } from '../../../shared/lib';

/**
 * The viewer's starting slots as the lineup note reads them, `[{ slot, player }]` with `player` null for an
 * empty slot: the league's roster_slots in commissioner order, each key as many times as its count, filled from
 * the starters that carry that slot. A starter in a slot the league does not name is appended, so a stray row
 * still counts.
 */
export function viewerSlots(league, starters) {
  const taken = new Map();
  (starters || []).forEach((p) => {
    const key = String(p.slot ?? '');
    taken.set(key, [...(taken.get(key) || []), p]);
  });
  const slots = [];
  parseRosterSlots(league?.roster_slots).forEach((s) => {
    if (s?.key == null) return;
    const key = String(s.key);
    const have = taken.get(key) || [];
    for (let i = 0; i < Number(s.count ?? 1); i += 1) slots.push({ slot: key, player: have[i] ?? null });
    taken.delete(key);
  });
  taken.forEach((list) => list.forEach((player) => slots.push({ slot: String(player.slot ?? ''), player })));
  return slots;
}

const isOutStarter = (p) => p.injury_status === 'O' || p.availability?.reason === 'out';

/**
 * The hero with its count source and its lineup note settled (the page passes the hero's own props plus the
 * lineup note's: `league`, `now`, `actionItems`, `noteEligible`, `onLockPassed`, and `heroRef`, a callback ref for the
 * compact scoreboard's observer).
 *
 * Counts: the server prints `playersRemaining` and `yetToPlay` on each side of a Matchup (spec #2334, one
 * definition), and the hero reads them. A payload without `yetToPlay` falls back to the entity helpers over the
 * matchup's own lineups, and then the sentence and the hero's own count lines take both counts from the helpers,
 * never one of each. The choice is made once per matchup id, the first time it is live, so a payload flickering
 * between null and present never remounts the hero or refetches the lineups.
 *
 * Lineup note (RULINGS Critique 7-11): the shared decision `lineupNote` (entities/roster) over the viewer's side
 * of the matchup detail (starters, bench) and its live game states, laid out by features/bench-what-if's
 * `LineupNote`. It shows only while the matchup is the league's current week and not settled (`noteEligible`),
 * never in best ball, and nothing once its lock has passed, at which point the action items are asked for once
 * more (`onLockPassed`, the shared cache's refetch). Before kickoff it names the advice's moves once the advice
 * has read: one GET for the viewer's own team, made only while the note is open before kickoff. The detail is
 * read once for the note or the helper counts and kept for that matchup.
 *
 * Everything else on the hero comes from the list model, which the score feed moves with no refetch.
 */
function WithLineups({
  hero, heroProps, helperCounts, noteEligible, league, now, actionItems, onLockPassed, heroRef,
}) {
  // shortcut: useMatchup opens its own score-feed socket and game-state channel beside the page's, upgrade by
  // reading the lineups through a cache both share once the lineup read is one the page owns.
  const { leagueId, viewerTeamId } = heroProps;
  const {
    matchup, detail, homeStarters, awayStarters,
  } = useMatchup(leagueId, hero.id);
  const games = matchup?.games;
  const board = matchupBoard(hero, viewerTeamId);
  const side = board.first.isViewer ? board.first.origin : null;
  const started = board.hasStarted === true;

  // In the board's order: the hero reads `counts.first` for the board's first side.
  const startersOf = { home: homeStarters, away: awayStarters };
  const countsOf = (s) => ({ remaining: playersRemaining(startersOf[s.origin], games), yet: yetToPlay(startersOf[s.origin], games) });
  const counts = helperCounts && matchup && homeStarters && awayStarters
    ? { first: countsOf(board.first), second: countsOf(board.second) }
    : null;

  const starters = side === 'home' ? homeStarters : side === 'away' ? awayStarters : null;
  const slots = useMemo(() => (starters ? viewerSlots(league, starters) : []), [league, starters]);
  const problem = useMemo(
    () => lineupProblemFor(actionItems, { leagueId, season: hero.season, week: hero.week }),
    [actionItems, leagueId, hero.season, hero.week]
  );
  const viewerPlayers = useMemo(
    () => (starters ? starters.concat(detail?.[side]?.bench || []) : []),
    [starters, detail, side]
  );
  const lockAt = useMemo(
    () => nextLockAt(problem?.deadlineAt, viewerPlayers, games),
    [problem, viewerPlayers, games]
  );
  const template = useMemo(() => parseRosterTemplate(league?.roster_slots), [league?.roster_slots]);
  const open = noteEligible && !!side && !!starters && !league?.best_ball;
  const lockPassed = open && lockAt != null && lockAt <= now;
  const hasIssue = slots.some((s) => !s.player || isOutStarter(s.player));
  const advice = useAdvice({
    leagueId: open && hasIssue && !started && !lockPassed ? leagueId : null,
    week: hero.week,
    bestBall: Boolean(league?.best_ball),
  });
  const otherSide = side === 'home' ? 'away' : 'home';
  const view = open && !lockPassed
    ? lineupNote({
      slots,
      bench: detail?.[side]?.bench,
      template,
      gameStates: games,
      started,
      lockAt,
      now,
      advice: advice.status === 'ready' || advice.suggestions.length > 0 ? adviceNote(advice) : null,
      gain: adviceGain(advice),
      proj: { you: hero?.[side]?.expectedFinal, them: hero?.[otherSide]?.expectedFinal },
    })
    : null;

  const asked = useRef(null);
  useEffect(() => {
    if (lockPassed && asked.current !== lockAt) {
      asked.current = lockAt;
      onLockPassed?.();
    }
  }, [lockPassed, lockAt, onLockPassed]);

  return (
    <>
      <Box ref={heroRef}>
        {/* Until the lineups have read, the helper path prints no count at all, so the server's numbers never flash first. */}
        <MatchupHero matchup={hero} counts={counts} countsPending={helperCounts && !counts} {...heroProps} />
      </Box>
      <LineupNote view={view} leagueId={leagueId} />
    </>
  );
}

export default function HeroSection({
  hero, heroProps, noteEligible, heroRef, ...lineup
}) {
  const source = useRef(new Map());
  const withDetail = useRef(new Set());
  const serverCounts = hero.home?.yetToPlay != null && hero.away?.yetToPlay != null;
  if (matchupBoard(hero).isLive && !source.current.has(hero.id)) {
    source.current.set(hero.id, serverCounts ? 'server' : 'helpers');
  }
  const helperCounts = source.current.get(hero.id) === 'helpers';
  // Once the lineups are read for a matchup they stay read, so the hero never remounts for the note.
  if (helperCounts || noteEligible) withDetail.current.add(hero.id);
  if (withDetail.current.has(hero.id)) {
    return (
      <WithLineups
        hero={hero}
        heroProps={heroProps}
        helperCounts={helperCounts}
        noteEligible={noteEligible}
        heroRef={heroRef}
        {...lineup}
      />
    );
  }
  return <Box ref={heroRef}><MatchupHero matchup={hero} {...heroProps} /></Box>;
}
