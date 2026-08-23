import { draftStatusLabel, DRAFT_NOT_STARTED_LABEL } from './draftStatusCopy';

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
