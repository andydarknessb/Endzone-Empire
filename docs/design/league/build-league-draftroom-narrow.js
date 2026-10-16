// Draft room below 1200px (1024 wide, fluid), commissioner view, Round 4. Not the viewer's pick: Dynasty Dads is on the clock.
// Tabs Chat / Players / Board / Draft (Tabs aria-label "Draft view"), Board selected.
const k = require('./league-kit-samples');
const out = process.argv[2];
const LG = 'Thursday Night Regulars';
const { px, FRAME, frameHead, posTag, arrow, youBadge } = k;

// Draft slots left to right. Pick 40 overall (round 4, 4th pick, snake order) is slot 9 and is on the clock.
// Picks 31-39 match the wide board's activity log; Darkness Falls (slot 3) holds Gibbs, Allen and Nacua as in My Roster there.
const ORDER = ['Blitz Brigade', 'Waiver Wolves', 'Darkness Falls', 'Sunday Scaries', 'Gridiron Ghosts', 'Fumble Rooskie', 'Hail Mary Club', 'Pocket Aces', 'Dynasty Dads', 'Red Zone Rejects', 'Bench Mob', 'Practice Squad'];
const PICKS = "Ja'Marr Chase WR|Bijan Robinson RB|Jahmyr Gibbs RB|Saquon Barkley RB|CeeDee Lamb WR|Justin Jefferson WR|Amon-Ra St. Brown WR|Malik Nabers WR|Tyler Warren TE|Ashton Jeanty RB|Derrick Henry RB|Christian McCaffrey RB|De'Von Achane RB|Nico Collins WR|Drake London WR|Trey McBride TE|Lamar Jackson QB|Jalen Hurts QB|Tyreek Hill WR|Jonathan Taylor RB|Chuba Hubbard RB|Josh Allen QB|Patrick Mahomes QB|Jaxon Smith-Njigba WR|A.J. Brown WR|Davante Adams WR|Puka Nacua WR|George Kittle TE|Travis Kelce TE|Breece Hall RB|Terry McLaurin WR|Jerome Ford RB|Evan Engram TE|Calvin Ridley WR|Javonte Williams RB|Mike Evans WR|Garrett Wilson WR|Bucky Irving RB|Colston Loveland TE".split('|').map(s => { const i = s.lastIndexOf(' '); return { name: s.slice(0, i), pos: s.slice(i + 1) }; });
const ROUNDS = 6, CLOCK = 40, ME = 'Darkness Falls';
const pickInRound = (r, slot) => (r % 2 ? slot : 13 - slot); // snake order
const CLOCK_SLOT = pickInRound(4, CLOCK - 36); // round 4, pick 4 -> slot 9 (the pick in round is its own inverse)
const clockTeam = ORDER[CLOCK_SLOT - 1];

const RDW = 40; // 12 columns share the rest, so the on-the-clock cell is on screen at 1024; the box scrolls only below that
const th = (t, o = {}) => `<th scope="col" style="box-sizing: border-box; height: 64px; padding: 6px; text-align: left; vertical-align: middle; ${o.clock ? 'background: {{t.play}}; color: {{t.playInk}}' : 'background: {{t.panel}}; color: {{t.ink}}'}; border-bottom: 2px solid {{t.rule}}; border-left: 2px solid {{t.rule}}; font-size: 13px; font-weight: 600; line-height: 1.3"><span style="display: inline-flex; align-items: center; gap: 4px; flex-wrap: wrap">${o.clock ? arrow() : ''}${t}${o.you ? youBadge() : ''}</span></th>`;
const cell = (r, slot) => {
  const i = pickInRound(r, slot), n = (r - 1) * 12 + i, team = ORDER[slot - 1];
  const base = 'box-sizing: border-box; height: 104px; padding: 6px; vertical-align: top; border-bottom: 2px solid {{t.rule}}; border-left: 2px solid {{t.rule}}';
  const pickNo = `<span style="font-size: 13px; color: ${n === CLOCK ? '{{t.playDim}}' : '{{t.dim}}'}">${r}.${String(i).padStart(2, '0')}</span>`;
  if (n === CLOCK) return `<td aria-label="Round ${r}, ${team}: on the clock" style="${base}; background: {{t.play}}; color: {{t.playInk}}"><div>${pickNo}</div><div style="display: flex; flex-direction: column; gap: 4px; margin-top: 4px; font-size: 13px; font-weight: 600; line-height: 1.3">${arrow()}On the clock</div></td>`;
  if (n > CLOCK) return `<td aria-label="Round ${r} pick ${i}, ${team}: empty" style="${base}">${pickNo}</td>`;
  const p = PICKS[n - 1];
  return `<td aria-label="Round ${r} pick ${i}, ${team}: ${p.name}" style="${base}"><div>${pickNo}</div><div style="font-size: 13px; font-weight: 600; line-height: 1.3; margin: 2px 0 4px; overflow-wrap: anywhere">${p.name}</div>${posTag(p.pos)}</td>`;
};
const rows = Array.from({ length: ROUNDS }, (_, i) => i + 1).map(r => `<tr><th scope="row" style="box-sizing: border-box; width: ${RDW}px; min-width: ${RDW}px; height: 104px; padding: 6px; text-align: left; vertical-align: top; position: sticky; left: 0; z-index: 1; background: {{t.panel}}; border-bottom: 2px solid {{t.rule}}; font-size: 15px; font-weight: 600">${r}</th>${Array.from({ length: 12 }, (_, s) => cell(r, s + 1)).join('')}</tr>`).join('');
const board = `<section aria-labelledby="db-h" style="${FRAME}; min-width: 0">
${frameHead(`<h2 id="db-h" style="margin: 0; ${px(24)}">Draft Board</h2><span style="margin-left: auto; font-size: 13px; color: {{t.dim}}">Rounds 1 to ${ROUNDS} of 15</span>`)}
<div role="region" aria-label="Draft Board grid" tabindex="0" style="overflow-x: auto"><table style="border-collapse: separate; border-spacing: 0; table-layout: fixed; width: 100%; min-width: 936px"><caption style="${k.SR}">Draft Board</caption><thead><tr><th scope="col" style="box-sizing: border-box; width: ${RDW}px; min-width: ${RDW}px; height: 64px; padding: 0 6px; text-align: left; position: sticky; left: 0; z-index: 1; background: {{t.panel}}; border-bottom: 2px solid {{t.rule}}; font-size: 13px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; color: {{t.dim}}">Rd</th>${ORDER.map(t => th(t, { clock: t === clockTeam, you: t === ME })).join('')}</tr></thead><tbody>${rows}</tbody></table></div>
</section>`;

