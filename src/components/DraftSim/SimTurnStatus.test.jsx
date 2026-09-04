import React from 'react';
import { render, screen } from '@testing-library/react';
import SimTurnStatus from './SimTurnStatus';

describe('SimTurnStatus (#819)', () => {
  it('mounts a polite status region', () => {
    render(<SimTurnStatus turnKey={null} text="" />);
    const region = screen.getByRole('status');
    expect(region).toHaveAttribute('aria-live', 'polite');
  });

  it('mounts empty and fills the turn text from an effect after mount (#819 AC2)', () => {
    // A region inserted into the DOM already holding its text is generally not
    // announced (ReadinessAnnouncer.jsx docblock), so an inline turn string
    // leaves the FIRST turn unspoken. The region must mount empty and receive
    // its text from an effect keyed on the pick identity.
    //
    // Red-tell: rendering the turn text inline in the region again (the pre-#819
    // shape) makes it present on the very first commit, before any pick identity
    // keys the effect, so the empty assertion below goes red.
    // A text is supplied but there is no pick identity yet, so nothing is
    // announced: the gate ignores the text until a turn exists. The region is
    // present (a node assistive tech can observe) but empty. textContent, not
    // toHaveTextContent(''), because an empty-string substring match passes
    // against any content. Inline rendering of the text prop would show
    // "Your pick!" here, turning this red.
    const { rerender } = render(<SimTurnStatus turnKey={null} text="Your pick!" />);
    expect(screen.getByRole('status').textContent).toBe('');

    // A pick identity arrives: the effect lands the turn text after mount. The
    // text also differs from the empty render, so this test stays green under
    // the AC7 red-tell that swaps the effect's dependency to the text.
    rerender(<SimTurnStatus turnKey={1} text="Bulldogs is on the clock…" />);
    expect(screen.getByRole('status')).toHaveTextContent('Bulldogs is on the clock…');
  });

  it('re-announces a snake-turnaround turn whose text is byte-identical to the previous pick (#819 AC7)', () => {
    // Snake turnaround: the same team is on the clock for two consecutive picks,
    // so the derived string is byte-identical. React bails on an Object.is-equal
    // state, so without the repeat-safe update the second turn's text node is
    // untouched and a screen reader stays silent. The pick identity (turnKey)
    // advances, so the effect refires and useAnnouncement's zero-width space
    // flips the node value.
    const { rerender } = render(
      <SimTurnStatus turnKey={8} text="Bulldogs is on the clock…" />
    );
    const region = screen.getByRole('status');
    expect(region).toHaveTextContent('Bulldogs is on the clock…');
    const afterFirst = region.textContent;

    // The next pick: the same team is on the clock again (a snake turnaround),
    // a new turnKey, the identical derived string.
    rerender(<SimTurnStatus turnKey={9} text="Bulldogs is on the clock…" />);
    expect(region).toHaveTextContent('Bulldogs is on the clock…');
    // The raw node value changed by exactly a zero-width space (invisible,
    // unspoken), so assistive tech re-announces. Red-tell: keying the effect on
    // the turn text instead of turnKey makes this equal afterFirst (silent).
    expect(region.textContent).not.toBe(afterFirst);
    expect(region.textContent).toBe('Bulldogs is on the clock…' + String.fromCharCode(0x200b));
  });

  it('does not re-fire the region on a rerender that leaves the pick identity unchanged (#819)', () => {
    // Proof the effect keys on turnKey and nothing else: a rerender that changes
    // the text prop but keeps turnKey must leave the region's text node
    // untouched, so an ordinary parent rerender is not an announcement.
    const { rerender } = render(<SimTurnStatus turnKey={3} text="Your pick!" />);
    const region = screen.getByRole('status');
    const after = region.textContent;
    rerender(<SimTurnStatus turnKey={3} text="Something else entirely" />);
    expect(region.textContent).toBe(after);
  });
});
