// Draft room, live, Round 4, the viewer is on the clock. Wide panes layout (59fr / 25fr / 16fr).
const k = require('./league-kit-samples');
const { BYE } = require('./lineup-data');
const out = process.argv[2];
const LG = 'Thursday Night Regulars';

const head = `<section aria-labelledby="h1" style="display: flex; flex-direction: column; gap: 8px; min-width: 0">
${k.breadcrumb([LG], 'Draft room')}
${k.h1(LG)}
<div style="display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px 24px">
<div role="group" aria-label="Draft status" style="display: flex; flex-wrap: wrap; align-items: center; gap: 8px 16px">${k.liveChip('Live')}<span style="font-size: 17px; color: {{t.dim}}">Draft in progress · On the clock: Darkness Falls · Times in CDT</span></div>
<div role="group" aria-label="Draft controls" style="display: flex; flex-wrap: wrap; gap: 4px 24px">${k.toggle({ id: 'snd', label: 'On-the-clock sound', on: true })}${k.toggle({ id: 'cmt', label: 'Draft assistant commentary', on: false })}</div>
</div>
</section>`;

const banner = k.pickBanner({ team: 'Darkness Falls', status: 'Your pick!', sub: 'Round 4 · Pick 46 overall · Darkness Falls is on the clock', clock: '0:47' });

// ---- left pane: Players ----
const P = (name, team, pos, _bye, adp, rank, pace, o = {}) => ({ name, team, pos, bye: BYE[team], adp, rank, pace, ...o });
const players = [
  P('Tee Higgins', 'CIN', 'WR', 12, '41.8', 18, '196.4', { queued: true, cursor: true }),
  P('Josh Jacobs', 'GB', 'RB', 5, '43.2', 16, '214.7', { queued: true }),
  P('Zay Flowers', 'BAL', 'WR', 7, '44.1', 19, '189.2'),
  P('Sam LaPorta', 'DET', 'TE', 8, '45.6', 4, '168.8', { queued: true }),
  P('Kyren Williams', 'LAR', 'RB', 8, '46.9', 17, '207.3', { inj: 'Q' }),
  P('Ricky Pearsall', 'SF', 'WR', 14, '48.3', 20, '182.5'),
  P('James Cook', 'BUF', 'RB', 7, '49.0', 18, '201.9'),
  P('DJ Moore', 'CHI', 'WR', 5, '50.4', 21, '178.0'),
  P('Joe Burrow', 'CIN', 'QB', 12, '51.7', 5, '331.6'),
  P('Jayden Daniels', 'WAS', 'QB', 12, '52.9', 6, '322.4'),
  P('Rashee Rice', 'KC', 'WR', 10, '54.2', 22, '174.3'),
  P('Tucker Kraft', 'GB', 'TE', 5, '56.8', 5, '154.1'),
  P('Courtland Sutton', 'DEN', 'WR', 12, '58.0', 23, '168.7'),
  P('Isaiah Likely', 'BAL', 'TE', 7, '59.6', 6, '149.2'),
  P('Brian Robinson Jr.', 'SF', 'RB', 14, '61.1', 19, '188.6'),
  P('Jakobi Meyers', 'LV', 'WR', 8, '62.4', 24, '163.5'),
  P('Baker Mayfield', 'TB', 'QB', 9, '63.8', 7, '314.9'),
  P('Rhamondre Stevenson', 'NE', 'RB', 14, '64.9', 20, '181.7'),
  P('Jauan Jennings', 'SF', 'WR', 14, '66.2', 25, '158.3'),
  P('Tony Pollard', 'TEN', 'RB', 9, '67.5', 21, '176.2'),
  P('Hunter Henry', 'NE', 'TE', 14, '68.9', 7, '141.7'),
  P('Rashid Shaheed', 'NO', 'WR', 7, '70.3', 26, '152.9'),
];
const left = `<section aria-labelledby="pp-h" style="${k.FRAME}; display: flex; flex-direction: column; min-width: 0">
${k.frameHead(`${k.segToggle({ label: 'Players or Board', items: [{ label: 'Players', on: true }, { label: 'Board' }] })}<h2 id="pp-h" style="margin: 0 0 0 12px; ${k.px(24)}">Available Players</h2>`)}
<div style="display: flex; flex-wrap: wrap; align-items: flex-end; gap: 12px 16px; padding: 16px 20px; border-bottom: 2px solid {{t.rule}}">
${k.field({ id: 'pp-f', label: 'Filter available', placeholder: 'Filter by name…', w: 220 })}
${k.select({ id: 'pp-pos', label: 'Position', options: ['All positions', 'QB', 'RB', 'WR', 'TE', 'K', 'DEF'], value: 'All positions', w: 160 })}
${k.select({ id: 'pp-bye', label: 'Bye week', options: ['All bye weeks', ...[...new Set(Object.values(BYE))].sort((a, b) => a - b).map(w => `Week ${w}`)], value: 'All bye weeks', w: 160 })}
${k.checkbox({ id: 'pp-hide', label: 'Hide drafted', checked: true })}
</div>
${k.playerTable({ rows: players })}
</section>`;

