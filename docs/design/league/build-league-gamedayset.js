// Dashboard on game day with nothing due: Sunday Week 7, 4:10 PM CDT, early games final, 3:25 games live, lineup set and picks in.
// No lock is under an hour, so the live scoreboard leads and Your move reads "You're set" (no cursor, no filled action).
const P = require('./league-dash-parts');
const { k, LG } = P;
const out = process.argv[2];
const CLOCK_MIN = 16 * 60 + 10;
const f1 = n => n.toFixed(1);

// Darkness Falls after the owner acted: Addison in for Puka Nacua, Spears at FLEX. [slot, name, inj, game, status, pts, proj, expected]
const ME = [
  ['QB', 'Josh Allen', '', 'BUF vs MIA', 'fin', 23.4, 22.1, 23.4],
  ['RB', 'Jahmyr Gibbs', '', 'DET vs TB', 'fin', 18.2, 19.6, 18.2],
  ['RB 2', 'Woody Marks', 'Q', 'HOU vs SEA', 'fin', 10.7, 11.8, 10.7],
  ['WR', 'Jordan Addison', '', 'MIN vs PHI', 'fin', 12.8, 10.1, 12.8],
  ['WR 2', "Ja'Marr Chase", '', 'CIN vs NYJ', 'fin', 17.5, 16.9, 17.5],
  ['TE', 'Trey McBride', '', 'ARI vs SF', 'ip', 3.9, 8.9, 9.4],
  ['FLEX', 'Tyjae Spears', '', 'TEN vs IND', 'fin', 14.3, 12.9, 14.3],
  ['K', 'Brandon Aubrey', '', 'DAL vs DEN', 'ip', 3.0, 8.1, 8.1],
  ['DEF', 'Broncos', '', 'DEN vs DAL', 'ip', 2.0, 6.4, 6.6],
];
// Sunday Scaries: the 12:00 games are final; Mahomes, Lamb and Ferguson are in the 3:25 window.
const OPP = [
  ['QB', 'Patrick Mahomes', '', 'KC vs LV', 'ip', 8.8, 17.2, 17.6], ['RB', 'Saquon Barkley', '', 'PHI vs MIN', 'fin', 18.6, 15.4, 18.6],
  ['RB 2', 'James Cook', '', 'BUF vs MIA', 'fin', 11.4, 11.0, 11.4], ['WR', 'CeeDee Lamb', '', 'DAL vs DEN', 'ip', 4.2, 13.4, 12.9],
  ['WR 2', 'Amon-Ra St. Brown', '', 'DET vs TB', 'fin', 13.9, 12.6, 13.9], ['TE', 'Jake Ferguson', '', 'DAL vs DEN', 'ip', 1.8, 5.8, 5.6],
  ['FLEX', 'Tyreek Hill', '', 'MIA vs BUF', 'fin', 10.2, 10.2, 10.2], ['K', "Ka'imi Fairbairn", '', 'HOU vs SEA', 'fin', 6.0, 7.0, 6.0],
  ['DEF', 'Eagles', '', 'PHI vs MIN', 'fin', 7.0, 6.0, 7.0],
];
// Critique 11 item 13: Expected final = points so far + projection x the share of the game left. At 4:10 PM the 3:25 PM games are 45 minutes in, about one quarter played (a game runs ~3 hours for 60 game minutes, so ~15 game minutes are gone): 0.75 of each is left. Final games keep their points. The typed expected figures are replaced here.
const SHARE_LEFT = 0.75;
for (const r of [...ME, ...OPP]) r[7] = Math.round((r[5] + (r[4] === 'ip' ? r[6] * SHARE_LEFT : 0)) * 10) / 10;
const sum = (rows, i) => rows.reduce((a, r) => a + r[i], 0), left = rows => rows.filter(r => r[4] === 'ip').length;
const meNow = sum(ME, 5), oppNow = sum(OPP, 5), meExp = sum(ME, 7), oppExp = sum(OPP, 7), lead = meNow - oppNow;
const pct = 82; // the Forecast's own figure stays when the Expected finals are recomputed (Critique 11 item 13)
const sentence = `Darkness Falls ${f1(meNow)}, Sunday Scaries ${f1(oppNow)}`;
const VS = {
  you: { name: 'Darkness Falls', fig: f1(meNow), expected: f1(meExp), note: `${P.D.plural(left(ME), 'player')} remaining` },
  opp: { name: 'Sunday Scaries', fig: f1(oppNow), expected: f1(oppExp), note: `${P.D.plural(left(OPP), 'player')} remaining` },
  youLeads: lead >= 0, margin: `${lead >= 0 ? 'Up' : 'Down'} ${f1(Math.abs(lead))}`, pct, updated: 'As of 4:10 PM', sentence,
  aria: `${LG} matchup: Darkness Falls ${lead >= 0 ? 'lead' : 'trail'} Sunday Scaries ${f1(meNow)} to ${f1(oppNow)}, expected final ${f1(meExp)} to ${f1(oppExp)}, ${pct}% Darkness Falls win probability. PMR, players remaining: ${left(ME)} for Darkness Falls and ${left(OPP)} for Sunday Scaries`,
};

