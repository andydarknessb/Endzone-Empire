import React from 'react';
import { NO_HISTORY_LABEL, formatPoints, timeUntil, reasonLabel } from '../../../shared/lib';

// A player's Clear time in the shared house style ("Clears in 14h 40m").
export function clearsText(availableAt) {
  const until = timeUntil(availableAt, Date.now());
  if (!until || until.passed) return 'Clearing now';
  return until.imminent ? 'Clears in under a minute' : `Clears in ${until.text}`;
}

export function availabilityOf(player) {
  return player.availability?.state || 'free_agent';
}

/** Proj Wk / ROS: a points figure, or - for a week the player can't play -
 * the reason itself, never a fabricated number (ADR 0040: "Unavailable
 * players show the reason, never a number, in the list and on the bars"). */
export function ProjWeekCell({ projWeek, noHistory = false }) {
  if (!projWeek) return <span>-</span>;
  if (projWeek.reason) return <span>{reasonLabel(projWeek.reason) || projWeek.reason}</span>;
  // #1778 (spec #1774): a Position-baseline projection is the position's
  // average, so the column reads "no history" in place of its number. The
  // verdict is the server's (`startVerdict`); an Unavailable reason above
  // already won.
  if (noHistory) return <span>{NO_HISTORY_LABEL}</span>;
  return <span>{formatPoints(projWeek.points)}</span>;
}

/** Ownership: the row's latest ESPN share (`{ share, change }` from the
 * view=cards read, ADR 0041). null when ESPN has no snapshot for the player -
 * renders nothing then, not an "unavailable" label or a dash glyph (ADR 0040
 * Lead correction item 4). */
export function OwnershipCell({ ownership }) {
  const value = typeof ownership === 'number' ? ownership : ownership?.share;
  if (value == null) return null;
  return <span>{`${value}%`}</span>;
}

