import React, {
  lazy, Suspense, useCallback, useEffect, useState,
} from 'react';
import PropTypes from 'prop-types';

// One chunk holds the title card, the queue, the scenes and (later) the audio,
// and it is fetched only when the list is non-empty: Home stays inside the
// initial JavaScript budget.
const PostgameStage = lazy(() => import('./PostgameStage'));

const SNACKBAR_MS = 5000;

/**
 * Mounts the Postgame cutscene for the due list `usePostgameCutscenes` returned.
 * Renders nothing for an empty list. After the last scene it shows the one
 * "{n} MORE RESULTS: {w}-{l}" line for the results beyond the cap.
 */
function PostgameCutscenes({ cutscenes }) {
  const [finished, setFinished] = useState(false);
  const [overflowText, setOverflowText] = useState(null);

  const handleFinish = useCallback(({ overflowText: text }) => {
    setFinished(true);
    setOverflowText(text || null);
  }, []);

  useEffect(() => {
    if (!overflowText) return undefined;
    const id = setTimeout(() => setOverflowText(null), SNACKBAR_MS);
    return () => clearTimeout(id);
  }, [overflowText]);

  if (!cutscenes || cutscenes.length === 0) return null;
  if (finished) {
    return overflowText ? (
      <div className="postgame-snackbar" role="status">{overflowText}</div>
    ) : null;
  }
  return (
    <Suspense fallback={null}>
      <PostgameStage cutscenes={cutscenes} onFinish={handleFinish} />
    </Suspense>
  );
}

PostgameCutscenes.propTypes = {
  cutscenes: PropTypes.array,
};

export default PostgameCutscenes;
