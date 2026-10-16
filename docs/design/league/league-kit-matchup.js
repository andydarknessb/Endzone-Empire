// Pieces shared by the wave 2 Matchup boards (MatchupPre, MatchupPhone). Own file: never edit league-kit*.js.
const k = require('./league-kit-samples');
const { px, esc, h2, meta, posTag, injTag, warn, arrow } = k;
const D0 = require('./lineup-data');
const { ME, OPP, BENCH, LIVE_TOTALS, SUMMARY, STARTERS } = D0;
const f1 = n => n.toFixed(1);

// One Week 7 slate: week7-games.js. Starter line two is "BUF vs MIA" plus the live clock on an in-progress game; no kickoff.
const W = require('./week7-games');
const teamLine = (tv, clock = 240) => W.teamLine(tv.split(' ')[0], clock);
// W-L as the product's ScoreboardStrip prints it (a "W-L" string from the standings, "-T" only with ties).
const D = require('./league-dash-parts');
const recordOf = name => { const r = D.standingsData.find(d => d.team === name); return r.w + '-' + r.l + (r.t ? '-' + r.t : ''); };
const sentence = (meNow, oppNow) => `Darkness Falls ${f1(meNow)}, Sunday Scaries ${f1(oppNow)}`;

// ---- NFL games strip: one drawing everywhere. Board black, no visible heading, aria-label "NFL games", a list that scrolls sideways inside its box.
// Live and final games show both scores, live clocks in Board ink, scheduled games their kickoff. games: rows of week7-games.js.
// Critique 9 item 6: the strip always ends on a cut tile. A tile is 1/6.5 of the box on desktop and 1/1.5 on a phone, so the next game shows half at the right edge at any width.
const nflStrip = (games, { clock = 240, phone = false } = {}) => {
  const B = { ink: '{{t.boardInk}}', dim: '{{t.boardDim}}', rule: '{{t.boardRule}}' };
  const item = (g, i) => {
    const s = W.stateAt(g, clock), live = s.status === 'live', fin = s.status === 'final';
    const line1 = s.status === 'scheduled' ? `${g.away} @ ${g.home}` : `${g.away} ${s.awayScore} - ${g.home} ${s.homeScore}`;
    const line2 = live ? `<span aria-hidden="true" style="display: inline-block; width: 8px; height: 8px; margin-right: 6px; background: ${B.ink}"></span><span style="font-weight: 600">${s.clock}</span>` : fin ? 'FINAL' : s.clock;
    return `<li style="flex: none; width: calc(100% / ${phone ? 1.5 : 6.5}); box-sizing: border-box; min-height: 64px; display: flex; flex-direction: column; justify-content: center; gap: 2px; padding: 8px 16px; border-left: ${i ? '2px solid ' + B.rule : '0'}"><span style="font-size: 15px; font-weight: 600; white-space: nowrap; font-variant-numeric: tabular-nums">${line1}</span><span style="font-size: 14px; white-space: nowrap; display: inline-flex; align-items: center; color: ${live ? B.ink : B.dim}">${line2}</span></li>`;
  };
  return `<section style="background: {{t.board}}; color: {{t.boardInk}}; border: 6px double {{t.boardDim}}; min-width: 0"><ul role="list" tabindex="0" aria-label="NFL games" style="list-style: none; margin: 0; padding: 0; display: flex; overflow-x: auto; min-width: 0">${games.map(item).join('')}</ul></section>`;
};
// Two-sided win probability (Critique 8 item 5, Critique 9 item 4): a's share filled from the left end, b's from the right; the leader in Board-lit on Board black (live), Ink on the page (before kickoff: nothing is live, so nothing is green), the trailer outlined; both names and percents at the ends; one accessible name.
// caption is html (the Endzone Forecast credit goes here on fantasy matchup bars only).
function twoSided(a, b, pct, { on = 'board', caption = 'Win probability', size = 13 } = {}) {
  const c = on === 'board' ? { ink: '{{t.boardInk}}', dim: '{{t.boardDim}}', lead: '{{t.boardLive}}' } : { ink: '{{t.ink}}', dim: '{{t.dim}}', lead: '{{t.ink}}' };
  const aLeads = pct >= 50, ac = Math.round(pct / 5);
  const cells = Array.from({ length: 20 }, (_, i) => ((i < ac) === aLeads) ? `<span style="height: 12px; box-sizing: border-box; background: ${c.lead}"></span>` : `<span style="height: 12px; box-sizing: border-box; border: 2px solid ${c.dim}"></span>`).join('');
  const end = (n, p, lead, right) => `<span style="min-width: 0; ${right ? 'text-align: right; ' : ''}${lead ? `font-weight: 700; color: ${c.ink}` : ''}">${n} ${p}%</span>`;
  return `<div role="img" aria-label="${esc(a)} ${pct}%, ${esc(b)} ${100 - pct}% win probability" style="display: flex; flex-direction: column; gap: 6px; font-size: ${size}px; color: ${c.dim}"><span>${caption}</span><div style="display: grid; grid-template-columns: repeat(20, minmax(0, 1fr)); gap: 2px">${cells}</div><div style="display: flex; flex-wrap: wrap; justify-content: space-between; gap: 2px 8px">${end(a, pct, aLeads)}${end(b, 100 - pct, !aLeads, true)}</div></div>`;
}
// Phone breadcrumb (Critique 9): the current page is dropped (the h1 says it), so the trail ends on its last link with no trailing separator.
const breadcrumbPhone = trail => `<nav aria-label="Breadcrumb"><ol style="list-style: none; margin: 0 0 0 -10px; padding: 0; display: flex; flex-wrap: wrap; align-items: center">${trail.map((t, i) => `<li style="display: flex; align-items: center">${k.link(t, t)}${i < trail.length - 1 ? `<span aria-hidden="true" style="color: {{t.dim}}; display: inline-flex">${arrow()}</span>` : ''}</li>`).join('')}</ol></nav>`;
// Lineup note (Critique 7 item 5): its own row between the NFL strip (or the versus panel) and Starters. No cursor, no filled action: a ghost "Set lineup".
// pre = 9:10 AM, the dashboard's figures (the Out starter, the empty slot, the gain, the lock); live = 2:40 PM, the empty slot and the next lock.
const EMPTY_SLOT = STARTERS.find(s => s.empty).slot, OUT_NAME = D0.OUT[0];
const lineupLocks = { pre: 'Sun ' + D0.FIRST_LOCK, live: 'Sun ' + D0.NEXT_LOCK };
// Critique 10 item 11: live, an empty row says what is true (the slot is open until the next kickoff); before kickoff it keeps "Fill by".
const fillBy = mode => mode === 'live' ? 'Empty · next kickoff ' + lineupLocks.live : 'Fill by ' + lineupLocks[mode];
// Critique 11 item 11: the live note does not dead-end. It says the slot is empty, that no bench player can fill it, and what to do: add a free agent playing at the next kickoff, with the timing ("next kickoff in {n} min") in the Danger text token Pick'em uses for "Locks in" (14px bold, on the panel surface where that pairing is registered) only while it is under an hour.
// The claim is checked against the data: a bench player can fill the slot only if his game has not started at 2:40 PM (week7-games.js); every bench game is live, final or on bye, so none can. If one could, the note names him instead.
const MIN_TO_LOCK = D0.mins(D0.NEXT_LOCK) - D0.CLOCK.liveMin, URGENT = MIN_TO_LOCK > 0 && MIN_TO_LOCK < 60;
const UNLOCKED = BENCH.filter(b => !b.bye && W.stateAt(W.gameOf(b.sub.split(' · ')[1]), 240).status === 'scheduled').map(b => b.name);
const liveNote = () => {
  const lead = UNLOCKED.length ? EMPTY_SLOT + ' is empty · ' + UNLOCKED.join(' or ') + ' can still fill it' : EMPTY_SLOT + ' is empty · no bench player can fill it · add a free agent playing at ' + D0.NEXT_LOCK;
  const head = lead.replace(EMPTY_SLOT + ' is empty', '<b style="font-weight: 600; color: {{t.ink}}">' + EMPTY_SLOT + ' is empty</b>');
  return URGENT
    ? { html: head + ' · <span style="font-weight: 700; color: {{t.danger}}; white-space: nowrap">next kickoff in ' + MIN_TO_LOCK + ' min</span>', plain: lead + ', next kickoff in ' + MIN_TO_LOCK + ' min', cta: UNLOCKED.length ? 'Set lineup' : 'Free agents' }
    : { html: head, plain: lead, cta: UNLOCKED.length ? 'Set lineup' : 'Free agents' };
};
// One meaning per symbol (Critique 8 item 5): the note's pictogram is the warning, never the lock (the lock means Locked).
// Critique 11 item 14: the 9:10 AM note names two moves and what they do ("Two moves · +23.0 pts: Addison in for Puka Nacua (Out) · Spears into the empty FLEX · you'd project 116.8 to 98.6", all read from lineup-data.js; 116.8 is meProj + ADVICE.gain); line two is the lock, which never breaks.
const PRE_NEW = +(D0.SUMMARY.meProj + +D0.ADVICE.gain).toFixed(1);
const preNote = () => ({
  html: '<b style="font-weight: 600; color: {{t.ink}}">' + D0.SWAP.line + ' · you\'d project ' + f1(PRE_NEW) + ' to ' + f1(D0.SUMMARY.oppProj) + '</b><br><span style="white-space: nowrap">Locks ' + lineupLocks.pre + '</span>',
  plain: D0.SWAP.line + ', you\'d project ' + f1(PRE_NEW) + ' to ' + f1(D0.SUMMARY.oppProj) + ', locks ' + lineupLocks.pre, cta: 'Set lineup' });
