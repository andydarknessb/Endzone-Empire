import { isPickemOnly } from '../../lib/leagueType';
import { receptionFormatLabel } from '../../lib/leagueRulesFormat';

// Waiver type in the words a 120px tile can hold. Not WAIVER_TYPE_LABELS from
// leagueRulesFormat: those are the League Rules page's full phrasings ("FAAB
// (Bidding)"), which wrap to three lines in a tile.
const WAIVER_TILE_LABELS = { faab: 'FAAB', priority: 'Priority' };

// An hours column as a tile value. The null check comes FIRST because
// `Number(null)` is 0, which would print a settled "0h" for a column that is
// simply absent.
function hoursLabel(value) {
  if (value == null) return null;
  const hours = Number(value);
  return Number.isFinite(hours) ? `${hours}h` : null;
}

/**
 * The facts a league's commissioner surface states without expanding
 * anything (ADR 0034, moved here from `widgets/commissioner-panel/model` so
 * both the League Dashboard's commissioner strip and the
 * `pages/commissioner-console` page read the one function), each one a field
 * the league payload already carries (SELECT leagues.*, plus the teams[]
 * select in league.router.js). No request is made for any of them.
 *
 * A fact whose source field is ABSENT is not rendered. The columns behind
 * these are NOT NULL with server defaults, so an absent field means a payload
 * that never carried it, and printing the column default would state a
 * setting the commissioner never chose. `trade_deadline_week` is the one
 * nullable source: there null IS the answer ("None"), not an absence.
 *
 * Every fact here is a fantasy-league concept - transactions, roster freezes,
 * waivers, trades, lineup slots, scoring - so a pick'em-only league gets none,
 * the same rule CommissionerTools already applies to its own transactions
 * lock and its roster and scoring tabs (`!pickemOnly`).
 */
export function commissionerFacts(league, teams) {
  const facts = [];
  if (!league || isPickemOnly(league)) return facts;

  if (typeof league.transactions_locked === 'boolean') {
    facts.push({
      key: 'transactions',
      label: 'Transactions',
      value: league.transactions_locked ? 'Locked' : 'Open',
    });
  }

  // teams[].locked is the per-team roster freeze, distinct from the league-wide
  // transactions lock above; the commissioner's question is how many managers
  // are frozen right now, which is why this counts rows rather than reading a
  // league flag.
  const rows = Array.isArray(teams) ? teams : [];
  if (rows.some((team) => typeof team?.locked === 'boolean')) {
    facts.push({
      key: 'teams-locked',
      label: 'Teams locked',
      value: `${rows.filter((team) => team?.locked).length} of ${rows.length}`,
    });
  }

  if ('trade_deadline_week' in league) {
    facts.push({
      key: 'trade-deadline',
      label: 'Trade deadline',
      value: league.trade_deadline_week == null ? 'None' : `Week ${league.trade_deadline_week}`,
    });
  }

  if (league.waiver_type) {
    const type = WAIVER_TILE_LABELS[league.waiver_type] || league.waiver_type;
    const period = hoursLabel(league.waiver_period_hours);
    facts.push({ key: 'waivers', label: 'Waivers', value: period ? `${type} · ${period}` : type });
  }

  const review = hoursLabel(league.trade_review_hours);
  if (review) facts.push({ key: 'trade-review', label: 'Trade review', value: review });

  // roster_slots is jsonb, so it arrives parsed; anything else reads as an
  // absent fact rather than a guessed one.
  if (Array.isArray(league.roster_slots)) {
    const starters = league.roster_slots.reduce((sum, slot) => sum + (Number(slot?.count) || 0), 0);
    const bench = Number(league.bench_slots) || 0;
    const ir = Number(league.ir_slots) || 0;
    const parts = [`${starters} starters`, `${bench} bench`];
    // A league with no IR slot reads exactly as it did before IR existed (#96),
    // rather than carrying a "0 IR" that means nothing to its commissioner.
    if (ir > 0) parts.push(`${ir} IR`);
    facts.push({ key: 'roster', label: 'Roster', value: parts.join(' · ') });
  }

  // The format the league actually plays, off its reception rate and never the
  // stored `scoring_preset` (null on a new league, 'custom' after any override,
  // so it says less than the rate does). Only the league's OWN stored rules are
  // read: naming the format of a league that stores none would take the scoring
  // defaults, which is a request this panel does not make, so such a league
  // renders no scoring fact rather than a guessed one.
  const format = receptionFormatLabel(league.scoring_rules);
  if (format) facts.push({ key: 'scoring', label: 'Scoring', value: format });

  return facts;
}

export default commissionerFacts;
