import React, { useEffect, useState } from 'react';
import PropTypes from 'prop-types';

// Timing ledger for the opening beat, shared with WinScene.css (`win-sweep`
// lasts SWEEP_MS, the green line starts SWEEP_MS after the pink one).
export const SWEEP_MS = 500;
export const SWEEP_STEPS = 8;
/** One character of the typed line every this many ms. */
export const TYPE_STEP_MS = 25;

/**
 * The opening beat every Postgame scene can share: black, a pink and then a
 * green 2 px line sweeping top to bottom on 8 steps, and `text` typing in. It
 * is decoration: the dialog's own name and live region carry the result, so the
 * whole thing is `aria-hidden`. The sweeps are the only flashes it has, one line
 * at a time, so nothing on it flashes more than three times a second.
 */
function Transition({ text }) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const id = setInterval(() => {
      setShown((n) => {
        if (n >= text.length) {
          clearInterval(id);
          return n;
        }
        return n + 1;
      });
    }, TYPE_STEP_MS);
    return () => clearInterval(id);
  }, [text]);

  return (
    <div className="win-transition" data-testid="win-transition" aria-hidden="true">
      <div className="win-sweep win-sweep--pink" />
      <div className="win-sweep win-sweep--green" />
      <div className="win-typed" data-testid="win-typed">{text.slice(0, shown)}</div>
    </div>
  );
}

Transition.propTypes = {
  text: PropTypes.string.isRequired,
};

export default Transition;
