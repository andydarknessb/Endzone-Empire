// League kit reference sheet: every new piece in its states. Hover and focus are forced notes; the live controls do the same on interaction.
const k = require('./league-kit-samples');
const out = process.argv[2];

const cap = t => `<figcaption style="font-size: 13px; color: {{t.dim}}">${t}</figcaption>`;
const fig = (inner, caption, extra = '') => `<figure style="margin: 0; display: flex; flex-direction: column; gap: 8px; min-width: 0; ${extra}">${inner}${cap(caption)}</figure>`;
const grid = (cols, inner, gap = 20) => `<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(${cols}px, 1fr)); gap: ${gap}px; align-items: start">${inner}</div>`;
const sec = (id, title, intro, inner) => `<section aria-labelledby="${id}" style="display: flex; flex-direction: column; gap: 16px"><div style="display: flex; flex-direction: column; gap: 4px">${k.h2(id, title)}<p style="margin: 0; font-size: 15px; color: {{t.dim}}; max-width: 90ch">${intro}</p></div>${inner}</section>`;
const swatch = (bg, label, inner) => `<div style="display: flex; flex-direction: column; gap: 8px"><div style="padding: 16px; background: ${bg}; display: flex; flex-wrap: wrap; align-items: center; gap: 12px; ${bg === '{{t.panel}}' || bg === '{{t.bg}}' ? 'border: 2px solid {{t.rule}}' : bg === '{{t.board}}' ? 'border: 2px solid {{t.boardRule}}' : ''}">${inner}</div><span style="font-size: 13px; color: {{t.dim}}">${label}</span></div>`;
const POS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'IDP'], GR = ['A', 'B', 'C', 'D', 'F'];

const head = `<section aria-labelledby="h1" style="display: flex; flex-direction: column; gap: 12px">${k.h1('League kit')}<p style="margin: 0; font-size: 17px; color: {{t.dim}}">Pieces added to the Home kit for every /league/:id/* page. Square corners, 6px double frames, no shadows, stepped motion.</p></section>`;

// 1. chips
const chips = sec('chips-h', 'Tags and chips', 'Position tags and grade chips are labels first: the letters carry the meaning and colour is a second cue. Each has a contrast pair on Field, Panel and Board. Never use them as decoration.', grid(380,
  swatch('{{t.bg}}', 'Position tags on Field', POS.map(p => k.posTag(p)).join('')) +
  swatch('{{t.panel}}', 'Position tags on Panel', POS.map(p => k.posTag(p)).join('')) +
  swatch('{{t.board}}', 'Position tags on Board (dark values in both themes)', POS.map(p => k.posTag(p, { on: 'board' })).join('')) +
  swatch('{{t.bg}}', 'Grade chips on Field', GR.map(k.gradeChip).join('')) +
  swatch('{{t.panel}}', 'Grade chips on Panel', GR.map(k.gradeChip).join('')) +
  swatch('{{t.board}}', 'Grade chips on Board', GR.map(k.gradeChip).join('')) +
  swatch('{{t.panel}}', 'In-row badges, Archivo 13 700 uppercase: activity kind tags, You, avatar, injury', ['Add', 'Drop', 'Trade', 'Waiver', 'Settings'].map(x => k.kindTag(x)).join('') + k.youBadge() + k.avatar('Darkness Falls') + k.injTag('Questionable') + k.injTag('Out')) +
  swatch('{{t.panel}}', 'Status chips, Pixel 16: phase, Scheduled, Needs you, Final, Recap, Live', ['Week 7 · In season', 'Scheduled', 'Needs you', 'Final', 'Recap'].map(k.chip).join('') + k.liveChip('Live')) +
  swatch('{{t.board}}', 'Live chip on Board (bright green, live state only)', k.liveChipBoard('Live'))
));

