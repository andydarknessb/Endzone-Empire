import React from 'react';
import MatchupHero from '../../../widgets/matchup-hero';
import {
  matchupBoard, playersRemaining, useMatchup, yetToPlay,
} from '../../../entities/matchup';

/**
 * The hero with its count source settled. The server prints `playersRemaining` and `yetToPlay` on each side
 * of a Matchup (spec #2334, one definition), and the hero sentence reads them. A payload without `yetToPlay`
 * (an older server) falls back to the entity helpers over the matchup's own lineups, which the list read does
 * not carry, so the fallback reads the detail once, and only while live, and then the sentence takes both
 * counts from the helpers, never one of each. Everything else on the hero comes from the list model, which
 * the score feed moves with no refetch.
 */
function WithLineups({ hero, ...rest }) {
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
  const serverCounts = hero.home?.yetToPlay != null && hero.away?.yetToPlay != null;
  if (!serverCounts && matchupBoard(hero).isLive) return <WithLineups hero={hero} {...rest} />;
  return <MatchupHero matchup={hero} {...rest} />;
}
