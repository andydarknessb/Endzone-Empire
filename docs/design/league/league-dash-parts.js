// Shared data and phone/game-day pieces for GameDay, MainPhone and GameDayPhone. Builds on league-kit; edits nothing there.
const k = require('./league-kit');
const { px, FRAME, frameHead, h2, meta } = k;

const D = require('./lineup-data');
const LG = 'Thursday Night Regulars';
const TEAMS = [
  ['Blitz Brigade', 5, 1, 701.2, 598.4, 'W3'], ['Waiver Wolves', 5, 1, 688.7, 612.0, 'W2'], ['Darkness Falls', 4, 2, 664.5, 603.1, 'W1'],
  ['Sunday Scaries', 4, 2, 651.0, 622.9, 'L1'], ['Gridiron Ghosts', 4, 2, 642.8, 630.4, 'W1'], ['Fumble Rooskie', 4, 2, 630.1, 617.5, 'W2'],
  ['Hail Mary Club', 3, 3, 618.9, 624.0, 'L2'], ['Pocket Aces', 3, 3, 609.4, 615.2, 'W1'], ['Dynasty Dads', 2, 4, 598.3, 640.6, 'L3'],
  ['Red Zone Rejects', 2, 4, 587.0, 633.9, 'L1'], ['Bench Mob', 1, 5, 561.2, 655.3, 'L4'], ['Practice Squad', 0, 6, 540.8, 671.7, 'L6'],
];
const standingsData = TEAMS.map(([team, w, l, pf, pa, strk], i) => ({ rank: i + 1, team, w, l, t: 0, pf: pf.toFixed(1), pa: pa.toFixed(1), strk }));
// Kinds: Add, Drop, Trade, Waiver, Settings, Stat correction, Recap. League-level rows (stat correction, recap) carry no team.
// Each row carries its age in minutes at the Main clock (Sun Oct 18, 9:10 AM CDT); every "ago" derives from it, so game day (2:40 PM) is 330 minutes later.
const ago = m => m < 60 ? m + 'm ago' : m < 1440 ? Math.floor(m / 60) + 'h ago' : Math.floor(m / 1440) + 'd ago';
const FEED_RAW = [
  ['Add', 'Hail Mary Club', 'added Tank Dell', 38],
  ['Add', 'Sunday Scaries', 'added Jake Ferguson', 130],
  ['Drop', 'Bench Mob', 'dropped Gardner Minshew', 190],
  ['Trade', 'Gridiron Ghosts', 'traded Chase Brown to Blitz Brigade for Courtland Sutton', 310],
  ['Stat correction', '', 'NFL stat correction updated 2 matchup scores in week 6', 550],
  ['Settings', 'Darkness Falls', 'commissioner action', 1500],
  ['Add', 'Pocket Aces', 'added Jameis Winston', 1700],
  ['Waiver', 'Darkness Falls', 'claimed Woody Marks · $12 FAAB, dropped Zach Ertz', 6190],
  ['Recap', '', 'Week 6 recap published', D.CLOCK.recapAgoMin],
];
const GAP = D.CLOCK.liveMin - D.CLOCK.mainMin;
const FEED = FEED_RAW.map(r => [r[0], r[1], r[2], ago(r[3])]);
const FEED_LIVE = FEED_RAW.map(r => [r[0], r[1], r[2], ago(r[3] + GAP)]);
// Week 7 has not finished, so the trophy room holds the weekly awards of weeks 1-6 of the 2026 season. Week 6 rows match the recap and the standings (Ghosts W1 over Hail Mary Club L2, Darkness Falls W1 over Dynasty Dads L3).
const AWARDS = [
  ['cup', 'Weekly High', 'Blitz Brigade', 'Week 6 · 141.7'], ['star', 'Closest Game', 'Gridiron Ghosts', 'Week 6 · by 0.8'], ['star', 'Biggest Blowout', 'Darkness Falls', 'Week 6 · by 22.2'],
  ['cup', 'Weekly High', 'Waiver Wolves', 'Week 5 · 138.9'], ['star', 'Called Shot', 'Sunday Scaries', 'Week 5'], ['star', 'Perfect Lineup', 'Waiver Wolves', 'Week 3'],
];
const RECAP = {
  body: 'Blitz Brigade went off for the week\'s top score and moved into first place. Darkness Falls beat Dynasty Dads 118.4 to 96.2, helped by 22.6 points from the Woody Marks waiver claim.',
  facts: [['High score', 'Blitz Brigade · 141.7'], ['Bench blunder', 'Sunday Scaries · 18.4 left on the bench'], ['Waiver steal', 'Woody Marks · Darkness Falls · 22.6 pts'], ['Closest game', 'Gridiron Ghosts vs Hail Mary Club · by 0.8']],
  generated: 'Generated Oct 13, 9:00 AM',
};
// Shared Lock Rule: the lineup play (an empty or Out starter) locks at the next eligible kickoff and Week 7 picks lock at the earliest unpicked kickoff.
// When the two tie they are ONE card, one foot per action, only the first filled. "+N pts available" is said once, in the lock note.
function sharedCard({ lineupLock, picksLock, picksMade, state, countdown }) {
  if (lineupLock !== picksLock) throw new Error('locks differ: ' + lineupLock + ' vs ' + picksLock + ', build two cards');
  const note = `Start ${D.SWAP.in} for ${D.SWAP.out} · +${D.ADVICE.gain}&nbsp;pts`;
  const why = 'Sunday ' + lineupLock;
  return {
    kind: 'lineup', name: 'Lineup and picks', league: '', detail: `Darkness Falls · ${picksMade} of 14 picks made`, lockDay: 'Sun', lockTime: lineupLock, lockNote: note, state, lead: true, countdown,
    aria: `Set your ${LG} lineup and make Week 7 picks: ${note}, ${picksMade} of 14 picks made, both lock ${why}`,
    actions: [
      { label: 'Set lineup', bare: true, aria: `Set your ${LG} lineup, ${D.LINEUP_STATUS}, locks ${why}` },
      { label: 'Make picks', bare: true, aria: `Make Week 7 picks in ${LG}, ${picksMade} of 14 made, the first open game locks ${why}` },
    ],
  };
}
const SHARED_MAIN = sharedCard({ lineupLock: D.FIRST_LOCK, picksLock: D.PICKS_FIRST_LOCK, picksMade: 0, state: 'next' });
const SHARED_LIVE = sharedCard({ lineupLock: D.NEXT_LOCK, picksLock: D.PICKS_NEXT_LOCK, picksMade: 9, state: 'urgent', countdown: 'in ' + (D.mins(D.NEXT_LOCK) - D.CLOCK.liveMin) + ' min' });
const WAIVERS = { kind: 'waivers', name: 'Waivers', league: '', detail: 'FAAB · 48h', lockDay: 'Wed', lockTime: '2:00 AM', lockNote: 'Claims clear after Week 7. 1 claim pending.', cta: 'View claims', aria: `View your waiver claims in ${LG}, they clear Wednesday 2:00 AM` };

