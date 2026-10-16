// Wave 2 Pick'em pieces (page, board, GameCard, SaveBar, week picker, sections control, CommissionerPanel) and the one Week 7 slate.
// Own file so parallel builders never collide. Product truth: src/pages/pickem, widgets/pickem-board, features/pick-winner, set-confidence, pick-week, widgets/pickem-settings.
const k = require('./league-kit-samples');
const { px, SR, esc, FRAME2, h2s, frameHead, lockIcon, arrow, warn, liveChip, radioCards } = k;

// ---- names (features/pick-winner/lib/teamNames.js) ----
const NAMES = {
  ARI: 'Arizona Cardinals', ATL: 'Atlanta Falcons', BAL: 'Baltimore Ravens', BUF: 'Buffalo Bills', CAR: 'Carolina Panthers', CHI: 'Chicago Bears', CIN: 'Cincinnati Bengals', CLE: 'Cleveland Browns',
  DAL: 'Dallas Cowboys', DEN: 'Denver Broncos', DET: 'Detroit Lions', GB: 'Green Bay Packers', HOU: 'Houston Texans', IND: 'Indianapolis Colts', JAX: 'Jacksonville Jaguars', KC: 'Kansas City Chiefs',
  LV: 'Las Vegas Raiders', LAC: 'Los Angeles Chargers', LAR: 'Los Angeles Rams', MIA: 'Miami Dolphins', MIN: 'Minnesota Vikings', NE: 'New England Patriots', NO: 'New Orleans Saints', NYG: 'New York Giants',
  NYJ: 'New York Jets', PHI: 'Philadelphia Eagles', PIT: 'Pittsburgh Steelers', SF: 'San Francisco 49ers', SEA: 'Seattle Seahawks', TB: 'Tampa Bay Buccaneers', TEN: 'Tennessee Titans', WAS: 'Washington Commanders',
};

// ---- the Week 7 slate: week7-games.js is the one games table; this maps it to the card's fields (state at 2:40 PM CDT) ----
const W7 = require('./week7-games');
const { WINDOWS } = W7;
const GAMES = W7.GAMES.map(g => {
  const st = W7.stateAt(g, 240), pk = g.pickem, [q, t] = st.status === 'live' ? st.clock.split(' ') : [];
  return {
    key: g.key, win: g.window, away: g.away, home: g.home, ko: g.kickoff, bc: g.broadcast, fav: g.line.fav, sp: g.line.spread, ou: g.line.total,
    venue: g.venue.name + ' · ' + g.venue.city, wx: g.venue.indoor ? 'Indoor' : g.weather,
    rec: [g.records.away + ' · ' + g.records.awayRoad, g.records.home + ' · ' + g.records.homeHome], n: pk.n, ph: st.status === 'scheduled' ? 'open' : st.status,
    fin: st.status === 'final' ? { as: st.awayScore, hs: st.homeScore, head: pk.headline } : undefined,
    live: st.status === 'live' ? { q, t, as: st.awayScore, hs: st.homeScore, dd: st.downDistance, poss: st.possession, hwp: pk.hwp, rev: pk.rev, np: pk.np } : undefined,
  };
});

// The viewer's picks at 2:40 PM: 9 of 14 (TNR). NYJ@CIN, IND@TEN and CAR@ATL are locked with no pick; ARI@SF and DAL@DEN are open and unpicked (5 unpicked, 9 made).
const MY_PICKS = { 'PIT|CLE': 'PIT', 'JAX|LAR': 'JAX', 'MIA|BUF': 'BUF', 'TB|DET': 'DET', 'SEA|HOU': 'SEA', 'PHI|MIN': 'PHI', 'KC|LV': 'KC', 'GB|CHI': 'GB', 'WAS|NYG': 'NYG' };

// Disabled action: a solid Rule edge and Dim text.
const btnDis = label => `<button type="button" disabled style="min-height: 44px; display: inline-flex; align-items: center; padding: 0 16px; box-sizing: border-box; border-radius: 0; font-family: inherit; font-size: 15px; font-weight: 600; background: transparent; border: 2px solid {{t.rule}}; color: {{t.dim}}; cursor: not-allowed">${label}</button>`;
// Page CSS: radio cards draw a round indicator (the team button's check is square). o.padTop: height of the sticky rank strip + 16px, so a focused card scrolls fully below it (WCAG 2.4.11).
const PK_CSS = '.rc-dot,.sw:checked+.rc-card .rc-dot::after{border-radius:50%}button:disabled:hover,select:disabled:hover{filter:none}';
const page = o => k.page(o).replace('</style>', PK_CSS + `#pk-cursor{scroll-margin-top:${o.cm || 80}px}` + (o.padTop ? `html{scroll-padding-top:${o.padTop}px}` : '') + '</style>');
// ---- small pieces ----
const check16 = (c = 'currentColor') => `<svg width="16" height="16" viewBox="0 0 12 12" aria-hidden="true" shape-rendering="crispEdges" style="flex: none"><path d="M1 6h2v2H1zM3 8h2v2H3zM5 6h2v2H5zM7 4h2v2H7zM9 2h2v2H9z" fill="${c}"/></svg>`;
const caretSvg = '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M1 2h10v2H9v2H7v2H5V6H3V4H1z" fill="currentColor"/></svg>';
const box = (t, extra = '') => `<span style="display: inline-flex; align-items: center; box-sizing: border-box; height: 28px; padding: 0 8px; border: 2px solid {{t.rule}}; font-size: 13px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; line-height: 1; white-space: nowrap; flex: none; ${extra}">${t}</span>`;
const favTag = '<span style="display: inline-flex; align-items: center; box-sizing: border-box; height: 22px; padding: 0 6px; border: 2px solid currentColor; font-size: 13px; font-weight: 700; letter-spacing: .04em; line-height: 1; flex: none">FAV</span>';
const oddsBadge = (fav, sp, ou) => box(`${fav} -${sp.toFixed(1)} · O/U ${ou}`, 'text-transform: none; letter-spacing: 0; font-weight: 600; font-size: 14px; font-variant-numeric: tabular-nums');
const outcomeChip = t => `<span style="display: inline-flex; align-items: center; box-sizing: border-box; height: 32px; padding: 0 10px; border: 2px solid {{t.ink}}; font-size: 14px; font-weight: 700; line-height: 1; white-space: nowrap; flex: none">${t}</span>`;
// Small pixel star (Perfect window).
const star16 = () => '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" shape-rendering="crispEdges" style="flex: none"><path d="M7 1h2v4h2v2h4v2h-3v2h1v4h-2v-2H9v-1H7v1H5v2H3v-4h1V9H1V7h4V5h2z" fill="currentColor"/></svg>';
const lockedTag = () => `<span style="display: inline-flex; align-items: center; gap: 8px; box-sizing: border-box; min-height: 32px; padding: 6px 10px; border: 2px solid {{t.rule}}; ${px(16)}; line-height: 1; flex: none">${lockIcon()}Locked</span>`;

