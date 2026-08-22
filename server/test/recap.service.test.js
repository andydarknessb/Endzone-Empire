const test = require('node:test');
const assert = require('node:assert/strict');
const { buildRecapFacts, templateNarrative } = require('../services/recap.service');

const matchup = (home, away, hs, as, final = true) => ({
  home_team_name: home,
  away_team_name: away,
  home_score: hs,
  away_score: as,
  final,
});

test('buildRecapFacts finds the highest scorer across both sides', () => {
  const facts = buildRecapFacts(3, [
    matchup('A', 'B', 101.5, 88),
    matchup('C', 'D', 95, 140.25),
  ]);
  assert.deepEqual(facts.highestScorer, { team: 'D', points: 140.25 });
});

test('buildRecapFacts identifies closest matchup and biggest blowout', () => {
  const facts = buildRecapFacts(3, [
    matchup('A', 'B', 100, 98),   // margin 2
    matchup('C', 'D', 130, 80),   // margin 50
    matchup('E', 'F', 110, 95),   // margin 15
  ]);
  assert.equal(facts.closestMatchup.margin, 2);
  assert.equal(facts.closestMatchup.home, 'A');
  assert.equal(facts.biggestBlowout.margin, 50);
  assert.equal(facts.biggestBlowout.home, 'C');
});

test('buildRecapFacts ignores non-final matchups and handles an empty week', () => {
  const facts = buildRecapFacts(1, [matchup('A', 'B', 10, 5, false)]);
  assert.equal(facts.matchupCount, 0);
  assert.equal(facts.highestScorer, undefined);
});

test('buildRecapFacts passes extras through', () => {
  const facts = buildRecapFacts(2, [matchup('A', 'B', 100, 90)], {
    waiverSteal: { player: 'P', team: 'A', points: 22 },
  });
  assert.deepEqual(facts.waiverSteal, { player: 'P', team: 'A', points: 22 });
});

test('templateNarrative mentions the headline facts', () => {
  const narrative = templateNarrative({
    week: 4,
    highestScorer: { team: 'Gridiron Geeks', points: 145.2 },
    closestMatchup: { home: 'A', away: 'B', homeScore: 100, awayScore: 99, margin: 1 },
    biggestBlowout: { home: 'C', away: 'D', homeScore: 150, awayScore: 80, margin: 70 },
    benchBlunder: { team: 'E', pointsLeftOnBench: 25.5 },
    waiverSteal: { player: 'Puka Nacua', team: 'F', points: 31 },
    playoffOdds: [{ name: 'Gridiron Geeks', playoffOdds: 0.92 }],
  });
  assert.match(narrative, /Gridiron Geeks .* 145\.2/);
  assert.match(narrative, /A edged B by just 1/);
  assert.match(narrative, /C steamrolled D by 70/);
  assert.match(narrative, /E left\s*25\.5 points/);
  assert.match(narrative, /Puka Nacua/);
  assert.match(narrative, /92% odds/);
});

test('templateNarrative skips a close-game line when nothing was close', () => {
  const narrative = templateNarrative({
    week: 4,
    highestScorer: { team: 'A', points: 120 },
    closestMatchup: { home: 'A', away: 'B', homeScore: 120, awayScore: 90, margin: 30 },
    biggestBlowout: { home: 'A', away: 'B', homeScore: 120, awayScore: 90, margin: 30 },
  });
  assert.equal(narrative.includes('edged'), false);
  assert.equal(narrative.includes('steamrolled'), false);
});

test('templateNarrative always produces something', () => {
  assert.equal(templateNarrative({ week: 9, matchupCount: 0 }), 'Week 9 is in the books.');
});