// button: false drops the link (MatchupPre keeps its one Set lineup here); the live note's link reads "Free agents".
const lineupNote = (mode, phone = false, { button = true } = {}) => {
  const n = mode === 'live' ? liveNote() : preNote();
  const btn = button ? k.btnGhost(n.cta, { tag: 'a', aria: n.cta + ', Thursday Night Regulars, ' + n.plain }) : '';
  return '<section aria-label="Lineup note: ' + n.plain + '" style="border: 2px solid {{t.frame2}}; background: {{t.panel}}; display: flex; flex-wrap: wrap; align-items: center; gap: 8px 16px; padding: ' + (phone ? '10px 14px' : '10px 20px') + '; box-sizing: border-box; min-height: 56px; font-size: 14px; color: {{t.dim}}"><span style="display: flex; align-items: flex-start; gap: 8px; flex: 1 1 ' + (phone ? '100%' : '320px') + '; min-width: 0"><span style="margin-top: 2px; display: inline-flex">' + warn(mode === 'live' && URGENT ? '{{t.danger}}' : '{{t.ink}}') + '</span><span>' + n.html + '</span></span>' + btn + '</section>';
};
// Critique 10 item 15: a closed "What the numbers mean" disclosure (mirrors kit.js help() and Pick'em's pkHelp); 44px summary. One list on every Matchup and Game Center board.
const numbersHelp = ({ phone = false } = {}) => {
  const defs = [
    ['Proj', "A lineup's points before its games are played, from Endzone Forecast, our projection engine."],
    ['Expected final', "Points so far plus the projected points still to come: a starter's projection times the share of his game left, or all of it before his game starts."],
    ['Players remaining', "Starters whose NFL game isn't final. Out starters and empty slots don't count. Before kickoff it reads \"starters set to play\"."],
    ['Yet to play', "The players remaining whose NFL game hasn't started."],
    ['Win probability', "Your chance to win the matchup from both lineups' projected finals (Endzone Forecast). It sharpens as games finish."],
    ['Projected margin', 'How far one lineup is projected to finish ahead of the other: the gap between the two Proj totals before kickoff, between the two Expected finals once games are live.'],
  ];
  return `<details style="font-size: 14px; color: {{t.dim}}; position: relative"><summary style="cursor: pointer; min-height: 44px; display: inline-flex; align-items: center; gap: 10px; font-weight: 600; color: {{t.ink}}"><svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M1 1h14v14H1zM3 3v10h10V3zM7 4h2v2H7zM7 7h2v5H7z" fill="currentColor" fill-rule="evenodd"/></svg>What the numbers mean</summary><dl style="margin: 4px 0 0; display: grid; grid-template-columns: ${phone ? '1fr' : 'max-content 1fr'}; gap: 6px 16px; max-width: 760px">${defs.map(([t, d]) => `<dt style="font-weight: 600; color: {{t.ink}}">${t}</dt><dd style="margin: 0">${d}</dd>`).join('')}</dl></details>`;
};
// Scoreboard heading: an h2 before the team-name h3s (visually hidden).
const sbHeading = text => `<h2 style="margin: 0; ${k.SR}">${text}</h2>`;
// The record line under a team name.
const recLine = (name, c = '{{t.dim}}') => `<div style="font-size: 13px; color: ${c}; font-variant-numeric: tabular-nums">${recordOf(name)}</div>`;

