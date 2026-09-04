// The canonical root key set of a memberSnapshot / `draft:state` snapshot,
// shared so the socketPayloadShape suite's pin and the draftEvents shim test
// assert the SAME list rather than two copies that can drift (review 751-f7).
const STATE_ROOT_CLEAN = ['league', 'onTheClock', 'picks', 'teams'];

// The Draft room snapshot's per-object key sets (#788), kept here as INDEPENDENT
// literal copies of the field lists in server/services/draftRoomSnapshot.js.
// The duplication is deliberate: tests import from this helper and never from the
// module, so a test can never become a tautology that passes whatever the query
// selects. Adding (or dropping) a column is a two-place edit - the module list
// AND the copy below - and a one-place edit fails a pin, loudly. Do not "DRY"
// these against the module.
//
// MEMBER_* is what an authenticated member receives on draft:state;
// PRESENTER_* is what a presenter share-link holder receives. `owner_id`,
// `draft_share_token` and `invite_code` are on neither.
const MEMBER_LEAGUE_FIELDS = [
  'id', 'name', 'draft_status', 'draft_paused', 'draft_type', 'draft_rotation',
  'draft_order_overrides', 'current_pick', 'pick_deadline_at', 'pick_time_seconds',
  'autodraft_delay_seconds', 'draft_rounds', 'roster_limit', 'roster_slots',
  'bench_slots', 'ir_slots', 'min_teams', 'draft_date', 'draft_timezone',
];
const MEMBER_TEAM_FIELDS = [
  'id', 'name', 'draft_position', 'autodraft', 'draft_ready', 'teamId', 'teamName',
];
const MEMBER_PICK_FIELDS = [
  'pick_number', 'team_id', 'is_keeper', 'teamId', 'teamName',
  // `adp` (players.adp) rides on every member pick since #833 so the Draft room's
  // Misery Meter reads a pick's market ADP off the pick, not off the windowed
  // pool. The presenter still never publishes it (PRESENTER_PICK_FIELDS below).
  'player_id', 'name', 'position', 'nfl_team', 'adp',
];

const PRESENTER_LEAGUE_FIELDS = [
  'name', 'draft_status', 'draft_paused', 'pick_deadline_at',
  'draft_rounds', 'roster_limit', 'ir_slots',
];
const PRESENTER_TEAM_FIELDS = ['teamId', 'teamName', 'draft_position'];
const PRESENTER_PICK_FIELDS = [
  'pick_number', 'teamId', 'teamName', 'is_keeper', 'player_id', 'name', 'position', 'nfl_team',
];

module.exports = {
  STATE_ROOT_CLEAN,
  MEMBER_LEAGUE_FIELDS,
  MEMBER_TEAM_FIELDS,
  MEMBER_PICK_FIELDS,
  PRESENTER_LEAGUE_FIELDS,
  PRESENTER_TEAM_FIELDS,
  PRESENTER_PICK_FIELDS,
};
