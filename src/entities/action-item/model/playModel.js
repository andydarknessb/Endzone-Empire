const HOUR_MS = 60 * 60 * 1000;

const timeMs = (value) => {
  const at = value ? new Date(value).getTime() : NaN;
  return Number.isNaN(at) ? null : at;
};

// The noun a Play names an item by when several share a lock, keyed on the item's `type`.
const NOUN = {
  picks_open: 'Picks',
  lineup_problem: 'Lineup',
  draft_live: 'Draft',
  seats_open: 'Open seats',
  trade_review: 'Trade review',
  trade_offer: 'Trade offer',
  join_requests: 'Join requests',
  waiver_claims: 'Waivers',
};

/** A Play's name: the item's title, or the distinct nouns of its items joined ("Lineup and picks"). */
export function playName(feet) {
  if (feet.length === 1) return feet[0].title;
  const [first, ...others] = [...new Set(feet.map((foot) => NOUN[foot.type] || foot.title))];
  return [first, ...others.map((noun) => noun.charAt(0).toLowerCase() + noun.slice(1))].join(' and ');
}

// One name per distinct league (by id), so two leagues sharing a name still count as two.
const leagueNames = (feet) => [...new Map(feet.filter((f) => f.leagueName).map((f) => [f.leagueId, f.leagueName])).values()];

// Info rows (FYI, nothing to do) and join requests are the sideline, not Plays.
const isSideline = (item) => item.severity === 'info' || item.type === 'join_requests';

/**
 * Plays over the Action items `GET /api/user/action-items` returns (CONTEXT.md: Play). Pure.
 *
 * The Shared Lock Rule: items with the identical `deadlineAt` are ONE Play, whatever their type and
 * across leagues, with a foot per item; an item with no deadline is a Play of its own. Plays run
 * earliest lock first, then the untimed in the server's order. Feet run by league name, then in the
 * server's order. Info items and join requests are `sideline`, never Plays. With `leagueId` only that
 * league's items count. `lead` is the first Play, `count` the number of Plays, `urgent` is true when
 * any Play item locks from `now` up to 60 minutes later.
 *
 * @param {Array} items the wire items (id, type, leagueId, leagueName, title, detail, severity, deadlineAt, cta)
 * @param {{ now: number|Date, leagueId?: number|string }} ctx
 * @returns {{ plays: Array, sideline: Array, lead: object|null, count: number, empty: boolean, urgent: boolean }}
 *   a Play is `{ key, deadlineAt, at, name, feet: [item], leagues: [leagueName] }`
 */
export function playModel(items, { now, leagueId = null }) {
  const nowMs = new Date(now).getTime();
  const mine = (Array.isArray(items) ? items : [])
    .filter((i) => leagueId == null || String(i.leagueId) === String(leagueId));
  const sideline = mine.filter(isSideline);
  const actionable = mine.filter((i) => !isSideline(i));

  const groups = [];
  const byTime = new Map();
  actionable.forEach((item, index) => {
    const at = timeMs(item.deadlineAt);
    let group = at == null ? null : byTime.get(at);
    if (!group) {
      group = { key: at == null ? `item:${item.id ?? index}` : `at:${at}`, deadlineAt: at == null ? null : item.deadlineAt, at, feet: [] };
      groups.push(group);
      if (at != null) byTime.set(at, group);
    }
    group.feet.push(item);
  });

  // Array.prototype.sort is stable, so equal and null deadlines keep server order.
  groups.sort((a, b) => (a.at ?? Infinity) - (b.at ?? Infinity) || 0);
  const plays = groups.map((group) => {
    const feet = [...group.feet].sort((a, b) => String(a.leagueName ?? '').localeCompare(String(b.leagueName ?? '')));
    return { ...group, feet, name: playName(feet), leagues: leagueNames(feet) };
  });

  const urgent = plays.some(({ at }) => at != null && at >= nowMs && at - nowMs <= HOUR_MS);

  return { plays, sideline, lead: plays[0] ?? null, count: plays.length, empty: plays.length === 0, urgent };
}
