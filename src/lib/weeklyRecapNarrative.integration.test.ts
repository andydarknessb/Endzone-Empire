/** @jest-environment node */

const { buildRecapFacts, llmNarrative } = require('../../server/services/recap.service');

type WeeklyMatchup = {
  home_team_name: string;
  away_team_name: string;
  home_score: number;
  away_score: number;
  final: boolean;
};

const weeklyScoreboard: {
  week: number;
  matchups: WeeklyMatchup[];
  waiverSteal: {
    player: string;
    team: string;
    points: number;
    outscoredStarter: { player: string; points: number };
  };
} = {
  week: 14,
  matchups: [
    {
      home_team_name: 'Night Owls',
      away_team_name: 'Goal Line Goons',
      home_score: 142.5,
      away_score: 83.1,
      final: true,
    },
    {
      home_team_name: 'Harbor Hail Marys',
      away_team_name: 'Fourth and Long',
      home_score: 109.4,
      away_score: 103.2,
      final: true,
    },
  ],
  waiverSteal: {
    player: 'Jalen McMillan',
    team: 'Night Owls',
    points: 24.4,
    outscoredStarter: { player: 'Darnell Mooney', points: 8.2 },
  },
};

function playerNamesOutsideScoreboard(text: string, teamNames: string[], playerNames: string[]) {
  let masked = text;
  for (const name of [...teamNames, ...playerNames]) {
    masked = masked.replaceAll(name, '');
  }
  return [...new Set(masked.match(/\b[A-Z][a-z]+ [A-Z][a-z]+\b/g) || [])];
}

describe('weekly recap AI prompt chain', () => {
  test('formats scoreboard facts without Markdown or hallucinated player names', async () => {
    const facts = buildRecapFacts(weeklyScoreboard.week, weeklyScoreboard.matchups, {
      waiverSteal: weeklyScoreboard.waiverSteal,
    });
    const generatedNarrative =
      'Night Owls own the week: they posted a league-best 142.5 points. ' +
      'They blasted Goal Line Goons 142.5-83.1 for the biggest blowout. ' +
      'Waiver steal Jalen McMillan scored 24.4 off the wire, dusting starter Darnell Mooney\'s 8.2. What a finish!';
    const client = {
      messages: {
        create: jest.fn().mockResolvedValue({
          content: [{ type: 'text', text: generatedNarrative }],
        }),
      },
    };

    const narrative = await llmNarrative(facts, { client });
    const prompt = client.messages.create.mock.calls[0][0].messages[0].content;

    expect(facts.highestScorer).toEqual({ team: 'Night Owls', points: 142.5 });
    expect(facts.biggestBlowout).toMatchObject({
      home: 'Night Owls', away: 'Goal Line Goons', margin: 59.4,
    });
    expect(prompt).toContain('Jalen McMillan');
    expect(prompt).toContain('Darnell Mooney');
    expect(narrative).toContain('Night Owls');
    expect(narrative).toContain('142.5');
    expect(narrative).toContain('Goal Line Goons');
    expect(narrative).toContain('Jalen McMillan');
    expect(narrative).toContain('Darnell Mooney');

    expect(narrative).not.toMatch(/(^|\s)(#{1,6}\s|[-*+]\s|\d+\.\s|```|\[[^\]]+\]\([^)]*\)|[*_`])/m);
    expect(playerNamesOutsideScoreboard(
      narrative,
      weeklyScoreboard.matchups.flatMap((matchup) => [matchup.home_team_name, matchup.away_team_name]),
      [weeklyScoreboard.waiverSteal.player, weeklyScoreboard.waiverSteal.outscoredStarter.player]
    )).toEqual([]);
    expect(narrative).toMatch(/scoreboard|blowout|waiver|wire|league|finish/i);
    expect(narrative).toMatch(/!/);
  });
});
