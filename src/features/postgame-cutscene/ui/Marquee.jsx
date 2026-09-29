import React, {
  useEffect, useLayoutEffect, useRef, useState,
} from 'react';
import PropTypes from 'prop-types';
import { TeamAvatar } from '../../../shared/ui';

// Timing ledger: the marquee moves in whole steps, MARQUEE_STEP_PX every
// MARQUEE_STEP_MS (~8 px, 10 steps a second), never a smooth slide.
export const MARQUEE_STEP_PX = 8;
export const MARQUEE_STEP_MS = 100;
export const MARQUEE_AVATAR_PX = 32;

/**
 * A one-line stepped ticker: the viewer's 32 px avatar leads `text`, and the
 * pair enters at the right edge, crosses and wraps. The text is whole (never
 * truncated or ellipsized); only the track's transform moves.
 */
function Marquee({ text, name, avatarStaticUrl }) {
  const [step, setStep] = useState(0);
  const [widths, setWidths] = useState({ box: 0, track: 0 });
  const boxRef = useRef(null);
  const trackRef = useRef(null);

  useLayoutEffect(() => {
    setWidths({
      box: boxRef.current ? boxRef.current.clientWidth : 0,
      track: trackRef.current ? trackRef.current.scrollWidth : 0,
    });
  }, [text]);

  useEffect(() => {
    const id = setInterval(() => setStep((s) => s + 1), MARQUEE_STEP_MS);
    return () => clearInterval(id);
  }, []);

  // One lap: from just off the right edge to just past the left one.
  const lap = Math.max(1, widths.box + widths.track);
  const x = widths.box - ((step * MARQUEE_STEP_PX) % lap);

  return (
    <div className="win-marquee" ref={boxRef} data-testid="win-marquee" aria-hidden="true">
      <div
        className="win-marquee-track"
        data-testid="win-marquee-track"
        ref={trackRef}
        style={{ transform: `translateX(${x}px)` }}
      >
        <span className="win-marquee-avatar" data-testid="win-marquee-avatar">
          <TeamAvatar name={name} avatarUrl={avatarStaticUrl} avatarStaticUrl={avatarStaticUrl} size={MARQUEE_AVATAR_PX} />
        </span>
        <span className="win-marquee-text" data-testid="win-marquee-text">{text}</span>
      </div>
    </div>
  );
}

Marquee.propTypes = {
  text: PropTypes.string.isRequired,
  name: PropTypes.string,
  avatarStaticUrl: PropTypes.string,
};

export default Marquee;