const phoneize = html => html.replace(/font-size: 24px/g, 'font-size: 16px').replace(/padding: 14px 20px/g, 'padding: 12px 14px');

// ---- pre-kickoff versus panel, phone (Main) ----
function versusPanelPhone({ you, opp, pct, margin, narrative, kickoff }) {
  const row = (s, you) => `<div style="display: flex; align-items: center; gap: 10px; min-width: 0">${k.avatar(s.name)}<div style="flex: 1; min-width: 0"><div style="${px(16)}; overflow-wrap: anywhere">${s.name}</div><div style="display: flex; align-items: center; gap: 8px; font-size: 13px; color: {{t.dim}}; margin-top: 4px">${you ? k.youBadge() : ''}Proj</div></div><span style="${px(24)}; line-height: 1.2">${s.fig}</span></div>`;
  return `<section aria-labelledby="vs-h" style="${FRAME}; min-width: 0">${frameHead(`${h2('vs-h', 'Week 7 Matchup', { phone: true })}${k.kindTag('Scheduled', { w: 0 })}${kickoff ? meta(kickoff, 'width: 100%') : ''}`, { phone: true })}
<div style="padding: 14px; display: flex; flex-direction: column; gap: 16px">${row(you, true)}${row(opp)}${k.oddsBar(pct, { name: you.name })}
<div style="display: flex; flex-direction: column; gap: 6px"><div style="font-size: 16px"><span style="color: {{t.dim}}">Projected margin ·</span> <b style="font-weight: 700">${k.nb(margin)}</b></div>${narrative ? `<p style="margin: 0; font-size: 15px; color: {{t.dim}}; text-wrap: pretty">${narrative}</p>` : ''}</div>
<div>${k.btnGhost('Matchup', { tag: 'a', aria: `Matchup, ${you.name} against ${opp.name}` })}</div></div></section>`;
}

