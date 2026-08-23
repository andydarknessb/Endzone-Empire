import { draftStatusLabel, draftStatusChipColor, DRAFT_NOT_STARTED_LABEL } from './draftStatusCopy';

// Issue #123 acceptance criterion 6. The status readout used to print the
// stored enum straight ("pending"), which is a database value rather than
// product language any manager has been taught.
test('a pending draft reads as Draft not started, never the raw enum', () => {
  expect(draftStatusLabel('pending')).toBe('Draft not started');
  expect(DRAFT_NOT_STARTED_LABEL).toBe('Draft not started');
});

test('the other stored statuses read as product language too', () => {
  expect(draftStatusLabel('active')).toBe('Draft in progress');
  expect(draftStatusLabel('complete')).toBe('Draft complete');
});

// Before the first draft:state frame there is no status at all, and an
// unrecognised one is a contract change rather than something to print raw.
test('an absent or unrecognised status is named honestly, not echoed', () => {
  expect(draftStatusLabel(null)).toBe('Draft status unknown');
  expect(draftStatusLabel(undefined)).toBe('Draft status unknown');
  expect(draftStatusLabel('paused_forever')).toBe('Draft status unknown');
});

// The colour is the other half of the same presentation fact, which is why it
// lives in this module rather than in a second cascade at the call site. It
// needs its own assertions for that to mean anything: with the label alone
// covered, swapping complete from success to error passed at every level.
test('each status wears the chip colour that goes with its label', () => {
  expect(draftStatusChipColor('pending')).toBe('default');
  expect(draftStatusChipColor('active')).toBe('warning');
  expect(draftStatusChipColor('complete')).toBe('success');
});

test('an unknown status wears the neutral colour rather than a severity', () => {
  // Colouring an unrecognised status as an error would assert something about
  // a draft the client no longer understands.
  expect(draftStatusChipColor(null)).toBe('default');
  expect(draftStatusChipColor(undefined)).toBe('default');
  expect(draftStatusChipColor('paused_forever')).toBe('default');
});

test('label and colour recognise exactly the same set of statuses', () => {
  // The drift this module exists to prevent is one half gaining or losing a
  // status the other does not have. Both fall back for anything they do not
  // recognise, so "recognised" is testable as "did not fall back", and the
  // two sets are compared rather than each being checked alone.
  const candidates = ['pending', 'active', 'complete', 'paused_forever', '', null, undefined];
  const labelKnows = candidates.filter((s) => draftStatusLabel(s) !== 'Draft status unknown');
  const colourKnows = candidates.filter((s) => draftStatusChipColor(s) !== 'default');

  expect(labelKnows).toEqual(['pending', 'active', 'complete']);
  // pending's colour IS the fallback colour, so it is legitimately absent
  // here; that is the one asymmetry, and naming it is the point.
  expect(colourKnows).toEqual(['active', 'complete']);
});