const head = k.phHead({ title: LG, chips: ['Week 7 · In season'], live: '3 matchups live', right: P.INVITE });
const versus = k.versusLive(VS);

// Nothing is due: a calm card, no cursor, no filled action.
const set = `<section aria-labelledby="move-h" style="${k.FRAME2}">
${k.frameHead(`${k.h2s('move-h', 'Your move')}${k.meta('Nothing is due', 'margin-left: auto')}`)}
<div style="padding: 16px 20px; display: flex; flex-direction: column; gap: 6px">
<h3 style="margin: 0; display: flex; align-items: center; gap: 12px; ${k.px(16)}">${k.checkIcon('{{t.ink}}')}You're set</h3>
<p style="margin: 0; font-size: 15px; color: {{t.dim}}">Lineup set · picks in · next lock Mon 7:15 PM</p>
</div></section>`;

const myTeam = k.myTeamWide({
  name: 'Darkness Falls', record: '4-2', rankLine: '3rd of 12', pf: '664.5', pa: '603.1', live: true, status: 'Lineup set',
  starters: ME.slice(0, 5).map(r => ({ slot: r[0].split(' ')[0], name: r[1], inj: r[2] || undefined, game: r[3], proj: f1(r[6]), pts: r[5] })),
  more: `and ${ME.length - 5} more starters`,
});
const pickem = P.pickemPanel({ rank: 'T-3', points: '56', wk: '14 of 14 made', behind: '6 pts' });
const commissioner = P.commissionerFrame();
const recap = k.recapPanel(P.RECAP);

const AROUND = [
  { a: { name: 'Blitz Brigade', fig: 118.9 }, b: { name: 'Bench Mob', fig: 90.2 }, live: false, played: true },
  { a: { name: 'Waiver Wolves', fig: 101.4 }, b: { name: 'Dynasty Dads', fig: 99.8 }, live: true, pct: 55 },
  { a: { name: 'Gridiron Ghosts', fig: 88.1 }, b: { name: 'Hail Mary Club', fig: 94.6 }, live: true, pct: 38 },
  { a: { name: 'Pocket Aces', fig: 118.7 }, b: { name: 'Fumble Rooskie', fig: 104.2 }, live: false, played: true },
  { a: { name: 'Red Zone Rejects', fig: 97.5 }, b: { name: 'Practice Squad', fig: 88.2 }, live: false, played: true },
].map(t => ({ ...t, aria: t.live
  ? `${t.a.name} against ${t.b.name}, live, ${t.a.fig.toFixed(1)} to ${t.b.fig.toFixed(1)}, ${t.pct}% win probability for ${t.a.name}`
  : t.played ? `${t.a.name} against ${t.b.name}, awaiting final, ${t.a.fig.toFixed(1)} to ${t.b.fig.toFixed(1)}, waiting on the score of record`
  : `${t.a.name} against ${t.b.name}, final, ${t.a.fig.toFixed(1)} to ${t.b.fig.toFixed(1)}` }));
