// Dashboard, pre-draft. Viewer is the commissioner of Thursday Night Regulars (team: Darkness Falls).
// Product order: head, Your move, commissioner strip, Draft Day countdown, hero (Matchup preview + My team), standings, activity, playbook, chat.
const k = require('./league-kit');
const out = process.argv[2];
const LG = 'Thursday Night Regulars';
const TEAMS = ['Blitz Brigade', 'Waiver Wolves', 'Darkness Falls', 'Sunday Scaries', 'Gridiron Ghosts', 'Fumble Rooskie', 'Hail Mary Club', 'Pocket Aces', 'Dynasty Dads', 'Red Zone Rejects', 'Bench Mob', 'Practice Squad'];

const head = k.phHead({ title: LG, chips: ['Pre-draft', '12 Teams'], right: k.inviteButton() });

const move = `<section aria-labelledby="move-h" style="${k.FRAME}; min-width: 0">
${k.frameHead(`${k.h2('move-h', 'Your move')}${k.badge(1, 'plays')}`)}
<div style="display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; padding: 12px">
${k.playCard({ kind: 'join', name: 'Join requests', league: LG, detail: '2 waiting', lockDay: 'Draft starts Sat', lockTime: '7:00 PM', lockNote: 'Review requests before then', cta: 'Review requests', aria: `Review 2 join requests for ${LG} before the draft starts Saturday 7:00 PM`, state: 'next' })}
</div>
</section>`;

// The pending join request is a badge-link in the strip; the lead card above carries the one filled action.
const commissioner = k.commissioner({
  facts: [['Transactions', 'Open'], ['Teams locked', '0 of 12'], ['Trade deadline', 'None'], ['Waivers', 'FAAB · 48h'], ['Trade review', '24h']],
  items: [
    { text: k.joinRequestsLink(2), note: 'Two managers are waiting to join this public league.' },
    { action: k.link('League administration', 'Open league administration') },
  ],
});

const blk = t => `<span style="display: inline-flex; align-items: center; box-sizing: border-box; padding: 12px 16px; border: 2px solid {{t.frame}}; background: {{t.bg}}; ${k.px(32)}; line-height: 1.2">${t}</span>`;
const draftDay = `<section aria-labelledby="dd-h" style="${k.FRAME}; min-width: 0">
${k.frameHead(`${k.h2('dd-h', 'Draft Day')}<span style="margin-left: auto">${k.btnGhost('Draft Room', { tag: 'a', aria: 'Open the Draft Room' })}</span>`)}
<div style="padding: 20px; display: flex; flex-direction: column; gap: 16px">
<div role="group" aria-label="Draft in 3 days 4 hours" style="display: flex; flex-wrap: wrap; align-items: center; gap: 12px"><span aria-hidden="true" style="${k.px(24)}">Draft in</span><span aria-hidden="true">${blk('3d')}</span><span aria-hidden="true">${blk('04h')}</span></div>
<p style="margin: 0; font-size: 17px">Sat, Oct 24 · 7:00 PM</p>
<div>${k.btnGhost('Add to calendar', { aria: 'Add the draft to your calendar' })}</div>
</div></section>`;

// Hero: the Matchup preview says "No matchup this week" (no week yet); My team keeps only the tiles that have a value.
const matchup = k.phEmpty({ id: 'vs-h', title: 'Matchup', text: 'No matchup this week', center: true });
const myTeam = k.phMyTeam({ name: 'Darkness Falls', tiles: [['FAAB left', '100/100']], status: 'Lineups open after the draft' });
const hero = `<div style="display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr); gap: 24px; align-items: stretch">${matchup}${myTeam}</div>`;

const standings = k.phPreseasonStandings({ teams: TEAMS, viewer: 2 });
const activity = k.phEmpty({ id: 'ac-h', title: 'Recent activity', small: true, text: 'No moves yet this season.', tail: k.link('All activity', 'All league activity') });

// Dropped: Draft Room (Draft Day button), Set Lineup, Waivers and Trades (My team links), Activity (Recent activity link).
const playbook = k.phPb({
  groups: [
    { name: 'Play', tiles: [{ kind: 'gamecenter', label: 'Game Center', status: 'Live scores and matchups' }, { kind: 'picks', label: "Pick'em", status: 'Make your weekly picks' }] },
    { name: 'League', tiles: [{ kind: 'rankings', label: 'Power Rankings', status: 'See where your team stacks up' }, { kind: 'history', label: 'History', status: 'Past seasons and champions' }, { kind: 'rules', label: 'League Rules', status: 'Scoring and roster settings' }, { kind: 'settings', label: 'Draft Settings', status: 'Configure the upcoming draft' }] },
  ],
});

const chat = `<div style="display: flex; justify-content: flex-end; padding-top: 14px">${k.chatButton({ unread: 1 })}</div>`;
const notes = k.notes([
  'Pre-draft, commissioner view, in the product\'s order. One cursor: Join requests is the commissioner\'s pending item, so its card takes the cursor frame and the page\'s one filled button; the card\'s time line is the draft start, not a lock. The product marks no quick action Recommended before the draft, so this lead is a design choice.',
  'The commissioner strip carries "Join requests" as a badge-link with the count (no second button), the five facts in one row, and the League administration link. Matchup preview reads "No matchup this week" (no week yet) and My team shows only the tiles that have a value: FAAB left. Draft grade, projected finish, playoff odds and roster value drop out.',
  'Hidden in this phase: Recap, Around the league (no week to show), Trophy room (no trophies yet). Recent activity shows its empty line below the standings. Draft Settings appears in the Playbook because it is commissioner-only and pre-draft or drafting only.',
  'Standings is the honest preseason state: placeholder marks, no playoff line, and the note that records, points and streaks populate after Week 1. The viewer row is Play-blue with an arrow, never a cursor. Green appears only on the one filled button.',
]);

const body = `<main style="max-width: 1280px; margin: 0 auto; padding: 40px 32px 64px; display: flex; flex-direction: column; gap: 32px">
${head}
${move}
${commissioner}
${draftDay}
${hero}
${standings}
${activity}
${playbook}
${chat}
${notes}
</main>`;
k.write(out, 'PreDraft.dc.html', k.page({ title: 'League dashboard, pre-draft', w: 1440, h: 2000, body }));
console.log('ok');