// A rank held by a game that has kicked off (at the board clock, 2:40 PM) cannot be swapped: label is 'AWAY @ HOME'.
const isLockedGame = label => { const [a, h] = label.split(' @ '), g = GAMES.find(x => x.away === a && x.home === h); return !!g && g.ph !== 'open'; };
// Sunday Pick'em (10 managers): how many have picked each game, in slate order (sums to 95).
const SUNDAY_PICKED = [7, 6, 8, 5, 7, 6, 8, 7, 6, 7, 8, 5, 7, 8];

// Confidence N / Confidence --: a 44px select, disabled until a team is picked or once the game is locked (set-confidence/ConfidenceMenu).
// used: { rank: 'AWAY @ HOME' } for ranks held by another game; they stay choosable (choosing one swaps the two games' ranks), except ranks held by a kicked-off game: disabled, "Confidence n · locked, AWAY @ HOME".
function confSelect({ value = null, max = 14, disabled = false, aria, describedBy, used = {} }) {
  const bd = disabled ? '{{t.rule}}' : '{{t.dim}}';
  const sel = `<div style="position: relative; width: 208px; flex: none"><select aria-label="${esc(aria)}"${describedBy ? ` aria-describedby="${describedBy}"` : ''}${disabled ? ' disabled' : ''} style="box-sizing: border-box; height: 44px; width: 100%; appearance: none; opacity: 1; border-radius: 0; background: {{t.bg}}; color: ${disabled ? '{{t.dim}}' : '{{t.ink}}'}; border: 2px solid ${bd}; font-family: inherit; font-size: 15px; font-weight: 600; padding: 0 56px 0 12px"><option value=""${value == null ? ' selected' : ''}>Confidence: none</option>${Array.from({ length: max }, (_, i) => `<option value="${i + 1}"${value === i + 1 ? ' selected' : ''}${used[i + 1] && value !== i + 1 && isLockedGame(used[i + 1]) ? ' disabled aria-disabled="true"' : ''}>Confidence ${i + 1}${used[i + 1] && value !== i + 1 ? (isLockedGame(used[i + 1]) ? ` · locked, ${used[i + 1]}` : ` · used by ${used[i + 1]}`) : ''}</option>`).join('')}</select><span aria-hidden="true" style="position: absolute; right: 0; top: 0; width: 44px; height: 44px; display: grid; place-items: center; pointer-events: none; border-left: 2px solid ${bd}; box-sizing: border-box; color: ${disabled ? '{{t.dim}}' : '{{t.ink}}'}">${caretSvg}</span></div>`;
  return sel;
}