// ---- live versus screen, phone: each team is a row (name wraps, score Pixel 24); the margin sits under the viewer's score ----
function versusLivePhone({ you, opp, youLeads = true, margin, pct, aria, scored = false, updated = '', sentence = '' }) {
  const c = { ink: '{{t.boardInk}}', dim: '{{t.boardDim}}' };
  const row = (s, lead, isYou) => `<div style="display: flex; align-items: flex-start; gap: 10px; min-width: 0">${k.avatar(s.name, { c: lead ? c.ink : c.dim })}<div style="flex: 1; min-width: 0"><div style="${px(16, lead ? c.ink : c.dim)}; overflow-wrap: anywhere">${s.name}</div><div style="display: flex; align-items: center; flex-wrap: wrap; gap: 4px 8px; font-size: 14px; color: ${c.dim}; margin-top: 4px">${isYou ? k.youBadge(c.ink) : ''}<span>Expected final <b style="font-weight: 600; color: ${c.ink}; white-space: nowrap">${s.expected}</b></span></div><div style="font-size: 14px; color: ${c.dim}; margin-top: 2px; text-wrap: pretty">${s.note}</div></div><span style="display: flex; flex-direction: column; align-items: flex-end; gap: 4px; flex: none"><span style="${px(24, lead ? c.ink : c.dim)}; line-height: 1.2">${s.fig}</span>${isYou ? `<span style="${px(16, c.ink)}; white-space: nowrap">${margin}</span>` : ''}</span></div>`;
  return `<section aria-labelledby="vl-h" style="display: flex; flex-direction: column; gap: 16px; padding: 14px; box-sizing: border-box; background: {{t.board}}; color: {{t.boardInk}}; border: 6px double {{t.boardDim}}; min-width: 0">
<div style="display: flex; flex-wrap: wrap; align-items: flex-start; gap: 8px 12px">${h2('vl-h', 'Week 7 Matchup', { phone: true })}${k.liveStamp(updated)}</div>
${sentence ? `<p aria-live="polite" style="margin: 0; ${k.SR}">${sentence}</p>` : ''}
<a href="#"${scored ? ' class="scored"' : ''} aria-label="${k.esc(aria)}" style="display: flex; flex-direction: column; gap: 16px; padding: 4px; color: inherit; text-decoration: none">${row(you, youLeads, true)}${row(opp, !youLeads, false)}
${k.oddsBar(pct, { on: 'board', name: you.name })}
<span style="display: inline-flex; align-items: center; gap: 8px; font-size: 15px; font-weight: 600">Matchup${k.arrow()}</span></a></section>`;
}

// ---- recap, phone ----
function recapPhone({ body, facts, generated }) {
  return `<section aria-labelledby="rc-h" style="${k.FRAME2}; min-width: 0">${frameHead(`${k.h2s('rc-h', 'Week 6 Recap')}${meta(generated, 'margin-left: auto')}`, { phone: true })}
<div style="padding: 14px; display: flex; flex-direction: column; gap: 16px"><p style="margin: 0; font-size: 16px; text-wrap: pretty">${body}</p>
<dl style="margin: 0; display: flex; flex-direction: column">${facts.map(([l, v], i) => `<div style="display: flex; flex-direction: column; gap: 2px; padding: 10px 0; ${i ? 'border-top: 2px solid {{t.rule}}' : 'border-top: 2px solid {{t.rule}}'}"><dt style="font-size: 13px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; color: {{t.dim}}">${l}</dt><dd style="margin: 0; font-size: 15px; font-weight: 600; text-wrap: pretty">${k.nb(v)}</dd></div>`).join('')}</dl>
<div style="margin-left: -10px">${k.link('Read the full recap', 'Read the full Week 6 recap')}</div></div></section>`;
}

