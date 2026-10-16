// The one Darkness Falls Week 7 fixture. Main, MainPhone, GameDay, GameDayPhone, Lineup, LineupPhone and Matchup all read it.
// game/detail follow the LedgerRow pre-game cell: "vs {opponent} · {kickoff}" over "{fav} -{spread} · O/U {total}", "Dome" or weather.
const STARTERS = [
  { slot: 'QB', name: 'Josh Allen', sub: 'QB · BUF', game: 'vs MIA · Sun 12:00 PM', detail: 'BUF -6.5 · O/U 48.5', proj: '22.1' },
  { slot: 'RB', name: 'Jahmyr Gibbs', sub: 'RB · DET', game: 'vs TB · Sun 12:00 PM', detail: 'Dome', proj: '19.6' },
  { slot: 'RB 2', name: 'Woody Marks', inj: 'Questionable', sub: 'RB · HOU', game: 'vs SEA · Sun 12:00 PM', detail: 'HOU -2.5 · O/U 43.0', proj: '11.8' },
  { slot: 'WR', name: 'Puka Nacua', inj: 'Out', sub: 'WR · LAR', game: 'vs JAX · Sun 12:00 PM', detail: 'Dome', proj: '0.0', cursor: true },
  { slot: 'WR 2', name: "Ja'Marr Chase", sub: 'WR · CIN', game: 'vs NYJ · Sun 12:00 PM', detail: 'CIN -4.0 · O/U 45.5', proj: '16.9' },
  { slot: 'TE', name: 'Trey McBride', sub: 'TE · ARI', game: 'vs SF · Sun 3:25 PM', detail: 'SF -2.5 · O/U 44.0', proj: '8.9' },
  { slot: 'FLEX', empty: true },
  { slot: 'K', name: 'Brandon Aubrey', sub: 'K · DAL', game: 'vs DEN · Sun 3:25 PM', detail: '52° · wind 12 mph', proj: '8.1' },
  { slot: 'DEF', name: 'Broncos', sub: 'DEF · DEN', game: 'vs DAL · Sun 3:25 PM', detail: '52° · wind 12 mph', proj: '6.4' },
];
const BENCH = [
  { slot: 'BENCH', name: 'Tyjae Spears', sub: 'RB · TEN', game: 'vs IND · Sun 12:00 PM', detail: 'TEN -3.5 · O/U 44.5', proj: '12.9', pos: 'RB' },
  { slot: 'BENCH', name: 'Jordan Addison', sub: 'WR · MIN', game: 'vs PHI · Sun 12:00 PM', detail: 'Dome', proj: '10.1', pos: 'WR' },
  { slot: 'BENCH', name: 'Dalton Kincaid', sub: 'TE · BUF', game: 'vs MIA · Sun 12:00 PM', detail: 'BUF -6.5 · O/U 48.5', proj: '7.4', pos: 'TE' },
  { slot: 'BENCH', name: 'Tank Bigsby', sub: 'RB · JAX', game: 'vs LAR · Sun 12:00 PM', detail: 'Dome', proj: '6.2', pos: 'RB' },
  { slot: 'BENCH', name: 'Tyler Allgeier', sub: 'RB · ATL', game: 'vs CAR · Sun 12:00 PM', detail: 'ATL -1.5 · O/U 42.0', proj: '5.8', pos: 'RB' },
  { slot: 'BENCH', name: 'Chris Olave', sub: 'WR · NO', game: 'Bye', detail: 'on bye', proj: '0.0', pos: 'WR', bye: true },
];
const IR = [{ slot: 'IR', name: 'Rome Odunze', inj: 'Injured reserve', sub: 'WR · CHI', game: 'on IR', detail: '', proj: '0.0', pos: 'WR' }];
// One bye week per NFL team, shared by Lineup, LineupPhone and the Draft room player pool. Week 7 is the lineup week: BAL, NE, LAC and NO are off (week7-games.js BYE_TEAMS).
const BYE = { ARI: 8, ATL: 5, BAL: 7, BUF: 11, CHI: 5, CIN: 12, DAL: 10, DEN: 12, DET: 8, GB: 5, HOU: 6, JAX: 8, KC: 10, LAR: 8, LAC: 7, LV: 8, MIN: 9, NE: 7, NO: 7, SF: 14, TB: 9, TEN: 9, WAS: 12 };

// One fixture clock (CDT, Sun Oct 18): Main reads 9:10 AM, game day 2:40 PM. Relative times derive from these; the Week 6 recap was generated Tue Oct 13, 9:00 AM.
const CLOCK = { main: '9:10 AM', live: '2:40 PM', mainMin: 9 * 60 + 10, liveMin: 14 * 60 + 40, recapAgoMin: 5 * 1440 + 10 };