// 2. table + standings
const sample = [['1', 'Blitz Brigade', '5-1-0', '701.2'], ['2', 'Waiver Wolves', '5-1-0', '688.7'], ['3', 'Darkness Falls', '4-2-0', '664.5'], ['4', 'Sunday Scaries', '4-2-0', '651.0']];
const cols = [{ label: 'Rank', w: 72 }, { label: 'Team', w: 200 }, { label: 'W-L-T', align: 'right', w: 96 }, { label: 'PF', align: 'right', w: 96 }];
const tbl = `<div style="${k.FRAME}">${k.table({ label: 'Sample table', cols, rows: [...sample.slice(0, 2), { cut: 'Playoff line' }, ...sample.slice(2)], viewer: 2, minW: 480 })}</div>`;
const tblPhone = `<div style="${k.FRAME}; width: 330px; box-sizing: border-box">${k.table({ label: 'Sample table, phone width', cols: [{ label: '#', w: 56 }, { label: 'Team', w: 200 }, { label: 'W-L-T', align: 'right', w: 96 }, { label: 'PF', align: 'right', w: 96 }, { label: 'PA', align: 'right', w: 96 }], rows: sample.map(r => [...r, '603.1']), viewer: 2, minW: 544 })}</div>`;
const TEAMS = [['Blitz Brigade', 5, 1, '701.2', '598.4', 'W3'], ['Waiver Wolves', 5, 1, '688.7', '612.0', 'W2'], ['Darkness Falls', 4, 2, '664.5', '603.1', 'W1'], ['Sunday Scaries', 4, 2, '651.0', '622.9', 'L1']];
const st = k.standings({ data: TEAMS.map(([team, w, l, pf, pa, strk], i) => ({ rank: i + 1, team, w, l, t: 0, pf, pa, strk })), viewer: 2, cutAfter: 3, id: 'kst-h' });
const tables = sec('tbl-h', 'Table and standings', 'Sticky first column inside an overflow-x box, tabular figures, 44px rows with 2px Rule dividers, no zebra. The viewer row is Play-blue with an arrow and is never the cursor. The cut line is a dashed Frame rule with a label.', `<div style="display: grid; grid-template-columns: minmax(0, 1.5fr) minmax(0, 1fr); gap: 24px; align-items: start">${fig(st, 'Standings screen, 4 of 12 rows')}<div style="display: flex; flex-direction: column; gap: 20px">${fig(tbl, 'table() with a viewer row and a cut line')}${fig(tblPhone, 'Phone width: the table box scrolls sideways, the first column stays')}</div></div>`);

// 3. matchup panels
const vs = k.versusPanel({ you: { name: 'Darkness Falls', fig: '112.4' }, opp: { name: 'Sunday Scaries', fig: '104.8' }, pct: 61, edges: [['QB', '22.1', '24.3'], ['RB', '38.1', '29.6'], ['WR', '31.2', '30.5'], ['TE', '8.9', '7.2'], ['K', '6.3', '7.9'], ['DEF', '5.8', '5.3']], margin: 'Darkness Falls by 7.6', narrative: 'Darkness Falls hold the running back edge, 38.1 to 29.6 projected.', id: 'kvs-h' });
const vl = k.versusLive({ you: { name: 'Darkness Falls', score: '87.4', fig: '87.4', note: '4 players remaining' }, opp: { name: 'Sunday Scaries', score: '71.2', fig: '71.2', note: '2 players remaining' }, youLeads: true, margin: 'Up 16.2', pct: 78, aria: 'Week 7 matchup: Darkness Falls lead Sunday Scaries 87.4 to 71.2, up 16.2, 78% win probability', scored: true, id: 'kvl-h' });
const matchups = sec('mu-h', 'Versus panel and scoreboard', 'Before kickoff: framed, projected figures, Frame-colour odds bar. Live: the Board-black tile scaled up, leader white and trailer dim, the margin directly under the viewer score, live odds bar, the score block is one link. The score flash is a specimen: the wash on the live tile below is the flash held at rest under reduced motion, and no dashboard board carries it.', grid(560, fig(vs, 'versusPanel, pre-kickoff') + fig(vl, 'versusLive, game day (specimen: score flash held, Kit only)')));

