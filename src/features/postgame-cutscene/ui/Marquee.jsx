import React, {
  useEffect, useLayoutEffect, useRef, useState,
} from 'react';
import PropTypes from 'prop-types';
import { TeamAvatar } from '../../../shared/ui';
import './Marquee.css';

// Timing ledger: the marquee moves in whole steps, MARQUEE_STEP_PX every
// MARQUEE_STEP_MS (~8 px, 10 steps a second), never a smooth slide.
export const MARQUEE_STEP_PX = 8;
export const MARQUEE_STEP_MS = 100;
export const MARQUEE_AVATAR_PX = 32;
// Steps held back from the budget: the marquee mounts a render after the beat
// starts and interval ticks can lag, so the last step or two may land after onDone.
export const MARQUEE_SLACK_STEPS = 2;

/**
 * A one-line stepped ticker: the viewer's 32 px avatar leads `text`, and the
 * pair crosses right to left and wraps. The text is whole (never truncated or
 * ellipsized); only the track's transform moves.
 *
 * The step rate is fixed, so a track wider than the distance the marquee can
 * travel in `visibleByMs` would never be seen whole. Such a track starts part
 * of the way in, timed so its right edge reaches the box's right edge
 * MARQUEE_SLACK_STEPS before `visibleByMs`. A track wider than the box plus
 * that travel starts with its head already past the left edge: at a fixed step
 * rate the head is what gives way, and the tail (the opponent) is always seen.
 * A shorter track still enters from just off the right edge.
 */
function Marquee({
  text, name, avatarUrl, visibleByMs,
}) {
  const [step, setStep] = useState(0);
  const [widths, setWidths] = useState({ box: 0, track: 0 });
  const boxRef = useRef(null);
  const trackRef = useRef(null);

  useLayoutEffect(() => {
    const measure = () => setWidths({
      box: boxRef.current ? boxRef.current.clientWidth : 0,
      track: trackRef.current ? trackRef.current.scrollWidth : 0,
    });
    measure();
    // The pixel font swaps in after the first paint and changes the width.
    let live = true;
    const fonts = typeof document !== 'undefined' ? document.fonts : null;
    if (fonts && fonts.ready) fonts.ready.then(() => { if (live) measure(); });
    return () => { live = false; };
  }, [text]);

  useEffect(() => {
    const id = setInterval(() => setStep((s) => s + 1), MARQUEE_STEP_MS);
    return () => clearInterval(id);
  }, []);

  // One lap: from just off the right edge to just past the left one. The slack
  // steps are counted out of the budget so a late tick cannot be the one that
  // reveals the tail.
  const lastStep = visibleByMs ? Math.max(0, Math.floor(visibleByMs / MARQUEE_STEP_MS) - MARQUEE_SLACK_STEPS) : Infinity;
  const head = Number.isFinite(lastStep)
    ? Math.max(0, widths.track - lastStep * MARQUEE_STEP_PX)
    : 0;
  const lap = Math.max(1, widths.box + widths.track);
  const x = widths.box - ((step * MARQUEE_STEP_PX + head) % lap);

  return (
    <div className="postgame-marquee" ref={boxRef} data-testid="postgame-marquee" aria-hidden="true">
      <div
        className="postgame-marquee-track"
        data-testid="postgame-marquee-track"
        ref={trackRef}
        style={{ transform: `translateX(${x}px)` }}
      >
        <span className="postgame-marquee-avatar" data-testid="postgame-marquee-avatar">
          <TeamAvatar name={name} avatarUrl={avatarUrl} avatarStaticUrl={avatarUrl} size={MARQUEE_AVATAR_PX} />
        </span>
        <span className="postgame-marquee-text" data-testid="postgame-marquee-text">{text}</span>
      </div>
    </div>
  );
}

Marquee.propTypes = {
  text: PropTypes.string.isRequired,
  name: PropTypes.string,
  avatarUrl: PropTypes.string,
  /** The time the marquee is on screen; the whole track is seen at least once within it. */
  visibleByMs: PropTypes.number,
};

export default Marquee;
