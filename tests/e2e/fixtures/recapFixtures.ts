/**
 * The Weekly Recap payload the recap layout guard (recap-layout.spec.ts, #1988)
 * routes in. layoutGuardFixtures.ts serves no recap, so the card self-hides and
 * the dashboard specs never render it; this is the busy-week case the spec
 * measures instead: ten sentences in one paragraph, the shape
 * server/services/recap.service.js `templateNarrative` produces when a week has
 * a high score, a nail-biter, a blowout, a bench blunder, two perfect lineups,
 * two Captain Hindsight lines and a called shot, plus the four facts the card
 * lists (the card caps them at four).
 *
 * Kept out of layoutGuardFixtures.ts on purpose: adding a recap there would put
 * the card on screen in every spec that shares it.
 */
import { LEAGUE_ID } from './layoutGuardFixtures';

export const RECAP_URL_PATTERN = `**/api/scoring/league/${LEAGUE_ID}/recap`;

export const RECAP_WEEK = 17;

const NARRATIVE_SENTENCES = [
  'Patagonia Frostbite Penguins lit up the scoreboard with a league-best 148.6 points in week 17.',
  'The nail-biter of the week: Chattahoochee Valley Riverhogs edged Sasquatch of the Cascade Range by just 1.8 (121.4-119.6).',
  'Emerald Coast Storm Chasers steamrolled Lake Superior Ore Haulers by 52.3 in the week\'s biggest blowout.',
  'Bench blunder of the week: Emerald Coast Storm Chasers left 38.4 points sitting on the bench.',
  'Patagonia Frostbite Penguins set a perfect lineup.',
  'Sasquatch of the Cascade Range set a perfect lineup.',
  'Captain Hindsight: Lake Superior Ore Haulers lost by 4.2; starting Jaxon Smith-Njigba over Jerry Jeudy at WR2 would have won it.',
  'Captain Hindsight: Chattahoochee Valley Riverhogs lost by 0.6; filling FLEX with Tyjae Spears would have won it.',
  'Sasquatch of the Cascade Range called it: Jaxon Smith-Njigba over Jerry Jeudy, 27.9 to 3.1. A bold call.',
  'Lake Superior Ore Haulers called Tyjae Spears over Rhamondre Stevenson and missed, 4.4 to 17.2.',
];

export const RECAP_PAYLOAD = {
  season: 2026,
  week: RECAP_WEEK,
  data: {
    generatedAt: '2026-12-29T03:00:00.000Z',
    narrative: NARRATIVE_SENTENCES.join(' '),
    facts: {
      week: RECAP_WEEK,
      highestScorer: { team: 'Patagonia Frostbite Penguins', points: 148.6 },
      benchBlunder: { team: 'Emerald Coast Storm Chasers', pointsLeftOnBench: 38.4 },
      waiverSteal: { player: 'Jaxon Smith-Njigba', team: 'Patagonia Frostbite Penguins', points: 27.9 },
      closestMatchup: {
        home: 'Chattahoochee Valley Riverhogs',
        away: 'Sasquatch of the Cascade Range',
        homeScore: 121.4,
        awayScore: 119.6,
        margin: 1.8,
      },
    },
  },
};
