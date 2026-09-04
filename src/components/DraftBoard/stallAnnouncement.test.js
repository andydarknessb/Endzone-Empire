import {
  STALL_EXIT_KINDS,
  isStallEntry,
  isStallExit,
  isStallRelevant,
} from './stallAnnouncement';

// stallAnnouncementFor (the announcement TEXT) moved into StallAnnouncer.jsx as
// a module-private function in #791 - it had exactly one caller, so the
// pure-function/component split #791's rulings 4 and 5 ask for was
// unnecessary. Its string-equality cases moved up to StallAnnouncer.test.jsx as
// assertions on the rendered region's text. This file keeps the entry/exit
// CLASSIFICATION below: isStallEntry, isStallExit and isStallRelevant have two
// callers apiece (StallAnnouncer.jsx and DraftBoard.jsx), so they stay here.

const stalled = (overrides = {}) => ({
  type: 'draft_activity',
  kind: 'stalled',
  seq: 6,
  id: 6,
  teamName: 'MinneApple',
  created_at: '2026-09-01T00:00:00.000Z',
  ...overrides,
});

const activity = (kind) => ({ type: 'draft_activity', kind, seq: 1, id: 1, teamName: 'Commish FC' });

describe('stall state edges (#648, #653): entry, exit and the pause carve-out', () => {
  it('exits are exactly the stuck-state-ending lifecycle kinds: resume, reset, complete', () => {
    // Derived by exclusion from the lifecycle roster, so it cannot drift into a
    // hand-listed parallel set. pause and draft_start are deliberately not exits.
    expect([...STALL_EXIT_KINDS].sort()).toEqual(['complete', 'reset', 'resume']);
    expect(STALL_EXIT_KINDS).not.toContain('pause');
    expect(STALL_EXIT_KINDS).not.toContain('draft_start');
    expect(STALL_EXIT_KINDS).not.toContain('stalled');
  });

  it('classifies the ENTRY edge (the stall itself)', () => {
    expect(isStallEntry(stalled())).toBe(true);
    expect(isStallEntry(activity('resume'))).toBe(false);
    expect(isStallEntry(null)).toBe(false);
  });

  it('classifies EXIT edges and holds the pause carve-out', () => {
    expect(isStallExit(activity('resume'))).toBe(true);
    expect(isStallExit(activity('reset'))).toBe(true);
    expect(isStallExit(activity('complete'))).toBe(true);
    // A nothing-draftable stall already implies the draft is paused (ADR 0018), so
    // a pause is NOT an exit - clearing on it would silence a still-stuck draft.
    expect(isStallExit(activity('pause'))).toBe(false);
    expect(isStallExit(activity('draft_start'))).toBe(false);
    expect(isStallExit(stalled())).toBe(false);
  });

  it('isStallRelevant is exactly the two edges, and nothing else reaches the announcer', () => {
    expect(isStallRelevant(stalled())).toBe(true);
    expect(isStallRelevant(activity('resume'))).toBe(true);
    expect(isStallRelevant(activity('complete'))).toBe(true);
    // Filtered OUT: a pick, a correction, a pause, draft_start, a chat message.
    expect(isStallRelevant(activity('pick'))).toBe(false);
    expect(isStallRelevant(activity('correction'))).toBe(false);
    expect(isStallRelevant(activity('pause'))).toBe(false);
    expect(isStallRelevant(activity('draft_start'))).toBe(false);
    expect(isStallRelevant({ type: 'league_chat', seq: 1, teamName: 'A' })).toBe(false);
    expect(isStallRelevant(null)).toBe(false);
  });
});