// 4. team + recap + around + commissioner
const mt = k.myTeam({ name: 'Darkness Falls', record: '4-2', rankLine: '3rd of 12', pf: '664.5', pa: '603.1', nextLock: 'Sun 12:00 PM', lockNote: 'First kickoff of Week 7', starters: [{ slot: 'QB', name: 'Josh Allen', game: 'BUF vs MIA', proj: '22.1' }, { slot: 'RB', name: 'Woody Marks', inj: 'Q', game: 'HOU vs SEA', proj: '11.8' }, { slot: 'TE', name: 'Trey McBride', game: 'ARI vs IND', proj: '12.4' }], more: 'and 6 more starters · 1 questionable', status: 'Lineup incomplete', id: 'kmt-h' });
const rc = k.recapPanel({ headline: 'Blitz Brigade posts 141.7 and takes first', body: 'Blitz Brigade went off for the week\'s top score and moved into first place.', facts: [['High score', 'Blitz Brigade · 141.7'], ['Closest game', 'Gridiron Ghosts vs Hail Mary Club · by 0.8']], generated: 'Generated Oct 13, 9:00 AM', id: 'krc-h' });
const at = k.aroundTile({ a: { name: 'Blitz Brigade', fig: '118.2' }, b: { name: 'Bench Mob', fig: '96.4' }, pct: 78, aria: 'Blitz Brigade against Bench Mob, 78% win probability' });
const cm = k.commissioner({ id: 'kcm-h', facts: [['Transactions', 'Open'], ['Teams locked', '0 of 12'], ['Trade deadline', 'Week 10'], ['Waivers', 'FAAB · 48h']], items: [{ text: 'Join requests · 2', note: 'Two managers are waiting to join.', action: k.btnGhost('Review requests') }, { text: 'Advance to Week 8', note: "Advancing closes Week 7 matchups and opens Week 8. You'll be asked to confirm.", action: k.btnGhost('Advance to Week 8') }, { text: 'Trade review closes in 38 min', urgent: true, note: 'Red appears only when something is under one hour.', action: k.btnGhost('Review trade') }] });
const panels = sec('pn-h', 'Team, recap, around the league, commissioner', 'Every panel is the one frame with a 2px Rule divider under its head. The commissioner strip is never filled; its only red is a lock under one hour.', `<div style="display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 24px; align-items: start">${fig(mt, 'myTeam')}<div style="display: flex; flex-direction: column; gap: 24px">${fig(rc, 'recapPanel')}${fig(`<div style="max-width: 400px">${at}</div>`, 'aroundTile (framed before kickoff); aroundMore is the dashed sixth cell')}</div></div>${fig(cm, 'commissioner frame, with one urgent item')}`);

// 5. playbook tiles
const pb = k.playbook({ id: 'kpb-h', groups: [{ name: 'Play', tiles: [{ kind: 'gamecenter', label: 'Game Center', status: 'Week 7 live scores' }, { kind: 'draft', label: 'Draft Room', status: 'Draft complete · review the board' }] }, { name: 'Moves', tiles: [{ kind: 'trade', label: 'Trades', status: 'Propose and review trades' }, { kind: 'waivers', label: 'Waivers', status: 'Claim free agents and place bids' }] }, { name: 'League', tiles: [{ kind: 'activity', label: 'Activity', status: 'Recent moves' }, { kind: 'rankings', label: 'Power Rankings', status: 'Where you stack up' }, { kind: 'history', label: 'History', status: 'Past seasons' }, { kind: 'rules', label: 'League Rules', status: 'Scoring and roster' }] }] });
const play = sec('pbk-h', 'Playbook tiles', 'Tiles are Play-blue with a 96 by 48 pictogram and never carry a filled foot. On subpages the one cursor sits on a row with the same 4px frame as the lead play card; the Lineup section below shows it once.', fig(pb, 'playbook with five new pictograms: gamecenter, activity, rankings, history, rules'));

