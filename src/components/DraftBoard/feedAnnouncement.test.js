import { feedAnnouncementFor } from './feedAnnouncement';

describe('feedAnnouncementFor', () => {
  it('announces a new human message by Team, not its content', () => {
    // Presence, not content: the announcement names WHO spoke so a reader can
    // navigate the log to read it, and never reads arbitrary (possibly long or
    // already-moderated) message text into a polite region (#445 AC2).
    expect(
      feedAnnouncementFor({ type: 'league_chat', teamName: 'Team Rocket', message: 'hello there everyone' })
    ).toBe('New message from Team Rocket');
  });

  it('treats an untyped entry as a League chat message', () => {
    // feedEntryKey defaults a missing type to league_chat; the announcer agrees.
    expect(feedAnnouncementFor({ teamName: 'Blue Bombers', message: 'hi' })).toBe(
      'New message from Blue Bombers'
    );
  });

  it('names a departed author as a former manager, never blank or "null"', () => {
    expect(feedAnnouncementFor({ type: 'league_chat', teamName: null, message: 'x' })).toBe(
      'New message from Former manager'
    );
  });

  it('says nothing for a message that arrived already hidden', () => {
    // A tombstoned entry is not new correspondence to announce (#482).
    expect(
      feedAnnouncementFor({ type: 'league_chat', teamName: 'Team Rocket', hidden: true, message: 'x' })
    ).toBe('');
  });

  it('announces a committed Pick with the Team and the player', () => {
    expect(
      feedAnnouncementFor({
        type: 'draft_activity',
        kind: 'pick',
        teamName: 'Gridiron Giants',
        player: { name: 'Justin Jefferson', position: 'WR', nflTeam: 'MIN' },
        round: 1,
        pickNumber: 3,
      })
    ).toBe('Gridiron Giants drafted Justin Jefferson');
  });

  it('marks an autopick as autodrafted', () => {
    expect(
      feedAnnouncementFor({
        type: 'draft_activity',
        kind: 'pick',
        teamName: 'Gridiron Giants',
        isAutopick: true,
        player: { name: 'Bijan Robinson' },
      })
    ).toBe('Gridiron Giants autodrafted Bijan Robinson');
  });

  it('falls back to "a player" when a Pick carries no player name', () => {
    expect(
      feedAnnouncementFor({ type: 'draft_activity', kind: 'pick', teamName: 'Gridiron Giants', player: {} })
    ).toBe('Gridiron Giants drafted a player');
  });

  it('says nothing for Draft lifecycle activity (start/pause/resume/reset/complete)', () => {
    // AC2 names human messages and Picks. Live draft-state is already carried by
    // the on-the-clock (LiveDraftBanner), countdown (#117) and readiness (#164)
    // regions; announcing lifecycle here too would only add contention.
    for (const kind of ['draft_start', 'pause', 'resume', 'reset', 'complete']) {
      expect(feedAnnouncementFor({ type: 'draft_activity', kind, teamName: 'Gridiron Giants' })).toBe('');
    }
  });

  it('says nothing for a null or undefined entry', () => {
    expect(feedAnnouncementFor(null)).toBe('');
    expect(feedAnnouncementFor(undefined)).toBe('');
  });

  it('uses no em-dashes in any announcement (house style, guarded copy)', () => {
    const samples = [
      feedAnnouncementFor({ type: 'league_chat', teamName: 'A', message: 'x' }),
      feedAnnouncementFor({ type: 'draft_activity', kind: 'pick', teamName: 'A', player: { name: 'P' } }),
    ];
    for (const text of samples) {
      expect(text).not.toMatch(/—/);
    }
  });
});
