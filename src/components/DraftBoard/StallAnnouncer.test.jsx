import React from 'react';
import { render, screen } from '@testing-library/react';
import StallAnnouncer from './StallAnnouncer';

const chat = (seq, teamName = 'A', message = 'hi') => ({
  type: 'league_chat', seq, id: seq, teamName, message,
});
const stalled = (seq, teamName = 'MinneApple') => ({
  type: 'draft_activity', kind: 'stalled', seq, id: seq, teamName,
  created_at: '2026-09-01T00:00:00.000Z',
});
const pick = (seq, teamName = 'Bulldogs', playerName = 'Pat Mahomes') => ({
  type: 'draft_activity', kind: 'pick', seq, id: seq, teamName, player: { name: playerName },
});

describe('StallAnnouncer', () => {
  it('mounts a persistent polite status region, silent to start', () => {
    render(<StallAnnouncer entries={[]} />);
    const region = screen.getByRole('status');
    expect(region).toHaveAttribute('aria-live', 'polite');
    // The region exists and is empty rather than absent, so a later change lands
    // on a node assistive tech is already observing (the #164 lesson).
    expect(region).toHaveTextContent('');
  });

  it('announces a live stall: names the cause and the commissioner next step, Team not the actor (AC1)', () => {
    // Seed silently with an ordinary entry, then a strictly-newer stalled entry
    // arrives live.
    const { rerender } = render(<StallAnnouncer entries={[chat(1)]} />);
    expect(screen.getByRole('status')).toHaveTextContent('');

    rerender(<StallAnnouncer entries={[chat(1), stalled(2, 'MinneApple')]} />);
    const region = screen.getByRole('status');
    expect(region).toHaveTextContent('no draftable player');
    expect(region).toHaveTextContent('A commissioner must resolve and resume');
    // The Team is named (it locates the stuck pick)...
    expect(region).toHaveTextContent('MinneApple');
    // ...but never as the actor (#620): no "<Team> stalled the draft".
    expect(region.textContent).not.toMatch(/stalled the draft/i);
    expect(region.textContent).not.toMatch(/MinneApple (stalled|paused)/i);
  });

  it('does NOT announce a stall that is only in the opening backlog / a history REPLACE (AC3)', () => {
    // The first non-empty feed is backlog, not a live arrival: it seeds the seq
    // high-water mark silently even when a stalled entry is its tail.
    render(<StallAnnouncer entries={[chat(1), stalled(2, 'MinneApple')]} />);
    expect(screen.getByRole('status')).toHaveTextContent('');

    // And a wholesale /draft-feed history REPLACE that resolves AFTER a live seed
    // and drops the tail to an older stalled entry is not new either: the
    // monotonic-seq guard keeps it silent.
    const { rerender } = render(<StallAnnouncer entries={[chat(50)]} />);
    // (second region now exists; scope the assertions to the fresh render's tree)
    rerender(<StallAnnouncer entries={[chat(38), stalled(40, 'MinneApple')]} />);
    const regions = screen.getAllByRole('status');
    regions.forEach((region) => expect(region).toHaveTextContent(''));
  });

  it('stays silent when the newest entry is a NON-stall activity or chat, and does not blank a standing stall', () => {
    const { rerender } = render(<StallAnnouncer entries={[chat(1)]} />);
    // A live stall announces.
    rerender(<StallAnnouncer entries={[chat(1), stalled(2, 'MinneApple')]} />);
    expect(screen.getByRole('status')).toHaveTextContent('The draft is stuck on MinneApple');
    // A Pick lands after it (activity is constant in a draft): the stall
    // announcement must survive untouched, not be blanked.
    rerender(<StallAnnouncer entries={[chat(1), stalled(2, 'MinneApple'), pick(3)]} />);
    expect(screen.getByRole('status')).toHaveTextContent('The draft is stuck on MinneApple');
    // A chat message lands after that: likewise untouched, and NOT announced here.
    rerender(<StallAnnouncer entries={[chat(1), stalled(2, 'MinneApple'), pick(3), chat(4, 'Rivals')]} />);
    expect(screen.getByRole('status')).toHaveTextContent('The draft is stuck on MinneApple');
    expect(screen.getByRole('status').textContent).not.toMatch(/New message/);
  });

  it('re-announces a SECOND stall whose text is byte-identical to the first', () => {
    // A stall on one Team resolves and resumes, then stalls again on the same
    // Team with the same cause: the two announcements are byte-identical. React
    // bails on an Object.is-equal string, so without a discriminator the second
    // is silent. The raw node value must change between them (a zero-width space).
    const { rerender } = render(<StallAnnouncer entries={[chat(1)]} />);
    const region = screen.getByRole('status');

    rerender(<StallAnnouncer entries={[chat(1), stalled(2, 'MinneApple')]} />);
    expect(region).toHaveTextContent('The draft is stuck on MinneApple');
    const afterFirst = region.textContent;

    // A different entry lands between (so the tail key changes), then the same
    // stall recurs at a newer seq.
    rerender(<StallAnnouncer entries={[chat(1), stalled(2, 'MinneApple'), pick(3)]} />);
    rerender(<StallAnnouncer entries={[chat(1), stalled(2, 'MinneApple'), pick(3), stalled(4, 'MinneApple')]} />);
    expect(region).toHaveTextContent('The draft is stuck on MinneApple');
    // The node value changed, so assistive tech re-announces...
    expect(region.textContent).not.toBe(afterFirst);
    // ...and the discriminator is specifically U+200B, nothing visible or spoken.
    expect(region.textContent).toBe(afterFirst + String.fromCharCode(0x200b));
  });

  it('stays silent when older entries are prepended (Load older)', () => {
    // loadOlder grows the HEAD; the tail is unchanged, so nothing new arrived.
    const { rerender } = render(<StallAnnouncer entries={[chat(5)]} />);
    rerender(<StallAnnouncer entries={[stalled(3, 'MinneApple'), chat(4), chat(5)]} />);
    expect(screen.getByRole('status')).toHaveTextContent('');
  });
});
