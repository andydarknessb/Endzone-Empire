// QA round 1 pieces for Lineup, Draft room, Commissioner, Matchup and the Kit sheet. Extends league-kit-draft (own file so parallel builders never collide on league-kit.js).
const k = require('./league-kit-draft');
const { px, SR, FRAME, esc, posTag, arrow, injTag, lockIcon } = k;

// shortcut: kit internals (kindTag, youBadge, avatar, injTag, rangeBar labels) still print 12px; no 12px text is allowed, so the page wrapper lifts them to 13px. Drop this once league-kit.js carries 13px itself.
const page = o => k.page(o).replace(/font-size: 12px/g, 'font-size: 13px');

// ---- status chip: words that carry state (phase, Scheduled, Needs you, Final) are Pixel 16, one border token ----
const chip = text => `<span style="display: inline-flex; align-items: center; box-sizing: border-box; min-height: 32px; padding: 6px 10px; border: 2px solid {{t.ink}}; ${px(16)}; line-height: 1; flex: none">${text}</span>`;

// ---- Matchup status legend: three shapes, never colour alone (filled square, outline square, outline with a centre dot) ----
const MARK = {
  ip: ['In progress', '<span aria-hidden="true" style="width: 12px; height: 12px; flex: none; background: currentColor"></span>'],
  fin: ['Final', '<span aria-hidden="true" style="width: 12px; height: 12px; flex: none; box-sizing: border-box; border: 2px solid currentColor"></span>'],
  yet: ['Yet to play', '<span aria-hidden="true" style="width: 12px; height: 12px; flex: none; box-sizing: border-box; border: 2px solid currentColor; display: grid; place-items: center"><span style="width: 4px; height: 4px; background: currentColor"></span></span>'],
};
const statusLegend = () => `<span style="display: inline-flex; flex-wrap: wrap; gap: 4px 20px; font-size: 13px; color: {{t.dim}}">${['ip', 'fin', 'yet'].map(s => `<span style="display: inline-flex; align-items: center; gap: 8px">${MARK[s][1]}${MARK[s][0]}</span>`).join('')}</span>`;

// ---- Unsaved tab marker: a square, with the words for screen readers ----
const unsavedMarker = () => `<span style="display: inline-flex; width: 10px; height: 10px; background: currentColor; flex: none" aria-hidden="true"></span><span style="${SR}">Unsaved changes</span>`;

// ---- Lineup: week picker ----
const stepBtn = (aria, d) => `<button type="button" aria-label="${aria}" style="width: 44px; height: 44px; padding: 0; display: grid; place-items: center; box-sizing: border-box; border-radius: 0; background: transparent; border: 2px solid {{t.ink}}; color: {{t.ink}}"><svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="${d}" fill="currentColor"/></svg></button>`;
const weekPicker = ({ week = 7, phone = false } = {}) => `<div role="group" aria-label="Week" style="display: ${phone ? 'flex' : 'inline-flex'}; align-items: center; ${phone ? 'justify-content: space-between; ' : ''}gap: 12px">${stepBtn('Previous week', 'M7 1h2v10H7zM5 3h2v6H5zM3 5h2v2H3z')}<span style="${px(16)}; ${phone ? '' : 'min-width: 120px; text-align: center'}">Week ${week}</span>${stepBtn('Next week', 'M3 1h2v10H3zM5 3h2v6H5zM7 5h2v2H7z')}</div>`;

