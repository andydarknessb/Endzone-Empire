const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildRecapFacts, pickWaiverSteal, templateNarrative, lineupTrophyFacts, calledShotFacts,
} = require('../services/recap.service');
const { rulesForLeague } = require('../services/scoringRules');
const { createFakePool } = require('./helpers/fakePool');

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

test('#739 pickWaiverSteal names the league-priced winner, not the column order', () => {
  // Full PPR. Under the stored half-PPR column A (20) outranks B (12), so the
  // old SQL ORDER BY on the column would have named A. Under the league's own
  // rules B's eighteen catches make him worth 21, and the pick is B.
  const rules = rulesForLeague({ scoring_rules: { receiving: { reception: 1 } } });
  const steal = pickWaiverSteal([
    { player: 'A', team: 'X', stats: { rushingYards: 200 } }, // 20 under either rule
    { player: 'B', team: 'Y', stats: { rushingYards: 30, receptions: 18 } }, // default 12, full PPR 21
  ], rules);
  assert.deepEqual(steal, { player: 'B', team: 'Y', points: 21 });
});

test('#739 pickWaiverSteal yields no steal when the best pickup prices to zero or below', () => {
  const rules = rulesForLeague({ scoring_rules: null });
  const steal = pickWaiverSteal([
    { player: 'A', team: 'X', stats: { fumbles: 1 } }, // -2 (a lost fumble)
    { player: 'B', team: 'Y', stats: {} }, // 0
  ], rules);
  assert.equal(steal, null);
});

