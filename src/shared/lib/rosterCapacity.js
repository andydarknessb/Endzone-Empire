// "Is this roster full?" as the availability payload states it (#1307,
// ADR 0040 CardStates): `rosterCount >= rosterCapacity`, and never full when
// either number is missing, because a missing fact must not disable a
// roster action the server would have allowed. Promoted under ADR 0031's
// second-island-consumer rule once `features/add-player`,
// `features/claim-player` and PlayerManagement's own row gate all needed
// the identical predicate; a promotion is a move, never a copy.
export function isRosterAtCapacity(availability) {
  const count = availability?.rosterCount;
  const capacity = availability?.rosterCapacity;
  return count != null && capacity != null && Number(count) >= Number(capacity);
}

export default isRosterAtCapacity;