// ---- derived facts (Main's status line and next lock, My team, the Lineup head) ----
const W = require('./week7-games');
const f1 = n => n.toFixed(1);
const mins = t => { const m = /(\d+):(\d+) ([AP])M/.exec(t); return (+m[1] % 12 + (m[3] === 'P' ? 12 : 0)) * 60 + +m[2]; };
const kick = s => (s.game && /Sun (\d+:\d+ [AP]M)/.exec(s.game) || [])[1];
const KICKS = [...new Set(STARTERS.map(kick).filter(Boolean))].sort((a, b) => mins(a) - mins(b));
const FIRST_LOCK = KICKS[0];                                  // pre-kickoff: the earliest starter kickoff
const NEXT_LOCK = KICKS.find(t => mins(t) > mins(CLOCK.live)); // game day, 2:40 PM CDT
// The pick'em slate shares the fixture's kickoffs: an unpicked game locks at its own kickoff, so the picks card leads with the earliest one.
const SLATE_KICKS = [...new Set([...STARTERS, ...BENCH].map(kick).filter(Boolean))].sort((a, b) => mins(a) - mins(b));
const PICKS_FIRST_LOCK = SLATE_KICKS[0], PICKS_NEXT_LOCK = SLATE_KICKS.find(t => mins(t) > mins(CLOCK.live));
const OUT = STARTERS.filter(s => s.inj === 'Out').map(s => s.name);
const EMPTY = STARTERS.filter(s => s.empty).length, ON_BYE = STARTERS.filter(s => s.bye).length;
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const LINEUP_STATUS = [EMPTY && `${plural(EMPTY, 'empty starting slot')}`, ON_BYE && `${plural(ON_BYE, 'starter')} on bye`].filter(Boolean).join(' · ');
const FILLED = STARTERS.length - EMPTY;
// Endzone Forecast advice: Addison for the Out WR (+10.1) and Spears into the empty FLEX (+12.9).
const ADVICE = { gain: '23.0', swaps: 2 };
// The named swap: the best non-bye bench player at the Out starter's position (Addison for Puka Nacua).
const _out = STARTERS.find(s => s.inj === 'Out'), _in = BENCH.filter(b => b.pos === _out.sub.split(' · ')[0] && !b.bye).sort((a, b) => b.proj - a.proj)[0];
// The second move: the best remaining non-bye bench player into the empty slot (Spears at FLEX). Copy only: ADVICE.gain stays the figure, and this line checks it adds up.
const _slot = STARTERS.find(s => s.empty).slot, _fill = BENCH.filter(b => b !== _in && !b.bye).sort((a, b) => b.proj - a.proj)[0];
if ((+_in.proj + +_fill.proj).toFixed(1) !== ADVICE.gain) throw new Error('ADVICE.gain ' + ADVICE.gain + ' != ' + _in.proj + ' + ' + _fill.proj);
// Critique 11 item 10: two moves named plainly: "Two moves · +23.0 pts: Addison in for Puka Nacua (Out) · Spears into the empty FLEX". head carries the gain, moves the two moves; both are built from the data above.
const last = n => n.split(' ').pop();
const SWAP = { out: _out.name, in: _in.name, fill: _fill.name, slot: _slot, head: `Two moves · +${ADVICE.gain} pts`, moves: `${last(_in.name)} in for ${_out.name} (${_out.inj}) · ${last(_fill.name)} into the empty ${_slot}` };
SWAP.line = `${SWAP.head}: ${SWAP.moves}`;