// Bench, both sides (the live Matchup board's data).
const BENCH_ME = BENCH.map(b => [b.name, b.pos, b.sub.split(' · ')[1], b.bye ? 'bye' : +b.proj]);
const BENCH_OPP = [['Rachaad White', 'RB', 'TB', 9.3], ['Calvin Ridley', 'WR', 'TEN', 9.0, 'Questionable'], ['Mark Andrews', 'TE', 'BAL', 'bye'], ['Jaylen Warren', 'RB', 'PIT', 8.1], ['Romeo Doubs', 'WR', 'GB', 6.0], ['Chig Okonkwo', 'TE', 'TEN', 4.1]];
// Critique 8 item 2: at 2:40 PM a bench player in a live or final game shows his points with "proj {x}" as line two, like starters; bye stays "on bye"; a game not started shows proj alone.
// Fixture figures [points so far, projection], each consistent with its game in week7-games.js: every Sunday Early game is Q4, PIT @ CLE is final, GB @ CHI is 7:20 PM, NO and BAL are on bye. The board shows no bench total.
const BENCH_LIVE = {
  'Tyjae Spears': [13.4, 12.9], 'Jordan Addison': [9.2, 10.1], 'Dalton Kincaid': [6.1, 7.4], 'Tank Bigsby': [4.4, 6.2], 'Tyler Allgeier': [7.2, 5.8], 'Chris Olave': null,
  'Rachaad White': [10.6, 9.3], 'Calvin Ridley': [7.2, 9.0], 'Mark Andrews': null, 'Jaylen Warren': [8.6, 8.1], 'Romeo Doubs': [null, 6.0], 'Chig Okonkwo': [3.7, 4.1],
};
const benchState = team => { const g = W.gameOf(team); return g ? W.stateAt(g, 240).status : 'bye'; };
for (const [n, , t] of [...BENCH_ME, ...BENCH_OPP]) { // fixture guard: a figure exists exactly when the game has started
  const st = benchState(t), v = BENCH_LIVE[n];
  if ((st === 'bye') !== (v === null) || (st === 'scheduled') !== (!!v && v[0] === null)) throw new Error('BENCH_LIVE disagrees with week7-games.js for ' + n + ' (' + t + ' ' + st + ')');
}
// Critique 11 item 14: a final game reads the same on every board: "8.6 pts · final" over "proj 8.1" (the fixture's points and projection), at 9:10 AM too (PIT @ CLE is final Thursday).
const benchFig = (n, t, proj, live) => {
  const g = W.gameOf(t), st = g ? W.stateAt(g, live ? 240 : 9).status : 'bye', v = BENCH_LIVE[n];
  if (st === 'bye') return '<span style="font-size: 15px; color: {{t.dim}}; flex: none">on bye</span>';
  if (st === 'scheduled' || (st === 'live' && !live)) return '<span style="font-size: 15px; color: {{t.dim}}; flex: none">proj ' + f1(proj) + '</span>';
  const word = st === 'final' ? 'pts · final' : 'pts';
  return '<span style="display: flex; flex-direction: column; align-items: flex-end; gap: 0; flex: none; line-height: 1.3; text-align: right"><span>' + (st === 'live' ? '<span style="' + k.SR + '">In progress, </span>' : '') + '<b style="font-size: 16px; font-weight: 700">' + f1(v[0]) + '</b> <span style="font-size: 13px; color: {{t.dim}}">' + word + '</span></span><span style="font-size: 13px; color: {{t.dim}}">proj ' + f1(v[1]) + '</span></span>';
};
const benchCol = (rows, name, { phone = false, live = false } = {}) => `<div style="min-width: 0"><h3 style="margin: 0 0 4px; font-size: 13px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; color: {{t.dim}}">${name}</h3><ul style="list-style: none; margin: 0; padding: 0">${rows.map(([n, p, t, proj, inj], i) => `<li style="display: flex; align-items: center; gap: ${phone ? 10 : 12}px; min-height: 48px; padding: ${phone ? 6 : 0}px 0; ${i < rows.length - 1 ? 'border-bottom: 2px solid {{t.rule}}' : ''}">${posTag(p)}<div style="flex: 1; min-width: 0; display: flex; align-items: center; flex-wrap: wrap; gap: 2px 8px"><span style="font-size: 15px; font-weight: 600">${n}</span>${inj ? injTag(inj) : ''}<span style="font-size: 13px; color: {{t.dim}}">${t}</span></div>${benchFig(n, t, proj, live)}</li>`).join('')}</ul></div>`;
// The Bench disclosure's control is the kit ghost button, pressed.
const hideBtn = k.btnGhost('Hide', { aria: 'Hide bench' }).replace('<button type="button"', '<button type="button" aria-expanded="true"');

