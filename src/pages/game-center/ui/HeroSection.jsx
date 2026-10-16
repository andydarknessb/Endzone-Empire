import React, { useRef } from 'react';
import MatchupHero from '../../../widgets/matchup-hero';
import {
  matchupBoard, playersRemaining, useMatchup, yetToPlay,
} from '../../../entities/matchup';

/**
 * The hero with its count source settled. The server prints `playersRemaining` and `yetToPlay` on each side
 * of a Matchup (spec #2334, one definition), and the hero sentence reads them. A payload without `yetToPlay`
 * (an older server) falls back to the entity helpers over the matchup's own lineups, which the list read does
 * not carry, so the fallback reads the detail once, and only while live, and then the sentence takes both
 * counts from the helpers, never one of each. The choice is made once per matchup id, the first time it is live,
 * so a payload flickering between null and present never remounts the hero or refetches the lineups. Everything else on the hero comes from the list model, which
 * the score feed moves with no refetch.
 */
function WithLineups({ hero, ...rest }) {
  // shortcut: useMatchup opens its own score-feed socket and game-state channel beside the page's, upgrade by
  // reading the lineups through a cache both share once the server sends yetToPlay everywhere (this path then goes).
  const { matchup, homeStarters, awayStarters } = useMatchup(rest.leagueId, hero.id);
  const games = matchup?.games;
  const counts = matchup && homeStarters && awayStarters
    ? {
      home: { remaining: playersRemaining(homeStarters, games), yet: yetToPlay(homeStarters, games) },
      away: { remaining: playersRemaining(awayStarters, games), yet: yetToPlay(awayStarters, games) },
    }
    : null;
  return <MatchupHero matchup={hero} counts={counts} {...rest} />;
}

export default function HeroSection({ hero, ...rest }) {
  const source = useRef(new Map());
  const serverCounts = hero.home?.yetToPlay != null && hero.away?.yetToPlay != null;
  if (matchupBoard(hero).isLive && !source.current.has(hero.id)) {
    source.current.set(hero.id, serverCounts ? 'server' : 'helpers');
  }
  if (source.current.get(hero.id) === 'helpers') return <WithLineups hero={hero} {...rest} />;
  return <MatchupHero matchup={hero} {...rest} />;
}
