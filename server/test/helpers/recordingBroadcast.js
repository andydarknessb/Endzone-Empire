const { beforeEach, afterEach } = require('node:test');
const draftRoomBroadcast = require('../../modules/draftRoomBroadcast');

/**
 * The recording Draft room broadcast (#745). Every service and route that emits
 * room-wide Draft events now reads the process broadcast through
 * getDraftRoomBroadcast(); construction with no transport throws, so there is no
 * silent default. A test that drives one of those paths injects THIS in place of
 * the real io/emitter transport and reads back which named method the code
 * reached, with which league and payload - never a silent drop.
 *
 * It records the ADAPTER-level calls (pickLanded, activityAppended, ...), not
 * the wire-level to()/emit() the adapter maps them to; the wire mapping is what
 * draftRoomBroadcast.test.js pins over a fake transport. Each method resolves
 * `{ delivered: true }` so a caller that awaits it behaves exactly as it does in
 * production.
 */
function createRecordingBroadcast() {
  const calls = [];
  const record = (method) => (leagueId, payload) => {
    calls.push({ method, leagueId, payload });
    return { delivered: true, transport: 'recording' };
  };
  return {
    calls,
    pickLanded: record('pickLanded'),
    activityAppended: record('activityAppended'),
    draftCompleted: record('draftCompleted'),
    rosterChanged: record('rosterChanged'),
    stateChanged: record('stateChanged'),
  };
}

/**
 * Register a fresh recording broadcast for the duration of test `t`, restoring
 * whatever was registered before (the socket harness's io adapter, or null).
 * Returns the recorder so the test can read `recorder.calls`.
 */
function installRecordingBroadcast(t) {
  const recorder = createRecordingBroadcast();
  const prior = draftRoomBroadcast.peekDraftRoomBroadcast();
  draftRoomBroadcast.setDraftRoomBroadcast(recorder);
  t.after(() => draftRoomBroadcast.setDraftRoomBroadcast(prior));
  return recorder;
}

/**
 * File-level convenience: register a fresh recording broadcast around every test
 * in the calling file via node:test beforeEach/afterEach, for a suite whose
 * subject is not the broadcast itself but which drives a path that now emits
 * through it (draftStart, the roster-change routes, ...). Returns an accessor
 * for the current recorder, should a test want to assert on its calls.
 */
function registerRecordingBroadcast() {
  let recorder = null;
  let prior;
  beforeEach(() => {
    prior = draftRoomBroadcast.peekDraftRoomBroadcast();
    recorder = createRecordingBroadcast();
    draftRoomBroadcast.setDraftRoomBroadcast(recorder);
  });
  afterEach(() => {
    draftRoomBroadcast.setDraftRoomBroadcast(prior);
  });
  return () => recorder;
}

module.exports = { createRecordingBroadcast, installRecordingBroadcast, registerRecordingBroadcast };