// Standard / Scoreboard toggle that fills its row on a phone (44px segments).
const viewToggleFill = ({ label, items }) => `<div role="group" aria-label="${esc(label)}" style="display: flex; width: 100%">${items.map((t, i) => `<button type="button" aria-pressed="${!!t.selected}" style="flex: 1; min-height: 44px; display: inline-flex; align-items: center; justify-content: center; gap: 8px; padding: 0 12px; box-sizing: border-box; border-radius: 0; font-family: inherit; font-size: 15px; font-weight: 600; border: 2px solid ${t.selected ? '{{t.play}}' : '{{t.ink}}'}; ${i ? 'margin-left: -2px; ' : ''}background: ${t.selected ? '{{t.play}}' : 'transparent'}; color: ${t.selected ? '{{t.playInk}}' : '{{t.ink}}'}">${t.selected ? arrow() : ''}${t.label}</button>`).join('')}</div>`;

// Critique 11 item 14: the FLEX slot's tag reads "FLEX" (a neutral outline, as the draft room's roster rows), not the WR of its first eligible position.
const slotTag = slot => { const p = slot.split(' ')[0]; return p === 'FLEX' ? '<span style="display: inline-flex; align-items: center; justify-content: center; box-sizing: border-box; min-width: 40px; height: 24px; padding: 0 6px; border: 2px solid {{t.dim}}; color: {{t.dim}}; font-size: 13px; font-weight: 700; line-height: 1">FLEX</span>' : posTag(p); };
// Critique 11 item 8: the compact sticky scoreboard, drawn as a labelled 56px specimen. In the product the full versus panel stays in flow; once it scrolls out of view this bar pins to the top and the page reserves it with scroll-padding-top 72px (56px + 16px). Board black, the Live chip, the leader in Board ink and the trailer in Board dim; no cursor, no action.
const stickyBar = ({ phone = false } = {}) => {
  const T = LIVE_TOTALS, me = T.lead >= 0, B = { ink: '{{t.boardInk}}', dim: '{{t.boardDim}}' };
  const a = '<span style="white-space: nowrap; font-weight: ' + (me ? 700 : 600) + '; color: ' + (me ? B.ink : B.dim) + '">DF ' + f1(T.meNow) + '</span>', b = '<span style="white-space: nowrap; font-weight: ' + (me ? 600 : 700) + '; color: ' + (me ? B.dim : B.ink) + '">SS ' + f1(T.oppNow) + '</span>';
  const by = '<span style="white-space: nowrap; font-weight: 700; color: ' + B.ink + '">' + (me ? 'Darkness Falls' : 'Sunday Scaries') + ' by ' + f1(Math.abs(T.lead)) + '</span>';
  const dot = '<span aria-hidden="true" style="color: ' + B.dim + '"> · </span>';
  const text = phone ? '<span style="display: flex; flex-direction: column; gap: 2px; min-width: 0"><span>' + a + dot + b + '</span>' + by + '</span>' : a + dot + b + dot + by;
  const aria = 'Darkness Falls ' + f1(T.meNow) + ', Sunday Scaries ' + f1(T.oppNow) + ', ' + (me ? 'Darkness Falls' : 'Sunday Scaries') + ' by ' + f1(Math.abs(T.lead));
  return '<section aria-labelledby="sticky-h" style="display: flex; flex-direction: column; gap: 8px; min-width: 0">' + k.h2s('sticky-h', 'When the scoreboard scrolls away') + meta('Specimen, 56px. It pins to the top once the full scoreboard is out of view.') + '<div role="group" aria-label="' + aria + '" style="height: 56px; box-sizing: border-box; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 0 ' + (phone ? 14 : 20) + 'px; background: {{t.board}}; color: ' + B.ink + '; border: 2px solid ' + B.dim + '; font-size: ' + (phone ? 15 : 16) + 'px; font-variant-numeric: tabular-nums; line-height: 1.3"><span aria-hidden="true" style="min-width: 0">' + text + '</span>' + k.liveChipBoard('Live') + '</div></section>';
};
// Phone starter cell: line 1 name + injury tag, line 2 state glyph, figure and the game (the game wraps under when the half is narrow).
// r: [slot, name, inj, teamVs, status, pts, proj, exp]; pre: true = projections only (kickoff line), false = live (points so far)
const phoneCell = (r, right, { pre = false } = {}) => {
  const [, name, inj, tv0, st, pts, proj] = r;
  const tv = pre ? tv0 : teamLine(tv0);
  const al = right ? 'text-align: right; align-items: flex-end' : 'align-items: flex-start';
  if (st === 'empty') return `<div style="display: flex; flex-direction: column; gap: 2px; min-width: 0; ${al}"><span style="font-size: 15px; color: {{t.dim}}">${pre ? 'Empty' : 'No starter'}</span><span style="font-size: 13px; color: {{t.dim}}">${fillBy(pre ? 'pre' : 'live')}</span></div>`;
  const [ml, mg] = k.MARK[st];
  const fig = st === 'yet'
    ? (inj === 'Out' ? `<span style="color: {{t.dim}}">out</span>` : `<span style="color: {{t.dim}}">proj</span> <b style="font-weight: 600">${f1(proj)}</b>`)
    : `<b style="font-weight: 700">${f1(pts)}</b> <span style="color: {{t.dim}}">pts</span>`;
  const glyph = `<span style="color: {{t.dim}}; display: inline-flex"><span style="${k.SR}">${ml}</span>${mg}</span>`;
  return `<div style="display: flex; flex-direction: column; gap: 2px; min-width: 0; ${al}"><div style="display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; ${right ? 'justify-content: flex-end' : ''}"><span style="font-size: 15px; font-weight: 600; overflow-wrap: anywhere">${name}</span>${inj ? injTag(inj) : ''}</div><div style="display: flex; flex-wrap: wrap; align-items: center; gap: 2px 8px; font-size: 14px; ${right ? 'justify-content: flex-end' : ''}"><span style="display: inline-flex; align-items: center; gap: 6px">${right ? '' : glyph}<span>${fig}</span>${right ? glyph : ''}</span><span style="font-size: 13px; color: {{t.dim}}">${tv}</span></div></div>`;
};

// kit.js paints the live bar with a literal hex; the board token is the same colour.
const oddsBar = (...a) => k.oddsBar(...a).replace(/#2fd97b/g, "{{t.boardLive}}");
module.exports = { ...k, oddsBar, f1, W, teamLine, recordOf, sentence, nflStrip, stickyBar, slotTag, twoSided, breadcrumbPhone, lineupNote, preNote, PRE_LEFT: D0.PRE_LEFT, numbersHelp, URGENT, MIN_TO_LOCK, fillBy, sbHeading, recLine, BENCH_ME, BENCH_OPP, benchCol, hideBtn, viewToggleFill, phoneCell, ME, OPP, LIVE_TOTALS, SUMMARY };
