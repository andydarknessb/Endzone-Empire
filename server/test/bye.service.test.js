const test = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../modules/pool');
const { byeWeekFromPlayedWeeks, computeByeWeeks, REG_SEASON_WEEKS } = require('../services/bye.service');

const fullSeason = () => new Set(Array.from({ length: REG_SEASON_WEEKS }, (_, i) => i + 1));

test('byeWeekFromPlayedWeeks returns the sole missing regular-season week', () => {
  const weeks = fullSeason();
  weeks.delete(6);
  assert.equal(byeWeekFromPlayedWeeks(weeks), 6);
});

test('byeWeekFromPlayedWeeks accepts an iterable and coerces week numbers', () => {
  const weeks = [...fullSeason()];
  weeks.splice(5, 1);
  assert.equal(byeWeekFromPlayedWeeks(weeks.map((week, index) => (index % 2 ? String(week) : week))), 6);
});

test('byeWeekFromPlayedWeeks returns null when an incomplete schedule has a non-bye gap', () => {
  const weeks = fullSeason();
  weeks.delete(6); // actual bye
  weeks.delete(10); // missing nfl_games row for a game week
  assert.equal(byeWeekFromPlayedWeeks(weeks), null);
});

test('byeWeekFromPlayedWeeks returns null when the schedule is unknown (no games)', () => {
  assert.equal(byeWeekFromPlayedWeeks(new Set()), null);
  assert.equal(byeWeekFromPlayedWeeks([]), null);
  assert.equal(byeWeekFromPlayedWeeks(null), null);
  assert.equal(byeWeekFromPlayedWeeks(undefined), null);
});

test('byeWeekFromPlayedWeeks returns null when every week is played (no bye)', () => {
  assert.equal(byeWeekFromPlayedWeeks(fullSeason()), null);
});

test('computeByeWeeks joins through fn_normalize_nfl_team and keys results by caller vocabulary', async (t) => {
  let captured = null;
  t.mock.method(pool, 'query', async (sql, params) => {
    captured = { sql: String(sql), params };
    // The query selects "t"."nfl_team" — the CALLER's own string — so a DEF
    // unit's full team name and a skill player's Tank01 code both resolve
    // against the same WSH-keyed schedule rows.
    const rows = [];
    for (let week = 1; week <= REG_SEASON_WEEKS; week++) {
      if (week === 9) continue;
      rows.push({ nfl_team: 'Washington Commanders', week });
      rows.push({ nfl_team: 'WSH', week });
    }
    return { rows };
  });

  const byes = await computeByeWeeks(['Washington Commanders', 'WSH'], 2026);

  assert.match(
    captured.sql,
    /fn_normalize_nfl_team\("ng"\."nfl_team"\) = fn_normalize_nfl_team\("t"\."nfl_team"\)/
  );
  assert.match(captured.sql, /unnest\(\$2::text\[\]\)/);
  assert.deepEqual(captured.params, [2026, ['Washington Commanders', 'WSH'], REG_SEASON_WEEKS]);
  assert.equal(byes.get('Washington Commanders'), 9);
  assert.equal(byes.get('WSH'), 9);
});

test('computeByeWeeks with no usable teams returns an empty map without querying', async (t) => {
  const spy = t.mock.method(pool, 'query', async () => {
    throw new Error('must not query');
  });
  const byes = await computeByeWeeks([null, '', undefined], 2026);
  assert.equal(byes.size, 0);
  assert.equal(spy.mock.callCount(), 0);
});