test('#739 pickWaiverSteal returns null for an empty candidate pool', () => {
  assert.equal(pickWaiverSteal([], rulesForLeague({ scoring_rules: null })), null);
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

// ---- #1854: Perfect Lineup and Captain Hindsight in the Recap --------------

test('#1854 templateNarrative narrates a perfect lineup, one line per team', () => {
  const narrative = templateNarrative({
    week: 4,
    perfectLineups: [{ team: 'Gridiron Geeks' }, { team: 'Sunday Scaries' }],
  });
  assert.match(narrative, /Gridiron Geeks set a perfect lineup\./);
  assert.match(narrative, /Sunday Scaries set a perfect lineup\./);
});

test('#1854 templateNarrative narrates Captain Hindsight for a swap over a starter', () => {
  const narrative = templateNarrative({
    week: 4,
    captainHindsight: [{ team: 'Team B', margin: 4.5, bench: 'Ben Bench', starter: 'Flex Guy', slot: 'FLEX' }],
  });
  assert.match(
    narrative,
    /Captain Hindsight: Team B lost by 4\.5; starting Ben Bench over Flex Guy at FLEX would have won it\./
  );
});

test('#1854 templateNarrative narrates Captain Hindsight for an empty slot fill', () => {
  const narrative = templateNarrative({
    week: 4,
    captainHindsight: [{ team: 'Team B', margin: 10, bench: 'Tina TE', starter: null, slot: 'TE' }],
  });
  assert.match(narrative, /Captain Hindsight: Team B lost by 10; filling TE with Tina TE would have won it\./);
});

test('#1854 templateNarrative words a tied Matchup as a tie, not "lost by 0"', () => {
  const narrative = templateNarrative({
    week: 4,
    captainHindsight: [{ team: 'Team B', margin: 0, bench: 'Ben Bench', starter: 'Flex Guy', slot: 'FLEX' }],
  });
  assert.match(narrative, /Captain Hindsight: Team B tied; starting Ben Bench over Flex Guy at FLEX would have won it\./);
  assert.equal(narrative.includes('lost by 0'), false);
});

test('#1854 templateNarrative leaves the bench blunder line as it was', () => {
  const narrative = templateNarrative({
    week: 4,
    benchBlunder: { team: 'E', pointsLeftOnBench: 25.5 },
    perfectLineups: [{ team: 'P' }],
  });
  assert.match(narrative, /Bench blunder of the week: E left 25\.5 points sitting on the bench\./);
});

test('#1854 lineupTrophyFacts reads trophy rows into recap facts, never recomputing', () => {
  const facts = lineupTrophyFacts([
    { type: 'perfect_lineup', team_name: 'Team A', data: { points: 98 } },
    {
      type: 'captain_hindsight', team_name: 'Team B',
      data: {
        benchPlayer: 'Ben Bench', starter: 'Flex Guy', slot: 'FLEX', margin: 12, gain: 25,
        benchPlayerId: 21, starterPlayerId: 7, benchPoints: 30, starterPoints: 5,
      },
    },
    { type: 'top_scorer', team_name: 'Team A', data: { points: 98 } },
  ]);
  assert.deepEqual(facts, {
    perfectLineups: [{ team: 'Team A' }],
    captainHindsight: [{ team: 'Team B', margin: 12, bench: 'Ben Bench', starter: 'Flex Guy', slot: 'FLEX' }],
  });
  assert.deepEqual(lineupTrophyFacts([]), {}, 'a week with neither adds no fact keys');
});

test('#1854 computeAndStoreWeeklyRecap reads the trophy rows just written into its facts and narrative', async (t) => {
  const fake = recapWorld({
    handlers: [[
      /^SELECT "trophies"\."type"/,
      (text, params) => {
        assert.deepEqual(params, [7, 2026, 5]);
        return {
          rows: [
            { type: 'perfect_lineup', team_name: 'Team A', data: { points: 98 } },
            {
              type: 'captain_hindsight', team_name: 'Team B',
              data: { benchPlayer: 'Ben Bench', starter: 'Flex Guy', slot: 'FLEX', margin: 20 },
            },
          ],
        };
      },
    ]],
  });
  fake.install(t);
  // The Recap never recomputes a lineup trophy: Hindsight's roster read is
  // poisoned, so any recomputation would show up as a thrown error here.
  t.mock.method(require('../services/decision.service'), 'weekHindsightRoster', async () => {
    throw new Error('the recap must not recompute lineup trophies');
  });
  const { computeAndStoreWeeklyRecap } = require('../services/recap.service');

  const data = await computeAndStoreWeeklyRecap({ leagueId: 7, season: 2026, week: 5 });

  assert.deepEqual(data.facts.perfectLineups, [{ team: 'Team A' }]);
  assert.equal(data.facts.captainHindsight[0].team, 'Team B');
  assert.match(data.narrative, /Team A set a perfect lineup\./);
  assert.match(data.narrative, /Captain Hindsight: Team B lost by 20; starting Ben Bench over Flex Guy at FLEX would have won it\./);
});

// ---- #1860: Called shots in the Recap --------------------------------------

const HIT = { outcome: 'hit', team_name: 'Team A', starter_name: 'Sam Starter', benched_name: 'Ben Bench', starter_points_actual: '11.4', benched_points_actual: '6.2', probability: '0.65' };
const MISS = { ...HIT, outcome: 'miss', team_name: 'Team B', starter_points_actual: '5', benched_points_actual: '9.5' };

test('#1860 templateNarrative narrates a hit and a miss, noting a bold call', () => {
  const narrative = templateNarrative({
    week: 4,
    calledShots: [
      { team: 'Team A', starter: 'Sam Starter', benched: 'Ben Bench', starterPoints: 11.4, benchedPoints: 6.2, outcome: 'hit', bold: false },
      { team: 'Team B', starter: 'Sue Starter', benched: 'Bea Bench', starterPoints: 5, benchedPoints: 9.5, outcome: 'miss', bold: true },
      { team: 'Team C', starter: 'Cy Starter', benched: 'Cat Bench', starterPoints: 20, benchedPoints: 8, outcome: 'hit', bold: true },
    ],
  });
  assert.match(narrative, /Team A called it: Sam Starter over Ben Bench, 11\.4 to 6\.2\./);
  assert.match(narrative, /Team B called Sue Starter over Bea Bench and missed, 5 to 9\.5\. A bold call\./);
  assert.match(narrative, /Team C called it: Cy Starter over Cat Bench, 20 to 8\. A bold call\./);
  assert.equal(narrative.match(/bold call/g).length, 2, 'only the bold ones are noted');
});

test('#1860 calledShotFacts reads resolved rows; a void adds nothing; no rows adds no key', () => {
  assert.deepEqual(calledShotFacts([HIT, MISS, { ...HIT, outcome: 'void' }]), {
    calledShots: [
      { team: 'Team A', starter: 'Sam Starter', benched: 'Ben Bench', starterPoints: 11.4, benchedPoints: 6.2, outcome: 'hit', bold: false },
      { team: 'Team B', starter: 'Sam Starter', benched: 'Ben Bench', starterPoints: 5, benchedPoints: 9.5, outcome: 'miss', bold: false },
    ],
  });
  assert.deepEqual(calledShotFacts([{ ...HIT, probability: '0.8' }]).calledShots[0].bold, true, '0.8 is bold');
  assert.deepEqual(calledShotFacts([]), {});
});

test('#1860 computeAndStoreWeeklyRecap reads the week\'s resolved called rows and never recomputes them', async (t) => {
  const fake = recapWorld({
    handlers: [[
      /^SELECT "teams"\."name" AS "team_name".* FROM "lineup_overrides"/,
      (text, params) => {
        assert.deepEqual(params, [7, 2026, 5], 'only the advanced week: a catch-up row of an earlier week gets no line');
        assert.match(text, /"called"/);
        assert.match(text, /"outcome" IN \('hit', 'miss'\)/);
        return { rows: [HIT] };
      },
    ]],
  });
  fake.install(t);
  const { computeAndStoreWeeklyRecap } = require('../services/recap.service');

  const data = await computeAndStoreWeeklyRecap({ leagueId: 7, season: 2026, week: 5 });

  assert.equal(data.facts.calledShots.length, 1);
  assert.match(data.narrative, /Team A called it: Sam Starter over Ben Bench, 11\.4 to 6\.2\./);
});

test('templateNarrative always produces something', () => {
  assert.equal(templateNarrative({ week: 9, matchupCount: 0 }), 'Week 9 is in the books.');
});

// ---- #1409: compute/announce split -----------------------------------------
//
// generateWeeklyRecap used to compute, store AND announce a recap in one
// step. The correction path (#1409) needs to rebuild a stored recap's facts
// without a second announcement, so the store and the announce are now
// separately callable. These tests pin that split at the DB-call level: a
// fake pool with handlers for every query the (mocked-free) path touches, so
// an unexpected extra INSERT is exactly as visible as a missing one.

/** A minimal one-matchup, two-team world for the store/announce split tests. */
function recapWorld({ homeScore = 100, awayScore = 80, handlers = [] } = {}) {
  return createFakePool([
    ...handlers,
    [/FROM "lineup_overrides"/, () => ({ rows: [] })],
    [/^SELECT "matchups"\.\*/, () => ({
      rows: [{
        id: 1, final: true, home_team_id: 1, away_team_id: 2,
        home_team_name: 'Team A', away_team_name: 'Team B',
        home_score: homeScore, away_score: awayScore,
      }],
    })],
    [/^SELECT \* FROM "leagues" WHERE "id" = \$1/, () => ({ rows: [{ id: 7, scoring_rules: null }] })],
    [/^INSERT INTO "league_analytics"/, () => ({ rows: [] })],
    [/^SELECT DISTINCT "owner_id" FROM "teams"/, () => ({ rows: [{ owner_id: 101 }, { owner_id: 102 }] })],
    [/^INSERT INTO "transactions"/, () => ({ rows: [] })],
    [/^INSERT INTO "notifications"/, () => ({ rows: [] })],
  ]);
}

test('#1409: computeAndStoreWeeklyRecap stores the recap without announcing it', async (t) => {
  const fake = recapWorld();
  fake.install(t);
  const { computeAndStoreWeeklyRecap } = require('../services/recap.service');

  const data = await computeAndStoreWeeklyRecap({ leagueId: 7, season: 2026, week: 5 });

  assert.equal(data.facts.highestScorer.team, 'Team A');
  assert.equal(fake.matching(/INSERT INTO "league_analytics"/).length, 1);
  assert.equal(fake.matching(/INSERT INTO "transactions"/).length, 0, 'no feed entry');
  assert.equal(fake.matching(/INSERT INTO "notifications"/).length, 0, 'no member notification');
  fake.assertClean();
});

test('#1409: computeAndStoreWeeklyRecap no-ops on a week with no finalized matchups', async (t) => {
  const fake = createFakePool([
    [/^SELECT "matchups"\.\*/, () => ({ rows: [] })],
  ]);
  fake.install(t);
  const { computeAndStoreWeeklyRecap } = require('../services/recap.service');

  const data = await computeAndStoreWeeklyRecap({ leagueId: 7, season: 2026, week: 5 });

  assert.equal(data, null);
  assert.equal(fake.calls.length, 1, 'nothing beyond the initial matchups read is queried');
});

test('#1409: announceWeeklyRecap posts the feed entry and member notifications, never a recap row', async (t) => {
  const fake = recapWorld();
  fake.install(t);
  const { announceWeeklyRecap } = require('../services/recap.service');

  await announceWeeklyRecap({ leagueId: 7, season: 2026, week: 5, narrative: 'Team A went off.' });

  assert.equal(fake.matching(/INSERT INTO "league_analytics"/).length, 0);
  assert.equal(fake.matching(/INSERT INTO "transactions"/).length, 1);
  assert.equal(fake.matching(/INSERT INTO "notifications"/).length, 2, 'one per team owner');
  fake.assertClean();
});

test('#1409: generateWeeklyRecap still does both, store then announce, for the advance-week path', async (t) => {
  const fake = recapWorld();
  fake.install(t);
  const { generateWeeklyRecap } = require('../services/recap.service');

  const data = await generateWeeklyRecap({ leagueId: 7, season: 2026, week: 5 });

  assert.ok(data);
  assert.equal(fake.matching(/INSERT INTO "league_analytics"/).length, 1);
  assert.equal(fake.matching(/INSERT INTO "transactions"/).length, 1);
  assert.equal(fake.matching(/INSERT INTO "notifications"/).length, 2);
  const storeIdx = fake.calls.findIndex((c) => /INSERT INTO "league_analytics"/.test(c.text));
  const announceIdx = fake.calls.findIndex((c) => /INSERT INTO "transactions"/.test(c.text));
  assert.ok(storeIdx >= 0 && announceIdx >= 0 && storeIdx < announceIdx, 'stores before it announces');
  fake.assertClean();
});

// ---- #1861: the Bench blunder line reads the stored points-left row ---------

test('#1861 the Bench blunder reads the week\'s stored points-left row and never Hindsight', async (t) => {
  const fake = recapWorld({
    handlers: [[
      /^SELECT "data" FROM "league_analytics"/,
      (text, params) => {
        assert.deepEqual(params, [7, 2026, 5, 'points_left']);
        return { rows: [{ data: { teams: [{ teamId: 1, pointsLeft: 4 }, { teamId: 2, pointsLeft: 12.5 }] } }] };
      },
    ]],
  });
  fake.install(t);
  t.mock.method(require('../services/decision.service'), 'weekHindsight', async () => {
    throw new Error('a stored week must not be re-read live');
  });
  const { computeAndStoreWeeklyRecap } = require('../services/recap.service');

  const data = await computeAndStoreWeeklyRecap({ leagueId: 7, season: 2026, week: 5 });

  assert.deepEqual(data.facts.benchBlunder, { team: 'Team B', pointsLeftOnBench: 12.5 });
});

test('#1861 a week with no stored row still reads Hindsight live', async (t) => {
  const fake = recapWorld({ handlers: [[/^SELECT "data" FROM "league_analytics"/, () => ({ rows: [] })]] });
  fake.install(t);
  t.mock.method(require('../services/decision.service'), 'weekHindsight', async ({ teamId }) => ({
    pointsLeftOnBench: teamId === 1 ? 9 : 2,
  }));
  const { computeAndStoreWeeklyRecap } = require('../services/recap.service');

  const data = await computeAndStoreWeeklyRecap({ leagueId: 7, season: 2026, week: 5 });

  assert.deepEqual(data.facts.benchBlunder, { team: 'Team A', pointsLeftOnBench: 9 });
});

test('ADR 0063: the prompt carries [[team:N]] tokens, never a team name; the LLM text is stored after the template', async (t) => {
  const fake = recapWorld();
  fake.install(t);
  const claude = require('../services/claude');
  let sent;
  t.mock.method(claude, 'narrative', async (req) => {
    sent = req;
    return req.user.includes('[[team:1]]') ? 'Team A won.' : null;
  });
  const { computeAndStoreWeeklyRecap } = require('../services/recap.service');

  const data = await computeAndStoreWeeklyRecap({ leagueId: 7, season: 2026, week: 5 });

  assert.doesNotMatch(sent.user, /Team A|Team B/);
  assert.match(sent.user, /\[\[team:1\]\]/);
  assert.match(sent.system, /\[\[team:N\]\]/);
  assert.deepEqual(sent.placeholders, { '[[team:1]]': 'Team A', '[[team:2]]': 'Team B' });
  assert.equal(data.facts.highestScorer.team, 'Team A', 'stored facts keep the real names');
  const inserts = fake.matching(/INSERT INTO "league_analytics"/);
  assert.equal(inserts.length, 2, 'template row first, then the LLM text');
  assert.match(JSON.parse(inserts[0].params[3]).narrative, /Team A lit up the scoreboard/);
  assert.equal(JSON.parse(inserts[1].params[3]).narrative, 'Team A won.');
});

// ---- Voice (ADR 0069) ----------------------------------------------------------

const RECAP_BASE =
  'You write short, punchy fantasy football weekly recaps for a league of friends. ' +
  'Two paragraphs max. Fun trash-talk energy, never mean-spirited. Use ONLY the facts ' +
  'provided. Never invent players, scores, or events. Plain text, no headings, no em dashes. ' +
  'Team names appear as [[team:N]] tokens; copy each token exactly where the team is named.';

const voicedWorld = (voice) => recapWorld({
  handlers: [[/^SELECT \* FROM "leagues" WHERE "id" = \$1/, () => ({ rows: [{ id: 7, scoring_rules: null, narrative_voice: voice }] })]],
});

async function recapWith(t, voice, reply) {
  voicedWorld(voice).install(t);
  const claude = require('../services/claude');
  let sent;
  t.mock.method(claude, 'narrative', async (req) => { sent = req; return reply; });
  const { computeAndStoreWeeklyRecap } = require('../services/recap.service');
  const data = await computeAndStoreWeeklyRecap({ leagueId: 7, season: 2026, week: 5 });
  return { sent, data };
}

test('a league with no Voice sends the Recap system prompt it always has', async (t) => {
  const { sent } = await recapWith(t, null, 'Team A won.');
  assert.equal(sent.system, RECAP_BASE);
});

test('a Voice league heads the Recap system prompt with the Voice block and drops the trash-talk line', async (t) => {
  const { VOICE_BLOCK } = require('../services/voices/polkHighLegend');
  const { sent } = await recapWith(t, 'polk_high_legend', 'Team A won.');
  assert.equal(sent.system, `${VOICE_BLOCK}\n\n${RECAP_BASE.replace('Fun trash-talk energy, never mean-spirited. ', '')}`);
  assert.doesNotMatch(sent.system, /Fun trash-talk energy/);
  assert.match(sent.system, /Use ONLY the facts/);
});

test('a Voice Recap rewrite naming any deny-list term is discarded and the template stays stored', async (t) => {
  const { DENY } = require('../services/voices/polkHighLegend');
  for (const term of DENY) {
    const { data } = await recapWith(t, 'polk_high_legend', `Team A won, says ${term}.`);
    assert.match(data.narrative, /Team A lit up the scoreboard/, `${term} discarded`);
  }
});

test('a discarded Voice Recap rewrite is logged once with the league, feature and term', async (t) => {
  const { logger } = require('../modules/logger');
  const claude = require('../services/claude');
  const { llmNarrative } = require('../services/recap.service');
  const warn = t.mock.method(logger, 'warn', () => {});
  t.mock.method(claude, 'narrative', async () => 'Team A won, says Bundy.');
  assert.equal(await llmNarrative({ week: 5 }, { voice: 'polk_high_legend', placeholders: {}, leagueId: 7 }), null);
  assert.equal(warn.mock.callCount(), 1);
  assert.deepEqual(warn.mock.calls[0].arguments, [{ leagueId: 7, feature: 'recap', term: 'Bundy' }, 'voice rewrite discarded']);
});

test('a deny-list term the facts or a Team name carry does not discard a Voice Recap rewrite', async (t) => {
  const { DENY } = require('../services/voices/polkHighLegend');
  const claude = require('../services/claude');
  const { llmNarrative } = require('../services/recap.service');
  const term = DENY[0];
  const reply = `[[team:1]] won behind ${term} Allen.`;
  t.mock.method(claude, 'narrative', async () => reply);
  const voice = 'polk_high_legend';

  const viaFacts = await llmNarrative({ week: 5, highestScorer: { player: `${term} Allen` } }, { voice, placeholders: {} });
  assert.equal(viaFacts, reply);
  const viaTeam = await llmNarrative({ week: 5 }, { voice, placeholders: { '[[team:1]]': `${term} Allen` } });
  assert.equal(viaTeam, reply);
  assert.equal(await llmNarrative({ week: 5 }, { voice, placeholders: {} }), null, 'neither carries it: discarded');
  assert.equal(await llmNarrative({ week: 5 }, { voice: null, placeholders: {} }), reply, 'a neutral league has no deny check');
});
