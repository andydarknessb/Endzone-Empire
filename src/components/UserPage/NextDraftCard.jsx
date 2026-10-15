import React, { useEffect, useRef } from 'react';
import PropTypes from 'prop-types';
import { deriveLeaguePhase, LEAGUE_PHASE } from '../../shared/lib/leaguePhase';
import { formatInstant } from '../../shared/lib/instantFormat';
import { timeUntil } from '../../shared/lib/timeUntil';
import { PlayCard } from './home';

// The featured draft as a Play-select play card (DESIGN.md "Play card", kind
// draft). A draft has no lock, so it leads the page only when no timed play
// exists; ActionQueue decides that and passes `lead`. The draft slot ("you
// pick 7th") is not on the wire yet (#2316), so it never shows.

// A pre-draft league past its draft_date is "late" only for this long; an older
// one is stale (its league card still shows it), not a draft about to start.
const LATE_WINDOW_MS = 24 * 60 * 60 * 1000;

const STATE_RANK = { live: 0, late: 1, scheduled: 2 };

/**
 * Where a league's draft sits for the Home card: 'live' (draft in progress),
 * 'late' (pre-draft, the scheduled time passed within the last 24 hours and
 * nobody has started it), 'scheduled' (pre-draft, time still ahead) or null (no
 * card, including a pre-draft league long past its date). Phase decides
 * live; draft_date only splits the pre-draft leagues.
 */
export function draftState(league, now) {
  const phase = deriveLeaguePhase(league);
  if (phase === LEAGUE_PHASE.DRAFTING) return 'live';
  if (phase !== LEAGUE_PHASE.PRE_DRAFT || !league.draft_date) return null;
  const at = new Date(league.draft_date).getTime();
  if (Number.isNaN(at)) return null;
  if (at > now) return 'scheduled';
  return now - at <= LATE_WINDOW_MS ? 'late' : null;
}

/**
 * The Draft the card features: a draft in progress, else a late one, else the
 * next scheduled one; the earliest draft_date wins within a state. Returns
 * `{ league, state }` or null.
 */
export function featuredDraft(leagues, now = Date.now()) {
  let best = null;
  let bestAt = Infinity;
  (leagues || []).forEach((league) => {
    const state = draftState(league, now);
    if (!state) return;
    const at = league.draft_date ? new Date(league.draft_date).getTime() : Infinity;
    if (best && (STATE_RANK[state] > STATE_RANK[best.state]
      || (state === best.state && at >= bestAt))) return;
    best = { league, state };
    bestAt = at;
  });
  return best;
}

const MAX_TIMEOUT_MS = 2_147_483_647;
const weekday = (at) => new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(at);

// The card's words for each state (build-states2.js). `commissioner` only
// changes the did-not-auto-start copy.
function copy(league, state, now, commissioner) {
  const cta = { label: 'Open draft room', to: `/league/${league.id}/draft` };
  if (state === 'live') {
    return {
      name: 'Draft room open',
      lockDay: 'Live',
      lockTime: 'now',
      lockNote: 'If your clock runs out, autopick covers your turn.',
      ariaLabel: `Open the ${league.name} draft room: the draft is live`,
      cta,
    };
  }
  if (state === 'late') {
    const failed = league.draft_autostart_failed === true;
    let name = 'Draft starting soon';
    let lockNote = 'Your draft is about to start.';
    if (failed) {
      name = commissioner ? 'Draft waiting on you' : 'Draft waiting';
      lockNote = commissioner
        ? "Your draft didn't start on its own."
        : "The draft didn't start on its own. It starts when the commissioner begins it.";
    }
    return {
      name,
      lockDay: 'Not started',
      lockTime: '',
      lockNote,
      ariaLabel: `Open the ${league.name} draft room: ${failed ? 'the draft has not started' : 'the draft is about to start'}`,
      cta,
    };
  }
  const at = new Date(league.draft_date).getTime();
  const until = timeUntil(at, now);
  const joined = Number(league.team_count);
  const max = Number(league.max_teams);
  const seats = Number.isFinite(joined) && Number.isFinite(max) && max > 0 ? `${joined} of ${max} teams joined` : null;
  return {
    name: 'Draft scheduled',
    detail: seats,
    lockDay: weekday(at),
    lockTime: formatInstant(at, 'time'),
    lockNote: until && !until.passed ? `Opens in ${until.text}.` : 'Opens now.',
    ariaLabel: `Open the ${league.name} draft room: the draft opens ${weekday(at)} ${formatInstant(at, 'time')}`,
    cta,
  };
}

/**
 * The draft play card. `now` (epoch ms) is the page's ticking clock. A
 * scheduled card calls `onExpire` once when its draft time passes, so the page
 * can refetch the leagues and let the draft go live.
 */
function NextDraftCard({
  league, now = Date.now(), lead = false, commissioner = false, onExpire = undefined,
}) {
  const state = draftState(league, now) || 'scheduled';
  const onExpireRef = useRef(onExpire);
  onExpireRef.current = onExpire;
  const scheduled = state === 'scheduled';
  useEffect(() => {
    if (!scheduled) return undefined;
    // shortcut: a draft more than ~24.8 days out fires early at the timer cap; the page just refetches.
    const delay = Math.min(Math.max(0, new Date(league.draft_date).getTime() - Date.now()), MAX_TIMEOUT_MS);
    const id = setTimeout(() => onExpireRef.current?.(), delay);
    return () => clearTimeout(id);
  }, [scheduled, league.draft_date]);

  const words = copy(league, state, now, commissioner);
  return (
    <PlayCard
      kind="draft"
      name={words.name}
      league={league.name}
      detail={words.detail}
      lockDay={words.lockDay}
      lockTime={words.lockTime}
      lockNote={words.lockNote}
      cta={words.cta}
      ariaLabel={words.ariaLabel}
      state={lead ? 'next' : 'open'}
      lead={lead}
    />
  );
}

NextDraftCard.propTypes = {
  league: PropTypes.shape({
    id: PropTypes.oneOfType([PropTypes.number, PropTypes.string]).isRequired,
    name: PropTypes.string,
    draft_date: PropTypes.string,
    draft_status: PropTypes.string,
    draft_autostart_failed: PropTypes.bool,
    team_count: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
    max_teams: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
  }).isRequired,
  now: PropTypes.number,
  lead: PropTypes.bool,
  commissioner: PropTypes.bool,
  // Called once when a scheduled draft's time arrives.
  onExpire: PropTypes.func,
};

export default NextDraftCard;