// 6. forms
const forms = sec('fm-h', 'Form controls', 'Native inputs, restyled. 44px targets, 2px borders, Dim border at rest and Ink on hover and focus, the white focus ring with the dark halo. Error is a Danger border plus a message with an icon, never colour alone.', `
${grid(220, fig(k.field({ id: 'f1', label: 'Team name', value: 'Darkness Falls', hint: 'Shown in standings and chat.' }), 'Field, default') +
  fig(k.field({ id: 'f2', label: 'Team name', value: 'Darkness Falls', state: 'hover' }), 'Hover note: border goes to Ink, a 12% brightness lift') +
  fig(k.field({ id: 'f3', label: 'Team name', value: 'Darkness Falls', state: 'focus' }), 'Focus note: white ring, 7px Field halo') +
  fig(k.field({ id: 'f4', label: 'Team name', value: 'Locked by commissioner', disabled: true }), 'Disabled: dim text, Rule border') +
  fig(k.field({ id: 'f5', label: 'FAAB bid', value: '120', error: 'You have $82 left. Enter $82 or less.' }), 'Error: Danger border and an icon message'))}
${grid(260, fig(k.select({ id: 's1', label: 'Season', options: ['2025', '2024', '2023'], value: '2025' }), 'Select, default') +
  fig(k.select({ id: 's2', label: 'Season', options: ['2025', '2024'], value: '2025', state: 'focus' }), 'Select, focus note') +
  fig(k.select({ id: 's3', label: 'Season', options: ['2025'], value: '2025', disabled: true }), 'Select, disabled') +
  fig(k.select({ id: 's4', label: 'Scoring', options: [{ value: '', label: 'Choose scoring' }, 'PPR', 'Half PPR'], value: '', error: 'Choose a scoring type.' }), 'Select, error'))}
${grid(260, fig(k.toggle({ id: 't1', label: 'Trade review' }), 'Toggle, off (the On/Off word is part of the control)') +
  fig(k.toggle({ id: 't2', label: 'Trade review', on: true }), 'Toggle, on: Play-blue track, knob right') +
  fig(k.toggle({ id: 't3', label: 'Trade review', on: true, state: 'focus' }), 'Toggle, focus note') +
  fig(k.toggle({ id: 't4', label: 'Trade review', disabled: true }), 'Toggle, disabled'))}
${grid(260, fig(k.stepper({ id: 'p1', label: 'Roster spots', value: '16' }), 'Stepper, default') +
  fig(k.stepper({ id: 'p2', label: 'Roster spots', value: '16', state: 'focus' }), 'Stepper, focus note') +
  fig(k.stepper({ id: 'p3', label: 'Roster spots', value: '8', atMin: true }), 'Stepper, at minimum: minus is disabled') +
  fig(k.stepper({ id: 'p4', label: 'Roster spots', value: '16', disabled: true }), 'Stepper, disabled'))}
${fig(k.radioCards({ legend: 'Waiver type', name: 'wv', options: [{ value: 'faab', label: 'FAAB', desc: 'Bid a budget, highest bid wins', checked: true }, { value: 'rolling', label: 'Priority', desc: 'Order resets after each claim', state: 'hover' }, { value: 'free', label: 'First come', desc: 'Claims process instantly', state: 'focus' }, { value: 'off', label: 'Off', desc: 'Not available on this league', disabled: true }] }), 'radioCards: selected (Play-blue, filled dot), hover note, focus note, disabled')}
${fig(`<div style="display: flex; flex-wrap: wrap; gap: 12px; align-items: center">${k.btnGhost('Ghost')}${k.force(k.btnGhost('Hover note'), 'hover')}${k.force(k.btnGhost('Focus note'), 'focus')}${k.btnQuiet('Quiet')}${k.btnDisabled('Disabled')}</div>`, 'Buttons: one filled action per page, so Fill lives only on the lead play card (and a dialog that blocks the page)')}`);

// 7. overlays
const dlg = `<div style="position: relative; height: 340px; overflow: hidden; border: 2px solid {{t.rule}}"><div aria-hidden="true" style="padding: 24px; display: flex; flex-direction: column; gap: 12px"><span style="${k.px(24)}">Commissioner</span><span style="font-size: 15px; color: {{t.dim}}">The page behind a dialog is inert.</span></div>${k.dialog({ id: 'adv', title: 'Advance to Week 8?', body: 'This closes Week 7 matchups and opens Week 8. Week 7 is scored as played, and this cannot be undone from here.', actions: k.btnGhost('Cancel') + k.btnFill('Confirm', { tag: 'button' }) })}</div>`;
const mn = `<div style="display: flex; flex-direction: column; gap: 8px; align-items: flex-start">${k.menuButton('Season 2025', { open: true })}${k.menu({ label: 'Season', items: [{ label: '2025', selected: true }, { label: '2024', selected: false, state: 'hover' }, { label: '2023', selected: false, state: 'focus' }, { sep: true }, { label: '2022 (no data)', selected: false, disabled: true }] })}</div>`;
const tb = k.tabs({ label: 'Draft view', id: 'kt', items: [{ label: 'Chat' }, { label: 'Players' }, { label: 'Board', selected: true }, { label: 'Draft' }] });
const tb2 = k.tabs({ label: 'Commissioner Tools', id: 'kt2', items: [{ label: 'General Settings', selected: true }, { label: 'Roster Settings', state: 'hover' }, { label: 'Scoring Settings', state: 'focus' }, { label: 'Waivers &amp; Trades' + k.unsavedMarker() }, { label: 'System Overrides', disabled: true }] });
const bc = k.breadcrumb([ 'Thursday Night Regulars' ], 'Lineup');
const over = sec('ov-h', 'Dialog, menu, tabs, breadcrumb', 'Dialog is a 6px double Frame on a Field scrim. Menu is a framed list: hover is Play-blue, the selected item has an arrow. Tabs only appear where a page already has tabs. The breadcrumb restyles the existing back link and adds no navigation.', `${grid(520, fig(dlg, 'dialog over a scrim, with the Cancel and Confirm pair') + fig(mn, 'menuButton and menu: selected, hover note, focus note, separator, disabled'))}${fig(tb, 'tabs: the Draft room tablist "Draft view" below 1200px, Board selected (role=tab, aria-selected)')}${fig(tb2, 'tabs: selected, hover note, focus note, the Unsaved marker (a square, and "Unsaved changes" for screen readers), disabled')}${fig(bc, 'breadcrumb: a back link to the dashboard, then the current page')}`);

