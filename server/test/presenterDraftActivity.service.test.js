const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createFakePool } = require('./helpers/fakePool');
const { listPresenterDraftActivity, PRESENTER_ACTIVITY_KINDS } = require('../services/leagueFeed');

/**
 * listPresenterDraftActivity - the PRESENTER-safe Draft-activity reader (#438).
 *
 * This is the privacy boundary expressed as a QUERY: unlike listCombinedDraftFeed
 * it has no chat arm, no viewerId and no block predicate, so League chat, the
 * unread relation, commissioner moderation (`hidden_at`) and per-viewer blocking
 * (`user_blocks`) are absent by CONSTRUCTION. These tests pin that the SQL reads
 * `draft_activity` and NOTHING else, that the commissioner's correction `reason`
 * free-text is never projected, and that each row shapes to the same Team-only
 * entry a member reads (leagueFeed.activityEntryOf).
 */

const pickRow = (over = {}) => ({
  id: 3,
  feed_seq: '8',
  created_at: '2026-09-01T00:01:00.000Z',
  kind: 'pick',
  teamId: 11,
  teamName: 'Gridiron Ghosts',
  player_id: 500,
  player_name: 'Pick Me',
  player_position: 'RB',
  player_nfl_team: 'KC',
  round: 1,
  pick_number: 1,
  is_autopick: false,
  is_legacy: false,
  ...over,
});

const lifecycleRow = (over = {}) => ({
  id: 4,
  feed_seq: '9',
  created_at: '2026-09-01T00:02:00.000Z',
  kind: 'pause',
  teamId: 11,
  teamName: 'Gridiron Ghosts',
  player_id: null,
  player_name: null,
  player_position: null,
  player_nfl_team: null,
  round: null,
  pick_number: null,
  is_autopick: null,
  is_legacy: false,
  ...over,
});

function activityPool(rows) {
  return createFakePool([
    [/FROM "draft_activity"/, () => ({ rows })],
  ]);
}

test('reads draft_activity ONLY - never chat_messages, user_blocks or a viewer', async () => {
  const fake = activityPool([pickRow()]);
  await listPresenterDraftActivity(fake, { leagueId: 12 });

  const query = fake.calls.find((c) => /"draft_activity"/.test(c.text));
  assert.ok(query, 'the reader queried draft_activity');
  assert.ok(!/"chat_messages"/.test(query.text), 'never joins or reads chat_messages');
  assert.ok(!/"user_blocks"/.test(query.text), 'never consults the block relation');
  assert.ok(!/"chat_reads"/.test(query.text), 'never consults the unread marker');
  // Scoped to the league behind the presenter token, and by that alone.
  assert.ok(/"draft_activity"\."league_id" = \$1/.test(query.text));
  assert.equal(query.params[0], 12);
});

test('the presenter kinds are a positive ALLOWLIST that excludes the cutover boundary', async () => {
  // AC3 is "approved public Pick and lifecycle facts": the SQL restricts kind
  // to an allowlist bound as $2, and the allowlist is the approved set - a Pick,
  // the lifecycle transitions and a correction - and NOT the internal cutover
  // marker (#436) nor any future kind added upstream. STALLED (#602) is a public
  // lifecycle transition like pause/resume (the draft the room showed up for is
  // waiting on a named team), so it belongs on this anonymous board too.
  const fake = activityPool([pickRow()]);
  await listPresenterDraftActivity(fake, { leagueId: 12 });

  const query = fake.calls.find((c) => /"draft_activity"/.test(c.text));
  assert.match(query.text, /"draft_activity"\."kind" = ANY\(\$2\)/);
  assert.deepEqual(
    [...PRESENTER_ACTIVITY_KINDS].sort(),
    ['complete', 'correction', 'draft_start', 'pause', 'pick', 'reset', 'resume', 'stalled'],
    'the approved presenter kinds are exactly these eight'
  );
  assert.ok(!PRESENTER_ACTIVITY_KINDS.includes('cutover'), 'the cutover boundary is never a presenter kind');
  assert.deepEqual(query.params[1], PRESENTER_ACTIVITY_KINDS, 'the allowlist rides as the $2 bound param');
});