// ---- board tile for Around the league on game day: live or final ----
function boardTile({ a, b, live, pct, aria }) {
  const lead = a.fig >= b.fig ? a : b;
  const margin = Math.abs(a.fig - b.fig).toFixed(1);
  const row = s => {
    const w = s === lead, c = w ? '{{t.boardInk}}' : '{{t.boardDim}}';
    return `<div style="display: flex; align-items: center; gap: 10px; min-width: 0">${k.avatar(s.name, { c })}<span style="flex: 1; min-width: 0; font-size: 15px; font-weight: 600; color: ${c}">${s.name}</span><span style="${px(16, c)}">${s.fig.toFixed(1)}</span></div>`;
  };
  const status = live ? k.liveChipBoard('Live') : k.chip('Final', { c: '{{t.boardDim}}' });
  const foot = live
    ? `${k.oddsBar(pct, { label: false, on: 'board', name: a.name })}<div style="font-size: 13px; color: {{t.boardDim}}"><b style="color: {{t.boardInk}}">${pct}%</b> ${a.name}</div>`
    : `<div style="font-size: 13px; color: {{t.boardDim}}"><b style="color: {{t.boardInk}}; font-weight: 600">${lead.name}</b> won by ${margin}</div>`;
  return `<a href="#" aria-label="${k.esc(aria)}" style="display: flex; flex-direction: column; gap: 12px; padding: 14px; box-sizing: border-box; height: 100%; background: {{t.board}}; color: {{t.boardInk}}; border: 2px solid {{t.boardDim}}; text-decoration: none; min-width: 0"><span style="align-self: flex-start">${status}</span>${row(a)}${row(b)}${foot}</a>`;
}
// The other five Week 7 matchups on game day: 3 live, 2 final.
const AROUND_LIVE = [
  { a: { name: 'Blitz Brigade', fig: 92.6 }, b: { name: 'Bench Mob', fig: 71.3 }, live: true, pct: 82 },
  { a: { name: 'Waiver Wolves', fig: 77.4 }, b: { name: 'Dynasty Dads', fig: 80.9 }, live: true, pct: 46 },
  { a: { name: 'Gridiron Ghosts', fig: 64.2 }, b: { name: 'Hail Mary Club', fig: 63.9 }, live: true, pct: 51 },
  { a: { name: 'Pocket Aces', fig: 118.7 }, b: { name: 'Fumble Rooskie', fig: 104.2 }, live: false },
  { a: { name: 'Red Zone Rejects', fig: 97.5 }, b: { name: 'Practice Squad', fig: 88.2 }, live: false },
].map(t => ({ ...t, aria: t.live
  ? `${t.a.name} against ${t.b.name}, live, ${t.a.fig.toFixed(1)} to ${t.b.fig.toFixed(1)}, ${t.pct}% win probability for ${t.a.name}`
  : `${t.a.name} against ${t.b.name}, final, ${t.a.fig.toFixed(1)} to ${t.b.fig.toFixed(1)}` }));

// ---- phone standings: rank, team, W-L-T stay in view; PF, PA, STRK scroll inside the table box ----
function standingsPhone({ data, viewer, cutAfter, fold = false }) {
  const rows = [];
  // Fold: the viewer row, two teams above and below, and the playoff line (the window runs down to the cut).
  const lo = fold ? Math.max(0, viewer - 2) : 0, hi = fold ? Math.max(viewer + 2, cutAfter - 1) : data.length - 1;
  data.forEach((d, i) => {
    if (i < lo || i > hi) return;
    const me = i === viewer, c = me ? '{{t.playInk}}' : '{{t.ink}}';
    rows.push([d.rank, `<span style="display: flex; align-items: center; gap: 6px"><span aria-hidden="true" style="width: 12px; flex: none; display: inline-flex">${me ? k.arrow() : ''}</span>${k.avatar(d.team, { c })}<a href="#" style="display: flex; align-items: center; min-height: 44px; font-size: 15px; font-weight: 600; color: inherit; text-decoration: none">${d.team}</a>${me ? k.youBadge(c) : ''}</span>`, `${d.w}-${d.l}-${d.t}`, d.pf, d.pa, d.strk]);
    if (i + 1 === cutAfter) rows.push({ cut: 'Playoff line' });
  });
  const cols = [{ label: '#', w: 44 }, { label: 'Team', w: 214 }, { label: 'W-L-T', align: 'right', w: 72 }, { label: 'PF', align: 'right', w: 72 }, { label: 'PA', align: 'right', w: 72 }, { label: 'STRK', align: 'right', w: 64 }];
  const tbl = k.table({ label: `Standings, ${data.length} teams`, cols, rows, viewer: viewer - lo, minW: 538 }).replace(/padding: 0 12px/g, 'padding: 0 8px');
  return `<section aria-labelledby="st-h" style="${FRAME}; min-width: 0">${frameHead(`${h2('st-h', 'Standings', { phone: true })}${meta(`${data.length} teams`, 'margin-left: auto')}`, { phone: true })}${tbl}<div style="padding: 8px 14px; border-top: 2px solid {{t.rule}}; font-size: 13px; color: {{t.dim}}">Scroll the table for PF, PA and STRK</div>${fold ? `<div style="padding: 0 4px; border-top: 2px solid {{t.rule}}">${k.link('Full standings', 'Full standings, all ' + data.length + ' teams')}</div>` : ''}</section>`;
}