// ---- TeamPickButton: abbreviation, FAV, full name, record, a trailing score once one exists, and the pick mark ----
// state: the card's save state while a pick is in flight: 'saved' (picked, filled, check) or 'saving' | 'failed' (the attempted pick, outlined: no fill, no check, until it saves).
function teamBtn({ team, opp, ko, lk, rec, fav, picked, won, lost, locked, score, poss, phone, state }) {
  const attempt = (state === 'failed' || state === 'saving') && picked;
  if (attempt) picked = false;
  const dim = picked ? '{{t.playDim}}' : '{{t.dim}}';
  const bd = won ? '{{t.ink}}' : picked || attempt ? '{{t.play}}' : locked ? '{{t.rule}}' : '{{t.dim}}';
  const aria = [`${team}, ${NAMES[team]} over ${NAMES[opp]}`, ko, lk ? lk.toLowerCase() : null, score != null ? `${score} points` : null, poss ? 'has the ball' : null, won ? 'winner' : null, picked && state === 'saved' ? 'saved' : attempt ? (state === 'saving' ? 'saving' : 'not saved, retry') : null].filter(Boolean).join(', ');
  const abbr = `<span style="display: inline-flex; align-items: center; gap: 8px; ${px(16)}; line-height: 1.2">${team}${fav ? favTag.replace('flex: none', 'flex: none; font-family: Archivo, sans-serif') : ''}${poss ? '<span aria-hidden="true" style="width: 8px; height: 8px; background: currentColor; flex: none"></span>' : ''}</span>`;
  const sc = score == null ? '' : `<span style="${px(24)}; line-height: 1.2; color: ${lost ? (picked ? '{{t.playDim}}' : '{{t.dim}}') : picked ? '{{t.playInk}}' : '{{t.ink}}'}; font-variant-numeric: tabular-nums">${score}</span>`;
  const mark = attempt ? `<span style="display: inline-flex; align-items: center; gap: 8px; font-size: 15px; font-weight: 700"><span aria-hidden="true" style="width: 16px; height: 16px; box-sizing: border-box; border: 2px solid {{t.play}}; flex: none"></span>Pick</span>` : picked ? `<span style="display: inline-flex; align-items: center; gap: 8px; font-size: 15px; font-weight: 700">${check16()}Pick</span>` : locked ? '' : '<span aria-hidden="true" style="width: 16px; height: 16px; box-sizing: border-box; border: 2px solid {{t.dim}}; flex: none"></span>';
  const base = `box-sizing: border-box; width: 100%; min-width: 0; border-radius: 0; text-align: left; font-family: inherit; font-size: 16px; line-height: 1.3; background: ${picked ? '{{t.play}}' : '{{t.panel}}'}; color: ${picked ? '{{t.playInk}}' : '{{t.ink}}'}; border: 2px solid ${bd}; cursor: ${locked ? 'default' : 'pointer'}${attempt ? '; box-shadow: inset 0 0 0 2px {{t.play}}' : ''}`;
  const nm = `<span style="font-size: 14px; font-weight: 600; overflow-wrap: anywhere">${NAMES[team]}</span><span style="font-size: 13px; color: ${dim}; font-variant-numeric: tabular-nums">${rec}</span>`;
  if (phone) {
    return `<button type="button" aria-label="${esc(aria)}" aria-pressed="${!!picked}"${locked ? ' disabled' : ''} style="${base}; display: flex; flex-direction: column; align-items: stretch; gap: 4px; padding: 10px 12px; min-height: 112px">${abbr}${nm}<span style="margin-top: auto; min-height: 32px; display: flex; align-items: center; justify-content: space-between; gap: 8px; padding-top: 4px"><span style="display: inline-flex; align-items: center">${mark}</span>${sc}</span></button>`;
  }
  return `<button type="button" aria-label="${esc(aria)}" aria-pressed="${!!picked}"${locked ? ' disabled' : ''} style="${base}; display: flex; align-items: center; gap: 16px; padding: 10px 14px; min-height: 76px"><span style="flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px">${abbr}${nm}</span>${sc}<span style="min-width: 76px; flex: none; display: inline-flex; justify-content: flex-end; text-align: right">${mark}</span></button>`;
}

// "Sun 3:25 PM" minus the board clock -> "Locks in 45 min" (only under an hour, same day).
const CLOCK = 'Sun 2:40 PM';
const mins = s => { const [d, t, ap] = s.split(' '), [h, m] = t.split(':').map(Number); return d + ':' + (((h % 12) + (ap === 'PM' ? 12 : 0)) * 60 + m); };
const locksIn = (ko, now = CLOCK) => { const [d1, a] = mins(ko).split(':'), [d2, b] = mins(now).split(':'); const dm = d1 === d2 ? a - b : NaN; return dm > 0 && dm < 60 ? 'Locks in ' + dm + ' min' : null; };

// Live win probability (ESPN's figure): one full-width row, away share from the left, home share from the right, leader in Accent filled, trailer in outlined Dim.
function probRow(g, hp) {
  const homeLeads = hp >= 50, hc = Math.round(hp / 5), ac = 20 - hc;
  const cells = Array.from({ length: 20 }, (_, i) => ((i < ac) !== homeLeads) ? '<span style="height: 12px; box-sizing: border-box; background: {{t.accent}}"></span>' : '<span style="height: 12px; box-sizing: border-box; border: 2px solid {{t.dim}}"></span>').join('');
  const end = (team, pct, lead) => `<span style="${lead ? 'font-weight: 700; color: {{t.ink}}' : ''}">${team} ${pct}%</span>`;
  return `<div role="img" aria-label="${NAMES[g.away]} ${100 - hp}%, ${NAMES[g.home]} ${hp}% win probability" style="display: flex; flex-direction: column; gap: 6px; font-size: 14px; color: {{t.dim}}"><span>Win probability</span><div style="display: grid; grid-template-columns: repeat(20, minmax(0, 1fr)); gap: 2px">${cells}</div><div style="display: flex; justify-content: space-between; gap: 8px">${end(g.away, 100 - hp, !homeLeads)}${end(g.home, hp, homeLeads)}</div></div>`;
}

