// Dashboard, season complete (fantasy). Viewer is a member (Darkness Falls, finished 3rd). Nothing needs the viewer: no Your move.
const k = require('./league-kit');
const out = process.argv[2];
const LG = 'Thursday Night Regulars';

const head = k.phHead({ title: LG, chips: ['Complete', '12 Teams', 'Draft Complete'] });

// Final standings: 14 regular-season games each, wins total equals losses total; PA is a blend that keeps the league sums equal.
const NAMES = ['Blitz Brigade', 'Waiver Wolves', 'Darkness Falls', 'Sunday Scaries', 'Gridiron Ghosts', 'Fumble Rooskie', 'Hail Mary Club', 'Pocket Aces', 'Dynasty Dads', 'Red Zone Rejects', 'Bench Mob', 'Practice Squad'];
const W = [11, 10, 9, 8, 8, 7, 7, 6, 6, 5, 4, 3];
const PF = [1602.3, 1571.8, 1544.0, 1512.6, 1498.2, 1476.9, 1455.3, 1431.7, 1399.5, 1378.1, 1320.4, 1267.0];
const mean = PF.reduce((a, b) => a + b) / 12;
const PA = PF.map((_, i) => 0.6 * mean + 0.4 * PF[11 - i]);
const STRK = ['W4', 'W2', 'L1', 'W1', 'L2', 'W1', 'L1', 'L3', 'W1', 'L2', 'L1', 'L5'];
const standings = k.standings({
  data: NAMES.map((team, i) => ({ rank: i + 1, team, w: W[i], l: 14 - W[i], t: 0, pf: PF[i].toFixed(1), pa: PA[i].toFixed(1), strk: STRK[i] })),
  viewer: 2, cutAfter: 6,
});

// Champion moment: the Trophy room's lead row, then the award list.
const stat = (l, v) => `<div style="display: flex; flex-direction: column; gap: 2px"><span style="font-size: 13px; color: {{t.dim}}">${l}</span><span style="font-size: 17px; font-weight: 600">${v}</span></div>`;
const champion = `<div style="display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 32px; align-items: center; padding: 24px 20px; border-bottom: 2px solid {{t.rule}}">
<div style="padding: 20px 28px; border: 2px dashed {{t.frame}}">${k.trophyPicto('cup', 10)}</div>
<div style="display: flex; flex-direction: column; gap: 16px; min-width: 0">
<h3 style="margin: 0; ${k.px(16)}">2026 League Champion</h3>
<div style="display: flex; align-items: center; gap: 16px; min-width: 0">${k.avatar('Blitz Brigade', { size: 48 })}<span style="${k.px(24)}; line-height: 1.3; overflow-wrap: anywhere">Blitz Brigade</span></div>
<div style="display: flex; flex-wrap: wrap; gap: 12px 40px">${stat('Final record', '11-3-0')}${stat('Final seed', '1st of 12')}${stat('Championship, Week 17', 'Beat Waiver Wolves 138.4 to 127.9')}</div>
<div style="margin-left: -10px">${k.link('Final standings', 'Jump to the final standings')}</div>
</div></div>`;
const awards = [
  ['star', 'Top Scorer', 'Blitz Brigade', 'Season 2026'], ['star', 'Weekly High', 'Waiver Wolves', 'Week 11 · 163.2'], ['cup', "Pick'em Champion", 'Gridiron Ghosts', 'Season 2026'],
  ['star', 'Longest Win Streak (7)', 'Sunday Scaries', 'Season 2026'], ['star', 'Best Draft (A)', 'Darkness Falls', 'Season 2026'], ['star', 'Closest Game', 'Fumble Rooskie', 'Week 4 · by 0.2'],
];
const trophies = `<section aria-labelledby="tr-h" style="${k.FRAME}">
${k.frameHead(`${k.h2('tr-h', 'Trophy room')}<span style="margin-left: auto; display: flex; flex-wrap: wrap; align-items: flex-end; gap: 8px 16px">${k.select({ id: 'tr-season', label: 'Season', options: ['2026', '2025'], value: '2026', w: 140 })}${k.link('Show all 12 teams and 14 awards', 'Show all 12 teams and 14 awards')}</span>`)}
${champion}
<ul style="margin: 0; padding: 8px 20px; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 0 24px">${awards.map(([kind, award, team, detail]) => k.trophy({ kind, award, team, detail })).join('')}</ul>
</section>`;