// ---- Around the league, phone: a scroller of fixed-width tiles inside the frame ----
function aroundPhone({ tiles, count, tail, tailAria, moreLabel, moreAria, tileW = 280 }) {
  return `<section aria-labelledby="ar-h" style="${k.FRAME2}; min-width: 0">${frameHead(`${k.h2s('ar-h', 'Around the league')}${meta(count, 'margin-left: auto')}<span style="width: 100%; margin-left: -10px">${k.link(tail, tailAria)}</span>`, { phone: true })}
<div role="region" aria-label="Around the league matchups" tabindex="0" style="display: flex; gap: 12px; overflow-x: auto; padding: 14px; scroll-snap-type: x mandatory">${tiles.map(t => `<div style="flex: none; width: ${tileW}px; scroll-snap-align: start">${t}</div>`).join('')}<div style="flex: none; width: 200px; scroll-snap-align: start">${k.aroundMore(moreLabel, moreAria)}</div></div></section>`;
}

// ---- activity, phone (folded to 3 rows on the phone boards) ----
function activityPhone(rows) {
  const r = rows.slice(0, 3);
  return `<section aria-labelledby="ac-h" style="${k.FRAME2}; min-width: 0">${frameHead(`<h2 id="ac-h" style="margin: 0; ${px(16)}">Recent activity</h2>${meta(r.length + ' moves')}<span style="margin-left: auto">${k.link('All activity', 'All league activity')}</span>`, { phone: true })}
<ul style="list-style: none; margin: 0; padding: 4px 14px 8px">${r.map(([kind, team, text, time], i) => k.activityRow({ kind, team, text, time, last: i === r.length - 1, phone: true })).join('')}</ul></section>`;
}

// ---- playbook, phone: single column of groups, tighter padding ----
const playbookLink = (groups, awards, phone = false) => { const names = groups.flatMap(g => g.tiles.map(t => t.label)); return `<a href="#" aria-label="Playbook: ${names.join(', ')}. Trophy case, ${awards} awards this season" style="${k.FRAME2}; display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 44px; padding: 8px ${phone ? 14 : 20}px; box-sizing: border-box; color: inherit; font-size: 15px; font-weight: 600; text-decoration: none"><span>${[ 'Playbook', ...names, `Trophy case (${awards})` ].join(' · ')}</span>${k.arrow()}</a>`; };

// Drop what the page already links: Trades and Waivers (My team), Game Center (Around the league), Activity (Recent activity), Set Lineup (a play when incomplete, else My team's Lineup link), Pick'em (a play).
const PLAYBOOK_MAIN = [
  { name: 'League', tiles: [{ kind: 'rankings', label: 'Power Rankings', status: 'See where your team stacks up' }, { kind: 'history', label: 'History', status: 'Past seasons and champions' }, { kind: 'rules', label: 'League Rules', status: 'Scoring and roster settings' }] },
];
const PLAYBOOK_LIVE = PLAYBOOK_MAIN;

const INVITE = k.inviteButton();