// ---- Lineup ledger row ----
// The row is one <button aria-pressed> laid under the content; the player name and Drop player are their own buttons on top (no nesting).
// mode: 'normal' | 'moving' (selected, wears the cursor) | 'eligible' (Play-blue) | 'dim' (ineligible while a move is open: Dim text and a dashed rule, no opacity).
// still: draw the cursor frame without the live .cursor class (reference sheet only, so a page keeps one cursor).
const HIT = 'position: absolute; inset: 0; width: 100%; height: 100%; padding: 0; margin: 0; border: 0; border-radius: 0; background: transparent';
function lineupRow({ slot, name, inj, sub, game, detail, proj, pts, lock = false, empty = false, cursor = false, still = false, mode = 'normal', phone = false, last = false }) {
  const hi = mode === 'eligible', dim = mode === 'dim', moving = mode === 'moving', cur = cursor || moving;
  const dm = hi ? '{{t.playDim}}' : '{{t.dim}}';
  const off = lock || dim;
  const nm = dim ? '{{t.dim}}' : 'inherit';
  const nowrap = t => `<span style="white-space: nowrap">${t}</span>`;
  const hit = `<button type="button" class="rowhit" aria-pressed="${moving}"${off ? ' aria-disabled="true"' : ''} style="${HIT}; cursor: ${off ? 'not-allowed' : 'pointer'}"><span style="${SR}">${esc(slot)}: ${empty ? 'empty slot' : esc(name)}${dim ? ', not eligible' : ''}${lock ? ', locked' : ''}</span></button>`;
  const lbl = `<span style="flex: none; width: ${phone ? 50 : 52}px; font-size: 13px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: ${nm}">${slot}</span>`;
  const nameBtn = `<button type="button" aria-label="${esc(name)}" style="pointer-events: auto; padding: 10px 0; margin: -10px 0; border: 0; border-radius: 0; background: none; color: ${nm}; font: inherit; font-size: 15px; font-weight: 600; text-align: left; cursor: pointer">${name}</button>`;
  const who = empty
    ? `<span style="font-size: 15px; color: ${dm}">Empty</span>`
    : `<div style="min-width: 0"><div style="display: flex; align-items: center; flex-wrap: wrap; gap: 4px 8px">${nameBtn}${inj ? injTag(inj) : ''}${lock ? `<span style="display: inline-flex; align-items: center">${lockIcon()}<span style="${SR}">Locked: this player's game has kicked off</span></span>` : ''}</div><div style="font-size: 13px; color: ${dm}">${sub}</div>${phone && game ? `<div style="font-size: 13px; color: ${dm}">${nowrap(game)}</div>` : ''}</div>`;
  const fig = empty ? '' : `<div style="text-align: right; flex: none"><div style="font-size: 16px; font-weight: 700; color: ${nm}">${pts != null ? pts : '-'}</div><div style="font-size: 13px; color: ${dm}; white-space: nowrap">${proj} proj</div></div>`;
  const sz = phone ? 44 : 36;
  const drop = empty || lock ? '' : k.iconBtn('trash', `Drop player ${name}`, { size: sz, quiet: true }).replace('style="', 'style="pointer-events: auto; ');
  const inner = phone
    ? `<div style="position: relative; pointer-events: none; display: flex; align-items: center; gap: 8px; min-height: 52px">${lbl}<div style="flex: 1; min-width: 0">${who}</div>${fig}<span style="width: ${sz}px; flex: none; display: inline-flex">${drop}</span></div>`
    : `<div style="position: relative; pointer-events: none; display: grid; grid-template-columns: 52px minmax(0, 1.25fr) minmax(0, 1fr) 84px 36px; align-items: center; gap: 12px; min-height: 52px">${lbl}${who}<div style="min-width: 0">${empty || !game ? '' : `<div style="font-size: 14px; font-weight: 600; white-space: nowrap">${game}</div><div style="font-size: 13px; color: ${dm}">${detail || ''}</div>`}</div>${fig || '<span></span>'}<div style="display: flex; justify-content: flex-end">${drop}</div></div>`;
  const border = cur ? '{{t.cursor}}' : 'transparent';
  const body = `<div class="${cur && !still ? 'cursor ' : ''}slot" style="position: relative; --cur: {{t.cursor}}; padding: 0 ${phone ? 6 : 8}px; border: 4px solid ${border}; box-sizing: border-box; ${hi ? 'background: {{t.play}}; color: {{t.playInk}}; ' : ''}">${hit}${inner}</div>`;
  return `<li style="${last ? '' : `border-bottom: 2px ${dim ? 'dashed' : 'solid'} {{t.rule}}`}">${body}</li>`;
}

