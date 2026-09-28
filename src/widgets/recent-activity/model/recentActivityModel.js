import { formatTimeSince } from '../../../shared/lib';

/**
 * Pure presentation helpers for the recent-activity widget (ticket #1105).
 * Both functions are exercised directly by recentActivityModel.test.js and
 * consumed only by ../ui/RecentActivity.jsx; nothing here reads a row's raw
 * server fields (`team_name`, `created_at`, ...) - that mapping is
 * `entities/activity`'s job (ADR 0029), and this module only ever sees the
 * read model it already produced (`type`, `at`).
 */

// The five transaction types `GET /api/league/:id/transactions` documents
// (entities/activity/model/activityModel.js), each with the Badge variant and
// label the issue's mockup (docs/design/league-dashboard-v2/build.mjs,
// `recentActivity()`) pins for it. A commissioner row's label is "Settings",
// not "Commissioner": the badge names the ACTION (a settings change), and the
// row's own Team column separately reads "Commissioner" for WHO made it.
//
// `stat_correction` is a sixth, documented row shape carried by the same
// entity (an NFL stat-correction row, entities/activity's own module
// docblock) that this card's mockup does not name a chip for. It gets an
// explicit entry rather than falling through to `activityBadge`'s generic
// fallback below, which would otherwise announce the raw enum
// ("Stat_correction", underscore and all) in a design-pinned chip row.
//
// `recap` is a seventh (a generated weekly recap being published, #1134):
// the fallback below happens to read "Recap" too since the raw type has no
// underscore, but it gets the same explicit treatment as stat_correction
// rather than leaning on that coincidence.
const TYPE_BADGE = {
  add: { variant: 'success', label: 'Add' },
  drop: { variant: 'danger', label: 'Drop' },
  trade: { variant: 'live', label: 'Trade' },
  waiver: { variant: 'neutral', label: 'Waiver' },
  commissioner: { variant: 'warning', label: 'Settings' },
  stat_correction: { variant: 'neutral', label: 'Stat correction' },
  recap: { variant: 'neutral', label: 'Recap' },
};

/**
 * The Badge `{ variant, label }` for a transaction row's `type`. A type this
 * table does not carry (a future server addition) degrades to a neutral chip
 * labelled with the type word itself, rather than throwing or rendering
 * blank.
 */
export function activityBadge(type) {
  const known = TYPE_BADGE[type];
  // A copy, not the table entry itself: a caller that mutated the returned
  // object would otherwise corrupt TYPE_BADGE process-wide.
  if (known) return { ...known };
  return {
    variant: 'neutral',
    label: typeof type === 'string' && type ? `${type[0].toUpperCase()}${type.slice(1)}` : 'Activity',
  };
}

/**
 * The row's timestamp as the card's right-hand relative mark: the app's one
 * time-since ladder in its compact style ("2h ago", "Yesterday", "Mon", then a
 * short date; shared/lib formatTimeSince), capitalized because it starts a
 * cell of its own ("Just now"). `now` and `locale` pin the output for a test.
 * Absent or unreadable input is null, so the cell renders nothing.
 */
export function formatActivityTime(at, now = Date.now(), locale) {
  const text = formatTimeSince(at, { now, locale, compact: true });
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : null;
}
