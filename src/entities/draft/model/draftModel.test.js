import {
  pickFromSnapshotRow,
  pickFromPickedEvent,
  emptyDraftModel,
  applyBoardSnapshot,
  applyLandedPick,
  applyDraftComplete,
} from './draftModel';

// A `draft:state` board-snapshot pick row, as draftRoomSnapshot.readPicks
// delivers it: snake_case pick columns, the Team identity aliases, the player's
// market ADP and - since #949 - the autopick fact `auto`.
const snapshotRow = (over = {}) => ({
  pick_number: 1,
  team_id: 11,
  is_keeper: false,
  teamId: 11,
  teamName: 'Team A',
  player_id: 501,
  name: 'Star Runningback',
  position: 'RB',
  nfl_team: 'KC',
  adp: 3.2,
  auto: false,
  ...over,
});

// A `draft:picked` live event: the pick number and Team at the root, the player
// nested, and the autopick flag at the root as `auto` (#435, #344).
const pickedEvent = (over = {}) => ({
  pickNumber: 1,
  teamId: 11,
  teamName: 'Team A',
  player: { id: 501, name: 'Star Runningback', position: 'RB', nfl_team: 'KC', adp: 3.2 },
  nextTeamId: 12,
  draftComplete: false,
  auto: false,
  ...over,
});

const activeLeague = (over = {}) => ({
  draft_status: 'active',
  draft_paused: false,
  current_pick: 0,
  pick_time_seconds: 60,
  pick_deadline_at: '2026-09-01T00:00:00.000Z',
  ...over,
});

// --- Criterion 1: both wire shapes produce ONE model, by plain function call ---

test('both wire shapes build a pick of the same shape (one model)', () => {
  const fromSnapshot = pickFromSnapshotRow(snapshotRow());
  const fromEvent = pickFromPickedEvent(pickedEvent());

  const shape = ['pick_number', 'teamId', 'teamName', 'player_id', 'name', 'position', 'nfl_team', 'adp', 'auto', 'is_keeper'];
  expect(Object.keys(fromSnapshot).sort()).toEqual([...shape].sort());
  expect(Object.keys(fromEvent).sort()).toEqual([...shape].sort());

  // And the same values for the same pick, so a live pick and its later snapshot
  // refresh describe one pick. A live pick is never a keeper.
  expect(fromEvent).toEqual({
    pick_number: 1,
    teamId: 11,
    teamName: 'Team A',
    player_id: 501,
    name: 'Star Runningback',
    position: 'RB',
    nfl_team: 'KC',
    adp: 3.2,
    auto: false,
    is_keeper: false,
  });
  expect(fromSnapshot).toEqual({ ...fromEvent, is_keeper: false });
});

test('a landed pick with no next-pick index returns the SAME league reference', () => {
  const league = activeLeague({ current_pick: 3 });
  const model = { ...emptyDraftModel, league, teams: [{ teamId: 12, teamName: 'Team B' }] };

  // No nextPickIndex, not completing: the league must be the same object so
  // memoised readers do not needlessly recompute (#819).
  const next = applyLandedPick(model, pickedEvent({ nextPickIndex: undefined }));

  expect(next.league).toBe(league);
  expect(next.league.current_pick).toBe(3);
});

test('a landed pick honours a keeper-skipped next-pick index verbatim', () => {
  const league = activeLeague({ current_pick: 3 });
  const model = { ...emptyDraftModel, league, teams: [{ teamId: 12, teamName: 'Team B' }] };

  // nextPickIndex is the next OPEN slot with keepers skipped, so NOT current + 1.
  const next = applyLandedPick(model, pickedEvent({ nextPickIndex: 7 }));

  expect(next.league).not.toBe(league); // a NEW object so readers recompute
  expect(next.league.current_pick).toBe(7);
  expect(league.current_pick).toBe(3); // input not mutated
});

// --- Criterion 2: the defect's own test ---

test('a board refresh over a model holding an autopicked pick preserves the autopick fact', () => {
  // The clock made a pick for Team A: the live event marks it auto.
  const league = activeLeague();
  let model = { ...emptyDraftModel, league, teams: [{ teamId: 12, teamName: 'Team B' }] };
  model = applyLandedPick(model, pickedEvent({ auto: true, nextPickIndex: 1 }));
  expect(model.picks[0].auto).toBe(true);

  // A board refresh arrives (any lifecycle act or reconnect emits draft:state),
  // rebuilding the pick list wholesale from the snapshot. The snapshot now
  // carries the autopick fact, so the refreshed pick is STILL marked auto.
  const refreshed = applyBoardSnapshot(model, {
    league,
    teams: model.teams,
    picks: [snapshotRow({ auto: true })],
    onTheClock: null,
  });

  expect(refreshed.picks).toHaveLength(1);
  expect(refreshed.picks[0].auto).toBe(true);
  // The red-tell: removing `auto` from pickFromSnapshotRow makes this the false
  // it was before #949 - every autopick silently un-marked on the first refresh.
});

test('applyDraftComplete marks the draft complete and idles the clock', () => {
  const league = activeLeague();
  const model = { ...emptyDraftModel, league, teams: [{ teamId: 12, teamName: 'Team B' }] };

  const done = applyDraftComplete(model);

  expect(done.draftComplete).toBe(true);
  expect(done.league.draft_status).toBe('complete');
  expect(done.onTheClock.state).toBe('idle');
  expect(league.draft_status).toBe('active'); // input not mutated
});