test('the PRESENTER_ACTIVITY_KINDS initialiser is spelled out LITERALLY, never a spread (#633)', () => {
  // The list's whole privacy value is that every approved kind is enumerated
  // literally (#619): a re-spread of `[PICK, ...LIFECYCLE_KINDS, CORRECTION]`
  // yields a byte-identical array, so every value-comparing assertion above
  // (deepEqual, includes, the sorted copy) stays green if the literal is silently
  // restored to a spread. This is the ONE assertion that reads the SOURCE FORM,
  // which is the whole protection #619 established and which nothing else audits.
  //
  // Resolve the module by the SAME specifier this file already requires, so a
  // file move tracks automatically and this never carries a second hardcoded path.
  const source = fs.readFileSync(require.resolve('../services/leagueFeed'), 'utf8');

  // Extract ONLY the initialiser expression, from its `Object.freeze([` to the
  // matching `])`. The regex is LINE-ANCHORED (`^ ... /m`): a doc-comment line
  // begins with a space-star and never with `const`, so anchoring to
  // start-of-line is what STRUCTURALLY keeps the extraction off the doc comment
  // above the array - which names `...LIFECYCLE_KINDS` and, when someone explains
  // the rule, writes out the whole `const ... = Object.freeze([ ... ])`
  // declaration to show it (ADR 0010: documenting a pattern means writing an
  // example of it). Without the anchor, String.match returns the FIRST match
  // anywhere in the file, so a future comment quoting the declaration would be
  // extracted instead of the real array and the guard would pass on the comment's
  // literal example while the real array spread - the exact hole this guards.
  const DECLARATION = /^const PRESENTER_ACTIVITY_KINDS = Object\.freeze\(\[([\s\S]*?)\]\)/m;

  // Collect every match ONCE, then assert in the order that keeps both failure
  // messages reachable. matchAll needs the global flag, so rebuild DECLARATION
  // with `gm` (new RegExp(re, flags) reuses the source and applies these flags).
  const all = [...source.matchAll(new RegExp(DECLARATION, 'gm'))];

  // FOUND before anything about contents (the anti-orphan half). Zero matches is
  // indistinguishable from a match that found no spread, so a rename or move must
  // turn this guard RED here rather than leave it vacuously green. This is the
  // message a future maintainer sees when a refactor orphans the guard.
  assert.ok(
    all.length >= 1,
    'could not locate `const PRESENTER_ACTIVITY_KINDS = Object.freeze([ ... ])` in ' +
      'leagueFeed.js; if the declaration was renamed or moved, update this guard ' +
      'rather than let it match nothing'
  );

  // UNIQUE: the anti-orphan assertion above catches zero; the case it cannot see
  // is TWO or more. NOT a second real declaration - two top-level `const` of the
  // same name is a SyntaxError the module never survives, so it can never reach
  // this assertion. What it catches is declaration-shaped TEXT at column 0
  // elsewhere in the file - a copy inside a template literal or a generated-code
  // string - which the line-anchored regex cannot distinguish from the real
  // declaration, so reading only the first match would silently audit the wrong
  // one. Same reasoning as the anti-orphan half applied to the other end: the
  // guard must know it is reading THE array, not one of several.
  assert.equal(
    all.length,
    1,
    `expected exactly one \`const PRESENTER_ACTIVITY_KINDS = Object.freeze([ ... ])\` ` +
      `declaration in leagueFeed.js, found ${all.length}; a source-form guard must ` +
      `read THE array, not one of several`
  );

  // The sole match's captured initialiser must contain no spread token: a new
  // lifecycle kind must never reach the anonymous presenter board without a
  // deliberate edit to this array (#619).
  const initialiser = all[0];
  assert.ok(
    !initialiser[1].includes('...'),
    'PRESENTER_ACTIVITY_KINDS must enumerate its kinds LITERALLY and never spread ' +
      'LIFECYCLE_KINDS (#619): a re-spread lets a future lifecycle kind reach the ' +
      'anonymous presenter board with no reviewed edit to this array'
  );
});

test('never projects the commissioner correction reason (un-vetted free-text)', async () => {
  const fake = activityPool([pickRow()]);
  await listPresenterDraftActivity(fake, { leagueId: 12 });

  const query = fake.calls.find((c) => /"draft_activity"/.test(c.text));
  assert.ok(!/reason/i.test(query.text), 'the presenter SELECT omits the reason column entirely');
});