// Pick'em panel (fantasy + pick'em leagues): the product's pick'em standings viewer strip plus the Picks link. 2px tier.
const PICKEM_PRE = { rank: 'T-3', points: '94', wk: '0 of 14 made', behind: '11 pts' };
const PICKEM_LIVE = { rank: 'T-3', points: '94', wk: '9 of 14 made', behind: '11 pts' };
function pickemPanel({ rank, points, wk, behind }, phone = false, box = false) {
  const stat = ([l, v]) => `<div style="display: flex; flex-direction: column; gap: 2px; min-width: 0"><span style="font-size: 13px; color: {{t.dim}}">${l}</span>${l === 'Your rank' || l === 'Points' ? `<span style="${px(24)}; line-height: 1.3; white-space: nowrap">${v}</span>` : `<span style="font-size: 16px; font-weight: 600; white-space: nowrap">${v}</span>`}</div>`;
  const stats = [['Your rank', rank], ['Points', points], ['Wk 7', wk], ['Behind leader', behind]].map(stat).join('');
  const a = k.link('Picks', "Pick'em picks, Week 7");
  if (box) return `<section aria-labelledby="pk-h" style="${k.FRAME2}; min-width: 0">${frameHead(`${k.h2s('pk-h', "Pick'em")}<span style="margin-left: auto">${a}</span>`)}<div style="padding: 14px 20px; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px">${stats}</div></section>`;
  return phone
    ? `<section aria-labelledby="pk-h" style="${k.FRAME2}; min-width: 0">${frameHead(`${k.h2s('pk-h', "Pick'em")}<span style="margin-left: auto">${a}</span>`, { phone: true })}<div style="padding: 12px 14px; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px">${stats}</div></section>`
    : `<section aria-labelledby="pk-h" style="${k.FRAME2}; display: flex; flex-wrap: wrap; align-items: center; gap: 12px 40px; padding: 8px 20px; min-width: 0">${k.h2s('pk-h', "Pick'em")}<div style="display: flex; flex-wrap: wrap; flex: 1; gap: 8px 40px; min-width: 0">${stats}</div>${a}</section>`;
}

// Commissioner strip: facts are desktop only; Advance week and the League administration link stay on a phone.
const commissionerFrame = (phone = false, invite = false) => k.commissioner({
  phone,
  facts: [['Transactions', 'Open'], ['Teams locked', '9 of 12'], ['Trade deadline', 'Week 10'], ['Waivers', 'FAAB · 48h'], ['Trade review', '24h']],
  items: [
    ...(invite ? [{ text: 'Invite code', note: 'Copy the invite link for new teams', action: k.inviteButton() }] : []),
    { text: 'Advance week', note: '<span id="adv-why">Opens when every Week 7 game is final</span>', action: k.btnDisabled('Advance to Week 8').replace('<button', '<button aria-describedby="adv-why"') },
    { action: k.link('League administration', 'Open league administration') },
  ],
});

// My team, desktop and phone: the first five starters of the shared fixture. Pre-kickoff the next lock is the first starter kickoff; on game day (2:40 PM) it is the next one.
const MT_ROWS = D.STARTERS.slice(0, 5).map(s => ({ slot: s.slot.split(' ')[0], name: s.name, inj: { Questionable: 'Q', Out: 'O' }[s.inj], game: D.ME.find(r => r[1] === s.name)[3], proj: s.proj, pts: D.ME.find(r => r[1] === s.name)[5] }));
const MT_REST = D.STARTERS.slice(5), MT_EMPTY = MT_REST.filter(s => s.empty).length;
const MYTEAM = {
  name: 'Darkness Falls', record: '4-2', rankLine: '3rd of 12', pf: '664.5', pa: '603.1', starters: MT_ROWS,
  more: `and ${MT_REST.length - MT_EMPTY} more starters${MT_EMPTY ? ` · ${D.plural(MT_EMPTY, 'empty slot')}` : ''}`,
};
const MT_STATUS = D.EMPTY ? 'Lineup incomplete' : 'Lineup set';
const MYTEAM_PRE = { ...MYTEAM, nextLock: 'Sun ' + D.FIRST_LOCK, lockNote: 'First kickoff of Week 7', status: MT_STATUS };
const MYTEAM_LIVE = { ...MYTEAM, live: true, nextLock: 'Sun ' + D.NEXT_LOCK, lockNote: 'Next kickoff of Week 7', status: MT_STATUS };
const myTeamPhone = o => k.myTeam({ ...o, phone: true }).replace(/padding: 20px; display: flex; flex-direction: column; gap: 16px/, 'padding: 14px; display: flex; flex-direction: column; gap: 16px').replace(/padding: 14px 20px/, 'padding: 12px 14px');

