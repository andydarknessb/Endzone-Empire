import React from 'react';
import { render, screen } from '@testing-library/react';
import FeedAnnouncer from './FeedAnnouncer';

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

  it('announces a Pick that arrives live', () => {
    const { rerender } = render(<FeedAnnouncer entries={[chat(1, 'A', 'hi')]} />);
    rerender(<FeedAnnouncer entries={[chat(1, 'A', 'hi'), pick(2, 'Gridiron Giants', 'Justin Jefferson')]} />);
    expect(screen.getByRole('status')).toHaveTextContent('Gridiron Giants drafted Justin Jefferson');
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
});