// ---- middle: chat and draft activity ----
const log = [
  ['d', 'PICK', 'Gridiron Ghosts drafted Travis Kelce (TE)', '7:23 PM'],
  ['c', 'Gridiron Ghosts', '7:23 PM', 'Kelce at 29 was too good to pass.'],
  ['d', 'PICK', 'Fumble Rooskie drafted Breece Hall (RB)', '7:24 PM'],
  ['d', 'PICK', 'Hail Mary Club drafted Terry McLaurin (WR)', '7:25 PM'],
  ['d', 'PICK', 'Pocket Aces drafted Jerome Ford (RB)', '7:26 PM'],
  ['c', 'Pocket Aces', '7:26 PM', 'Third running back I wanted gone.'],
  ['d', 'PICK', 'Dynasty Dads drafted Evan Engram (TE)', '7:27 PM'],
  ['d', 'AUTO', 'Red Zone Rejects autodrafted Calvin Ridley (WR)', '7:28 PM'],
  ['d', 'PICK', 'Bench Mob drafted Javonte Williams (RB)', '7:29 PM'],
  ['d', 'PICK', 'Practice Squad drafted Mike Evans (WR)', '7:30 PM'],
  ['d', 'PICK', 'Practice Squad drafted Garrett Wilson (WR)', '7:31 PM'],
  ['d', 'PICK', 'Bench Mob drafted Bucky Irving (RB)', '7:32 PM'],
  ['c', 'Bench Mob', '7:33 PM', 'Running backs are going fast.'],
  ['d', 'AUTO', 'Red Zone Rejects autodrafted Colston Loveland (TE)', '7:34 PM'],
  ['d', 'PICK', 'Dynasty Dads drafted Brian Thomas Jr. (WR)', '7:35 PM'],
  ['c', 'Dynasty Dads', '7:35 PM', 'Finally got my guy.'],
  ['d', 'PICK', 'Pocket Aces drafted Xavier Worthy (WR)', '7:36 PM'],
  ['d', 'PICK', 'Hail Mary Club drafted Kenneth Walker III (RB)', '7:37 PM'],
  ['d', 'PICK', 'Fumble Rooskie drafted Alvin Kamara (RB)', '7:38 PM'],
  ['d', 'PICK', 'Gridiron Ghosts drafted Brock Bowers (TE)', '7:39 PM'],
  ['d', 'AUTO', 'Sunday Scaries autodrafted Jaylen Waddle (WR)', '7:40 PM'],
  ['c', 'Waiver Wolves', '7:40 PM', 'Darkness Falls, you are up.'],
];
const mid = `<section aria-label="Chat and Draft activity" style="${k.FRAME}; display: flex; flex-direction: column; min-width: 0">
${k.frameHead(`<h2 id="ch-h" style="margin: 0; ${k.px(16)}">League Chat</h2>`)}
<ul role="log" aria-labelledby="ch-h" tabindex="0" style="list-style: none; margin: 0; padding: 14px 16px; display: flex; flex-direction: column; justify-content: flex-end; gap: 12px; flex: 1">${log.map(([t, a, b, c]) => t === 'd' ? k.drawLine({ tag: a, text: b, time: c }) : k.chatMsg({ team: a, time: b, text: c })).join('')}</ul>
${k.composer()}
</section>`;

