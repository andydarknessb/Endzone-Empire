const test = require('node:test');
const assert = require('node:assert/strict');
// nextPickClockSeconds now lives in the Pick clock module, its owner (ADR 0018);
// shouldAutoEnableAutodraft stays in draft.service.
const { nextPickClockSeconds } = require('../services/pickClock.service');
const { shouldAutoEnableAutodraft } = require('../services/draft.service');

test('nextPickClockSeconds: no clock once the draft is complete', () => {
  assert.equal(
    nextPickClockSeconds({ draftComplete: true, nextTeamAutodraft: false, pickTimeSeconds: 90, autodraftDelaySeconds: 10 }),
    null
  );
});

test('nextPickClockSeconds: autodrafting team gets the short delay', () => {
  assert.equal(
    nextPickClockSeconds({ draftComplete: false, nextTeamAutodraft: true, pickTimeSeconds: 90, autodraftDelaySeconds: 10 }),
    10
  );
  // Even in an otherwise untimed draft, autodraft still fires.
  assert.equal(
    nextPickClockSeconds({ draftComplete: false, nextTeamAutodraft: true, pickTimeSeconds: 0, autodraftDelaySeconds: 8 }),
    8
  );
  // Never zero.
  assert.equal(
    nextPickClockSeconds({ draftComplete: false, nextTeamAutodraft: true, pickTimeSeconds: 0, autodraftDelaySeconds: 0 }),
    1
  );
});

test('nextPickClockSeconds: normal team uses the pick clock, null when untimed', () => {
  assert.equal(
    nextPickClockSeconds({ draftComplete: false, nextTeamAutodraft: false, pickTimeSeconds: 90, autodraftDelaySeconds: 10 }),
    90
  );
  assert.equal(
    nextPickClockSeconds({ draftComplete: false, nextTeamAutodraft: false, pickTimeSeconds: 0, autodraftDelaySeconds: 10 }),
    null
  );
});

test('shouldAutoEnableAutodraft: flips on at two consecutive timeouts', () => {
  assert.equal(shouldAutoEnableAutodraft(0), false);
  assert.equal(shouldAutoEnableAutodraft(1), false);
  assert.equal(shouldAutoEnableAutodraft(2), true);
  assert.equal(shouldAutoEnableAutodraft(3), true);
});