// ---- Endzone Forecast suggestion card. Sit and Start share ONE grid, so names, notes, bars and figures line up row for row. ----
const fact = t => `<span style="display: inline-flex; align-items: center; height: 28px; padding: 0 8px; box-sizing: border-box; border: 2px solid {{t.rule}}; font-size: 13px; font-weight: 600">${t}</span>`;
function forecastCard({ slot, title, verdict, odds, gain, sit, start, decide, actions }) {
  const lab = t => `<span style="font-size: 13px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: {{t.dim}}">${t}</span>`;
  const nameCell = c => `<div style="display: flex; align-items: center; flex-wrap: wrap; gap: 4px 8px"><span style="font-size: 15px; font-weight: 600">${c.name}</span>${c.inj ? injTag(c.inj) : ''}</div>`;
  const note = c => `<div style="font-size: 13px; color: {{t.dim}}">${c.note || ''}</div>`;
  const facts = c => `<div style="display: flex; flex-wrap: wrap; align-items: flex-start; gap: 6px">${(c.facts || []).map(fact).join('')}</div>`;
  const rows = [[lab('Sit'), lab('Start')], [nameCell(sit), nameCell(start)], [note(sit), note(start)], [k.rangeBar(sit.range), k.rangeBar(start.range)]];
  if (sit.facts || start.facts) rows.push([facts(sit), facts(start)]);
  return `<div style="border: 2px solid {{t.ink}}; display: flex; flex-direction: column">
<div style="display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; padding: 10px 12px; border-bottom: 2px solid {{t.rule}}"><span style="${px(16)}">${slot}</span><span style="${px(16)}; margin-left: auto">${verdict}</span><span style="width: 100%; font-size: 15px; font-weight: 600">${title}</span><span style="width: 100%; font-size: 13px; color: {{t.dim}}">about ${odds}% · +${gain} pts</span></div>
<div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px 24px; padding: 12px">${rows.flat().join('')}</div>
<div style="display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-top: 2px solid {{t.rule}}; font-size: 14px; font-weight: 600">${k.clock('currentColor')}Decide by ${decide}</div>
<div style="display: flex; flex-wrap: wrap; gap: 8px; padding: 0 12px 12px">${actions}</div>
</div>`;
}

// ---- phone: move strip and the sticky footer toggles ----
const tog = (label, count, on) => `<button type="button" aria-pressed="${on}" style="flex: 1; min-height: 44px; display: inline-flex; align-items: center; justify-content: center; gap: 6px; padding: 0 8px; box-sizing: border-box; border-radius: 0; font-family: inherit; font-size: 14px; font-weight: 600; border: 2px solid ${on ? '{{t.play}}' : '{{t.ink}}'}; background: ${on ? '{{t.play}}' : 'transparent'}; color: ${on ? '{{t.playInk}}' : '{{t.ink}}'}">${on ? arrow() : ''}${label}${count ? ` <span style="font-weight: 400">${count}</span>` : ''}</button>`;
const moveStrip = name => `<div role="status" style="display: flex; align-items: center; justify-content: space-between; gap: 12px"><span style="font-size: 14px; font-weight: 600">Moving ${name}. Pick a highlighted player.</span>${k.btnGhost('Cancel')}</div>`;
const footerToggles = ({ starters = '8/9', bench = '6' } = {}) => `<div role="group" aria-label="Show" style="display: flex; gap: 8px">${tog('Starters', starters, true)}${tog('Bench', bench, true)}${tog('Outlook', '', false)}</div>`;
const stickyFooter = ({ name, sticky = true }) => `<div style="${sticky ? 'position: sticky; bottom: 0; z-index: 5; ' : ''}box-sizing: border-box; background: {{t.panel}}; border-top: 6px double {{t.frame}}; padding: 10px 16px 12px; display: flex; flex-direction: column; gap: 10px">${moveStrip(name)}${footerToggles()}</div>`;

// ---- Draft room: a rail frame for the Kit sheet and the narrow board ----
const rail = sections => `<section aria-label="Draft rail" style="${FRAME}; min-width: 0">${sections.join('')}</section>`;

module.exports = { ...k, page, chip, MARK, statusLegend, unsavedMarker, weekPicker, lineupRow, fact, forecastCard, tog, moveStrip, footerToggles, stickyFooter, rail };
