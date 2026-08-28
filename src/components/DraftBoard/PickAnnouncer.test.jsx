import React from 'react';
import { render, screen } from '@testing-library/react';
import PickAnnouncer from './PickAnnouncer';

const pick = (teamName, playerName, auto = false) => ({
  teamName,
  player: { name: playerName },
  auto,
});

describe('PickAnnouncer', () => {
  it('mounts a persistent polite status region, silent to start', () => {
    render(<PickAnnouncer pick={null} />);
    const region = screen.getByRole('status');
    expect(region).toHaveAttribute('aria-live', 'polite');
    // The region exists and is empty rather than absent, so a later change lands
    // on a node assistive tech is already observing (the #164 lesson).
    expect(region).toHaveTextContent('');
  });

  it('announces a Pick that lands after mount', () => {
    const { rerender } = render(<PickAnnouncer pick={null} />);
    expect(screen.getByRole('status')).toHaveTextContent('');
    rerender(<PickAnnouncer pick={pick('Gridiron Giants', 'Justin Jefferson')} />);
    expect(screen.getByRole('status')).toHaveTextContent('Gridiron Giants drafted Justin Jefferson');
  });

  it('announces an autopick as autodrafted', () => {
    const { rerender } = render(<PickAnnouncer pick={null} />);
    rerender(<PickAnnouncer pick={pick('Gridiron Giants', 'Bijan Robinson', true)} />);
    expect(screen.getByRole('status')).toHaveTextContent('Gridiron Giants autodrafted Bijan Robinson');
  });

  it('announces each successive Pick', () => {
    const { rerender } = render(<PickAnnouncer pick={null} />);
    rerender(<PickAnnouncer pick={pick('Team A', 'One Player')} />);
    expect(screen.getByRole('status')).toHaveTextContent('Team A drafted One Player');
    rerender(<PickAnnouncer pick={pick('Team B', 'Two Player')} />);
    expect(screen.getByRole('status')).toHaveTextContent('Team B drafted Two Player');
  });

  it('does not re-announce on an ordinary rerender that does not change the pick', () => {
    // A parent rerender (a pool refetch, a clock tick) that hands the SAME pick
    // object back must not re-fire the region; only a genuinely new Pick does.
    const landed = pick('Team A', 'Same Player');
    const { rerender } = render(<PickAnnouncer pick={landed} />);
    const region = screen.getByRole('status');
    expect(region).toHaveTextContent('Team A drafted Same Player');
    const after = region.textContent;
    rerender(<PickAnnouncer pick={landed} />);
    // Same object identity: the announcement text node is untouched.
    expect(region.textContent).toBe(after);
  });

  it('re-announces a SECOND Pick whose text is byte-identical to the first', () => {
    // Two consecutive Picks can describe identically - two autodrafts of the
    // same-named player by the same Team both read the same string. React bails
    // on an Object.is-equal state, so a byte-identical string would leave the
    // region's text node untouched and the second Pick silent. The node's raw
    // text value must CHANGE between them, which a zero-width space flip does.
    const { rerender } = render(<PickAnnouncer pick={null} />);
    const region = screen.getByRole('status');

    // Two distinct pick objects (identity differs, so the effect runs) whose
    // announcement text is identical.
    rerender(<PickAnnouncer pick={pick('Harbor Hawks', 'John Smith', true)} />);
    expect(region).toHaveTextContent('Harbor Hawks autodrafted John Smith');
    const afterFirst = region.textContent;

    rerender(<PickAnnouncer pick={pick('Harbor Hawks', 'John Smith', true)} />);
    expect(region).toHaveTextContent('Harbor Hawks autodrafted John Smith');
    // The raw text node value changed (an invisible, unspoken discriminator), so
    // assistive tech re-announces rather than seeing an unchanged node.
    expect(region.textContent).not.toBe(afterFirst);
    // ...and the discriminator is specifically the zero-width space, nothing
    // visible or spoken. not.toBe above proves only that SOMETHING changed - a
    // visible char (even String.fromCharCode(0x2014), which leaves no em-dash byte
    // for the guard) would satisfy it and the substring toHaveTextContent both,
    // while a screen reader began speaking it. Pin U+200B exactly, built from its
    // code point so no invisible literal sits in this file either.
    expect(region.textContent).toBe('Harbor Hawks autodrafted John Smith' + String.fromCharCode(0x200b));
  });

  it('re-announces the fourth of A, A, B, B - a different Pick between two repeat-pairs', () => {
    // The interleaving a global parity counter gets wrong: after A, A, B, the
    // fourth event (a second B) must still change the node. A counter that only
    // tracks parity flips on the second A and again on the second B, landing the
    // fourth B on the un-flipped value equal to the third - silent. Comparing
    // against the CURRENTLY RENDERED text instead cannot desync this way. This is
    // the shape #518 fixed in FeedAnnouncer (which now uses the same idiom); here
    // it must hold.
    const { rerender } = render(<PickAnnouncer pick={null} />);
    const region = screen.getByRole('status');

    rerender(<PickAnnouncer pick={pick('Team A', 'Player One')} />); // A
    rerender(<PickAnnouncer pick={pick('Team A', 'Player One')} />); // A (repeat)
    rerender(<PickAnnouncer pick={pick('Team B', 'Player Two')} />); // B
    expect(region).toHaveTextContent('Team B drafted Player Two');
    const afterThird = region.textContent;

    rerender(<PickAnnouncer pick={pick('Team B', 'Player Two')} />); // B (repeat)
    expect(region).toHaveTextContent('Team B drafted Player Two');
    // The fourth event's node value must differ from the third's, or the second
    // B is never spoken.
    expect(region.textContent).not.toBe(afterThird);
  });
});