// 8. chat, activity, trophies, countdown
const msgs = [{ team: 'Sunday Scaries', time: '9:12 AM', text: 'Who is starting at flex this week?' }, { team: 'Darkness Falls', time: '9:14 AM', text: 'Woody Marks, if he clears.', you: true }, { team: 'Waiver Wolves', time: '9:20 AM', text: 'Trade offer coming for Gibbs. Be nice.' }];
const feedRows = [['Add', 'Sunday Scaries', 'added Jake Ferguson', '2h ago'], ['Drop', 'Bench Mob', 'dropped Gardner Minshew', '3h ago'], ['Trade', 'Gridiron Ghosts', 'traded Chase Brown to Blitz Brigade for Courtland Sutton', '5h ago'], ['Waiver', 'Darkness Falls', 'claimed Woody Marks · $12 FAAB, dropped Zach Ertz', '38m ago'], ['Settings', 'Waiver Wolves', 'moved the trade deadline to Week 10', '7h ago']];
const feedBox = `<ul style="${k.FRAME}; list-style: none; margin: 0; padding: 4px 16px 8px">${feedRows.map((r, i) => k.activityRow({ kind: r[0], team: r[1], text: r[2], time: r[3], last: i === feedRows.length - 1 })).join('')}</ul>`;
const social = sec('ch-h', 'Chat and activity', 'The chat button is 56px, square, with a 28px count badge; the drawer docks 380px on desktop and goes full width on a phone. Activity rows are Archivo sentences with a square kind tag.', `<div style="display: grid; grid-template-columns: 380px minmax(0, 1fr); gap: 24px; align-items: start">${fig(k.chatDrawer({ messages: msgs, id: 'kchat-h' }), 'chatDrawer, desktop dock')}<div style="display: flex; flex-direction: column; gap: 20px">${fig(`<div style="display: flex; gap: 24px; padding: 14px 14px 0 0">${k.chatButton({ unread: 3 })}${k.chatButton({})}</div>`, 'chatButton with 3 unread, and with none')}${fig(feedBox, 'activityRow: Add, Drop, Trade, Waiver, Settings')}</div></div>`);

const trophyBox = `<ul style="${k.FRAME}; margin: 0; padding: 8px 20px; display: grid; grid-template-columns: repeat(auto-fit, minmax(340px, 1fr)); gap: 0 24px">${k.trophy({ kind: 'cup', award: '2025 League Champion', team: 'Waiver Wolves', detail: 'Season 2025' })}${k.trophy({ kind: 'star', award: 'Weekly High', team: 'Blitz Brigade', detail: 'Week 6 · 141.7' })}</ul>`;
const cd = `<div style="${k.FRAME}; padding: 20px; display: flex; flex-wrap: wrap; align-items: center; gap: 16px 32px"><div style="display: flex; flex-direction: column; gap: 8px"><h2 style="margin: 0; ${k.px(24)}">Draft Day</h2><span style="font-size: 15px; color: {{t.dim}}">Sat, Oct 24 · 7:00 PM CDT</span>${k.btnGhost('Add to calendar')}</div>${k.countdown({ days: 3, hours: 4, minutes: 12 })}</div>`;
const trc = sec('tc-h', 'Trophies and countdown', 'Trophies are pixel pictograms on a 2px grid in Frame colour: a cup for season titles, a star for weekly awards. The countdown is Pixel 32 in square blocks.', grid(520, fig(trophyBox, 'trophy: cup and star') + fig(cd, 'countdown, pre-draft')));

const { stat, draftroom, lineup } = require('./kit-sections')({ sec, fig, grid });

const body = `<main style="max-width: 1280px; margin: 0 auto; padding: 40px 32px 64px; display: flex; flex-direction: column; gap: 48px">
${head}${chips}${tables}${matchups}${panels}${play}${forms}${over}${social}${trc}${stat}${draftroom}${lineup}
</main>`;

k.write(out, 'Kit.dc.html', k.page({ title: 'League kit', w: 1440, h: 6000, body }));
console.log('ok');
