import React, {
  Suspense, useCallback, useEffect, useState,
} from 'react';
import PropTypes from 'prop-types';
import { lazyWithReload } from '../../../shared/lib';

// One chunk holds the title card, the queue, the scenes and (later) the audio,
// and it is fetched only when the list is non-empty: Home stays inside the
// initial JavaScript budget.
const PostgameStage = lazyWithReload(() => import('./PostgameStage'));

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
  // The live region is mounted from the start and only its text changes, which
  // is what screen readers announce reliably; a region inserted already holding
  // its text often is not.
  return (
    <>
      {!finished && (
        <Suspense fallback={null}>
          <PostgameStage cutscenes={cutscenes} onFinish={handleFinish} />
        </Suspense>
      )}
      <div role="status" className="postgame-status">
        {overflowText && <div className="postgame-snackbar">{overflowText}</div>}
      </div>
    </>
  );
}

PostgameCutscenes.propTypes = {
  cutscenes: PropTypes.array,
};

export default PostgameCutscenes;
