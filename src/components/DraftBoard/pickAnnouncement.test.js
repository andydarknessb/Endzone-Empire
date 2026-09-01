import { pickAnnouncementFor } from './pickAnnouncement';

// The room-level Pick announcer's text (#513), kept a pure function so the
// string is unit-tested on its own and the announcer component is only
// responsible for WHEN it changes. It reads the `draft:picked` broadcast shape
// straight off the wire (server: draftSocket.js / pickClock.service.js emit
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

  it('appends "Draft complete." to the Pick that completes the draft (#519)', () => {
    // The final live Pick carries draftComplete:true on the same draft:picked
    // payload (server spreads the pick outcome). One ordered polite update:
    // Team and player FIRST, then the completion sentence, so a reader hears
    // who was picked before hearing the draft is over.
    expect(
      pickAnnouncementFor({
        teamName: 'Gridiron Giants',
        player: { name: 'Justin Jefferson' },
        auto: false,
        draftComplete: true,
      })
    ).toBe('Gridiron Giants drafted Justin Jefferson. Draft complete.');
  });

  it('appends "Draft complete." to a final AUTOMATIC Pick too (#519)', () => {
    expect(
      pickAnnouncementFor({
        teamName: 'Gridiron Giants',
        player: { name: 'Bijan Robinson' },
        auto: true,
        draftComplete: true,
      })
    ).toBe('Gridiron Giants autodrafted Bijan Robinson. Draft complete.');
  });

  it('reuses a name-final period instead of doubling the full stop (#519)', () => {
    // A final Pick landing on a suffixed name is an ordinary way for a draft to
    // end. "Jr.. Draft complete." would render a double stop in braille output,
    // so the name's own period is reused rather than a second one added.
    expect(
      pickAnnouncementFor({
        teamName: 'Gridiron Giants',
        player: { name: 'Marvin Harrison Jr.' },
        auto: false,
        draftComplete: true,
      })
    ).toBe('Gridiron Giants drafted Marvin Harrison Jr. Draft complete.');
    // ...and for a final autopick of a suffixed name.
    expect(
      pickAnnouncementFor({
        teamName: 'Gridiron Giants',
        player: { name: 'Michael Pittman Jr.' },
        auto: true,
        draftComplete: true,
      })
    ).toBe('Gridiron Giants autodrafted Michael Pittman Jr. Draft complete.');
  });

  it('adds no completion sentence to a non-final Pick (#519)', () => {
    // Every Pick before the last leaves the wording exactly as it was: a
    // draftComplete that is false, or absent entirely, means no completion
    // sentence.
    expect(
      pickAnnouncementFor({
        teamName: 'Gridiron Giants',
        player: { name: 'Justin Jefferson' },
        auto: false,
        draftComplete: false,
      })
    ).toBe('Gridiron Giants drafted Justin Jefferson');
    expect(
      pickAnnouncementFor({
        teamName: 'Gridiron Giants',
        player: { name: 'Bijan Robinson' },
        auto: true,
      })
    ).toBe('Gridiron Giants autodrafted Bijan Robinson');
  });

  it('uses no em-dashes in any announcement (house style, guarded copy)', () => {
    const samples = [
      pickAnnouncementFor({ teamName: 'A', player: { name: 'P' }, auto: false }),
      pickAnnouncementFor({ teamName: 'A', player: { name: 'P' }, auto: true }),
      // The module now produces four outputs; the completion variants are
      // user-facing copy too, so guard them as well (#519).
      pickAnnouncementFor({ teamName: 'A', player: { name: 'P' }, auto: false, draftComplete: true }),
      pickAnnouncementFor({ teamName: 'A', player: { name: 'P' }, auto: true, draftComplete: true }),
    ];
    for (const text of samples) {
      // The literal em dash (U+2014, bytes e2 80 94) the guards chain forbids in
      // user-facing copy.
      expect(text).not.toMatch(/—/);
    }
  });
});