// The card's save-state line (Critique 10, 11): the polite live region is the words alone; Undo and Retry sit beside it, outside it. Always in the DOM on an open card, empty at rest.
// save: 'saving' | 'saved' | 'failed' | 'refused' (a 409: msg says why, no Retry); swap: 'DAL @ DEN' (confidence: choosing a used rank swaps the two games' ranks).
function saveLine(g, save, swap, msg) {
  const row = 'display: flex; flex-wrap: wrap; align-items: center; gap: 0 12px; min-height: 44px; padding: 4px 0; box-sizing: border-box; font-size: 15px';
  const live = (inner, extra = '') => `<span role="status" aria-live="polite" style="display: inline-flex; flex-wrap: wrap; align-items: center; gap: 0 12px${extra}">${inner}</span>`;
  const away = `${g.away} at ${g.home}`, dot = '<span aria-hidden="true" style="color: {{t.dim}}">\u00b7</span>';
  if (!save) return `<div style="${SR}">${live('')}</div>`;
  if (save === 'saving') return `<div style="${row}">${live('Saving\u2026', '; color: {{t.dim}}')}</div>`;
  if (save === 'saved') return `<div style="${row}">${live(`${check16()}<span style="font-weight: 600">${swap ? `Swapped with ${swap}` : 'Pick saved'}</span>${swap ? '<span style="color: {{t.dim}}">Both ranks saved</span>' : ''}`)}${dot}${k.btnGhost('Undo', { aria: `Undo ${swap ? 'swap' : 'pick'}, ${away}` })}</div>`;
  return `<div style="${row}">${live(`${warn('{{t.danger}}')}<span>${msg || "Couldn't save this pick."}</span>`, '; color: {{t.danger}}; font-weight: 600')}${save === 'failed' ? k.btnGhost('Retry', { aria: `Retry saving pick, ${away}` }) : ''}</div>`;
}

// ---- GameCard: open (no pick / picked), live, final, flagged. cursor: the one 4px frame on the page (Danger under one hour). ----
function gameCard(g, { mode = 'straight', total = 12, phone = false, cursor = false, urgent = true, cursorId, my, flaggedMsg, phase, conf, n, save, swap, saveMsg, hintId, usedRanks } = {}) {
  const ph = phase || g.ph, pick = my === undefined ? MY_PICKS[g.key] : my, locked = ph !== 'open';
  const isFinal = ph === 'final', isLive = ph === 'live', f = g.fin, l = g.live;
  const hs = isFinal ? f.hs : isLive ? l.hs : null, as = isFinal ? f.as : isLive ? l.as : null;
  const winner = isFinal ? (f.hs > f.as ? g.home : g.away) : null;
  const side = (team, rec, home) => teamBtn({ team, opp: home ? g.away : g.home, ko: g.ko, lk: urgent && !locked ? locksIn(g.ko) : null, rec, fav: g.fav === team, picked: pick === team, won: isFinal && winner === team, lost: isFinal && winner !== team, locked, score: home ? hs : as, poss: isLive && l.poss === team, phone, state: pick === team ? save : undefined });
  const lk = urgent && !locked ? locksIn(g.ko) : null;
  const outcome = !isFinal ? null : !pick ? 'No pick' : pick === winner ? (conf != null ? `Correct · +${conf}` : 'Correct') : `Missed · picked ${pick}`;
  const lead = isFinal ? k.chip('Final')
    : isLive ? `${liveChip(`${l.q} · ${l.t}`)}${lockedTag()}`
      : ph === 'locked' ? `${lockedTag()}<span style="${px(16)}; line-height: 1.2">${g.ko}</span><span style="font-size: 14px; color: {{t.dim}}">· ${g.bc}</span>`
      : `<span style="${px(16)}; line-height: 1.2">${g.ko}</span><span style="font-size: 14px; color: {{t.dim}}">· ${g.bc}</span>${lk ? `<span style="font-size: 14px; font-weight: 700; color: {{t.danger}}">${lk}</span>` : ''}`;
  const right = isFinal ? outcomeChip(outcome)
    : `${!isLive && g.fav ? oddsBadge(g.fav, g.sp, g.ou) : ''}${mode === 'confidence' ? confSelect({ value: conf ?? null, max: 14, disabled: locked || !pick, aria: `Confidence for ${g.away} at ${g.home}`, used: usedRanks, describedBy: !locked && !pick ? hintId : undefined }) : ''}`;
  const head = `<div style="display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px"><span style="display: inline-flex; flex-wrap: wrap; align-items: center; gap: 6px 12px">${lead}</span>${right ? `<span style="margin-left: auto; display: inline-flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 8px 12px">${right}</span>` : ''}</div>`;
  const teams = `<div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: ${phone ? 8 : 12}px">${side(g.away, g.rec[0], false)}${side(g.home, g.rec[1], true)}</div>`;
  const sub = 'font-size: 14px; color: {{t.dim}}';
  let foot;
  if (flaggedMsg) {
    foot = `<span role="status" aria-live="polite" style="display: flex; align-items: center; gap: 10px; min-height: 44px; padding: 4px 0; box-sizing: border-box; color: {{t.danger}}; font-size: 15px; font-weight: 600">${warn('{{t.danger}}')}${flaggedMsg}</span>`;
  } else if (isFinal) {
    foot = `<p style="margin: 0; padding-top: 10px; border-top: 2px solid {{t.rule}}; ${sub}; text-wrap: pretty">${f.head}</p>`;
  } else if (isLive) {
    const hp = Math.round(l.hwp * 100);
    foot = `<div style="display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 12px; ${sub}"><b style="font-weight: 600; color: {{t.ink}}">${l.dd.replace(/&/g, '&amp;')}</b><span>${l.poss} ball</span></div>
${probRow(g, hp)}
<div style="display: flex; flex-wrap: wrap; justify-content: space-between; gap: 4px 12px; ${sub}"><span>League picks · <b style="font-weight: 700; color: {{t.ink}}">${l.rev.map(([t, c]) => `${t} ${c}`).join(', ')}</b></span>${l.np > 0 ? `<span>${l.np} no pick</span>` : ''}</div>`;
  } else {
    const cnt = n ?? g.n;
    foot = `<div style="display: flex; flex-wrap: wrap; justify-content: space-between; gap: 4px 16px; ${sub}"><span><b style="font-weight: 700; color: {{t.ink}}">${cnt}</b> of ${total} managers have picked</span></div>`;
  }
  const meta = ph === 'open' ? `<div style="display: flex; flex-wrap: wrap; gap: 2px 16px; ${sub}"><span>${g.venue}</span><span>${g.wx}</span></div>` : '';
  const inner = `<article aria-label="${g.away} at ${g.home}${lk ? ', ' + lk : ''}" style="display: flex; flex-direction: column; gap: 10px">${cursor ? `<span style="${SR}">Next pick</span>` : ''}${head}${teams}${locked ? '' : saveLine(g, save, swap, saveMsg)}${meta}${foot}</article>`;
  // A failed, refused or kicked-off save is a 2px Danger edge (and the alert pictogram in its line), never the 4px cursor frame.
  if (flaggedMsg || save === 'failed' || save === 'refused') return `<div style="padding: 10px; border: 2px solid {{t.danger}}; box-sizing: border-box">${inner}</div>`;
  if (cursor) {
    const c = urgent ? '{{t.danger}}' : '{{t.cursor}}';
    return `<div${cursorId ? ` id="${cursorId}" tabindex="-1"` : ''} class="cursor slot" style="--cur: ${c}; padding: 8px; border: 4px solid ${c}; box-sizing: border-box">${inner}</div>`;
  }
  return `<div style="padding: 8px; border: 4px solid transparent; box-sizing: border-box">${inner}</div>`;
}

