import React from 'react';
import { render, screen } from '@testing-library/react';
import FeedAnnouncer from './FeedAnnouncer';
// Imported the way the existing server-roster parity tests do (chatLimits.parity.test.js,
// useLeagueChat.humanType.parity.test.js): draftActivity.js's only load-time require is
// the pure server/services/teamIdentity (no pg, no socket.io), so it loads fine in jsdom.
import { ALL_KINDS } from '../../../server/services/draftActivity';

const chat = (seq, teamName, message, teamId = null) => ({ type: 'league_chat', seq, id: seq, teamName, message, teamId });
const pick = (seq, teamName, playerName) => ({
  type: 'draft_activity',
  kind: 'pick',
  seq,
  id: seq,
  teamName,
  player: { name: playerName },
});

describe('FeedAnnouncer', () => {
  it('mounts a persistent polite status region', () => {
    render(<FeedAnnouncer entries={[]} />);
    const region = screen.getByRole('status');
    expect(region).toHaveAttribute('aria-live', 'polite');
    // Silent to start: the region exists and is empty rather than absent, so a
    // later change lands on a node assistive tech is already observing (#164).
    expect(region).toHaveTextContent('');
  });

  it('does not announce the feed that is already there when the room opens', () => {
    // Opening backlog is not "new"; seeding it silently is the whole point.
    render(<FeedAnnouncer entries={[chat(1, 'A', 'old'), chat(2, 'B', 'older still')]} />);
    expect(screen.getByRole('status')).toHaveTextContent('');
  });

  it('announces a message that arrives live after the room is open', () => {
    const { rerender } = render(<FeedAnnouncer entries={[chat(1, 'A', 'hi')]} />);
    expect(screen.getByRole('status')).toHaveTextContent('');
    rerender(<FeedAnnouncer entries={[chat(1, 'A', 'hi'), chat(2, 'Team Rocket', 'yo')]} />);
    expect(screen.getByRole('status')).toHaveTextContent('New message from Team Rocket');
  });

  it('stays silent when a Pick arrives live - the room-level PickAnnouncer speaks it (#513)', () => {
    // Picks moved to a room-level announcer (PickAnnouncer, #513) so they are
    // heard on every tab. The feed announcer must NOT also speak a Pick, or a
    // reader with Chat mounted would hear it twice. It still advances its own
    // high-water seq past the Pick (below) so a later message is not mistaken
    // for backlog.
    const { rerender } = render(<FeedAnnouncer entries={[chat(1, 'A', 'hi')]} />);
    rerender(<FeedAnnouncer entries={[chat(1, 'A', 'hi'), pick(2, 'Gridiron Giants', 'Justin Jefferson')]} />);
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
    // A human message arriving AFTER the (silent) Pick still announces: the Pick
    // advanced the seq high-water mark but did not leave the announcer stuck.
    rerender(
      <FeedAnnouncer
        entries={[chat(1, 'A', 'hi'), pick(2, 'Gridiron Giants', 'Justin Jefferson'), chat(3, 'Team Rocket', 'gg')]}
      />
    );
    expect(screen.getByRole('status')).toHaveTextContent('New message from Team Rocket');
  });

  it('a Pick does not blank a still-unread message announcement (#513)', () => {
    // feedAnnouncementFor returns '' for a Pick now, but a Pick tail must be a
    // NO-OP here, not the empty-clear that hidden arrivals and the viewer's own
    // message take: otherwise the previous "New message from X" is wiped the
    // instant a Pick lands, and Picks land constantly in an active draft, so a
    // reader could lose a message announcement a fraction of a second after it
    // was written.
    const { rerender } = render(<FeedAnnouncer entries={[chat(1, 'A', 'old')]} />);
    // A live message announces...
    rerender(<FeedAnnouncer entries={[chat(1, 'A', 'old'), chat(2, 'Rivals', 'hi')]} />);
    expect(screen.getByRole('status')).toHaveTextContent('New message from Rivals');
    // ...then a Pick lands. The message announcement must survive it untouched.
    rerender(
      <FeedAnnouncer
        entries={[chat(1, 'A', 'old'), chat(2, 'Rivals', 'hi'), pick(3, 'Bulldogs', 'Pat Mahomes')]}
      />
    );
    expect(screen.getByRole('status')).toHaveTextContent('New message from Rivals');
  });

  it('a Draft LIFECYCLE entry does not blank a pending message announcement either (#513)', () => {
    // The no-op keys on type === 'draft_activity', not kind === 'pick', so every
    // lifecycle transition (the authoritative kind set is ALL_KINDS in the server
    // draft-activity module; DraftActivityEntry.jsx's router is only its
    // renderable subset) is covered by the same guard as Picks: they too
    // used to fall into the empty-clear and must now leave a still-unread message
    // announcement intact.
    const { rerender } = render(<FeedAnnouncer entries={[chat(1, 'A', 'old')]} />);
    rerender(<FeedAnnouncer entries={[chat(1, 'A', 'old'), chat(2, 'Rivals', 'hi')]} />);
    expect(screen.getByRole('status')).toHaveTextContent('New message from Rivals');
    // A lifecycle activity entry (a pause) arrives after the message...
    rerender(
      <FeedAnnouncer
        entries={[
          chat(1, 'A', 'old'),
          chat(2, 'Rivals', 'hi'),
          { type: 'draft_activity', kind: 'pause', seq: 3, id: 3, teamName: 'A' },
        ]}
      />
    );
    // ...and the message announcement survives it untouched.
    expect(screen.getByRole('status')).toHaveTextContent('New message from Rivals');
  });

  it('stays silent when older entries are prepended (Load older)', () => {
    // loadOlder grows the HEAD; the tail the reader is following is unchanged, so
    // nothing new arrived and nothing is announced.
    const { rerender } = render(<FeedAnnouncer entries={[chat(5, 'A', 'hi')]} />);
    rerender(<FeedAnnouncer entries={[chat(3, 'X', 'ancient'), chat(4, 'Y', 'old'), chat(5, 'A', 'hi')]} />);
    expect(screen.getByRole('status')).toHaveTextContent('');
  });

  it('stays silent when the newest entry is Draft lifecycle activity', () => {
    const { rerender } = render(<FeedAnnouncer entries={[chat(1, 'A', 'hi')]} />);
    rerender(
      <FeedAnnouncer entries={[chat(1, 'A', 'hi'), { type: 'draft_activity', kind: 'pause', seq: 2, id: 2, teamName: 'A' }]} />
    );
    expect(screen.getByRole('status')).toHaveTextContent('');
  });

  it('announces each successive live arrival', () => {
    const { rerender } = render(<FeedAnnouncer entries={[chat(1, 'A', 'hi')]} />);
    rerender(<FeedAnnouncer entries={[chat(1, 'A', 'hi'), chat(2, 'B', 'one')]} />);
    expect(screen.getByRole('status')).toHaveTextContent('New message from B');
    rerender(<FeedAnnouncer entries={[chat(1, 'A', 'hi'), chat(2, 'B', 'one'), chat(3, 'C', 'two')]} />);
    expect(screen.getByRole('status')).toHaveTextContent('New message from C');
  });

  it('re-announces a SECOND message from the SAME Team (identical text still mutates the region)', () => {
    // Two consecutive messages from one Team describe identically. Without a
    // discriminator React would bail on the Object.is-equal state and the second
    // would be silent. The region's text node must change between them.
    const { rerender } = render(<FeedAnnouncer entries={[chat(1, 'A', 'hi')]} />);
    const region = screen.getByRole('status');

    rerender(<FeedAnnouncer entries={[chat(1, 'A', 'hi'), chat(2, 'Harbor Hawks', 'one')]} />);
    expect(region).toHaveTextContent('New message from Harbor Hawks');
    const afterFirst = region.textContent;

    rerender(<FeedAnnouncer entries={[chat(1, 'A', 'hi'), chat(2, 'Harbor Hawks', 'one'), chat(3, 'Harbor Hawks', 'two')]} />);
    expect(region).toHaveTextContent('New message from Harbor Hawks');
    // The raw text node value changed, so assistive tech re-announces rather than
    // seeing an unchanged node and staying silent.
    expect(region.textContent).not.toBe(afterFirst);
    // ...and the discriminator is specifically the zero-width space, nothing
    // visible or spoken. not.toBe above proves only that SOMETHING changed - a
    // visible char (even String.fromCharCode(0x2014), which leaves no em-dash byte
    // for the guard) would satisfy it and the substring toHaveTextContent both,
    // while a screen reader began speaking it. Pin U+200B exactly, built from its
    // code point so no invisible literal sits in this file either.
    expect(region.textContent).toBe('New message from Harbor Hawks' + String.fromCharCode(0x200b));
  });

  it('re-announces the FOURTH of A, A, B, B - a different message between two repeat-pairs', () => {
    // The interleaving a global parity counter gets wrong. After A, A, B the
    // counter has flipped on the second A and stayed put through the first B; the
    // fourth event (a second B) lands on the un-flipped value, byte-identical to
    // the third, so the region's node does not change and the second B is silent.
    // Comparing against the CURRENTLY RENDERED text instead cannot desync, so
    // each of the four events must change the raw text node.
    const { rerender } = render(<FeedAnnouncer entries={[chat(1, 'A', 'seed')]} />);
    const region = screen.getByRole('status');

    rerender(<FeedAnnouncer entries={[chat(1, 'A', 'seed'), chat(2, 'Harbor Hawks', 'a')]} />); // A
    expect(region).toHaveTextContent('New message from Harbor Hawks');
    const afterA1 = region.textContent;

    rerender(<FeedAnnouncer entries={[chat(1, 'A', 'seed'), chat(2, 'Harbor Hawks', 'a'), chat(3, 'Harbor Hawks', 'b')]} />); // A repeat
    expect(region).toHaveTextContent('New message from Harbor Hawks');
    const afterA2 = region.textContent;
    expect(afterA2).not.toBe(afterA1);

    rerender(
      <FeedAnnouncer
        entries={[chat(1, 'A', 'seed'), chat(2, 'Harbor Hawks', 'a'), chat(3, 'Harbor Hawks', 'b'), chat(4, 'Gridiron Giants', 'c')]}
      />
    ); // B
    expect(region).toHaveTextContent('New message from Gridiron Giants');
    const afterB1 = region.textContent;
    expect(afterB1).not.toBe(afterA2);

    rerender(
      <FeedAnnouncer
        entries={[
          chat(1, 'A', 'seed'),
          chat(2, 'Harbor Hawks', 'a'),
          chat(3, 'Harbor Hawks', 'b'),
          chat(4, 'Gridiron Giants', 'c'),
          chat(5, 'Gridiron Giants', 'd'),
        ]}
      />
    ); // B repeat - the event the broken counter leaves silent
    expect(region).toHaveTextContent('New message from Gridiron Giants');
    // The fourth event's node value must differ from the third's, or the second
    // Gridiron Giants message is never spoken.
    expect(region.textContent).not.toBe(afterB1);
  });

  it('re-announces three or more consecutive byte-identical messages, each changing the node', () => {
    // Cory's second criterion: a run of three-plus identical spoken strings must
    // each change the rendered text node. Capture the raw textContent after each
    // and assert every step differs from the one before it.
    const { rerender } = render(<FeedAnnouncer entries={[chat(1, 'A', 'seed')]} />);
    const region = screen.getByRole('status');

    rerender(<FeedAnnouncer entries={[chat(1, 'A', 'seed'), chat(2, 'Rivals', 'one')]} />);
    expect(region).toHaveTextContent('New message from Rivals');
    const after1 = region.textContent;

    rerender(<FeedAnnouncer entries={[chat(1, 'A', 'seed'), chat(2, 'Rivals', 'one'), chat(3, 'Rivals', 'two')]} />);
    expect(region).toHaveTextContent('New message from Rivals');
    const after2 = region.textContent;
    expect(after2).not.toBe(after1);

    rerender(
      <FeedAnnouncer
        entries={[chat(1, 'A', 'seed'), chat(2, 'Rivals', 'one'), chat(3, 'Rivals', 'two'), chat(4, 'Rivals', 'three')]}
      />
    );
    expect(region).toHaveTextContent('New message from Rivals');
    const after3 = region.textContent;
    expect(after3).not.toBe(after2);
  });

  it('does NOT announce a backlog history replace that resolves after a live seed (#4)', () => {
    // A live message (seq 50) seeds the announcer, then a wholesale /draft-feed
    // history replace lands older rows and the tail drops to seq 40. That is not
    // a new arrival, and the monotonic-seq guard keeps it silent.
    const { rerender } = render(<FeedAnnouncer entries={[chat(50, 'Live', 'just now')]} />);
    expect(screen.getByRole('status')).toHaveTextContent('');
    rerender(<FeedAnnouncer entries={[chat(38, 'Old', 'a'), chat(39, 'Old', 'b'), chat(40, 'Old', 'c')]} />);
    expect(screen.getByRole('status')).toHaveTextContent('');
  });

  it("does not announce the viewer's OWN message, but does announce another Team's (#9)", () => {
    const { rerender } = render(
      <FeedAnnouncer entries={[chat(1, 'Mine', 'hi', 11)]} viewerTeamId={11} />
    );
    // The viewer's own live message is echoed by the server; do not read it back.
    rerender(
      <FeedAnnouncer entries={[chat(1, 'Mine', 'hi', 11), chat(2, 'Mine', 'again', 11)]} viewerTeamId={11} />
    );
    expect(screen.getByRole('status')).toHaveTextContent('');
    // Another Team's message announces normally.
    rerender(
      <FeedAnnouncer
        entries={[chat(1, 'Mine', 'hi', 11), chat(2, 'Mine', 'again', 11), chat(3, 'Rivals', 'gg', 12)]}
        viewerTeamId={11}
      />
    );
    expect(screen.getByRole('status')).toHaveTextContent('New message from Rivals');
  });

  // The copy assertions that used to live one layer down, against
  // feedAnnouncementFor directly (feedAnnouncement.test.js, now deleted), moved
  // up here as assertions on the rendered region's text (#791, ADR 0028 ruling
  // 5): feedAnnouncementFor is now module-private to this file.
  it('treats an untyped entry as a League chat message', () => {
    // feedEntryKey defaults a missing type to league_chat; the announcer agrees.
    const { rerender } = render(<FeedAnnouncer entries={[chat(1, 'A', 'seed')]} />);
    rerender(
      <FeedAnnouncer
        entries={[chat(1, 'A', 'seed'), { seq: 2, id: 2, teamName: 'Blue Bombers', message: 'hi' }]}
      />
    );
    expect(screen.getByRole('status')).toHaveTextContent('New message from Blue Bombers');
  });

  it('names a departed author as a former manager, never blank or "null"', () => {
    const { rerender } = render(<FeedAnnouncer entries={[chat(1, 'A', 'seed')]} />);
    rerender(
      <FeedAnnouncer
        entries={[chat(1, 'A', 'seed'), { type: 'league_chat', seq: 2, id: 2, teamName: null, message: 'x' }]}
      />
    );
    expect(screen.getByRole('status')).toHaveTextContent('New message from Former manager');
  });

  it('says nothing for a message that arrived already hidden', () => {
    // A tombstoned entry is not new correspondence to announce (#482).
    const { rerender } = render(<FeedAnnouncer entries={[chat(1, 'A', 'seed')]} />);
    rerender(<FeedAnnouncer entries={[chat(1, 'A', 'seed'), chat(2, 'Rivals', 'hi')]} />);
    expect(screen.getByRole('status')).toHaveTextContent('New message from Rivals');
    rerender(
      <FeedAnnouncer
        entries={[
          chat(1, 'A', 'seed'),
          chat(2, 'Rivals', 'hi'),
          { type: 'league_chat', seq: 3, id: 3, teamName: 'Team Rocket', hidden: true, message: 'x' },
        ]}
      />
    );
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });

  it('no longer announces an autopick either (#513)', () => {
    const { rerender } = render(<FeedAnnouncer entries={[chat(1, 'A', 'seed')]} />);
    rerender(
      <FeedAnnouncer
        entries={[
          chat(1, 'A', 'seed'),
          {
            type: 'draft_activity',
            kind: 'pick',
            seq: 2,
            id: 2,
            teamName: 'Gridiron Giants',
            isAutopick: true,
            player: { name: 'Bijan Robinson' },
          },
        ]}
      />
    );
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });

  it('says nothing for any Draft activity - Picks and every lifecycle kind alike (#513)', () => {
    // AC2 no longer names Picks here (#513 moved them to PickAnnouncer). Live
    // draft-state is carried by the on-the-clock (LiveDraftBanner), countdown
    // (#117), readiness (#164) and the room-level Pick announcer; announcing any
    // of it in the feed too would only add contention or duplicate speech.
    //
    // Iterates the server's exported ALL_KINDS (#654) rather than a hand-written
    // list, so a kind added to the server roster - 'stalled' included - is
    // covered here without editing this test.
    for (const kind of ALL_KINDS) {
      const { rerender, unmount } = render(<FeedAnnouncer entries={[chat(1, 'A', 'seed')]} />);
      rerender(
        <FeedAnnouncer
          entries={[chat(1, 'A', 'seed'), { type: 'draft_activity', kind, seq: 2, id: 2, teamName: 'Gridiron Giants' }]}
        />
      );
      expect(screen.getByRole('status')).toBeEmptyDOMElement();
      unmount();
    }
  });

  it('uses no em-dashes in any announcement (house style, guarded copy)', () => {
    const { rerender } = render(<FeedAnnouncer entries={[chat(1, 'A', 'seed')]} />);
    rerender(<FeedAnnouncer entries={[chat(1, 'A', 'seed'), chat(2, 'A', 'x')]} />);
    // The literal em dash (U+2014, bytes e2 80 94) the guards chain forbids in
    // user-facing copy.
    expect(screen.getByRole('status').textContent).not.toMatch(/—/);
  });
});
