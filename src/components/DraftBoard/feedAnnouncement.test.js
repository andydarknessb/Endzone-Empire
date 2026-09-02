import { feedAnnouncementFor } from './feedAnnouncement';
// Imported the way the existing server-roster parity tests do (chatLimits.parity.test.js,
// useLeagueChat.humanType.parity.test.js): draftActivity.js's only load-time require is
// the pure server/services/teamIdentity (no pg, no socket.io), so it loads fine in jsdom.
import { ALL_KINDS } from '../../../server/services/draftActivity';

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

  it('no longer announces a committed Pick - the room-level PickAnnouncer speaks it (#513)', () => {
    // Picks moved to a room-level announcer (PickAnnouncer, #513) so they are
    // heard on every tab and in both layouts, not only while Chat is mounted.
    // The Chat-scoped feed announcer must therefore go SILENT on a Pick, or a
    // screen-reader user with Chat mounted would hear the same Pick twice.
    expect(
      feedAnnouncementFor({
        type: 'draft_activity',
        kind: 'pick',
        teamName: 'Gridiron Giants',
        player: { name: 'Justin Jefferson', position: 'WR', nflTeam: 'MIN' },
        round: 1,
        pickNumber: 3,
      })
    ).toBe('');
  });

  it('no longer announces an autopick either (#513)', () => {
    expect(
      feedAnnouncementFor({
        type: 'draft_activity',
        kind: 'pick',
        teamName: 'Gridiron Giants',
        isAutopick: true,
        player: { name: 'Bijan Robinson' },
      })
    ).toBe('');
  });

  it('says nothing for any Draft activity - Picks and every lifecycle kind alike (#513)', () => {
    // AC2 no longer names Picks here (#513 moved them to PickAnnouncer). Live
    // draft-state is carried by the on-the-clock (LiveDraftBanner), countdown
    // (#117), readiness (#164) and the room-level Pick announcer; announcing any
    // of it in the feed too would only add contention or duplicate speech.
    //
    // Iterates the server's exported ALL_KINDS (#654) rather than a hand-written
    // list, so a kind added to the server roster - 'stalled' included - is covered
    // here without editing this test. A hand-written enumeration is exactly what
    // went stale before: this file used to list five of the six lifecycle kinds
    // and never caught that 'stalled' was missing.
    for (const kind of ALL_KINDS) {
      expect(feedAnnouncementFor({ type: 'draft_activity', kind, teamName: 'Gridiron Giants' })).toBe('');
    }
  });

  it('says nothing for a null or undefined entry', () => {
    expect(feedAnnouncementFor(null)).toBe('');
    expect(feedAnnouncementFor(undefined)).toBe('');
  });

  it("suppresses the viewer's OWN chat message (the server echoes it to the sender)", () => {
    const own = { type: 'league_chat', teamId: 11, teamName: 'My Team', message: 'hi' };
    expect(feedAnnouncementFor(own, 11)).toBe('');
    // Another Team's message still announces.
    expect(feedAnnouncementFor({ ...own, teamId: 12, teamName: 'Them' }, 11)).toBe('New message from Them');
    // With no viewer identity, nothing is suppressed.
    expect(feedAnnouncementFor(own)).toBe('New message from My Team');
  });

  it('uses no em-dashes in any announcement (house style, guarded copy)', () => {
    const samples = [
      feedAnnouncementFor({ type: 'league_chat', teamName: 'A', message: 'x' }),
    ];
    for (const text of samples) {
      expect(text).not.toMatch(/—/);
    }
  });
});