// Loading card (GameCardSkeleton): header chip, two team rows, one bar.
const skelCard = () => `<div style="padding: 8px; border: 4px solid transparent"><div data-testid="game-card-skeleton" style="display: flex; flex-direction: column; gap: 10px"><div style="display: flex; justify-content: space-between">${k.skel('120px', 20)}${k.skel('150px', 28)}</div><div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px">${[0, 1].map(() => `<div style="box-sizing: border-box; min-height: 76px; border: 2px solid {{t.rule}}; padding: 14px; display: flex; flex-direction: column; gap: 10px">${k.skel('64px', 16)}${k.skel('60%', 14)}</div>`).join('')}</div>${k.skel('100%', 12)}</div></div>`;

// ---- a kickoff window: one tertiary frame, cards as rows with 2px Rule dividers ----
// summary: a settled window (every game locked) is one row plus a ghost Show games / Hide games control; expanded keeps the row and draws the cards under it.
// notes: [{ t, id }] at the head's right end (the reveal line once per head; the confidence hint, which aria-describedby points at).
function windowFrame({ id, title, notes = [], cards = [], summary, expanded = false, phone = false }) {
  const list = cards.length ? `<ul id="${id}-list" style="list-style: none; margin: 0; padding: 0">${cards.map((c, i) => `<li style="${i < cards.length - 1 ? 'border-bottom: 2px solid {{t.rule}}' : ''}">${c}</li>`).join('')}</ul>` : '';
  const h3 = `<h3 id="${id}" style="margin: 0; ${px(16)}">${title}</h3>`;
  if (summary) {
    // A settled window is one line: name, summary, ghost control (phone: the name, then the summary and control on a line under it). Expanded keeps the line and draws the cards under it.
    const btn = k.btnGhost(expanded ? 'Hide games' : 'Show games', { aria: `${expanded ? 'Hide' : 'Show'} games, ${title}` }).replace('<button type="button"', `<button type="button" aria-expanded="${expanded}"${expanded ? ` aria-controls="${id}-list"` : ''}`);
    const line = `<div style="display: flex; flex-wrap: wrap; align-items: center; gap: 4px 16px; padding: ${phone ? '8px 14px' : '8px 20px'}; box-sizing: border-box${expanded ? '; border-bottom: 2px solid {{t.rule}}' : ''}"><span style="${phone ? 'flex: 1 1 100%' : 'flex: none; width: 224px'}">${h3}</span><span style="flex: 1 1 0; min-width: 0; font-size: ${phone ? 15 : 16}px; font-weight: 600; font-variant-numeric: tabular-nums; text-wrap: balance">${summary}</span><span style="margin-left: auto; flex: none">${btn}</span></div>`;
    return `<section aria-labelledby="${id}" style="${FRAME2}; min-width: 0">${line}${list}</section>`;
  }
  return `<section aria-labelledby="${id}" style="${FRAME2}; min-width: 0">${frameHead(`${h3}${notes.length ? `<span style="margin-left: auto; display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 2px 16px; font-size: 13px; color: {{t.dim}}">${notes.map(n => `<span${n.id ? ` id="${n.id}"` : ''}>${n.t}</span>`).join('')}</span>` : ''}`, { phone })}${list}</section>`;
}

// What a window says about itself when it is settled, from the board's picks and outcomes.
function windowSummary(gs, phaseOf, pickOf) {
  const picked = gs.filter(pickOf).length, none = gs.length - picked;
  if (gs.every(g => phaseOf(g) === 'final')) {
    const correct = gs.filter(g => pickOf(g) && pickOf(g) === (g.fin.hs > g.fin.as ? g.home : g.away)).length;
    // Perfect: two or more games, every one picked and right. A one-game window never earns it (1 of 1 is not an ending worth a star).
    const perfect = gs.length >= 2 && !none && correct === gs.length;
    return `Final · ${correct} of ${picked} correct${none ? ` · ${none} no pick` : ''}${perfect ? `<span style="display: inline-flex; align-items: center; gap: 6px; margin-left: 12px; font-weight: 700">${star16()}Perfect</span>` : ''}`;
  }
  return `${gs.filter(g => phaseOf(g) === 'live').length} live · ${picked} picked · ${none} no pick`;
}

