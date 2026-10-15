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
// One bye week per NFL team, shared by Lineup, LineupPhone and the Draft room player pool. Week 7 is the lineup week: only NO is off.
const BYE = { ARI: 8, ATL: 5, BAL: 10, BUF: 11, CHI: 5, CIN: 12, DAL: 10, DEN: 12, DET: 8, GB: 5, HOU: 6, JAX: 8, KC: 10, LAR: 8, LV: 8, MIN: 9, NE: 14, NO: 7, SF: 14, TB: 9, TEN: 9, WAS: 12 };

// One fixture clock (CDT, Sun Oct 18): Main reads 9:10 AM, game day 2:40 PM. Relative times derive from these; the Week 6 recap was generated Tue Oct 13, 9:00 AM.
const CLOCK = { main: '9:10 AM', live: '2:40 PM', mainMin: 9 * 60 + 10, liveMin: 14 * 60 + 40, recapAgoMin: 5 * 1440 + 10 };

// ---- derived facts (Main's status line and next lock, My team, the Lineup head) ----
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
const SWAP = { out: _out.name, in: _in.name };

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
// ---- Sunday 2:40 PM CDT, live: [status, points so far, expected final] per starter ----
const LIVE = { 'Josh Allen': ['ip', 19.8, 24.6], 'Jahmyr Gibbs': ['ip', 16.9, 18.9], 'Woody Marks': ['ip', 9.1, 12.2], 'Puka Nacua': ['fin', 0.0, 0.0], "Ja'Marr Chase": ['ip', 15.2, 18.0], 'Trey McBride': ['yet', null, 8.9], 'Brandon Aubrey': ['yet', null, 8.1], Broncos: ['yet', null, 6.4] };
const teamVs = s => `${s.sub.split(' · ')[1]} vs ${/vs (\w+)/.exec(s.game)[1]}`;
const ME = STARTERS.map(s => s.empty ? [s.slot, '', '', '', 'empty', 0, 0, 0] : [s.slot, s.name, s.inj === 'Out' ? 'Out' : s.inj || '', teamVs(s), LIVE[s.name][0], LIVE[s.name][1], +s.proj, LIVE[s.name][2]]);
const sum = (rows, i) => rows.reduce((a, r) => a + (r[i] || 0), 0);
const left = rows => rows.filter(r => r[4] === 'ip' || r[4] === 'yet').length;
const winPct = (me, opp) => Math.round(100 / (1 + Math.exp((opp - me) / 12)));

// ---- Week 7 totals: pre-kickoff projections, and the live game-day figures (they differ by design) ----
const meProj = sum(ME, 6), oppProj = sum(OPP, 6);
const SUMMARY = { meProj, oppProj, trail: oppProj - meProj, pct: winPct(meProj, oppProj) };
const meNow = sum(ME, 5), oppNow = sum(OPP, 5), meExp = sum(ME, 7), oppExp = sum(OPP, 7);
const LIVE_TOTALS = { meNow, oppNow, meExp, oppExp, lead: meNow - oppNow, pct: winPct(meExp, oppExp), meLeft: left(ME), oppLeft: left(OPP) };

// Two different season metrics: points the bench scored, and points left on it by the lineups that were set.
const BENCH_POINTS = '164.2', LEFT_ON_BENCH = '38.6 (4th fewest of 12)';
module.exports = { mins, CLOCK, STARTERS, BENCH, IR, BYE, SUMMARY, BENCH_POINTS, LEFT_ON_BENCH, OPP, ME, LIVE_TOTALS, FIRST_LOCK, NEXT_LOCK, LINEUP_STATUS, PICKS_FIRST_LOCK, PICKS_NEXT_LOCK, OUT, EMPTY, ON_BYE, FILLED, ADVICE, SWAP, f1, plural };