// ---- head ----
const gear = '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" shape-rendering="crispEdges"><path fill-rule="evenodd" d="M7 1h2v2H7zM7 13h2v2H7zM1 7h2v2H1zM13 7h2v2h-2zM4 4h8v8H4zM7 7h2v2H7z" fill="currentColor"/></svg>';
const head = `<section aria-labelledby="h1" style="display: flex; flex-direction: column; gap: 8px; min-width: 0">
${k.breadcrumb([LG], 'Draft room')}
<div style="display: flex; align-items: center; gap: 12px">${k.h1(LG)}<button type="button" aria-label="Draft settings" style="width: 44px; height: 44px; padding: 0; display: grid; place-items: center; flex: none; box-sizing: border-box; border-radius: 0; background: transparent; border: 2px solid {{t.ink}}; color: {{t.ink}}">${gear}</button></div>
<div style="display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px 24px">
<div role="group" aria-label="Draft status" style="display: flex; flex-wrap: wrap; align-items: center; gap: 8px 16px">${k.liveChip('Live')}<span style="font-size: 17px; color: {{t.dim}}">Draft in progress · On the clock: ${clockTeam} · Times in CDT</span></div>
<div role="group" aria-label="Draft controls" style="display: flex; flex-wrap: wrap; gap: 4px 24px">${k.toggle({ id: 'snd', label: 'On-the-clock sound', on: true })}${k.toggle({ id: 'cmt', label: 'Draft assistant commentary', on: false })}</div>
</div>
</section>`;

const commish = `<section aria-label="Commissioner draft controls" style="${FRAME}">
<div style="display: flex; flex-wrap: wrap; align-items: center; gap: 12px; padding: 12px 20px">${k.btnGhost('Pause Draft')}${k.btnGhost('Correct latest Pick')}${k.btnGhost('Reset draft')}${k.btnGhost('Presenter link', { tag: 'a' })}<span style="font-size: 14px; color: {{t.dim}}; margin-left: 4px">Keeper picks cannot be corrected.</span></div>
</section>`;

const banner = k.pickBanner({ team: clockTeam, status: `${clockTeam} is on the clock`, sub: `Round 4 · Pick ${CLOCK} overall`, clock: '0:52' });
const tabs = k.tabs({ label: 'Draft view', id: 'dv', items: [{ label: 'Chat' }, { label: 'Players' }, { label: 'Board', selected: true }, { label: 'Draft' }] });

const notes = k.notes([
  'Below 1200px the three panes become the tablist "Draft view": Chat, Players, Board, Draft (real role=tab buttons with aria-selected, Board selected). This is the commissioner view, so the section "Commissioner draft controls" sits above the on-the-clock banner: Pause Draft, Correct latest Pick, Reset draft, Presenter link and "Keeper picks cannot be corrected." All four are ghost buttons.',
  `Not the viewer's pick: the banner reads "${clockTeam} is on the clock" and the board marks that team's column head and the open cell ("Round 4, ${clockTeam}: on the clock") in Play-blue with an arrow. With no pick of the viewer's to point at, there is no cursor and no filled action on this board; the one cursor returns when Darkness Falls is up (see DraftRoom).`,
  'The Draft Board region scrolls sideways inside its frame (Rd column sticky) so the page never side-scrolls. Cells carry the player, a position tag and the pick number; each cell is labelled "Round {r} pick {n}, {team}: {player}". Picks 31 to 39 match the wide board.',
]);

const body = `<main style="padding: 32px 24px 64px; display: flex; flex-direction: column; gap: 24px">
${head}
${commish}
${banner}
<div style="display: flex; flex-direction: column; gap: 16px; min-width: 0">${tabs}<div role="tabpanel" aria-labelledby="dv-2" style="min-width: 0">${board}</div></div>
${notes}
</main>`;

k.write(out, 'DraftRoomNarrow.dc.html', k.page({ title: 'Draft room, narrow', w: 1024, h: 1800, body }));
console.log('ok');