// Picks status the SaveBar states: how many are made, how many open games still lack one, when the next game locks.
function pickStatus(picks, phaseOf = g => g.ph) {
  const open = GAMES.filter(g => phaseOf(g) === 'open'), picked = GAMES.filter(g => picks[g.key]).length;
  return { picked, total: GAMES.length, open: open.filter(g => !picks[g.key]).length, next: open.length ? open[0].ko : null };
}

// ---- Picks status (Critique 10): saved on tap, so there is no SaveBar. The Picks h2 row carries the one status: "{n} of {total} picked · {o} open · next lock {day time}", or "{total} of {total} picked · all saved" when complete. ----
// Rank pool (confidence mode): one cell per rank, used ranks filled and numbered, free ranks outlined (numbered in Dim); one image, cells hidden.
// locked: ranks held by a kicked-off game (cannot be swapped): the filled cell adds a small lock above its number.
const lock8 = '<svg width="8" height="8" viewBox="0 0 8 8" aria-hidden="true" shape-rendering="crispEdges" style="flex: none"><path d="M2 0h4v1H2zM1 1h1v2H1zM6 1h1v2H6zM0 3h8v5H0zM3 4v2h2V4z" fill="currentColor" fill-rule="evenodd"/></svg>';
const rankPool = (used, total, locked = []) => `<span role="img" aria-label="Ranks used: ${used.length ? used.join(', ') : 'none'}${locked.length ? `; locked to kicked-off games: ${locked.join(', ')}` : ''}" style="display: inline-grid; grid-template-columns: repeat(${total}, 24px); gap: 2px">${Array.from({ length: total }, (_, i) => { const r = i + 1, on = used.includes(r), lk = on && locked.includes(r); return `<span aria-hidden="true" style="height: 24px; box-sizing: border-box; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 1px; font-size: ${lk ? 12 : 13}px; font-weight: 700; line-height: 1; ${on ? 'background: {{t.frame}}; color: {{t.bg}}' : 'border: 2px solid {{t.dim}}; color: {{t.dim}}'}">${lk ? lock8 : ''}${r}</span>`; }).join('')}</span>`;
// Sticky rank strip at the top of the Picks section (confidence mode): "{r} ranks left" and the cells. The words are plain text: the card's save line is the one announcement per tap.
const rankStrip = ({ used = [], total = 14, locked = [] } = {}) => { const r = total - used.length; return `<div data-testid="rank-strip" style="position: sticky; top: 0; z-index: 5; background: {{t.bg}}; border-bottom: 2px solid {{t.rule}}; padding: 8px 0; display: flex; flex-wrap: wrap; align-items: center; gap: 8px 20px"><span style="font-size: 16px; font-variant-numeric: tabular-nums"><b style="font-weight: 600">${r} ${r === 1 ? 'rank' : 'ranks'} left</b></span>${rankPool(used, total, locked)}</div>`; };
// The status words. The link is the in-page jump to the cursor card (24px target on desktop, 44px on phone, by negative margins so the line does not grow).
function statusWords({ picked, total = 14, open, next, cursorId, phone = false }) {
  if (picked === total) return `<b style="font-weight: 600">${picked} of ${total} picked</b> · <span style="white-space: nowrap">all saved ${check16()}</span>`;
  const hit = phone ? '; display: inline-flex; align-items: center; min-height: 44px; padding: 0 6px; margin: -12px -6px; vertical-align: middle' : '; display: inline-flex; align-items: center; min-height: 24px; margin: -2px 0; vertical-align: middle';
  const tail = [open ? `${open} open` : null, next && open ? (cursorId ? `<a href="#${cursorId}" style="color: {{t.ink}}; text-decoration: underline; text-decoration-thickness: 2px; text-underline-offset: 5px; text-decoration-color: {{t.dim}}${hit}">next lock ${next}</a>` : `next lock ${next}`) : null].filter(Boolean);
  return `<b style="font-weight: 600">${picked} of ${total} picked</b>${tail.map(t => ' · <span style="white-space: nowrap">' + t + '</span>').join('')}`;
}
// Picks h2 row: "Picks" then the words, plain text (not a live region: the card's save line is the one announcement per tap).
const picksHead = o => `<div style="display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 16px">${h2s('pk-h', 'Picks')}<span style="font-size: ${o.phone ? 15 : 16}px; font-variant-numeric: tabular-nums">${statusWords(o)}</span></div>`;

