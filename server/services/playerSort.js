'use strict';

// The wire `?sort=` values GET /api/players actually honours, in one named
// place (issue #951). Before this, the accepted set was spread across three
// constructs in player.router.js - the SQL `orderBy` if/else chain and the two
// booleans projectionSort/byeSort - and exported from nowhere, so nothing could
// assert against it. The router now normalises req.query.sort against this list
// (a value not in it falls through to the stable "id" ordering, silently, same
// as before), and the Draft room's sortFields module pins each of its own wire
// names against this one authority in a parity test rather than scraping source
// or hardcoding a copy.
//
// Pure by design (no requires): this is the house parity pattern (see
// server/modules/chatLimits.js, server/services/draftActivity.js LIFECYCLE_KINDS)
// so a jest test under src/ can import it without dragging pg or express into
// the client bundle's jsdom run.
//
// Keep this list and the router's ordering branches in step: a value here with
// no branch or boolean in player.router.js would be accepted but ordered by id.
const ACCEPTED_SORT_FIELDS = Object.freeze([
  'name',
  'adp',
  'position_rank',
  'nfl_team',
  'projected_points',
  'bye_week',
]);

module.exports = { ACCEPTED_SORT_FIELDS };
