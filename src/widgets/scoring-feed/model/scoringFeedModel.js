/**
 * Pure helpers for the scoring-feed widget (ADR 0031, #895): the strip line
 * and the feed row are presenters over one item shape, and everything that
 * turns a field of that shape into display text lives here, with no React and
 * no DOM, so it is table-testable.
 *
 * The item shape both surfaces read (the page builds it from the score feed's
 * typed plays and its roster lookup, exactly as the legacy ticker did):
 *
 *   { playerId, name, nflTeam, teamName, pointsDelta, type, isTouchdown,
 *     at (ISO string, epoch ms or Date; optional), side ('home' | 'away' | null) }
 *
 * `side` says which side of the viewer's matchup scored, or null for a play in
 * another matchup; the feed paints it as the home / away / neutral dot.
 */

/** The idle line both surfaces render before the first play of the week lands. */
export const IDLE_LINE = 'Live scoring plays will appear here once games kick off.';

const HOUR_MS = 60 * 60 * 1000;

/** Epoch ms for an `at` value (Date, ISO string or number), or null when it cannot be read. */
export function toMs(at) {
  if (at == null || at === '') return null;
  const ms = at instanceof Date ? at.getTime() : new Date(at).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/**
 * A signed points delta to one decimal: "+10.4", "-2.0", "+0.0". The sign is a
 * hyphen for a negative play (house style: hyphens in scores, never a minus
 * glyph the font may lack), a plus for zero and above. A non-numeric delta
 * reads as "+0.0" rather than "NaN".
 */
export function formatPoints(pointsDelta) {
  const n = Number(pointsDelta);
  const value = Number.isFinite(n) ? n : 0;
  const rounded = Math.round(Math.abs(value) * 10) / 10;
  return `${value < 0 && rounded > 0 ? '-' : '+'}${rounded.toFixed(1)}`;
}

/**
 * The clock time of a play, "3:41 PM", in the viewer's locale (an explicit
 * `locale` is for tests, which need a deterministic form). An absent or
 * unreadable `at` yields '' so the row's time cell stays blank and aligned.
 */
export function formatPlayTime(at, locale) {
  const ms = toMs(at);
  if (ms == null) return '';
  return new Date(ms).toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' });
}

/**
 * How many plays landed in the last rolling hour before `now` (epoch ms; the
 * strip passes its own clock so the count is testable). A play with no `at`
 * is a play just received, so it counts; a play older than an hour does not.
 */
export function playsThisHour(items, now) {
  const list = Array.isArray(items) ? items : [];
  const nowMs = toMs(now) ?? Date.now();
  const since = nowMs - HOUR_MS;
  return list.reduce((count, item) => {
    if (!item) return count;
    const ms = toMs(item.at);
    return ms == null || ms >= since ? count + 1 : count;
  }, 0);
}

/** "1 play this hour" / "6 plays this hour". */
export function playsThisHourLabel(count) {
  return `${count} ${count === 1 ? 'play' : 'plays'} this hour`;
}

/** The dot's key for an item's side: 'home', 'away', or 'neutral' for anything else. */
export function sideKey(side) {
  return side === 'home' || side === 'away' ? side : 'neutral';
}

/** The `dash-*` token the side dot paints, by side key. */
export const SIDE_TOKENS = {
  home: 'var(--dash-home)',
  away: 'var(--dash-away)',
  neutral: 'var(--dash-faint)',
};

/** The visually hidden side text a screen reader hears beside the dot (none for neutral). */
export const SIDE_LABELS = {
  home: 'Home side',
  away: 'Away side',
  neutral: '',
};