test('a correction entry reads back with no reason, so no free-text can leak', async () => {
  // The real query omits `reason`, so the row activityEntryOf shapes never
  // carries it; a correction is a Pick-shaped snapshot with reason null.
  const fake = activityPool([
    pickRow({ id: 7, feed_seq: '10', kind: 'correction' }),
  ]);
  const [entry] = await listPresenterDraftActivity(fake, { leagueId: 12 });
  assert.equal(entry.kind, 'correction');
  assert.ok(!('reason' in entry), 'the presenter entry carries no reason surface at all');
});

test('shapes each row as the same Team-only entry a member reads', async () => {
  const fake = activityPool([pickRow(), lifecycleRow()]);
  const entries = await listPresenterDraftActivity(fake, { leagueId: 12 });

  assert.deepEqual(entries[0], {
    type: 'draft_activity',
    kind: 'pick',
    id: 3,
    seq: 8,
    teamId: 11,
    teamName: 'Gridiron Ghosts',
    player: { id: 500, name: 'Pick Me', position: 'RB', nflTeam: 'KC' },
    round: 1,
    pickNumber: 1,
    isAutopick: false,
    isLegacy: false,
    created_at: '2026-09-01T00:01:00.000Z',
  });
  // A lifecycle event carries NO Pick fields (#437) - Team identity and the
  // instant only.
  assert.deepEqual(entries[1], {
    type: 'draft_activity',
    kind: 'pause',
    id: 4,
    seq: 9,
    teamId: 11,
    teamName: 'Gridiron Ghosts',
    isLegacy: false,
    created_at: '2026-09-01T00:02:00.000Z',
  });
});

test('the entry carries no account identifier anywhere', async () => {
  const fake = activityPool([pickRow(), lifecycleRow()]);
  const entries = await listPresenterDraftActivity(fake, { leagueId: 12 });
  const body = JSON.stringify(entries);
  for (const forbidden of ['user_id', 'owner_id', 'username', 'email', 'account']) {
    assert.ok(!new RegExp(forbidden).test(body), `${forbidden} is not exposed`);
  }
});

test('the default window takes the newest page descending, then flips to ascending display order', async () => {
  const fake = activityPool([pickRow()]);
  await listPresenterDraftActivity(fake, { leagueId: 12 });
  const query = fake.calls.find((c) => /"draft_activity"/.test(c.text));
  assert.match(query.text, /ORDER BY "draft_activity"\."feed_seq" DESC/);
  assert.match(query.text, /ORDER BY feed_seq ASC/);
  // Default page size cap rides as the last bound parameter.
  assert.equal(query.params[query.params.length - 1], 100);
});

test('?before=<seq> pages older: compares < and binds the cursor after the allowlist', async () => {
  const fake = activityPool([pickRow()]);
  await listPresenterDraftActivity(fake, { leagueId: 12, before: 8 });
  const query = fake.calls.find((c) => /"draft_activity"/.test(c.text));
  // $1 league, $2 allowlist, $3 cursor.
  assert.match(query.text, /"draft_activity"\."feed_seq" < \$3/);
  assert.ok(query.params.includes(8), 'the cursor rode into the params');
});

test('?after=<seq> resumes newer: compares > and reads ascending', async () => {
  const fake = activityPool([pickRow()]);
  await listPresenterDraftActivity(fake, { leagueId: 12, after: 8 });
  const query = fake.calls.find((c) => /"draft_activity"/.test(c.text));
  assert.match(query.text, /"draft_activity"\."feed_seq" > \$3/);
  assert.match(query.text, /ORDER BY "draft_activity"\."feed_seq" ASC/);
  assert.ok(query.params.includes(8));
});

test('limit is capped at the feed page size so no caller can ask for an unbounded scan', async () => {
  const fake = activityPool([pickRow()]);
  await listPresenterDraftActivity(fake, { leagueId: 12, limit: 10000 });
  const query = fake.calls.find((c) => /"draft_activity"/.test(c.text));
  assert.equal(query.params[query.params.length - 1], 100);
});