// ---- right: draft rail ----
const sec = (inner) => `<div style="padding: 16px 14px; border-bottom: 2px solid {{t.rule}}">${inner}</div>`;
const q = [['Tee Higgins', 'WR'], ['Josh Jacobs', 'RB'], ['Sam LaPorta', 'TE']];
const roster = [['QB', 'Josh Allen'], ['RB', 'Jahmyr Gibbs'], ['RB'], ['WR', 'Puka Nacua'], ['WR'], ['TE'], ['FLEX'], ['K'], ['DEF']];
const up = [[46, 'Darkness Falls', true], [47, 'Waiver Wolves'], [48, 'Blitz Brigade'], [49, 'Blitz Brigade'], [50, 'Waiver Wolves']];
const rail = `<section aria-label="Draft rail" style="${k.FRAME}; min-width: 0">
${sec(`${k.railHead('q-h', 'My Queue')}<ul style="list-style: none; margin: 8px 0 0; padding: 0">${q.map(([name, pos], i) => k.queueRow({ n: i + 1, name, pos, first: i === 0, last: i === q.length - 1 })).join('')}</ul>`)}
${sec(`${k.railHead('r-h', 'My Roster')}<ul style="list-style: none; margin: 8px 0 0; padding: 0">${roster.map(([slot, name]) => k.rosterRow({ slot, name })).join('')}</ul>`)}
${sec(`${k.railHead('u-h', 'Upcoming')}<ul style="list-style: none; margin: 8px 0 0; padding: 0">${up.map(([pick, team, you]) => k.upcomingRow({ pick, team, you, clock: you })).join('')}</ul>
<div style="margin-top: 12px; font-size: 13px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; color: {{t.dim}}">My picks · 46 · 51 · 70</div>
<div style="display: flex; flex-direction: column; align-items: flex-start; margin-left: -10px">${k.link('All 15 of my picks', 'All 15 of my picks')}${k.link('Full Draft order', 'Full Draft order')}</div>`)}
${k.assistantSection()}
</section>`;

const panes = `<div style="display: grid; grid-template-columns: minmax(0, 59fr) minmax(0, 25fr) minmax(0, 16fr); gap: 16px; align-items: stretch">${left}${mid}${rail}</div>`;

const notes = k.notes([
  'One cursor: the top queued player row (Tee Higgins) wears the Cursor frame, and its Draft button is the page\'s one filled green action. Every other Draft button, including My Queue row 1, is ghost. Draft opens the confirm dialog "Draft Tee Higgins?", whose own filled button is allowed because the modal blocks the page.',
  'The on-the-clock banner is Board black with the pick clock in Pixel 32 and the status in Pixel 24 (role=status, aria-live polite: "Your pick!", "{Team} is on the clock", "Waiting…"). 0:47 is not under 30 seconds, so there is no red; under 0:30 the clock turns Danger. "Draft paused" and "No pick clock" replace the clock. The banner stays sticky and carries no round meter.',
  'Rail buttons are 44px (queue Draft, Move up, Move down, Remove); table buttons stay 36px. The move arrows are 16px on the 2px grid and sit in their own pair, a rule away from the 12px remove x. Every chat message has a quiet Hide button ("Hide message from {team}"). The framed Draft assistant section closes the rail.',
  'Green is the Live chip and the one filled Draft. Position chips carry their letters, so colour is never the only cue. Only the status line, the clock and the headings are pixel type; rows, chat and the rail stay Archivo.',
  'Kept for tests/e2e/draft-accessibility.spec.ts: regions "Chat and Draft activity", "Draft rail", "Draft Board" (the Board view); log "League Chat"; group "Chat composer" with textbox "Message", "Insert emoji" and Send; group "Players or Board" with button "Board". Below 1200px the panes become the tabs Chat, Players, Board, Draft: see DraftRoomNarrow. The commissioner toolbar is not shown in this member view.',
]);

const body = `<main style="padding: 32px 24px 64px; display: flex; flex-direction: column; gap: 24px">
${head}
${banner}
${panes}
${notes}
</main>`;

k.write(out, 'DraftRoom.dc.html', k.page({ title: 'Draft room, your pick', w: 1440, h: 1600, body }));
console.log('ok');
