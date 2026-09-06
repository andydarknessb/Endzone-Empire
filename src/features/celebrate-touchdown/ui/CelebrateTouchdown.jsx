import React from 'react';
import TecmoCutscene from './TecmoCutscene';
import MatchupToasts from './MatchupToasts';

/**
 * The feature's render half (ADR 0031, #903): the toast stack and the cutscene
 * at the head of the queue, driven by the object `useCelebrateTouchdown`
 * returns. The page mounts this once, anywhere in its tree (both pieces are
 * fixed-position overlays), and hands the hook's plays into its own score
 * feed callback. A cutscene remounts per queue entry (keyed by its `_cid`) so
 * two touchdowns by one scorer play as two cutscenes, not one.
 */
export default function CelebrateTouchdown({ celebration }) {
  if (!celebration) return null;
  const { cutscene, dismissCutscene, toasts, dismissToast } = celebration;
  return (
    <>
      <MatchupToasts toasts={toasts} onDismiss={dismissToast} />
      {cutscene && (
        <TecmoCutscene key={cutscene._cid} play={cutscene} onDone={dismissCutscene} />
      )}
    </>
  );
}
