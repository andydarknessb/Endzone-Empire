const IR_ELIGIBLE_DESIGNATIONS = new Set(['O', 'IR']);

function isIrEligible(injuryDesignation) {
  return IR_ELIGIBLE_DESIGNATIONS.has(injuryDesignation);
}

module.exports = { isIrEligible };
