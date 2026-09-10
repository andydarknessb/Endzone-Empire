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

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;

/**
 * The row's timestamp as the card's right-hand relative mark: "Just now" /
 * "Nm ago" / "Nh ago" inside a day, "Yesterday" for the next day back, the
 * short weekday name (e.g. "Mon") through the rest of the week, and a short
 * date beyond that (the year added only when it isn't the current one).
 *
 * Bucketed on ELAPSED time, not calendar-day boundaries: a row logged 90
 * minutes into today reads "1h ago" the same way a row 90 minutes into
 * yesterday's last hour does, rather than one of them jumping to "Yesterday"
 * a few minutes after midnight. This is the same shape `src/utils/
 * formatRelative.js` uses for waiver-clear timestamps; it is not reused here
 * because that helper has no "Yesterday" step and this card's mockup and
 * acceptance criteria both name one explicitly.
 *
 * `now` (epoch ms or a Date) is the clock the buckets are measured against;
 * it defaults to the render time and exists so a test can pin it. `locale`
 * threads through to the weekday/date `toLocaleDateString` calls exactly the
 * way `scoring-feed/model/scoringFeedModel.js`'s `formatPlayTime` takes one:
 * `undefined` in production (the viewer's own locale), pinned to a fixed
 * value by a test so the asserted string does not depend on the machine
 * running it.
 */
export function formatActivityTime(at, now = Date.now(), locale) {
  // Guard against null and undefined before constructing a Date.
  // new Date(null) is the Unix epoch, not an Invalid Date (#1122): without
  // this guard, null becomes "Dec 31, 1969" instead of rendering nothing.
  if (at == null || at === '') {
    return null;
  }

  // Guard against invalid Date objects before date math (#1122).
  if (at instanceof Date && Number.isNaN(at.getTime())) {
    return null;
  }

  const date = at instanceof Date ? at : new Date(at);

  // Return null if the parsed date is invalid
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const nowMs = now instanceof Date ? now.getTime() : now;
  const diffMs = Math.max(0, nowMs - date.getTime());

  if (diffMs < MINUTE_MS) return 'Just now';
  if (diffMs < HOUR_MS) return `${Math.floor(diffMs / MINUTE_MS)}m ago`;
  if (diffMs < DAY_MS) return `${Math.floor(diffMs / HOUR_MS)}h ago`;
  if (diffMs < 2 * DAY_MS) return 'Yesterday';
  if (diffMs < WEEK_MS) return date.toLocaleDateString(locale, { weekday: 'short' });

  const sameYear = date.getFullYear() === new Date(nowMs).getFullYear();
  return date.toLocaleDateString(locale, {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}
