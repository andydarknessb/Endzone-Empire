import { pickActionExists, pickTemporarilyUnavailable, PICK_UNAVAILABLE_EXPLANATION } from './pickAvailability';

describe('pickActionExists', () => {
  test('exists for an active snake-type draft', () => {
    expect(pickActionExists({ draftStatus: 'active', draftType: 'snake' })).toBe(true);
  });

  test('exists for an active draft with no draftType (defaults to snake, matching the DB column default)', () => {
    expect(pickActionExists({ draftStatus: 'active', draftType: undefined })).toBe(true);
    expect(pickActionExists({ draftStatus: 'active', draftType: null })).toBe(true);
  });

  test('does not exist before the draft starts', () => {
    expect(pickActionExists({ draftStatus: 'pending', draftType: 'snake' })).toBe(false);
  });

  test('does not exist once the draft is complete', () => {
    expect(pickActionExists({ draftStatus: 'complete', draftType: 'snake' })).toBe(false);
  });

  test('does not exist for an autopick-type draft - no manual control ever exists', () => {
    expect(pickActionExists({ draftStatus: 'active', draftType: 'autopick' })).toBe(false);
  });

  test('does not exist for an offline-type draft - the commissioner enters every pick elsewhere', () => {
    expect(pickActionExists({ draftStatus: 'active', draftType: 'offline' })).toBe(false);
  });

  test('does not exist for an auction-type draft - no live scoring (modules/liveGameEngine.js) yet', () => {
    expect(pickActionExists({ draftStatus: 'active', draftType: 'auction' })).toBe(false);
  });
});

describe('pickTemporarilyUnavailable', () => {
  test('unavailable when it is not the viewer\'s turn', () => {
    expect(pickTemporarilyUnavailable({ isMyTurn: false, draftPaused: false })).toBe(true);
  });

  test('unavailable when the draft is paused, even on the viewer\'s turn', () => {
    expect(pickTemporarilyUnavailable({ isMyTurn: true, draftPaused: true })).toBe(true);
  });

  test('available on the viewer\'s turn while unpaused', () => {
    expect(pickTemporarilyUnavailable({ isMyTurn: true, draftPaused: false })).toBe(false);
  });
});

test('exactly one shared explanation covers every temporarily-unavailable reason', () => {
  expect(typeof PICK_UNAVAILABLE_EXPLANATION).toBe('string');
  expect(PICK_UNAVAILABLE_EXPLANATION.length).toBeGreaterThan(0);
});