const around = `<section aria-labelledby="ar-h" style="${k.FRAME2}">
${k.frameHead(`${k.h2s('ar-h', 'Around the league')}${k.meta('3 rival matchups · win probability · Endzone Forecast', 'margin-left: auto')}${k.link('Live · Game Center', 'Live scores, open Game Center')}`)}
<div style="display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 16px; padding: 20px">
${AROUND.slice(0, 3).map(t => `<div>${P.boardTile(t)}</div>`).join('')}
${k.aroundMore('All matchups in Game Center', 'Open Game Center, all Week 7 matchups')}
</div>
</section>`;

const standings = k.standings({ data: P.standingsData, viewer: 2, cutAfter: 6 });
const feed = P.feedAt(CLOCK_MIN).slice(0, 3);
const activity = `<section aria-labelledby="ac-h" style="${k.FRAME2}; display: flex; flex-direction: column; min-width: 0">
${k.frameHead(`<h2 id="ac-h" style="margin: 0; ${k.px(16)}">Recent activity</h2>${k.meta(feed.length + ' moves')}<span style="margin-left: auto">${k.link('All activity', 'All league activity')}</span>`)}
<ul style="list-style: none; margin: 0; padding: 4px 16px 8px">${feed.map(([kind, team, text, time], i) => k.activityRow({ kind, team, text, time, last: i === feed.length - 1 })).join('')}</ul>
</section>`;
const grid = `<div style="display: grid; grid-template-columns: minmax(0, 1.55fr) minmax(0, 1fr); gap: 24px; align-items: start">${standings}${activity}</div>`;
const playbook = P.playbookLink(P.PLAYBOOK_LIVE, P.AWARDS.length);
const chat = `<div style="display: flex; justify-content: flex-end; padding-top: 14px">${k.chatButton({ unread: 3 })}</div>`;

const notes = k.notes([
  'Game-day top rule: when no lock is under one hour, the live scoreboard leads the page and Your move follows it. Here it is Sunday 4:10 PM CDT, the 12:00 games are final, the 3:25 games are live, and the next lock is Monday 7:15 PM, so Your move is a calm "You\'re set" card: no cursor, no filled action, no badge. GameDay (a 45 minute lock) keeps Your move first.',
  'Fixture clock: Sun Oct 18, 4:10 PM CDT (activity ages derive from it). The owner already acted, so this board\'s lineup differs from GameDay on purpose: Jordan Addison replaced Puka Nacua at WR and Tyjae Spears fills FLEX, and all 14 picks are in. Totals, Expected final (points so far plus each live starter&#39;s projection times 0.75, the share left about 45 minutes into the 3:25 PM games; Critique 11 item 13: 121.0 → 123.4 and 103.2 → 109.2; the win probability stays 82%) and players remaining are computed from the starters below the screen.',
  'The scoreboard is plain Board black at rest, both names on one baseline, the margin directly under the viewer score, and a visually hidden polite live region carries the score sentence only. Order after it: You\'re set, My team, Pick\'em, the Commissioner strip, recap, around the league, standings and activity, then one Playbook and trophy case link row.',
]);

const body = `<main style="max-width: 1280px; margin: 0 auto; padding: 40px 32px 64px; display: flex; flex-direction: column; gap: 32px">
${head}
${versus}
${set}
${myTeam}
${pickem}
${commissioner}
${recap}
${around}
${grid}
${playbook}
${chat}
${notes}
</main>`;

k.write(out, 'GameDaySet.dc.html', k.page({ title: 'League dashboard, game day, all set', w: 1440, h: 3442, body }));
console.log('ok');
