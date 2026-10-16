// Kit sheet sections added in QA round 1: status legend and skeletons, Draft room, Lineup. Called from build-kit.js with its helpers.
const k = require('./league-kit-samples');
const { STARTERS, BYE } = require('./lineup-data');

module.exports = ({ sec, fig, grid }) => {
  // ---- status legend and skeleton blocks ----
  const skels = `<div aria-busy="true" style="${k.FRAME}; padding: 16px 20px; display: flex; flex-direction: column; gap: 12px; max-width: 520px">${k.skel('60%', 24)}<div style="display: flex; align-items: center; gap: 12px">${k.skel('28px', 28)}${k.skel('40%', 16)}<span style="flex: 1"></span>${k.skel('48px', 16)}</div><div style="display: flex; align-items: center; gap: 12px">${k.skel('28px', 28)}${k.skel('32%', 16)}<span style="flex: 1"></span>${k.skel('48px', 16)}</div></div>`;
  const legendBox = `<div style="${k.FRAME}; padding: 16px 20px; display: flex; flex-direction: column; gap: 12px; max-width: 520px">${k.statusLegend()}${['ip', 'fin', 'yet'].map(s => `<div style="display: flex; align-items: center; gap: 12px; font-size: 15px"><span style="display: inline-flex; width: 140px; align-items: center; gap: 8px; color: {{t.dim}}; font-size: 13px">${k.MARK[s][1]}${k.MARK[s][0]}</span><b style="font-weight: 600">Ja'Marr Chase</b></div>`).join('')}</div>`;
  const stat = sec('sl-h', 'Matchup status legend and skeleton blocks', 'In progress is a filled square, Final an outline square, Yet to play an outline with a centre dot: three shapes, always beside the words. Skeleton blocks are square Skel fills that do not animate; the container sets aria-busy.',
    grid(520, fig(legendBox, 'Matchup status legend markers, shown in the Starters frame head and beside each side of a row') + fig(skels, 'skel blocks: a head line and two avatar rows')));

  // ---- Draft room ----
  const P = (name, team, pos, adp, rank, pace, o = {}) => ({ name, team, pos, bye: BYE[team], adp, rank, pace, ...o });
  const banner = k.pickBanner({ team: 'Darkness Falls', status: 'Your pick!', sub: 'Round 4 · Pick 46 overall · Darkness Falls is on the clock', clock: '0:47' });
  const bannerUrgent = k.pickBanner({ team: 'Waiver Wolves', status: 'Waiver Wolves is on the clock', sub: 'Round 4 · Pick 47 overall', clock: '0:21', urgent: true });
  const table = k.playerTable({ rows: [P('Zay Flowers', 'BAL', 'WR', '44.1', 19, '189.2'), P('Kyren Williams', 'LAR', 'RB', '46.9', 17, '207.3', { inj: 'Q', queued: true })] });
  const ul = inner => `<ul style="list-style: none; margin: 8px 0 0; padding: 0">${inner}</ul>`;
  const rs = inner => `<div style="padding: 16px 14px; border-bottom: 2px solid {{t.rule}}">${inner}</div>`;
  const rail = k.rail([
    rs(`${k.railHead('q-h', 'My Queue')}${ul(k.queueRow({ n: 1, name: 'Tee Higgins', pos: 'WR', first: true }) + k.queueRow({ n: 2, name: 'Sam LaPorta', pos: 'TE', last: true }))}`),
    rs(`${k.railHead('r-h', 'My Roster')}${ul(k.rosterRow({ slot: 'QB', name: 'Josh Allen' }) + k.rosterRow({ slot: 'RB', name: 'Jahmyr Gibbs' }) + k.rosterRow({ slot: 'FLEX' }))}`),
    rs(`${k.railHead('u-h', 'Upcoming')}${ul(k.upcomingRow({ pick: 46, team: 'Darkness Falls', you: true, clock: true }) + k.upcomingRow({ pick: 47, team: 'Waiver Wolves' }))}`),
    k.assistantSection(),
  ]);
  const chat = `<ul style="${k.FRAME}; list-style: none; margin: 0; padding: 14px 16px; display: flex; flex-direction: column; gap: 12px; box-sizing: border-box">${k.chatMsg({ team: 'Pocket Aces', time: '7:26 PM', text: 'Third running back I wanted gone.' })}${k.chatMsg({ team: 'Darkness Falls', time: '7:27 PM', text: 'Tee Higgins is mine.', you: true })}</ul>`;
  const tableBox = `<div style="display: flex; flex-direction: column; gap: 12px"><div>${k.segToggle({ label: 'Players or Board', items: [{ label: 'Players', on: true }, { label: 'Board' }] })}</div><div style="${k.FRAME}">${table}</div></div>`;
  const draftroom = sec('dr-h', 'Draft room', 'Pieces of the Draft room board. The pick banner carries the status, the clock and nothing else: no round meter. Rail controls are 44px and the dense table keeps 36px buttons. Move arrows are 16px on the 2px grid and sit in their own pair, apart from the 12px remove x. Every chat message has a quiet Hide.',
    `${fig(banner, 'pickBanner: your pick, 0:47')}${fig(bannerUrgent, 'pickBanner: another team, under 30 seconds, the clock turns Danger')}
${fig(tableBox, 'segToggle (Players or Board) and playerTable rows: Draft (36px, ghost) and Queue (icon; the queued row shows a check)')}
${grid(300, fig(rail, 'rail: My Queue (row 1 Draft, move up, move down, remove), My Roster, Upcoming and the framed Draft assistant') + fig(chat, 'chatMsg with Hide message from {team}'))}`);

  // ---- Lineup ----
  const row = (name, extra = {}) => k.lineupRow({ ...STARTERS.find(x => x.name === name), ...extra });
  const deskBox = `<section aria-label="Lineup rows, desktop" style="${k.FRAME}"><ul style="list-style: none; margin: 0; padding: 4px 12px 8px">${[row('Jahmyr Gibbs'), row('Puka Nacua'), row('Trey McBride', { lock: true, game: 'Final 24-21', detail: '', pts: '6.4' }), k.lineupRow({ slot: 'FLEX', empty: true, last: true })].join('')}</ul></section>`;
  const phoneBox = `<section aria-label="Lineup rows, phone move" style="${k.FRAME}; width: 358px; max-width: 100%; box-sizing: border-box"><ul style="list-style: none; margin: 0; padding: 2px 6px 6px">${[row('Puka Nacua', { phone: true, mode: 'moving', still: true }), row("Ja'Marr Chase", { phone: true, mode: 'eligible' }), row('Jahmyr Gibbs', { phone: true, mode: 'dim' }), row('Trey McBride', { phone: true, mode: 'dim', last: true })].join('')}</ul></section>`;
  const lineup = sec('ln-h', 'Lineup', 'Each ledger row is one button (aria-pressed) with the player name and Drop player as separate buttons on top. The cursor row, the one live cursor on this sheet, is the player who needs a move. During a move, eligible rows turn Play-blue and ineligible rows keep full opacity: Dim text, a dashed rule and "not eligible" for screen readers.',
    `${grid(520, fig(`<div style="display: flex; flex-direction: column; gap: 16px"><div>${k.weekPicker({ week: 7 })}</div>${deskBox}</div>`, 'week picker; ledger rows: normal, cursor (Out; the live cursor), locked (lock icon, no Drop), empty')
      + fig(`<div style="display: flex; flex-direction: column; gap: 16px"><div style="width: 358px; max-width: 100%">${k.weekPicker({ week: 7, phone: true })}</div>${phoneBox}</div>`, 'phone: selected (aria-pressed, cursor frame held still on this sheet), eligible, ineligible (the last is also locked)'))}
${grid(520, fig(`<div style="${k.FRAME}; width: 358px; max-width: 100%; box-sizing: border-box">${k.stickyFooter({ name: 'Puka Nacua', sticky: false })}</div>`, 'phone move strip and the footer toggles (sticky on the page): Starters, Bench, Outlook')
      + fig(`<div style="${k.FRAME}; padding: 16px; max-width: 360px; box-sizing: border-box">${k.rangeBar({ floor: 3.2, proj: 10.1, ceil: 19.4, max: 24 })}</div>`, 'Endzone Forecast range bar: a band from Floor to Ceiling, a tick at Proj, three labelled figures'))}`);

  return { stat, draftroom, lineup };
};
