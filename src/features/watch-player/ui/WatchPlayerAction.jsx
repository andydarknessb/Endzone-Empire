import React from 'react';
import { Button } from '@mui/material';
import { MIN_TOUCH_TARGET_SX } from '../../../shared/lib';
import { useWatchPlayer } from '../model/useWatchPlayer';

/**
 * The Decision card's Watch action (#1312, ADR 0040 follow-up, grill ruling
 * Q6, the design canvas's CardStates artboard): a full-text toggle button,
 * matching the sibling action-bar buttons' own shape (Claim/Add/Bench/
 * Start), copy "Watch"/"Watching" (issue ruling, no em-dashes). Shown across
 * every Availability context (my_team, free_agent, waivers, rostered), never
 * the `draft` context, which is not an Availability state (ADR 0040's #1313
 * follow-up).
 *
 * `watching` is the caller's own current fact (the #1306 card payload's
 * `watching` field); `onToggled` reports the settled next value so the
 * caller can update its own display without waiting on a second fetch (the
 * `/:id/card` read has no refetch of its own - `shared/lib`'s `useEndpoint`
 * only re-reads on a URL change). `onDone` is the same best-effort refresh
 * hook every other action-bar button already takes (`onActionDone`).
 */
export default function WatchPlayerAction({ playerId, leagueId, watching, onToggled, onDone }) {
  const { toggleWatch, pending } = useWatchPlayer({ leagueId, onDone });

  const handleClick = async () => {
    const outcome = await toggleWatch({ playerId, watching });
    if (outcome.ok) onToggled?.(outcome.watching);
  };

  return (
    <Button
      size="small"
      variant={watching ? 'contained' : 'outlined'}
      disabled={pending || playerId == null}
      onClick={handleClick}
      aria-pressed={watching}
      sx={MIN_TOUCH_TARGET_SX}
      data-testid="watch-player-action"
    >
      {watching ? 'Watching' : 'Watch'}
    </Button>
  );
}
