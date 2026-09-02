// The canonical root key set of a getDraftState / `draft:state` snapshot,
// shared so the socketPayloadShape suite's pin and the draftEvents shim test
// assert the SAME list rather than two copies that can drift (review 751-f7).
const STATE_ROOT_CLEAN = ['league', 'onTheClock', 'picks', 'teams'];

module.exports = { STATE_ROOT_CLEAN };