// ---- the opponent, Sunday Scaries: [slot, name, inj, game, status, pts, proj, expected] (status: ip, fin, yet) ----
const OPP = [
  ['QB', 'Patrick Mahomes', '', 'KC vs LV', 'yet', null, 17.2, 17.2],
  ['RB', 'Saquon Barkley', '', 'PHI vs MIN', 'ip', 16.2, 15.4, 17.0],
  ['RB 2', 'James Cook', '', 'BUF vs MIA', 'ip', 10.4, 11.0, 11.2],
  ['WR', 'CeeDee Lamb', '', 'DAL vs DEN', 'yet', null, 13.4, 13.4],
  ['WR 2', 'Amon-Ra St. Brown', '', 'DET vs TB', 'ip', 11.9, 12.6, 13.2],
  ['TE', 'Jake Ferguson', '', 'DAL vs DEN', 'yet', null, 5.8, 5.8],
  ['FLEX', 'Tyreek Hill', '', 'MIA vs BUF', 'ip', 9.8, 10.2, 10.4],
  ['K', "Ka'imi Fairbairn", '', 'HOU vs SEA', 'ip', 5.0, 7.0, 6.8],
  ['DEF', 'Eagles', '', 'PHI vs MIN', 'ip', 5.6, 6.0, 6.2],
];
// JAX @ LAR is live in Q4 at 2:40 PM (week7-games.js), so Puka Nacua (Out) reads in progress with 0.0, not final.
// ---- Sunday 2:40 PM CDT, live: [status, points so far, expected final] per starter ----
const LIVE = { 'Josh Allen': ['ip', 19.8], 'Jahmyr Gibbs': ['ip', 16.9], 'Woody Marks': ['ip', 9.1], 'Puka Nacua': ['ip', 0.0], "Ja'Marr Chase": ['ip', 15.2], 'Trey McBride': ['yet', null], 'Brandon Aubrey': ['yet', null], Broncos: ['yet', null] };
// Critique 11 item 13: Expected final = points so far + projection x the share of the game left (the Q4 clock: minutes left / 60) for a live starter, the full projection for a game not started, the points for a final game; one decimal per row so the rows add up to the total.
const shareLeft = tv => { const g = W.gameOf(tv.split(' ')[0]), s = W.stateAt(g, 240); if (s.status === 'final') return 0; if (s.status === 'scheduled') return 1; const m = /^Q4 (\d+):(\d+)$/.exec(s.clock); if (!m) throw new Error('share needs a Q4 clock: ' + s.clock); return (+m[1] + m[2] / 60) / 60; };
const expFinal = (tv, pts, proj) => { const sh = shareLeft(tv); return Math.round(((sh === 1 ? 0 : pts) + proj * sh) * 10) / 10; };
const teamVs = s => `${s.sub.split(' · ')[1]} vs ${/vs (\w+)/.exec(s.game)[1]}`;
const ME = STARTERS.map(s => s.empty ? [s.slot, '', '', '', 'empty', 0, 0, 0] : [s.slot, s.name, s.inj === 'Out' ? 'Out' : s.inj || '', teamVs(s), LIVE[s.name][0], LIVE[s.name][1], +s.proj, expFinal(teamVs(s), LIVE[s.name][1], +s.proj)]);
const sum = (rows, i) => rows.reduce((a, r) => a + (r[i] || 0), 0);
for (const r of OPP) r[7] = expFinal(r[3], r[5], r[6]); // OPP is declared above LIVE; its typed expected figures are replaced here
// Players remaining (Critique 9 item 2), one definition everywhere: a starter whose NFL game is not final at the clock (240 = 2:40 PM, 9 = 9:10 AM); Out starters and empty slots never count.
const stillToPlay = (rows, clock) => rows.filter(r => r[4] !== 'empty' && r[2] !== 'Out' && (g => g && W.stateAt(g, clock).status !== 'final')(W.gameOf(r[3].split(' ')[0]))).length;
const left = rows => stillToPlay(rows, 240);
// Critique 11 item 9: "yet to play" is the not-started subset of players remaining (a game still scheduled at 2:40 PM; Out starters and empty slots never count).
const yetToPlay = (rows, clock) => rows.filter(r => r[4] !== 'empty' && r[2] !== 'Out' && (g => g && W.stateAt(g, clock).status === 'scheduled')(W.gameOf(r[3].split(' ')[0]))).length;
const winPct = (me, opp) => Math.round(100 / (1 + Math.exp((opp - me) / 12)));

// ---- Week 7 totals: pre-kickoff projections, and the live game-day figures (they differ by design) ----
const meProj = sum(ME, 6), oppProj = sum(OPP, 6);
const SUMMARY = { meProj, oppProj, trail: oppProj - meProj, pct: winPct(meProj, oppProj) };
const meNow = sum(ME, 5), oppNow = sum(OPP, 5), meExp = sum(ME, 7), oppExp = sum(OPP, 7);
const LIVE_TOTALS = { meNow, oppNow, meExp, oppExp, lead: meNow - oppNow, pct: 42, meLeft: left(ME), oppLeft: left(OPP), meYet: yetToPlay(ME, 240), oppYet: yetToPlay(OPP, 240) };
// Critique 11 item 13: the win probability stays the Forecast's own figure (42%) when the Expected finals are recomputed; the dashboard formula alone would now give winPct(meExp, oppExp).
const PRE_LEFT = { me: stillToPlay(ME, 9), opp: stillToPlay(OPP, 9) }; // 9:10 AM: starters minus Out and empty slots (and any game already final)

// Two different season metrics: points the bench scored, and points left on it by the lineups that were set.
const BENCH_POINTS = '164.2', LEFT_ON_BENCH = '38.6 (4th fewest of 12)';
module.exports = { stillToPlay, PRE_LEFT, mins, CLOCK, STARTERS, BENCH, IR, BYE, SUMMARY, BENCH_POINTS, LEFT_ON_BENCH, OPP, ME, LIVE_TOTALS, FIRST_LOCK, NEXT_LOCK, LINEUP_STATUS, PICKS_FIRST_LOCK, PICKS_NEXT_LOCK, OUT, EMPTY, ON_BYE, FILLED, ADVICE, SWAP, f1, plural };
