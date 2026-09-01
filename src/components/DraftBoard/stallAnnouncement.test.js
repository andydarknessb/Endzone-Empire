import { stallAnnouncementFor } from './stallAnnouncement';

const stalled = (overrides = {}) => ({
  type: 'draft_activity',
  kind: 'stalled',
  seq: 6,
  id: 6,
  teamName: 'MinneApple',
  created_at: '2026-09-01T00:00:00.000Z',
  ...overrides,
});

describe('stallAnnouncementFor', () => {
  it('names the cause and the commissioner next step, and names the Team without casting it as the actor', () => {
    const text = stallAnnouncementFor(stalled());
    // The cause (#602/#620): there was no draftable player.
    expect(text).toMatch(/no draftable player/i);
    // The next step: a commissioner must act - the entry is addressed to them.
    expect(text).toMatch(/a commissioner must resolve and resume/i);
    // The Team is NAMED (it locates the stuck pick)...
    expect(text).toContain('MinneApple');
    // ...but never cast as the actor (#620): not "<Team> stalled the draft".
    expect(text).not.toMatch(/stalled the draft/i);
    expect(text).not.toMatch(/MinneApple (stalled|paused|reset)/i);
    // House style: no em-dash in user-facing copy.
    expect(text).not.toContain('—');
  });

  it('reads as a plain stuck-state line for a null Team, never "Former manager"', () => {
    // Matches the sibling visible line (StalledActivityLine, #620): a null actor
    // is a plain state transition, not a departed manager.
    const text = stallAnnouncementFor(stalled({ teamName: null }));
    expect(text).toMatch(/the draft is stuck: no draftable player/i);
    expect(text).toMatch(/a commissioner must resolve and resume/i);
    expect(text).not.toMatch(/former manager/i);
    expect(text).not.toMatch(/stuck on/i);
  });

  it('returns the empty string for a non-stall draft_activity entry', () => {
    // Only the stall speaks through this announcer; every other activity kind is
    // silent here (Picks are the room-level PickAnnouncer's, #513; the rest is
    // the combined-feed announcer's deliberate silence).
    expect(stallAnnouncementFor({ type: 'draft_activity', kind: 'pick', seq: 1 })).toBe('');
    expect(stallAnnouncementFor({ type: 'draft_activity', kind: 'pause', seq: 1 })).toBe('');
    expect(stallAnnouncementFor({ type: 'draft_activity', kind: 'complete', seq: 1 })).toBe('');
  });

  it('returns the empty string for a chat entry and for nothing at all', () => {
    expect(stallAnnouncementFor({ type: 'league_chat', seq: 1, teamName: 'A' })).toBe('');
    expect(stallAnnouncementFor(null)).toBe('');
    expect(stallAnnouncementFor(undefined)).toBe('');
  });
});
