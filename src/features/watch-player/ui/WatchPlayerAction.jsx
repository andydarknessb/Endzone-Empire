import React from 'react';
import { useWatchPlayer } from '../model/useWatchPlayer';
import { PsButton } from '../../../shared/ui/playselect';

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
 *
 * A square ghost toggle (ADR 0067, spec #2347 ruling 7), and the Play-blue selected state while
 * watching, never the green filled action.
 */
export default function WatchPlayerAction({
  playerId, leagueId, watching, onToggled, onDone,
}) {
  const { toggleWatch, pending } = useWatchPlayer({ leagueId, onDone });

  const handleClick = async () => {
    const outcome = await toggleWatch({ playerId, watching });
    if (outcome.ok) onToggled?.(outcome.watching);
  };

  return (
    <PsButton
      variant={watching ? 'selected' : 'ghost'}
      disabled={pending || playerId == null}
      onClick={handleClick}
      aria-pressed={watching}
      data-testid="watch-player-action"
    >
      {watching ? 'Watching' : 'Watch'}
    </PsButton>
  );
}
