import { describeOutcome } from './describeOutcome';

const SAVED_BOTH =
  'Lineup saved. This move ended a commissioner IR override and voided your called shot. It cannot be undone';

test.each([
  ['a plain save offers Undo', { undoable: true, irreversible: [] }, {},
    { message: 'Lineup saved', severity: 'success', undo: true }],
  ['an IR override only: named, no Undo', { undoable: false, irreversible: ['ir_override'] }, {},
    { message: 'Lineup saved. This move ended a commissioner IR override and cannot be undone', severity: 'success', undo: false }],
  ['a Called shot only: named, Undo still offered', { undoable: false, irreversible: ['called_shot'] }, {},
    { message: 'Lineup saved. Your called shot was voided', severity: 'success', undo: true }],
  ['both: the #2039 copy, no Undo', { undoable: false, irreversible: ['ir_override', 'called_shot'] }, {},
    { message: SAVED_BOTH, severity: 'success', undo: false }],
  ['the order of irreversible does not matter', { undoable: false, irreversible: ['called_shot', 'ir_override'] }, {},
    { message: SAVED_BOTH, severity: 'success', undo: false }],
  ['an Undo restores and carries no Undo', { undoable: true, irreversible: [] }, { isUndo: true },
    { message: 'Lineup restored', severity: 'success', undo: false }],
  ['an Undo of a voided shot says the shot stays void', { undoable: true, irreversible: [] }, { isUndo: true, shotVoided: true },
    { message: 'Lineup restored. Your called shot is still void', severity: 'success', undo: false }],
  ['a queued write has no answer yet and no Undo', undefined, { queued: true },
    { message: 'Lineup change saved offline. It will sync when you reconnect', severity: 'info', undo: false }],
  ['a response with no disclosure fields reads as a plain save', { updated: 2 }, {},
    { message: 'Lineup saved', severity: 'success', undo: true }],
  ['no response body reads as a plain save', undefined, {},
    { message: 'Lineup saved', severity: 'success', undo: true }],
])('%s', (_name, response, options, expected) => {
  expect(describeOutcome(response, options)).toEqual(expected);
});