// ---- pick-week: previous, "Wk 1" to "Wk 18" as a radio group, next. No "All weeks" (PickemBoard passes "All" to setWeek and breaks; spec #2334 fixes it). ----
const stepBtn = (aria, d, off) => `<button type="button" tabindex="-1" aria-label="${aria}"${off ? ' disabled' : ''} style="width: 44px; height: 44px; padding: 0; flex: none; display: grid; place-items: center; box-sizing: border-box; border-radius: 0; background: transparent; border: 2px solid ${off ? '{{t.rule}}' : '{{t.ink}}'}; color: ${off ? '{{t.dim}}' : '{{t.ink}}'}"><svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="${d}" fill="currentColor"/></svg></button>`;
function weekStrip({ week = 7, weeks = 18 } = {}) {
  const segs = Array.from({ length: weeks }, (_, i) => i + 1).map((w, i) => { const on = w === week; return `<button type="button" role="radio" aria-checked="${on}" tabindex="${on ? 0 : -1}" style="min-height: 44px; flex: none; min-width: 56px; display: inline-flex; align-items: center; justify-content: center; gap: 8px; padding: 0 8px; box-sizing: border-box; border-radius: 0; font-family: inherit; font-size: 15px; font-weight: 600; ${i ? 'margin-left: -2px; ' : ''}border: 2px solid ${on ? '{{t.play}}' : '{{t.ink}}'}; background: ${on ? '{{t.play}}' : 'transparent'}; color: ${on ? '{{t.playInk}}' : '{{t.ink}}'}${on ? '; scroll-initial-target: nearest' : ''}">${on ? arrow() : ''}Wk ${w}</button>`; }).join('');
  const strip = `<div data-testid="week-scroll" style="flex: 0 1 auto; min-width: 0; overflow-x: auto; overflow-y: hidden; scrollbar-width: thin; scrollbar-color: {{t.dim}} transparent"><div role="radiogroup" aria-label="Weeks" style="display: flex; width: max-content">${segs}</div></div>`;
  return `<div role="group" aria-label="Week picker" style="display: flex; align-items: center; gap: 12px">${stepBtn('Previous week', 'M7 1h2v10H7zM5 3h2v6H5zM3 5h2v2H3z')}${strip}${stepBtn('Next week', 'M3 1h2v10H3zM5 3h2v6H5zM7 5h2v2H7z')}</div>`;
}

// ---- page sections control: Picks / Standings (a radiogroup; selected = Play-blue fill + arrow + the word) ----
const sectionsControl = ({ selected = 'picks', phone = false } = {}) => `<div role="radiogroup" aria-label="Pick'em sections" style="display: ${phone ? 'flex' : 'inline-flex'}">${[['picks', 'Picks'], ['standings', 'Standings']].map(([v, t], i) => { const on = v === selected; return `<button type="button" role="radio" aria-checked="${on}" tabindex="${on ? 0 : -1}" style="min-height: 44px; ${phone ? 'flex: 1; ' : 'min-width: 140px; '}display: inline-flex; align-items: center; justify-content: center; gap: 8px; padding: 0 16px; box-sizing: border-box; border-radius: 0; font-family: inherit; font-size: 15px; font-weight: 600; ${i ? 'margin-left: -2px; ' : ''}border: 2px solid ${on ? '{{t.play}}' : '{{t.ink}}'}; background: ${on ? '{{t.play}}' : 'transparent'}; color: ${on ? '{{t.playInk}}' : '{{t.ink}}'}">${on ? arrow() : ''}${t}</button>`; }).join('')}</div>`;

// ---- page head: breadcrumb "Leagues / {league} / Pick'em", pixel h1, the page's own blurb ----
const BLURB = "Pick the winner of every NFL game. Picks lock at kickoff, and everyone's picks are revealed game by game as they do.";
const RULE = (n = 14) => `<b style="font-weight: 600">Confidence league:</b> give each game a rank from 1 to ${n}, each used once. A correct pick earns its rank.`;
// Phone: the h1 says the page, so the trail ends at the league (no current crumb, no trailing separator).
const phoneCrumb = league => `<nav aria-label="Breadcrumb"><ol style="list-style: none; margin: 0 0 0 -10px; padding: 0; display: flex; flex-wrap: wrap; align-items: center"><li style="display: flex; align-items: center">${k.link('Leagues', 'Leagues')}<span aria-hidden="true" style="color: {{t.dim}}; display: inline-flex">${arrow()}</span></li><li style="display: flex; align-items: center">${k.link(league, league)}</li></ol></nav>`;
const pkHead = (league, { phone = false, confidence = false } = {}) => `<section aria-labelledby="h1" style="display: flex; flex-direction: column; gap: 4px; min-width: 0">${phone ? phoneCrumb(league) : k.breadcrumb(['Leagues', league], "Pick'em")}<div style="display: flex; flex-direction: column; gap: 12px; min-width: 0">${k.h1("Pick'em", { phone })}<p style="margin: 0; font-size: ${phone ? 16 : 17}px; color: {{t.dim}}; max-width: 760px; text-wrap: pretty">${BLURB}</p>${confidence ? `<p style="margin: 0; font-size: ${phone ? 15 : 16}px; max-width: 760px; text-wrap: pretty">${RULE()}</p>` : ''}</div></section>`;

