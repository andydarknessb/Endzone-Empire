// Draft room + Commissioner console pieces. Extends league-kit (own file so parallel builders never collide on league-kit.js).
const k = require('./league-kit');
const { px, SR, FRAME, frameHead, esc, posTag, kindTag, arrow, picto, avatar, FOCUS } = k;

// Cursor row inside a table: the row's cells carry the 4px Cursor border, blinking like the cards.
const EXTRA_CSS = `.cur-row>*{animation:blink .5s steps(1) 3}@media (prefers-reduced-motion:reduce){.cur-row>*{animation:none}}`;
const page = o => k.page(o).replace('</style>', EXTRA_CSS + '\n</style>');

// ---- small buttons (desktop density: 36px, tables and rails) ----
const SM = 'min-height: 36px; display: inline-flex; align-items: center; justify-content: center; gap: 8px; padding: 0 14px; box-sizing: border-box; border-radius: 0; font-family: inherit; font-size: 15px; font-weight: 600; cursor: pointer';
const smBtn = (label, { fill = false, aria } = {}) => `<button type="button"${aria ? ` aria-label="${esc(aria)}"` : ''} style="${SM}; ${fill ? 'background: {{t.accent}}; border: 2px solid {{t.accent}}; color: {{t.onAccent}}; font-weight: 700' : 'background: transparent; border: 2px solid {{t.ink}}; color: {{t.ink}}'}">${label}</button>`;
const railBtn = (label, { aria } = {}) => smBtn(label, { aria }).replace('min-height: 36px', 'min-height: 44px');
const ICON = {
  plus: 'M5 1h2v4h4v2H7v4H5V7H1V5h4z', check: 'M1 6h2v2H1zM3 8h2v2H3zM5 6h2v2H5zM7 4h2v2H7zM9 2h2v2H9z',
  trash: 'M6 1h4v2H6zM2 3h12v2H2zM3 5h2v8H3zM11 5h2v8h-2zM3 13h10v2H3zM7 7h2v4H7z',
  x: 'M1 1h2v2H1zM3 3h2v2H3zM5 5h2v2H5zM7 7h2v2H7zM9 9h2v2H9zM9 1h2v2H9zM7 3h2v2H7zM3 7h2v2H3zM1 9h2v2H1z',
  smile: 'M3 1h6v2H3zM1 3h2v6H1zM9 3h2v6H9zM3 9h6v2H3zM4 4h1v2H4zM7 4h1v2H7zM4 7h4v1H4z',
};
// Move arrows are 16px on the 2px grid (stem + stepped head) so they never read as the 12px remove x.
const ARROW16 = { up: 'M7 2h2v2H7zM5 4h6v2H5zM3 6h10v2H3zM7 8h2v6H7z', down: 'M7 2h2v6H7zM3 8h10v2H3zM5 10h6v2H5zM7 12h2v2H7z' };
const ic = (d, n = 12) => `<svg width="${n}" height="${n}" viewBox="0 0 ${n} ${n}" aria-hidden="true" shape-rendering="crispEdges"><path d="${d}" fill="currentColor"/></svg>`;
const iconBtn = (kind, aria, { pressed, off = false, size = 36, quiet = false } = {}) => `<button type="button" aria-label="${esc(aria)}"${pressed !== undefined ? ` aria-pressed="${pressed}"` : ''}${off ? ' disabled' : ''} style="width: ${size}px; height: ${size}px; padding: 0; display: grid; place-items: center; flex: none; box-sizing: border-box; border-radius: 0; background: transparent; border: 2px ${off ? 'dashed {{t.rule}}' : quiet ? 'solid transparent' : 'solid {{t.ink}}'}; color: ${off || quiet ? '{{t.dim}}' : '{{t.ink}}'}; cursor: ${off ? 'not-allowed' : 'pointer'}">${ARROW16[kind] ? ic(ARROW16[kind], 16) : kind === 'trash' ? ic(ICON.trash, 16) : ic(ICON[kind])}</button>`;

// ---- Players / Board toggle: a group of two buttons, selected = Play-blue + arrow ----
const segToggle = ({ label, items }) => `<div role="group" aria-label="${esc(label)}" style="--on: {{t.play}}; --onInk: {{t.playInk}}; display: inline-flex">${items.map(t => `<button type="button" aria-pressed="${!!t.on}" class="${t.on ? '' : 'pb'}" style="min-height: 44px; display: inline-flex; align-items: center; gap: 8px; padding: 0 16px; box-sizing: border-box; border-radius: 0; font-family: inherit; font-size: 15px; font-weight: 600; background: ${t.on ? '{{t.play}}' : 'transparent'}; color: ${t.on ? '{{t.playInk}}' : '{{t.ink}}'}; border: 2px solid ${t.on ? '{{t.play}}' : '{{t.ink}}'}; margin-left: -2px">${t.on ? arrow() : ''}${t.label}</button>`).join('')}</div>`;