// The live versus screen: per side the live score, Expected final and PMR (the dashboard does not poll, so no "updated" line). Figures come from the shared fixture.
const T = D.LIVE_TOTALS, youLeads = T.lead >= 0, margin = D.f1(Math.abs(T.lead));
const LIVE_VS = {
  you: { name: 'Darkness Falls', fig: D.f1(T.meNow), expected: D.f1(T.meExp), note: `${D.plural(T.meLeft, 'player')} remaining` }, opp: { name: 'Sunday Scaries', fig: D.f1(T.oppNow), expected: D.f1(T.oppExp), note: `${D.plural(T.oppLeft, 'player')} remaining` },
  youLeads, margin: youLeads ? `Up ${margin}` : `Down ${margin}`, pct: T.pct, updated: 'As of 2:40 PM', sentence: `Darkness Falls ${D.f1(T.meNow)}, Sunday Scaries ${D.f1(T.oppNow)}, as of 2:40 PM`,
  aria: `${LG} matchup: Darkness Falls ${youLeads ? 'lead' : 'trail'} Sunday Scaries ${D.f1(T.meNow)} to ${D.f1(T.oppNow)}, expected final ${D.f1(T.meExp)} to ${D.f1(T.oppExp)}, ${T.pct}% Darkness Falls win probability. PMR, players remaining: ${T.meLeft} for Darkness Falls and ${T.oppLeft} for Sunday Scaries`,
};
// The pre-kickoff versus panel (Main, MainPhone): projected totals of the same fixture.
const S = D.SUMMARY, behind = S.trail > 0;
const VERSUS_PRE = {
  you: { name: 'Darkness Falls', fig: D.f1(S.meProj) }, opp: { name: 'Sunday Scaries', fig: D.f1(S.oppProj) }, pct: S.pct,
  margin: behind ? `Sunday Scaries by ${D.f1(S.trail)}` : `Darkness Falls by ${D.f1(-S.trail)}`,
};

function yourMove(cards, { phone = false, badge = true } = {}) {
  const lead = cards.find(c => c.lead), rest = cards.filter(c => c !== lead);
  const ph = { phone };
  const head = k.frameHead(`${k.h2('move-h', 'Your move', ph)}${badge ? k.badge(cards.length, 'plays') : ''}${k.meta('Earliest lock first', phone ? 'width: 100%' : 'margin-left: auto')}`, ph);
  const body = phone
    ? `<div style="display: grid; grid-template-columns: minmax(0, 1fr); gap: 8px; padding: 8px">${k.playCard({ ...lead, phone: true })}${rest.map(c => k.playCard({ ...c, phone: true, compact: true })).join('')}</div>`
    : `<div style="display: grid; grid-template-columns: minmax(0, 2fr) minmax(0, 1fr); gap: 8px; padding: 12px; align-items: start">${k.playCard({ ...lead, wide: true })}<div style="display: flex; flex-direction: column; gap: 8px">${rest.map(c => k.playCard({ ...c, compact: true })).join('')}</div></div>`;
  return `<section aria-labelledby="move-h" style="${FRAME}">${head}${body}</section>`;
}
// Activity feed at a later fixture clock (minutes after midnight).
const feedAt = clockMin => FEED_RAW.map(r => [r[0], r[1], r[2], ago(r[3] + clockMin - D.CLOCK.mainMin)]);

module.exports = { yourMove, feedAt, PICKEM_PRE, PICKEM_LIVE, playbookLink, pickemPanel, D, VERSUS_PRE, FEED_LIVE, MYTEAM_PRE, MYTEAM_LIVE, myTeamPhone, LIVE_VS, k, LG, TEAMS, standingsData, FEED, AWARDS, RECAP, SHARED_MAIN, SHARED_LIVE, WAIVERS, phoneize, versusPanelPhone, versusLivePhone, recapPhone, boardTile, AROUND_LIVE, standingsPhone, aroundPhone, activityPhone, PLAYBOOK_MAIN, PLAYBOOK_LIVE, INVITE, commissionerFrame };