// ---- CommissionerPanel: "Commissioner settings", scoring radio cards, ghost Save scoring mode (disabled until the mode changes), never filled ----
const MODES = [{ value: 'straight', label: 'Straight up: 1 point per correct pick' }, { value: 'confidence', label: 'Confidence: rank every game, earn the rank you assigned' }];
// Collapsed (default): one row, "Commissioner settings · Pick'em on · {mode} · locked for the season" and a ghost Edit (aria-expanded false).
// Expanded: the same row with Edit pressed, then the body; the switch stays usable, the scoring cards are disabled with the product's reason.
function commissionerPanel({ mode = 'straight', lockedOn = false, expanded = false, phone = false, id = 'cs-h' } = {}) {
  const word = mode === 'confidence' ? 'Confidence' : 'Straight up';
  const edit = k.btnGhost(expanded ? 'Hide' : 'Edit', { aria: `${expanded ? 'Hide' : 'Edit'} commissioner settings` }).replace('<button type="button"', `<button type="button" aria-expanded="${expanded}" aria-controls="${id}-body"`);
  const row = `<div style="display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px 16px; padding: ${phone ? '8px 14px' : '8px 20px'}; box-sizing: border-box${expanded ? '; border-bottom: 2px solid {{t.rule}}' : ''}"><span style="display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 12px; min-width: 0">${h2s(id, 'Commissioner settings')}<span style="font-size: 15px; color: {{t.dim}}">${lockedOn ? '' : "Pick'em on · "}${word} · locked for the season</span></span>${edit}</div>`;
  if (!expanded) return `<section aria-labelledby="${id}" style="${FRAME2}; min-width: 0">${row}</section>`;
  const intro = lockedOn
    ? 'Everyone picks the winner of every NFL game, picks lock at kickoff, and a tied game credits nobody.'
    : "Pick'em runs for the whole league alongside fantasy. Everyone picks the winner of every NFL game, picks lock at kickoff, and a tied game credits nobody.";
  return `<section aria-labelledby="${id}" style="${FRAME2}; min-width: 0">${row}<div id="${id}-body" style="padding: 20px; display: flex; flex-direction: column; gap: 16px">
<p style="margin: 0; font-size: 15px; color: {{t.dim}}; max-width: 760px; text-wrap: pretty">${intro}</p>
${lockedOn ? `<p style="margin: 0; font-size: 15px; font-weight: 600">Pick'em is always on in this league.</p>` : k.toggle({ id: 'pk-enable', label: "Enable Pick'em for this league", on: true })}
${radioCards({ legend: 'Scoring', name: 'pk-mode', options: MODES.map(o => ({ ...o, label: o.value === mode ? `${o.label} <span style="display: inline-flex; align-items: center; gap: 6px; margin-left: 8px; font-size: 14px; font-weight: 700; white-space: nowrap">${lockIcon()}Locked</span>` : o.label, checked: o.value === mode, disabled: true })) })}
<div style="display: flex; flex-wrap: wrap; align-items: center; gap: 8px 16px">${btnDis('Save scoring mode')}<span style="font-size: 14px; color: {{t.dim}}">The mode can only change before the season's first pick.</span></div>
</div></section>`;
}

// "What the numbers mean" (mirrors kit.js help()): closed by default; the Confidence entry only on confidence boards.
const pkHelp = ({ phone = false, confidence = false, open = false } = {}) => {
  const defs = [['Spread', 'The favorite and the points it is expected to win by.'], ['O/U', 'The expected combined score of both teams.'], ['FAV', 'Marks the favorite, the team the spread expects to win.'], ['Win probability', "ESPN's live figure for each team's chance to win; it shows on live games."], ...(confidence ? [['Confidence', "Each pick carries a rank from 1 up to the week's game count, each used once. A correct pick earns its rank."]] : [])];
  return `<details${open ? ' open' : ''} style="font-size: 14px; color: {{t.dim}}; position: relative"><summary style="cursor: pointer; min-height: 44px; display: inline-flex; align-items: center; gap: 10px; font-weight: 600; color: {{t.ink}}"><svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M1 1h14v14H1zM3 3v10h10V3zM7 4h2v2H7zM7 7h2v5H7z" fill="currentColor" fill-rule="evenodd"/></svg>What the numbers mean</summary><dl style="margin: 4px 0 0; display: grid; grid-template-columns: ${phone ? '1fr' : 'max-content 1fr'}; gap: 6px 16px; max-width: 760px">${defs.map(([t, d]) => `<dt style="font-weight: 600; color: {{t.ink}}">${t}</dt><dd style="margin: 0">${d}</dd>`).join('')}</dl></details>`;
};

// Rows of a page: windows built from a slate, in kickoff order. opts is passed to every gameCard; cursorKey names the one cursor card.
function windows(games, opts = {}, cursorKey, extra = {}) {
  const order = ['thursday-night', 'sunday-early', 'sunday-late', 'sunday-night', 'monday-night'];
  const phaseOf = g => opts.phase ? opts.phase(g) : g.ph;
  const pickOf = g => { const m = { ...opts, ...(extra[g.key] || {}) }; return m.my === undefined ? MY_PICKS[g.key] : m.my; };
  return order.map(w => {
    const gs = games.filter(g => g.win === w);
    if (!gs.length) return '';
    const settled = gs.every(g => phaseOf(g) !== 'open');
    const hint = !settled && opts.mode === 'confidence' && gs.some(g => phaseOf(g) === 'open' && !pickOf(g)), hintId = hint ? `w-${w}-hint` : undefined;
    return windowFrame({ id: `w-${w}`, title: WINDOWS[w], notes: settled ? [] : [{ t: 'League picks reveal at kickoff' }, ...(hint ? [{ t: 'Pick a team to set its confidence', id: hintId }] : [])], phone: opts.phone, summary: settled ? windowSummary(gs, phaseOf, pickOf) : undefined,
      cards: settled ? [] : gs.map(g => gameCard(g, { ...opts, hintId, ...(extra[g.key] || {}), phase: opts.phase ? opts.phase(g) : undefined, cursor: g.key === cursorKey })) });
  }).join('\n');
}

module.exports = { ...k, page, btnDis, NAMES, GAMES, WINDOWS, MY_PICKS, check16, confSelect, isLockedGame, SUNDAY_PICKED, lock8, teamBtn, gameCard, skelCard, windowFrame, saveLine, rankStrip, star16, weekStrip, sectionsControl, pkHead, BLURB, RULE, rankPool, commissionerPanel, windows, windowSummary, pickStatus, statusWords, picksHead, pkHelp, locksIn, outcomeChip, box, lockedTag, oddsBadge };
