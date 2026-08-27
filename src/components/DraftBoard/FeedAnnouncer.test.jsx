import React from 'react';
import { render, screen } from '@testing-library/react';
import FeedAnnouncer from './FeedAnnouncer';

const chat = (seq, teamName, message) => ({ type: 'league_chat', seq, id: seq, teamName, message });
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
});