// ---- on-the-clock banner: Board black, pixel pick clock. Under 30 s pass urgent: the clock turns Danger. ----
function pickBanner({ team, status, sub, clock, urgent = false }) {
  const c = { ink: '{{t.boardInk}}', dim: '{{t.boardDim}}' };
  return `<section aria-label="On the clock" style="display: flex; flex-wrap: wrap; align-items: center; gap: 16px 32px; padding: 16px 24px; box-sizing: border-box; background: {{t.board}}; color: ${c.ink}; border: 6px double {{t.boardDim}}">
<div aria-hidden="true">${picto('draft', 96, c.ink)}</div>
<div style="display: flex; align-items: center; gap: 16px; flex: 1; min-width: 320px">${avatar(team, { size: 48, c: c.ink })}<div style="min-width: 0"><div role="status" aria-live="polite" style="${px(24, c.ink)}; text-wrap: balance">${status}</div><div style="font-size: 15px; color: ${c.dim}; margin-top: 4px">${sub}</div></div></div>
<div role="timer" aria-label="Pick clock ${clock}" style="display: flex; flex-direction: column; align-items: flex-end; gap: 2px"><span style="${px(32, urgent ? '{{t.danger}}' : c.ink)}; line-height: 1.2">${clock}</span><span style="font-size: 13px; color: ${c.dim}">Pick clock</span></div>
</section>`;
}

// ---- available players table ----
const COLS = [['Name', 200, 'left'], ['Position', 88, 'left'], ['Bye', 52, 'right'], ['ADP', 60, 'right'], ['Pos rank', 84, 'right'], ['17-game pace', 128, 'right'], ['Actions', 132, 'right']];
const injBadge = q => `<span style="display: inline-grid; place-items: center; width: 22px; height: 22px; box-sizing: border-box; border: 2px solid {{t.ink}}; font-size: 13px; font-weight: 700; line-height: 1"><span aria-hidden="true">${q}</span><span style="${SR}">Questionable</span></span>`;
// rows: [{ name, team, inj, pos, bye, adp, rank, pace, queued, cursor }]. One row wears the cursor and the page's one filled Draft.
function playerTable({ rows }) {
  const th = ([l, w, a]) => `<th scope="col" style="box-sizing: border-box; width: ${w}px; min-width: ${w}px; height: 40px; padding: 0 10px; text-align: ${a}; background: {{t.panel}}; border-bottom: 2px solid {{t.rule}}; font-size: 13px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; color: {{t.dim}}; white-space: nowrap">${l}</th>`;
  const body = rows.map(r => {
    const cur = !!r.cursor, N = COLS.length;
    const cells = [
      `<div style="display: flex; align-items: center; gap: 8px; font-size: 15px; font-weight: 600">${r.name}${r.inj ? injBadge(r.inj) : ''}</div><div style="font-size: 13px; font-weight: 400; color: {{t.dim}}">${r.team}</div>`,
      posTag(r.pos), r.bye, r.adp, `#${r.rank}`, r.pace,
      `<span style="display: inline-flex; gap: 8px">${smBtn('Draft', { fill: cur, aria: `Draft ${r.name}` })}${iconBtn(r.queued ? 'check' : 'plus', r.queued ? `Remove ${r.name} from queue` : `Queue ${r.name}`, { pressed: !!r.queued })}</span>`,
    ];
    return `<tr${cur ? ' class="cur-row" aria-current="true"' : ''}>${cells.map((c, i) => {
      const bd = cur ? `border-top: 4px solid {{t.cursor}}; border-bottom: 4px solid {{t.cursor}}; ${i === 0 ? 'border-left: 4px solid {{t.cursor}};' : ''} ${i === N - 1 ? 'border-right: 4px solid {{t.cursor}};' : ''}` : 'border-bottom: 2px solid {{t.rule}};';
      const st = `box-sizing: border-box; height: 52px; padding: 0 10px; text-align: ${COLS[i][2]}; background: {{t.panel}}; ${bd} white-space: nowrap; font-size: 15px`;
      return i === 0 ? `<th scope="row" style="${st}; font-weight: 400">${c}</th>` : `<td style="${st}">${c}</td>`;
    }).join('')}</tr>`;
  }).join('');
  return `<div role="region" aria-label="Available Players table" tabindex="0" style="overflow-x: auto"><table style="width: 100%; border-collapse: separate; border-spacing: 0; table-layout: fixed; min-width: 744px"><caption style="${SR}">Available Players</caption><thead><tr>${COLS.map(th).join('')}</tr></thead><tbody>${body}</tbody></table></div>`;
}

const checkbox = ({ id, label, checked = false }) => `<label style="display: inline-flex; align-items: center; gap: 10px; min-height: 44px; font-size: 15px; font-weight: 600; cursor: pointer"><input id="${id}" type="checkbox"${checked ? ' checked' : ''} style="${SR}"><span aria-hidden="true" style="display: grid; place-items: center; width: 24px; height: 24px; box-sizing: border-box; border: 2px solid {{t.ink}}; color: {{t.ink}}">${checked ? '<svg width="12" height="12" viewBox="0 0 12 12"><path d="' + ICON.check + '" fill="currentColor"/></svg>' : ''}</span>${label}</label>`;