// Recap of the championship week: own panel (fact rows and narrative only).
const facts = [['High score', 'Blitz Brigade · 138.4'], ['Bench blunder', 'Waiver Wolves · 14.6 left on the bench'], ['Waiver steal', 'Isaiah Likely · Blitz Brigade · 17.2 pts'], ['Closest game', 'Hail Mary Club vs Pocket Aces · by 1.4']];
const recap = k.recapPanel({
  week: 17, facts, generated: 'Generated Dec 29, 9:00 AM',
  body: 'Blitz Brigade closed out the season with a 138.4 to 127.9 win over Waiver Wolves and took the 2026 League Championship. Isaiah Likely, a midseason waiver pickup, scored 17.2 points in the final.',
});

const feed = [
  ['Waiver', 'Waiver Wolves', 'claimed Rashid Shaheed · $6 FAAB, dropped Tyler Lockett', '3d ago'],
  ['Add', 'Blitz Brigade', 'added Isaiah Likely', '4d ago'],
  ['Drop', 'Bench Mob', 'dropped Gardner Minshew', '4d ago'],
  ['Trade', 'Gridiron Ghosts', 'traded Chase Brown to Sunday Scaries for Courtland Sutton', '5d ago'],
  ['Stat correction', '', 'NFL stat correction updated 1 matchup score in week 17', '5d ago'],
  ['Settings', 'Darkness Falls', 'commissioner action', '6d ago'],
  ['Recap', '', 'Week 17 recap published', '6d ago'],
  ['Add', 'Pocket Aces', 'added Jameis Winston', '1w ago'],
];
const activity = `<section aria-labelledby="ac-h" style="${k.FRAME2}; display: flex; flex-direction: column; min-width: 0">
${k.frameHead(`<h2 id="ac-h" style="margin: 0; ${k.px(16)}">Recent activity</h2>${k.meta(feed.length + ' moves')}<span style="margin-left: auto">${k.link('All activity', 'All league activity')}</span>`)}
<ul style="list-style: none; margin: 0; padding: 4px 16px 8px">${feed.map(([kind, team, text, time], i) => k.activityRow({ kind, team, text, time, last: i === feed.length - 1 })).join('')}</ul></section>`;
const grid = `<div style="display: grid; grid-template-columns: minmax(0, 1.55fr) minmax(0, 1fr); gap: 24px; align-items: stretch">${standings}${activity}</div>`;

const playbook = k.phPb({
  groups: [
    { name: 'Play', tiles: [{ kind: 'draft', label: 'Draft Room', status: 'Draft complete · review the board' }, { kind: 'lineup', label: 'Set Lineup', status: 'Set your Week 17 lineup' }, { kind: 'gamecenter', label: 'Game Center', status: 'Week 17 live scores' }, { kind: 'picks', label: "Pick'em", status: 'Week 17 picks lock at kickoff' }] },
    { name: 'Moves', tiles: [{ kind: 'waivers', label: 'Waivers', status: 'Claim free agents and place bids' }, { kind: 'trade', label: 'Trades', status: 'Propose and review trades' }] },
    { name: 'League', tiles: [{ kind: 'rankings', label: 'Power Rankings', status: 'See where your team stacks up' }, { kind: 'history', label: 'History', status: 'Past seasons and champions' }, { kind: 'rules', label: 'League Rules', status: 'Scoring and roster settings' }] },
  ],
});

const chat = `<div style="display: flex; justify-content: flex-end; padding-top: 14px">${k.chatButton({ unread: 0 })}</div>`;
const notes = k.notes([
  'No Your move frame: nothing in a completed league needs the viewer, and the product marks no quick action Recommended. So this page has no cursor and no filled button. The trophy sprite, Playbook tiles and links are all outlined or plain.',
  'The champion moment leads because the season is the news: Trophy room opens with the 2026 League Champion (pixel trophy, team name Pixel 24, final record and seed), then the award list. Green is not used anywhere on this page (nothing is live and there is no filled action).',
  'Final standings keep the Rank column as the final seed; the dashed Playoff line sits after the sixth seed. The viewer row is Play-blue with an arrow. The recap is the championship week, fact rows and narrative only.',
  'Hidden in this phase: Matchup, My team, Around the league, Draft Day, Commissioner strip (member), Draft Settings. Pixel type is limited to heads, team name, chips and the trophy award names.',
]);

const body = `<main style="max-width: 1280px; margin: 0 auto; padding: 40px 32px 64px; display: flex; flex-direction: column; gap: 32px">
${head}
${trophies}
${recap}
${grid}
${playbook}
${chat}
${notes}
</main>`;
k.write(out, 'Complete.dc.html', k.page({ title: 'League dashboard, season complete', w: 1440, h: 2000, body }));
console.log('ok');
