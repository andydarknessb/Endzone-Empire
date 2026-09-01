import React from 'react';
import { render, screen } from '@testing-library/react';
import StallAnnouncer from './StallAnnouncer';

// A live stalled entry as the room records it from the draft:activity seam
// (#648): a fresh object per stall, so its identity changes and the effect fires.
const stall = (teamName = 'MinneApple', seq = 30) => ({
  type: 'draft_activity',
  kind: 'stalled',
  id: seq,
  seq,
  teamName,
  created_at: '2026-09-01T00:00:00.000Z',
});

// A stall-relevant lifecycle entry that is NOT the stall itself: an exit
// (resume/reset/complete) that ends the stuck state, or a pause that does not.
const lifecycle = (kind, seq = 40) => ({
  type: 'draft_activity',
  kind,
  id: seq,
  seq,
  teamName: 'Commish FC',
  created_at: '2026-09-01T00:05:00.000Z',
});

describe('StallAnnouncer', () => {
  it('mounts a persistent polite status region, silent to start', () => {
    render(<StallAnnouncer stall={null} />);
    const region = screen.getByRole('status');
    expect(region).toHaveAttribute('aria-live', 'polite');
    // The region exists and is empty rather than absent, so a later change lands
    // on a node assistive tech is already observing (the #164 lesson).
    expect(region).toHaveTextContent('');
  });

  it('announces a live stall: names the cause and the commissioner next step, Team not the actor (AC1)', () => {
    const { rerender } = render(<StallAnnouncer stall={null} />);
    expect(screen.getByRole('status')).toHaveTextContent('');

    rerender(<StallAnnouncer stall={stall('MinneApple')} />);
    const region = screen.getByRole('status');
    expect(region).toHaveTextContent('no draftable player');
    expect(region).toHaveTextContent('A commissioner must resolve and resume');
    // The Team is named (it locates the stuck pick)...
    expect(region).toHaveTextContent('MinneApple');
    // ...but never as the actor (#620): no "<Team> stalled the draft".
    expect(region.textContent).not.toMatch(/stalled the draft/i);
    expect(region.textContent).not.toMatch(/MinneApple (stalled|paused)/i);
  });

  it('announces each successive stall', () => {
    const { rerender } = render(<StallAnnouncer stall={null} />);
    rerender(<StallAnnouncer stall={stall('MinneApple', 30)} />);
    expect(screen.getByRole('status')).toHaveTextContent('The draft is stuck on MinneApple');
    rerender(<StallAnnouncer stall={stall('Gridiron', 40)} />);
    expect(screen.getByRole('status')).toHaveTextContent('The draft is stuck on Gridiron');
  });

  it('does not re-announce on an ordinary rerender that does not change the stall', () => {
    // A parent rerender (a pool refetch, a clock tick) that hands the SAME stall
    // object back must not re-fire the region; only a genuinely new stall does.
    const landed = stall('MinneApple');
    const { rerender } = render(<StallAnnouncer stall={landed} />);
    const region = screen.getByRole('status');
    expect(region).toHaveTextContent('The draft is stuck on MinneApple');
    const after = region.textContent;
    rerender(<StallAnnouncer stall={landed} />);
    // Same object identity: the announcement text node is untouched.
    expect(region.textContent).toBe(after);
  });

  it('re-announces a SECOND stall whose text is byte-identical to the first', () => {
    // A stall on one Team resolves and resumes, then stalls again on the same Team
    // with the same cause: the two announcements are byte-identical. React bails on
    // an Object.is-equal string, so without a discriminator the second is silent.
    // The raw node value must change between them (a zero-width space).
    const { rerender } = render(<StallAnnouncer stall={null} />);
    const region = screen.getByRole('status');

    // Two distinct stall objects (identity differs, so the effect runs) whose
    // announcement text is identical.
    rerender(<StallAnnouncer stall={stall('MinneApple', 30)} />);
    expect(region).toHaveTextContent('The draft is stuck on MinneApple');
    const afterFirst = region.textContent;

    rerender(<StallAnnouncer stall={stall('MinneApple', 44)} />);
    expect(region).toHaveTextContent('The draft is stuck on MinneApple');
    // The raw text node value changed (an invisible, unspoken discriminator), so
    // assistive tech re-announces rather than seeing an unchanged node.
    expect(region.textContent).not.toBe(afterFirst);
    // ...and the discriminator is specifically U+200B, nothing visible or spoken,
    // built from its code point so no invisible literal sits in this file either.
    expect(region.textContent).toBe(afterFirst + String.fromCharCode(0x200b));
  });

  it.each(['resume', 'reset', 'complete'])(
    'clears the announcement when the stuck state ends on %s (#653): a stall is a STATE, so an exit retracts it',
    (kind) => {
      const { rerender } = render(<StallAnnouncer stall={null} />);
      rerender(<StallAnnouncer stall={stall('MinneApple', 30)} />);
      expect(screen.getByRole('status')).toHaveTextContent('The draft is stuck on MinneApple');
      // The stuck state ends: the region must fall silent, not leave "The draft is
      // stuck" standing in the accessibility tree for the life of the room.
      rerender(<StallAnnouncer stall={lifecycle(kind, 40)} />);
      expect(screen.getByRole('status')).toHaveTextContent('');
    }
  );

  it('does NOT clear on pause: a nothing-draftable stall already implies the draft is paused (ADR 0018)', () => {
    const { rerender } = render(<StallAnnouncer stall={null} />);
    rerender(<StallAnnouncer stall={stall('MinneApple', 30)} />);
    expect(screen.getByRole('status')).toHaveTextContent('The draft is stuck on MinneApple');
    // pause is not an exit, so a standing stall survives it untouched.
    rerender(<StallAnnouncer stall={lifecycle('pause', 40)} />);
    expect(screen.getByRole('status')).toHaveTextContent('The draft is stuck on MinneApple');
  });

  it('re-announces a fresh stall after a clear (stall, resume, stall again)', () => {
    const { rerender } = render(<StallAnnouncer stall={null} />);
    const region = screen.getByRole('status');
    rerender(<StallAnnouncer stall={stall('MinneApple', 30)} />);
    expect(region).toHaveTextContent('The draft is stuck on MinneApple');
    rerender(<StallAnnouncer stall={lifecycle('resume', 40)} />);
    expect(region).toHaveTextContent('');
    // A second stuck state after the resume must announce again from empty.
    rerender(<StallAnnouncer stall={stall('MinneApple', 50)} />);
    expect(region).toHaveTextContent('The draft is stuck on MinneApple');
  });
});
