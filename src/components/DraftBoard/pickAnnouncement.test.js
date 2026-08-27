import { pickAnnouncementFor } from './pickAnnouncement';

// The room-level Pick announcer's text (#513), kept a pure function so the
// string is unit-tested on its own and the announcer component is only
// responsible for WHEN it changes. It reads the `draft:picked` broadcast shape
// straight off the wire (server: draftSocket.js / autopick.service.js emit
// `{ ...outcome, auto }`): `teamName`, `player.name`, and the top-level `auto`
// flag that is the one non-identity fact about how the Pick was made.
describe('pickAnnouncementFor', () => {
  it('announces a committed Pick with the Team and the player', () => {
    expect(
      pickAnnouncementFor({
        teamName: 'Gridiron Giants',
        player: { id: 3, name: 'Justin Jefferson', position: 'WR', nfl_team: 'MIN' },
        auto: false,
      })
    ).toBe('Gridiron Giants drafted Justin Jefferson');
  });

  it('marks an autopick as autodrafted', () => {
    expect(
      pickAnnouncementFor({
        teamName: 'Gridiron Giants',
        player: { name: 'Bijan Robinson' },
        auto: true,
      })
    ).toBe('Gridiron Giants autodrafted Bijan Robinson');
  });

  it('falls back to "a player" when a Pick carries no player name', () => {
    expect(pickAnnouncementFor({ teamName: 'Gridiron Giants', player: {}, auto: false })).toBe(
      'Gridiron Giants drafted a player'
    );
    // And when the player object is missing entirely.
    expect(pickAnnouncementFor({ teamName: 'Gridiron Giants', auto: false })).toBe(
      'Gridiron Giants drafted a player'
    );
  });

  it('names a Pick with no Team identity as a former manager, never blank or "null"', () => {
    // A Pick's Team cannot really be null (draft_picks.team_id is NOT NULL and
    // cascades), but the rendering rule must never print nothing or "null".
    expect(pickAnnouncementFor({ teamName: null, player: { name: 'Josh Allen' }, auto: false })).toBe(
      'Former manager drafted Josh Allen'
    );
  });

  it('says nothing for a null or undefined pick', () => {
    expect(pickAnnouncementFor(null)).toBe('');
    expect(pickAnnouncementFor(undefined)).toBe('');
  });

  it('uses no em-dashes in any announcement (house style, guarded copy)', () => {
    const samples = [
      pickAnnouncementFor({ teamName: 'A', player: { name: 'P' }, auto: false }),
      pickAnnouncementFor({ teamName: 'A', player: { name: 'P' }, auto: true }),
    ];
    for (const text of samples) {
      // The literal em dash (U+2014, bytes e2 80 94) the guards chain forbids in
      // user-facing copy.
      expect(text).not.toMatch(/—/);
    }
  });
});
