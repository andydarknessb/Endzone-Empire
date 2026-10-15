const QUEUED = 'Lineup change saved offline. It will sync when you reconnect';
const IR_ENDED = 'This move ended a commissioner IR override';

/**
 * Pure: what a Lineup save's answer says to the manager (#1969, spec #2042).
 * `response` is the PUT body (`undoable`, `irreversible`: what an Undo could not
 * put back, `ir_override` and `called_shot`). Returns the toast `message`, its
 * `severity`, and whether the toast offers `undo`.
 *
 * An ended IR override cannot come back from a manager's move, so that save
 * offers no Undo. A voided Called shot stays void after one, so its Undo still
 * restores the slots and says so. `isUndo` marks the Undo's own save, which
 * offers no Undo itself; `shotVoided` says the save being undone voided a shot.
 * `queued`: the write is waiting offline, so there is no answer yet.
 */
export function describeOutcome(response, { isUndo = false, shotVoided = false, queued = false } = {}) {
  if (queued) return { message: QUEUED, severity: 'info', undo: false };
  if (isUndo) {
    return {
      message: `Lineup restored${shotVoided ? '. Your called shot is still void' : ''}`,
      severity: 'success',
      undo: false,
    };
  }
  const irreversible = response?.irreversible ?? [];
  const irEnded = irreversible.includes('ir_override');
  const voided = irreversible.includes('called_shot');
  if (irEnded) {
    return {
      message: `Lineup saved. ${IR_ENDED}${voided ? ' and voided your called shot. It cannot be undone' : ' and cannot be undone'}`,
      severity: 'success',
      undo: false,
    };
  }
  return {
    message: `Lineup saved${voided ? '. Your called shot was voided' : ''}`,
    severity: 'success',
    undo: true,
  };
}

export default describeOutcome;
