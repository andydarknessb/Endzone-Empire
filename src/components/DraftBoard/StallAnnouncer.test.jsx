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
const resume = (seq, teamName = 'Commish FC') => ({
  type: 'draft_activity', kind: 'resume', seq, id: seq, teamName,
  created_at: '2026-09-01T00:05:00.000Z',
});

describe('StallAnnouncer', () => {
  it('mounts a polite status region, silent to start', () => {
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

  it('announces a stall that arrives BEHIND a later entry in one multi-entry slice (not just the tail)', () => {
    // The feed does not arrive one entry at a time: useDraftRoomFeed commits a
    // whole live/reconnect slice in ONE setEntries. A stall committed alongside a
    // trailing chat message (e.g. a reconnect resume slice) is NOT the tail. It
    // must still be announced - and its seq must not be silently skipped past.
    const { rerender } = render(<StallAnnouncer entries={[chat(29)]} />);
    expect(screen.getByRole('status')).toHaveTextContent('');
    // seq 30 stall, seq 31 chat, delivered together; tail is the chat.
    rerender(<StallAnnouncer entries={[chat(29), stalled(30, 'MinneApple'), chat(31, 'Rivals')]} />);
    const region = screen.getByRole('status');
    expect(region).toHaveTextContent('The draft is stuck on MinneApple');
    expect(region).toHaveTextContent('A commissioner must resolve and resume');
  });

  it('clears when the draft resumes: a resume ends the stuck state, so the region falls silent', () => {
    // A stall is a STATE, not an event: it must not linger in the accessibility
    // tree (visuallyHidden is clip-based, so the text stays readable in browse
    // mode) after the commissioner resolved it and the draft resumed.
    const { rerender } = render(<StallAnnouncer entries={[chat(1)]} />);
    rerender(<StallAnnouncer entries={[chat(1), stalled(2, 'MinneApple')]} />);
    expect(screen.getByRole('status')).toHaveTextContent('The draft is stuck on MinneApple');
    // The commissioner resolves and resumes.
    rerender(<StallAnnouncer entries={[chat(1), stalled(2, 'MinneApple'), resume(3)]} />);
    expect(screen.getByRole('status')).toHaveTextContent('');
  });

  it('nets to resumed when a stall and a resume arrive in the same slice (newest transition wins)', () => {
    const { rerender } = render(<StallAnnouncer entries={[chat(1)]} />);
    // stalled(2) then resume(3) committed together: the draft stuck then resumed,
    // so the net state is not-stuck and nothing should be left announced.
    rerender(<StallAnnouncer entries={[chat(1), stalled(2, 'MinneApple'), resume(3)]} />);
    expect(screen.getByRole('status')).toHaveTextContent('');
  });

  it('stays silent when older entries are prepended (Load older)', () => {
    // loadOlder grows the HEAD; the tail is unchanged, so nothing new arrived.
    const { rerender } = render(<StallAnnouncer entries={[chat(5)]} />);
    rerender(<StallAnnouncer entries={[stalled(3, 'MinneApple'), chat(4), chat(5)]} />);
    expect(screen.getByRole('status')).toHaveTextContent('');
  });
});
