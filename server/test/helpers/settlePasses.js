const matchupScoring = require('../../services/matchupScoring.service');
const settleFollowUpSvc = require('../../services/settleFollowUp.service');

/**
 * settleWeek scores the week and starts the follow-up by default. A test whose
 * subject is the week advance itself (the finalize, the seed, the waiver reset)
 * stubs both, so the fake pool sees only the advance's own queries. A null score
 * queues no announcement. Returns the score stub, so a test that re-scores after
 * the advance can restore it first.
 */
function stubSettlePasses(t) {
  const scoring = t.mock.method(matchupScoring, 'scoreMatchupsInTransaction', async () => null);
  t.mock.method(settleFollowUpSvc, 'settleFollowUp', async () => {});
  return scoring;
}

module.exports = { stubSettlePasses };
