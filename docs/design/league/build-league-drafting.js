// Dashboard, draft live. Viewer is a member (Darkness Falls), 3 picks from the clock.
// Product order: head, Your move, hero (Matchup preview + My team), standings, activity, playbook, chat.
const k = require('./league-kit');
const out = process.argv[2];
const LG = 'Thursday Night Regulars';
const TEAMS = ['Blitz Brigade', 'Waiver Wolves', 'Darkness Falls', 'Sunday Scaries', 'Gridiron Ghosts', 'Fumble Rooskie', 'Hail Mary Club', 'Pocket Aces', 'Dynasty Dads', 'Red Zone Rejects', 'Bench Mob', 'Practice Squad'];

const head = k.phHead({ title: LG, chips: ['Draft live', '12 Teams'] });

const move = `<section aria-labelledby="move-h" style="${k.FRAME}; min-width: 0">
${k.frameHead(`${k.h2('move-h', 'Your move')}${k.badge(1, 'plays')}`)}
<div style="display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; padding: 12px">
${k.playCard({ kind: 'draft', name: 'Draft Room', league: LG, detail: 'You pick in 3 picks', lockDay: 'Live', lockTime: 'Round 2', lockNote: 'Draft is live now · make your picks', cta: 'Enter Draft Room', aria: `Enter the ${LG} Draft Room, the draft is live now, you pick in 3 picks`, state: 'next' })}
</div>
</section>`;

const matchup = k.phEmpty({ id: 'vs-h', title: 'Matchup', text: 'No matchup this week', center: true });
const myTeam = k.phMyTeam({ name: 'Darkness Falls', tiles: [['FAAB left', '100/100']], status: 'Lineups open after the draft' });
const hero = `<div style="display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr); gap: 24px; align-items: stretch">${matchup}${myTeam}</div>`;

const standings = k.phPreseasonStandings({ teams: TEAMS, viewer: 2 });
const activity = k.phEmpty({ id: 'ac-h', title: 'Recent activity', small: true, text: 'No moves yet this season.', tail: k.link('All activity', 'All league activity') });

// Dropped: Set Lineup, Waivers and Trades (My team links), Activity (Recent activity link).
const playbook = k.phPb({
  groups: [
    { name: 'Play', tiles: [{ kind: 'gamecenter', label: 'Game Center', status: 'Live scores and matchups' }, { kind: 'picks', label: "Pick'em", status: 'Make your weekly picks' }] },
    { name: 'League', tiles: [{ kind: 'rankings', label: 'Power Rankings', status: 'See where your team stacks up' }, { kind: 'history', label: 'History', status: 'Past seasons and champions' }, { kind: 'rules', label: 'League Rules', status: 'Scoring and roster settings' }] },
  ],
});

const chat = `<div style="display: flex; justify-content: flex-end; padding-top: 14px">${k.chatButton({ unread: 4 })}</div>`;
const notes = k.notes([
  'One cursor: while the draft is live, Draft Room is the Recommended action and leads. It wears the calm cursor frame and the page\'s one filled button. The clock is not under 30 seconds (three picks away), so nothing is red; the cursor goes red only when the pick clock drops under 30 seconds.',
  'The live state is the only green besides the filled foot: the "Live" lock line on the lead card. The Draft live chip is neutral, as in the product (the live chip variant is for the played season).',
  'Matchup preview reads "No matchup this week" and My team shows only the tile that has a value (FAAB left); standings are preseason and Recent activity is its empty line below them. All honest empty states, not placeholders for invented numbers.',
  'Hidden in this phase: Draft Day countdown (pre-draft only), Commissioner strip (member), Recap, Around the league, Draft Settings (commissioner only), Trophy room (no trophies). The Draft Room tile leaves the Playbook because it is the lead.',
]);

const body = `<main style="max-width: 1280px; margin: 0 auto; padding: 40px 32px 64px; display: flex; flex-direction: column; gap: 32px">
${head}
${move}
${hero}
${standings}
${activity}
${playbook}
${chat}
${notes}
</main>`;
k.write(out, 'Drafting.dc.html', k.page({ title: 'League dashboard, draft live', w: 1440, h: 2000, body }));
console.log('ok');