// ---- rail ----
const railHead = (id, text, extra = '') => `<div style="display: flex; align-items: center; justify-content: space-between; gap: 8px"><h2 id="${id}" style="margin: 0; ${px(16)}">${text}</h2>${extra}</div>`;
const queueRow = ({ n, name, pos, first, last }) => `<li style="display: flex; flex-direction: column; gap: 8px; padding: 10px 0; ${last ? '' : 'border-bottom: 2px solid {{t.rule}}'}"><div style="font-size: 15px; font-weight: 600">${n}. ${name} <span style="font-weight: 400; color: {{t.dim}}">(${pos})</span></div><div style="display: flex; flex-wrap: wrap; align-items: center; gap: 8px">${first ? railBtn('Draft', { aria: `Draft ${name} from queue` }) : ''}<span style="display: inline-flex; align-items: center"><span style="display: inline-flex">${iconBtn('up', `Move ${name} up`, { off: first, size: 44 })}<span style="margin-left: -2px; display: inline-flex">${iconBtn('down', `Move ${name} down`, { off: last, size: 44 })}</span></span><span aria-hidden="true" style="width: 2px; height: 28px; margin: 0 10px; background: {{t.rule}}; flex: none"></span>${iconBtn('x', `Remove ${name} from queue`, { size: 44 })}</span></div></li>`;
const rosterRow = ({ slot, name }) => `<li style="display: flex; align-items: center; gap: 10px; min-height: 36px; border-bottom: 2px solid {{t.rule}}">${slot === 'FLEX' ? `<span style="display: inline-flex; align-items: center; justify-content: center; box-sizing: border-box; min-width: 40px; height: 24px; padding: 0 6px; border: 2px solid {{t.dim}}; color: {{t.dim}}; font-size: 13px; font-weight: 700; line-height: 1">FLEX</span>` : posTag(slot)}<span style="font-size: 15px; ${name ? 'font-weight: 600' : 'color: {{t.dim}}'}">${name || 'Empty'}</span></li>`;
const upcomingRow = ({ pick, team, you, clock }) => `<li style="display: flex; align-items: center; gap: 8px; min-height: 36px; border-bottom: 2px solid {{t.rule}}; font-size: 15px"><span style="width: 12px; display: inline-flex; flex: none">${clock ? arrow() : ''}</span><b style="font-weight: 600; width: 24px; flex: none">${pick}</b><span style="flex: 1; min-width: 0; ${you ? 'font-weight: 600' : ''}">${team}</span>${you ? `<span style="${SR}">(you)</span>` : ''}</li>`;

// ---- chat ----
const chatMsg = ({ team, time, text, you }) => `<li style="padding-left: 12px; border-left: 4px solid ${you ? '{{t.play}}' : '{{t.rule}}'}"><div style="display: flex; gap: 8px; align-items: center"><b style="font-size: 14px; font-weight: 600">${team}</b><span style="font-size: 13px; color: {{t.dim}}">${time}</span><button type="button" aria-label="Hide message from ${esc(team)}" style="margin: -12px -10px -12px auto; min-height: 44px; padding: 0 10px; box-sizing: border-box; border-radius: 0; background: transparent; border: 2px solid transparent; color: {{t.dim}}; font-family: inherit; font-size: 13px; font-weight: 600; cursor: pointer">Hide</button></div><div style="font-size: 15px">${text}</div></li>`;
const drawLine = ({ tag, text, time }) => `<li style="display: flex; align-items: flex-start; gap: 10px">${kindTag(tag, { w: 56 })}<div style="flex: 1; min-width: 0; font-size: 15px; padding-top: 1px">${text}<span style="font-size: 13px; color: {{t.dim}}"> · ${time}</span></div></li>`;
const composer = () => `<div role="group" aria-label="Chat composer" style="display: flex; gap: 8px; padding: 12px 16px; border-top: 2px solid {{t.rule}}"><label for="dr-msg" style="${SR}">Message</label><input id="dr-msg" type="text" placeholder="Message" style="box-sizing: border-box; height: 44px; border-radius: 0; background: {{t.bg}}; color: {{t.ink}}; border: 2px solid {{t.dim}}; font-family: inherit; font-size: 16px; flex: 1; min-width: 0; padding: 0 12px">${iconBtn('smile', 'Insert emoji', { size: 44 })}<button type="button" style="min-height: 44px; padding: 0 16px; box-sizing: border-box; border-radius: 0; background: transparent; border: 2px solid {{t.ink}}; color: {{t.ink}}; font-size: 15px; font-weight: 600">Send</button></div>`;

const assistantSection = () => `<section aria-labelledby="da-h" style="padding: 16px 14px">${railHead('da-h', 'Draft assistant')}<div style="margin-top: 10px; padding: 12px; border: 2px solid {{t.frame}}; display: flex; flex-direction: column; gap: 4px"><span style="font-size: 13px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: {{t.dim}}">Misery Meter</span><span style="font-size: 15px">Quiet so far. Make a pick.</span></div></section>`;

module.exports = { ...k, assistantSection, railBtn, ARROW16, page, smBtn, iconBtn, segToggle, pickBanner, playerTable, checkbox, railHead, queueRow, rosterRow, upcomingRow, chatMsg, drawLine, composer, FOCUS };
