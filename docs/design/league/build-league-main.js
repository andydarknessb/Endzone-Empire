// Dashboard, in season, Week 7, before Sunday's kickoffs. Viewer is a member of Thursday Night Regulars.
const P = require('./league-dash-parts');
const { k, LG } = P;
const out = process.argv[2];

const head = k.phHead({ title: LG, chips: ['Week 7 · In season'] });

const cards = [P.SHARED_MAIN, P.WAIVERS];
const move = P.yourMove(cards);

// Hero stays 2-up: the Pick'em panel sits in the versus column under the matchup (grid areas), so both columns end level and the matchup absorbs only a little slack.
const hero = `<div style="display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr); grid-template-areas: 'v m' 'p m'; grid-template-rows: 1fr auto; gap: 24px; align-items: stretch">
<div style="grid-area: v; display: grid">${k.versusPanel({ ...P.VERSUS_PRE, pad: 24, gap: 24 })}</div>
<div style="grid-area: m; display: grid">${k.myTeam(P.MYTEAM_PRE)}</div>
<div style="grid-area: p">${P.pickemPanel(P.PICKEM_PRE, false, true)}</div>
</div>`;

const recap = k.recapPanel({
  body: 'Blitz Brigade went off for the week\'s top score and moved into first place. Darkness Falls beat Dynasty Dads 118.4 to 96.2, helped by 22.6 points from the Woody Marks waiver claim.',
  facts: [['High score', 'Blitz Brigade · 141.7'], ['Bench blunder', 'Sunday Scaries · 18.4 left on the bench'], ['Waiver steal', 'Woody Marks · Darkness Falls · 22.6 pts'], ['Closest game', 'Gridiron Ghosts vs Hail Mary Club · by 0.8']],
  generated: 'Generated Oct 13, 9:00 AM',
});

const tile = (a, b, pct) => k.aroundTile({ a: { name: a[0], fig: a[1] }, b: { name: b[0], fig: b[1] }, pct, aria: `${a[0]} against ${b[0]}, projected ${a[1]} to ${b[1]}, ${pct}% win probability for ${a[0]}` });
const around = `<section aria-labelledby="ar-h" style="${k.FRAME2}">
${k.frameHead(`${k.h2s('ar-h', 'Around the league')}${k.meta('5 matchups · win probability · Endzone Forecast', 'margin-left: auto')}${k.link('Projected · Game Center', 'Projected scores, open Game Center')}`)}
<div style="display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; padding: 20px">
${tile(['Blitz Brigade', '118.2'], ['Bench Mob', '96.4'], 78)}
${tile(['Waiver Wolves', '109.9'], ['Dynasty Dads', '101.3'], 63)}
${tile(['Gridiron Ghosts', '107.1'], ['Hail Mary Club', '105.3'], 54)}
${tile(['Pocket Aces', '103.1'], ['Fumble Rooskie', '99.8'], 59)}
${tile(['Red Zone Rejects', '97.5'], ['Practice Squad', '88.2'], 68)}
${k.aroundMore('All matchups in Game Center', 'Open Game Center, all Week 7 matchups')}
</div>
</section>`;

const TEAMS = [
  ['Blitz Brigade', 5, 1, 701.2, 598.4, 'W3'], ['Waiver Wolves', 5, 1, 688.7, 612.0, 'W2'], ['Darkness Falls', 4, 2, 664.5, 603.1, 'W1'],
  ['Sunday Scaries', 4, 2, 651.0, 622.9, 'L1'], ['Gridiron Ghosts', 4, 2, 642.8, 630.4, 'W1'], ['Fumble Rooskie', 4, 2, 630.1, 617.5, 'W2'],
  ['Hail Mary Club', 3, 3, 618.9, 624.0, 'L2'], ['Pocket Aces', 3, 3, 609.4, 615.2, 'W1'], ['Dynasty Dads', 2, 4, 598.3, 640.6, 'L3'],
  ['Red Zone Rejects', 2, 4, 587.0, 633.9, 'L1'], ['Bench Mob', 1, 5, 561.2, 655.3, 'L4'], ['Practice Squad', 0, 6, 540.8, 671.7, 'L6'],
];
const standings = k.standings({
  data: TEAMS.map(([team, w, l, pf, pa, strk], i) => ({ rank: i + 1, team, w, l, t: 0, pf: pf.toFixed(1), pa: pa.toFixed(1), strk })),
  viewer: 2, cutAfter: 6,
});

const feed = P.FEED;
const activity = `<section aria-labelledby="ac-h" style="${k.FRAME2}; display: flex; flex-direction: column; min-width: 0">
${k.frameHead(`<h2 id="ac-h" style="margin: 0; ${k.px(16)}">Recent activity</h2>${k.meta(feed.length + ' moves')}<span style="margin-left: auto">${k.link('All activity', 'All league activity')}</span>`)}
<ul style="list-style: none; margin: 0; padding: 4px 16px 8px">${feed.map(([kind, team, text, time], i) => k.activityRow({ kind, team, text, time, last: i === feed.length - 1 })).join('')}</ul>
</section>`;
const grid = `<div style="display: grid; grid-template-columns: minmax(0, 1.55fr) minmax(0, 1fr); gap: 24px; align-items: stretch">${standings}${activity}</div>`;

const playbook = P.playbookLink(P.PLAYBOOK_MAIN, P.AWARDS.length);

const chat = `<div style="display: flex; justify-content: flex-end; padding-top: 14px">${k.chatButton({ unread: 3 })}</div>`;

const notes = k.notes([
  'One cursor: Set lineup and Week 7 picks both lock Sun ' + P.D.FIRST_LOCK + ', so by the Shared Lock Rule they are one card: one cursor, one foot per action, only "Set lineup" filled. Its note names the swap and says the gain once ("Start ' + P.D.SWAP.in + ' for ' + P.D.SWAP.out + ' · +' + P.D.ADVICE.gain + ' pts"). The lead card sits left with its field band beside the text; Waivers is a compact card (name, lock, foot) stacked on the right, so no part of the frame is empty. The badge counts the cards (2). My team has no second lineup link because Your move already carries Set lineup, and its Out chip is a filled Ink chip.',
  'Container tiers: the Your move, Matchup, My team and Standings frames keep the 6px double rule; Recap, Around the league and Recent activity are a 2px Rule border with a Pixel 16 heading. The Playbook and the trophy case are one link row. The activity count is plain meta text; boxed badges are only for things that need you and chat unread. Board black is kept for live.',
  'Before kickoff the versus panel is framed, figures are labelled "Proj", and the odds bar uses Frame color. Fixture clock: Sun Oct 18, 9:10 AM CDT (activity ages derive from it; the Week 6 recap is 5d old). Pick&#39;em (2px tier) sits under the Matchup in the left hero column so the hero stays 2-up and both columns end level; the Matchup has no band over 40px. One win probability credit per frame. Green is reserved for the filled foot and live state, so nothing else on this board is green.',
  'The standings screen puts the viewer on Play-blue with an arrow, not a cursor. The dashed Frame rule after sixth is the playoff line. The Playbook row drops Game Center, Trades, Activity, the Draft Room tile and the lineup and picks tiles because the page already links them or the draft is over.',
]);

const body = `<main style="max-width: 1280px; margin: 0 auto; padding: 40px 32px 64px; display: flex; flex-direction: column; gap: 32px">
${head}
${move}
${hero}
${recap}
${around}
${grid}
${playbook}
${chat}
${notes}
</main>`;

k.write(out, 'Main.dc.html', k.page({ title: 'League dashboard, in season', w: 1440, h: 3600, body }));
console.log('ok');
