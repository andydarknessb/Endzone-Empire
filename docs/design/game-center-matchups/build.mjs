// Generates the .dc.html artboards for the Game Center / Matchup canvas.
// Run: node build.mjs   (writes Main.dc.html + siblings beside this file)
// Every artboard is self-contained (artboards share nothing at runtime), so
// the shared CSS below is inlined into each one.
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Tokens: lifted from src/theme/tokens.js (dash-* group, both modes) and
// scaleTokens. Values are literal here on purpose: the artboard has no theme
// provider, so the [data-theme] block below is the provider.
// ---------------------------------------------------------------------------
const CSS = (width) => `
[data-theme="dark"]{
  --bg:#0b1015; --surface:#141b23; --surface2:#1b242f; --surface3:#222e3b;
  --line:rgba(154,183,211,.12); --line-strong:rgba(154,183,211,.22);
  --ink:#e8eef4; --dim:#93a4b5; --faint:#8a9bad;
  --accent:#2fd97b; --accent-soft:rgba(47,217,123,.12); --accent-line:rgba(47,217,123,.35); --on-accent:#0b1015;
  --home:#7eaaff; --home-soft:rgba(126,170,255,.16); --away:#7ee2a8; --away-soft:rgba(126,226,168,.16);
  --danger:#ff6b6b; --danger-soft:rgba(255,107,107,.14); --warning:#f0b34e; --warning-soft:rgba(240,179,78,.14);
  --success:#7ee2a8; --success-soft:rgba(126,226,168,.14);
  --pos-qb:#ff8a80; --pos-rb:#7ee2a8; --pos-wr:#7fb0ff; --pos-te:#f0b34e; --pos-k:#c4a2f5; --pos-def:#b0bec5; --pos-flex:#93a4b5; --on-pos:#0f1419;
  --led:#ffb547; --led-dim:rgba(255,181,71,.28); --board:#07090c;
  --shadow-1:0 1px 2px rgba(0,0,0,.45); --shadow-2:0 6px 16px rgba(0,0,0,.5);
}
[data-theme="light"]{
  --bg:#eef2f6; --surface:#ffffff; --surface2:#f4f7fa; --surface3:#e6ecf2;
  --line:rgba(31,45,58,.12); --line-strong:rgba(31,45,58,.22);
  --ink:#141b23; --dim:#55636f; --faint:#5e6a74;
  --accent:#0f6a41; --accent-soft:rgba(15,106,65,.12); --accent-line:rgba(15,106,65,.32); --on-accent:#ffffff;
  --home:#1e5bb8; --home-soft:rgba(30,91,184,.10); --away:#1b7d4f; --away-soft:rgba(27,125,79,.12);
  --danger:#c62828; --danger-soft:rgba(198,40,40,.10); --warning:#8a5a00; --warning-soft:rgba(138,90,0,.12);
  --success:#1b7d4f; --success-soft:rgba(27,125,79,.12);
  --pos-qb:#c62828; --pos-rb:#15663f; --pos-wr:#1e5bb8; --pos-te:#9a5100; --pos-k:#6d28d9; --pos-def:#4b5c66; --pos-flex:#586472; --on-pos:#ffffff;
  --led:#ffb547; --led-dim:rgba(255,181,71,.28); --board:#0b1015;
  --shadow-1:0 1px 2px rgba(16,24,32,.08); --shadow-2:0 4px 12px rgba(16,24,32,.10);
}
*{box-sizing:border-box}
body{margin:0}
a{color:var(--accent);text-decoration:none}
a:hover{color:var(--accent);text-decoration:underline}
.root{width:${width}px;min-height:100%;overflow-x:hidden;background:var(--bg);color:var(--ink);font-family:"Archivo","Helvetica Neue",Arial,sans-serif;font-size:14px;line-height:1.45;-webkit-font-smoothing:antialiased}
.display{font-family:"Barlow Condensed",Impact,sans-serif}
.num{font-variant-numeric:tabular-nums}
.led{font-family:"Press Start 2P","Courier New",monospace}
.card{background:var(--surface);border:1px solid var(--line);border-radius:14px}
.tile{background:var(--surface2);border:1px solid var(--line);border-radius:10px}
.chip{display:inline-flex;align-items:center;gap:6px;height:22px;padding:0 9px;border-radius:999px;font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;border:1px solid var(--line);background:var(--surface2);color:var(--dim);white-space:nowrap}
.chip.live{background:var(--danger-soft);color:var(--danger);border-color:var(--danger)}
.chip.final{background:var(--success-soft);color:var(--success);border-color:var(--success)}
.chip.you{background:var(--accent-soft);color:var(--accent);border-color:var(--accent-line);font-size:10.5px;letter-spacing:.08em}
.chip.warn{background:var(--warning-soft);color:var(--warning);border-color:var(--warning)}
.dot{width:8px;height:8px;border-radius:999px;background:currentColor;flex:none}
.pos{display:inline-flex;align-items:center;justify-content:center;min-width:34px;height:20px;padding:0 6px;border-radius:6px;font-size:10.5px;font-weight:700;letter-spacing:.06em;color:var(--on-pos)}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;height:38px;padding:0 16px;border-radius:9px;font-size:13px;font-weight:600;border:1px solid var(--line-strong);color:var(--dim);background:transparent;white-space:nowrap}
.btn.primary{background:var(--accent);border-color:var(--accent);color:var(--on-accent)}
.btn.icon{width:38px;padding:0}
.seg{display:inline-flex;background:var(--surface2);border:1px solid var(--line);border-radius:9px;padding:3px;gap:2px}
.seg > div{height:30px;padding:0 14px;border-radius:7px;display:flex;align-items:center;font-size:13px;font-weight:600;color:var(--dim)}
.seg > div.on{background:var(--surface);color:var(--ink);box-shadow:var(--shadow-1)}
.label{font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--faint)}
.hair{height:1px;background:var(--line)}
.avatar{display:flex;align-items:center;justify-content:center;border-radius:999px;background:var(--surface3);color:var(--ink);font-weight:700;flex:none}
.pace{height:5px;border-radius:3px;background:var(--surface3);overflow:hidden}
.pace > div{height:100%;border-radius:3px}
.split{display:flex;height:8px;border-radius:999px;overflow:hidden;background:var(--surface3)}
.row{display:flex;align-items:center}
.stack{display:flex;flex-direction:column}
.grow{flex:1 1 0;min-width:0}
.ellip{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.note{font-size:12px;color:var(--faint)}
svg{display:block}
`;

const HEAD = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600;700&amp;family=Archivo:wght@400;500;600;700&amp;family=Press+Start+2P&amp;display=swap">
  <style>
`;

const SCRIPT = (w, h) => `
<script data-dc-script data-props='{"theme":{"editor":"enum","options":["dark","light"],"default":"dark","section":"Theme"},"$preview":{"width":${w},"height":${h}}}'>
class Component extends DCLogic {
  renderVals() {
    return { theme: this.props.theme === 'light' ? 'light' : 'dark' };
  }
}
</script>
</body>
</html>
`;

function page({ width, height, body }) {
  return `${HEAD}${CSS(width)}  </style>
</helmet>
<div class="root" data-theme="{{theme}}" style="width: ${width}px; min-height: ${height}px; background: var(--bg); color: var(--ink);">
${body}
</div>
</x-dc>${SCRIPT(width, height)}`;
}

// ---------------------------------------------------------------------------
// Icons: inline stroke SVG on a 20px grid, one style.
// ---------------------------------------------------------------------------
const icon = (name, size = 18, color = 'currentColor') => {
  const paths = {
    chevL: '<path d="M12.5 4.5 7 10l5.5 5.5"/>',
    chevR: '<path d="M7.5 4.5 13 10l-5.5 5.5"/>',
    chevD: '<path d="M5 7.5 10 12.5 15 7.5"/>',
    chevU: '<path d="M5 12.5 10 7.5l5 5"/>',
    check: '<path d="M4 10.5 8 14.5 16 6"/>',
    clock: '<circle cx="10" cy="10" r="7"/><path d="M10 6v4l3 2"/>',
    bolt: '<path d="M11 2 4 11h5l-1 7 7-9h-5z"/>',
    swap: '<path d="M4 7h11m0 0-3-3m3 3-3 3M16 13H5m0 0 3-3m-3 3 3 3"/>',
    field: '<rect x="2.5" y="4.5" width="15" height="11" rx="1.5"/><path d="M10 4.5v11M6 4.5v11M14 4.5v11"/>',
    list: '<path d="M4 6h12M4 10h12M4 14h12"/>',
    info: '<circle cx="10" cy="10" r="7"/><path d="M10 9v5M10 6.5v.5"/>',
    sync: '<path d="M16 8A6.5 6.5 0 0 0 4.5 6.5M4 12a6.5 6.5 0 0 0 11.5 1.5"/><path d="M16 3v5h-5M4 17v-5h5"/>',
    menu: '<path d="M3 6h14M3 10h14M3 14h14"/>',
    search: '<circle cx="9" cy="9" r="5.5"/><path d="m13 13 4 4"/>',
    bell: '<path d="M5 14V9a5 5 0 0 1 10 0v5l1.5 2h-13z"/><path d="M8.5 17.5a1.5 1.5 0 0 0 3 0"/>',
    football: '<path d="M4 16c3-9 7-12 12-12 0 5-3 9-12 12z"/><path d="m8 12 4-4M9 13l1-1M11 9l1-1"/>',
    lock: '<rect x="5" y="9" width="10" height="8" rx="1.5"/><path d="M7 9V6.5a3 3 0 0 1 6 0V9"/>',
  };
  return `<svg width="${size}" height="${size}" viewBox="0 0 20 20" fill="none" stroke="${color}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]}</svg>`;
};

// ---------------------------------------------------------------------------
// Sample data (marked as sample at handover). One live Sunday afternoon in
// Week 3. Every number a surface shows is derived from this block so the
// hero, the grid and the detail agree.
// ---------------------------------------------------------------------------
const T = {
  dock: { name: 'Duluth Dockworkers', abbr: 'DD', rec: '2-0', color: 'var(--home)' },
  frost: { name: 'Fargo Frostbite', abbr: 'FF', rec: '1-1', color: 'var(--away)' },
  bliz: { name: 'Bemidji Blizzard', abbr: 'BB', rec: '2-0' },
  mav: { name: 'Mankato Mavericks', abbr: 'MM', rec: '1-1' },
  rail: { name: 'Rochester Rail Kings', abbr: 'RK', rec: '0-2' },
  sent: { name: 'St. Cloud Sentinels', abbr: 'SC', rec: '1-1' },
  hawk: { name: 'Hibbing Hawks', abbr: 'HH', rec: '2-0' },
  bru: { name: 'Brainerd Bruisers', abbr: 'BR', rec: '0-2' },
  wolf: { name: 'Winona Wolfpack', abbr: 'WW', rec: '1-1' },
  mon: { name: 'Moorhead Monarchs', abbr: 'MO', rec: '1-1' },
};

const HERO = {
  home: { t: T.dock, score: '82.2', ef: '110.5', pmr: 4, wp: 36 },
  away: { t: T.frost, score: '77.0', ef: '123.9', pmr: 6, wp: 64 },
  status: 'live',
};

const GRID = [
  { home: { t: T.bliz, score: '92.1', ef: '118.0', pmr: 2 }, away: { t: T.mav, score: '88.7', ef: '119.4', pmr: 3 }, status: 'live', wp: 49 },
  { home: { t: T.rail, score: '55.2', ef: '96.8', pmr: 3 }, away: { t: T.sent, score: '71.0', ef: '112.3', pmr: 4 }, status: 'live', wp: 21 },
  { home: { t: T.wolf, score: '101.3', ef: null, pmr: 0 }, away: { t: T.mon, score: '97.6', ef: null, pmr: 0 }, status: 'played', wp: 58 },
  { home: { t: T.hawk, score: '0.0', ef: '108.3', pmr: 9 }, away: { t: T.bru, score: '0.0', ef: '111.9', pmr: 9 }, status: 'scheduled', wp: null, kickoff: 'Sun 7:20 PM' },
];

const FEED = [
  { at: '3:41 PM', who: 'J. Jefferson', nfl: 'MIN', play: '34-yd receiving TD', pts: '+10.4', team: T.frost, side: 'away' },
  { at: '3:37 PM', who: 'A. Jones', nfl: 'GB', play: '3-yd rushing TD', pts: '+9.3', team: T.dock, side: 'home' },
  { at: '3:29 PM', who: 'T. Kelce', nfl: 'KC', play: '12-yd receiving TD', pts: '+7.2', team: T.dock, side: 'home' },
  { at: '3:14 PM', who: 'C. Lamb', nfl: 'DAL', play: '21-yd receiving TD', pts: '+8.1', team: T.bliz, side: null },
  { at: '2:58 PM', who: 'B. Robinson', nfl: 'ATL', play: '2-yd rushing TD', pts: '+6.2', team: T.mav, side: null },
  { at: '2:44 PM', who: 'J. Allen', nfl: 'BUF', play: '9-yd rushing TD', pts: '+6.9', team: T.frost, side: 'away' },
];

// Starters, paired by slot in the league's slot order. `st` is the per-player
// game state the mockup proposes adding to the detail row (see the FSD note).
const ROWS = [
  { slot: 'QB', pos: 'qb', home: { n: 'J. Goff', nfl: 'DET', vs: 'vs CHI', pts: 18.6, proj: 19.2, st: 'final', line: '289 pass yds · 2 pass TD · 1 INT' }, away: { n: 'J. Allen', nfl: 'BUF', vs: 'vs MIA', pts: 24.1, proj: 22.5, st: 'final' } },
  { slot: 'RB', pos: 'rb', home: { n: 'A. Jones', nfl: 'GB', vs: '@ TB', pts: 14.3, proj: 13.8, st: 'live', game: 'Q3 6:42' }, away: { n: 'S. Barkley', nfl: 'PHI', vs: '@ NO', pts: 4.8, proj: 16.4, st: 'live', game: 'Q3 11:20' } },
  { slot: 'RB', pos: 'rb', home: { n: 'J. Gibbs', nfl: 'DET', vs: 'vs CHI', pts: 11.2, proj: 15.1, st: 'final' }, away: { n: 'D. Henry', nfl: 'BAL', vs: '@ CLE', pts: 12.6, proj: 14.0, st: 'final' } },
  { slot: 'WR', pos: 'wr', home: { n: 'A. St. Brown', nfl: 'DET', vs: 'vs CHI', pts: 16.4, proj: 16.0, st: 'final' }, away: { n: 'J. Jefferson', nfl: 'MIN', vs: 'vs SF', pts: 21.4, proj: 15.6, st: 'live', game: 'Q4 3:15', flash: true } },
  { slot: 'WR', pos: 'wr', home: { n: 'D. Adams', nfl: 'NYJ', vs: 'vs CIN', pts: 0.0, proj: 14.2, st: 'sched', game: 'Sun 7:20 PM' }, away: { n: 'N. Collins', nfl: 'HOU', vs: '@ LAR', pts: 0.0, proj: 13.1, st: 'sched', game: 'Mon 7:15 PM' } },
  { slot: 'TE', pos: 'te', home: { n: 'T. Kelce', nfl: 'KC', vs: 'vs LAC', pts: 9.7, proj: 11.0, st: 'live', game: 'Q2 1:05' }, away: { n: 'S. LaPorta', nfl: 'DET', vs: 'vs CHI', pts: 5.1, proj: 9.2, st: 'final' } },
  { slot: 'FLEX', pos: 'flex', home: { n: 'C. Kupp', nfl: 'LAR', vs: 'vs HOU', pts: 0.0, proj: 12.8, st: 'sched', game: 'Mon 7:15 PM' }, away: { n: 'J. Chase', nfl: 'CIN', vs: '@ NYJ', pts: 0.0, proj: 15.8, st: 'sched', game: 'Sun 7:20 PM' } },
  { slot: 'K', pos: 'k', home: { n: 'J. Tucker', nfl: 'BAL', vs: '@ CLE', pts: 8.0, proj: 8.5, st: 'final' }, away: { n: 'B. Aubrey', nfl: 'DAL', vs: '@ ARI', pts: 6.0, proj: 8.9, st: 'live', game: 'Q3 0:48' } },
  { slot: 'D/ST', pos: 'def', home: { n: 'Ravens D/ST', nfl: 'BAL', vs: '@ CLE', pts: 4.0, proj: 7.1, st: 'final' }, away: { n: '49ers D/ST', nfl: 'SF', vs: '@ MIN', pts: 3.0, proj: 6.5, st: 'live', game: 'Q4 3:15' } },
];

const NFL = [
  { a: 'GB', as: 17, b: 'TB', bs: 20, clock: 'Q3 6:42', live: true },
  { a: 'KC', as: 21, b: 'LAC', bs: 14, clock: 'Q2 1:05', live: true },
  { a: 'PHI', as: 10, b: 'NO', bs: 13, clock: 'Q3 11:20', live: true },
  { a: 'MIN', as: 27, b: 'SF', bs: 24, clock: 'Q4 3:15', live: true },
  { a: 'DAL', as: 16, b: 'ARI', bs: 9, clock: 'Q3 0:48', live: true },
  { a: 'CIN', as: null, b: 'NYJ', bs: null, clock: '7:20 PM', live: false },
];

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------
const avatar = (t, size, ring) => `<div class="avatar display" style="width: ${size}px; height: ${size}px; font-size: ${Math.round(size * 0.38)}px; ${ring ? `box-shadow: 0 0 0 2px var(--bg), 0 0 0 4px ${ring};` : ''}">${t.abbr}</div>`;

const statusChip = (s) => ({
  live: '<span class="chip live"><span class="dot"></span>Live</span>',
  final: '<span class="chip final">Final</span>',
  played: '<span class="chip warn">Awaiting final</span>',
  scheduled: '<span class="chip">Scheduled</span>',
}[s] || '');

const splitBar = (homePct, h = 8) => `<div class="split" role="img" aria-label="Win probability" style="height: ${h}px;">
  <div style="width: ${homePct}%; background: var(--home);"></div>
  <div style="width: ${100 - homePct}%; background: var(--away);"></div>
</div>`;

const posChip = (pos, label) => `<span class="pos" style="background: var(--pos-${pos});">${label}</span>`;

const stateDot = (st) => ({
  live: '<span class="dot" style="color: var(--danger);"></span>',
  final: `<span style="color: var(--faint); display: flex;">${icon('check', 14)}</span>`,
  sched: `<span style="color: var(--faint); display: flex;">${icon('clock', 14)}</span>`,
}[st]);

const paceBar = (pts, proj, w = 100) => {
  const ratio = proj > 0 ? Math.max(0, Math.min(1, pts / proj)) : 0;
  const ahead = pts >= proj && proj > 0;
  return `<div class="pace" style="width: ${w}px;"><div style="width: ${Math.round(ratio * 100)}%; background: ${ahead ? 'var(--success)' : 'var(--home)'};"></div></div>`;
};

// App bar: matches Nav.jsx (MUI AppBar on surface-raised, hairline bottom).
const appBar = (mobile) => `
<div class="row" style="height: 56px; padding: 0 ${mobile ? 12 : 24}px; gap: ${mobile ? 10 : 24}px; background: var(--surface); border-bottom: 1px solid var(--line);">
  ${mobile ? `<div style="color: var(--dim); display: flex;">${icon('menu', 22)}</div>` : ''}
  <div class="row display" style="gap: 10px; font-size: 22px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase;">
    <div style="width: 26px; height: 26px; border-radius: 7px; background: var(--accent); color: var(--on-accent); display: flex; align-items: center; justify-content: center;">${icon('football', 16, 'currentColor')}</div>
    <span>Endzone Empire</span>
  </div>
  ${mobile ? '' : `<div class="row" style="gap: 4px; margin-left: 8px;">
    ${['Dashboard', 'Lineup', 'Game Center', 'Players', 'Waivers', 'Trades'].map((l, i) => `<div style="padding: 8px 12px; border-radius: 8px; font-size: 14px; font-weight: 500; color: ${i === 2 ? 'var(--accent)' : 'var(--dim)'}; background: ${i === 2 ? 'var(--accent-soft)' : 'transparent'};">${l}</div>`).join('')}
  </div>`}
  <div class="grow"></div>
  <div class="row" style="gap: 6px; color: var(--dim);">
    <div class="btn icon" style="border: 0;">${icon('search', 20)}</div>
    <div class="btn icon" style="border: 0;">${icon('bell', 20)}</div>
    <div class="avatar" style="width: 32px; height: 32px; font-size: 12px; background: var(--home-soft); color: var(--home);">CA</div>
  </div>
</div>`;

const breadcrumb = () => `<div class="row" style="gap: 8px; font-size: 13px; color: var(--faint);">
  <span>Leagues</span><span>/</span><span>Northwoods League</span><span>/</span><span style="color: var(--dim);">Game Center</span>
</div>`;

const weekStepper = (full) => `<div class="row" style="gap: 6px; ${full ? 'width: 100%;' : ''}">
  <div class="btn icon" aria-label="Previous week">${icon('chevL')}</div>
  <div class="seg" style="${full ? 'flex: 1 1 0;' : ''}">
    ${['Wk 1', 'Wk 2', 'Wk 3', 'Wk 4'].map((w, i) => `<div class="${i === 2 ? 'on' : ''}" style="${full ? 'flex: 1 1 0; justify-content: center; padding: 0;' : ''}">${w}</div>`).join('')}
  </div>
  <div class="btn icon" aria-label="Next week">${icon('chevR')}</div>
</div>`;

const syncLine = () => `<div class="row" style="gap: 6px; font-size: 12px; color: var(--faint);">${icon('sync', 14)}<span>Scores synced 3:42 PM · next pass in 8 min</span></div>`;

const tickerStrip = (mobile) => `
<div class="card row" style="gap: 12px; padding: 8px 12px; overflow: hidden; border-color: var(--danger-soft);">
  <span class="chip live" style="flex: none;"><span class="dot"></span>Live</span>
  <div class="row grow" style="gap: 20px; white-space: nowrap; overflow: hidden;">
    ${FEED.slice(0, mobile ? 1 : 4).map((f) => `<div class="row" style="gap: 8px; font-size: 13px;">
      <span style="font-weight: 600;">${f.who}</span><span style="color: var(--faint);">${f.nfl}</span>
      <span style="color: var(--dim);">${f.play}</span>
      <span class="num" style="font-weight: 700; color: var(--success);">${f.pts}</span>
      <span style="color: var(--faint);">to ${f.team.name}</span>
    </div>`).join('')}
  </div>
  ${mobile ? '' : `<div class="row" style="gap: 4px; font-size: 12px; color: var(--faint); flex: none;">${icon('list', 14)}<span>6 plays this hour</span></div>`}
</div>`;

// Hero card: the viewer's matchup. Same numbers as the Matchup Detail artboard.
const heroSide = (s, align, size) => `
<div class="stack" style="align-items: ${align === 'right' ? 'flex-end' : 'flex-start'}; gap: 8px; min-width: 0; text-align: ${align};">
  <div class="row" style="gap: 12px; flex-direction: ${align === 'right' ? 'row-reverse' : 'row'};">
    ${avatar(s.t, size, s.t.color)}
    <div class="stack" style="min-width: 0; align-items: ${align === 'right' ? 'flex-end' : 'flex-start'};">
      <div class="row" style="gap: 8px;"><span class="display ellip" style="font-size: 22px; font-weight: 700; letter-spacing: .02em; line-height: 1.1;">${s.t.name}</span>${s.you ? '<span class="chip you">You</span>' : ''}</div>
      <span class="note num">${s.t.rec} · ${s.you ? '3rd' : '5th'} in league</span>
    </div>
  </div>
  <div class="display num" style="font-size: 56px; font-weight: 700; line-height: 1; letter-spacing: .01em;">${s.score}</div>
  <div class="row" style="gap: 8px;">
    <div class="tile stack" style="padding: 6px 10px; min-width: 88px;"><span class="label">Expected final</span><span class="num" style="font-size: 16px; font-weight: 600;">${s.ef}</span></div>
    <div class="tile stack" style="padding: 6px 10px; min-width: 64px;"><span class="label">PMR</span><span class="num" style="font-size: 16px; font-weight: 600;">${s.pmr}</span></div>
  </div>
</div>`;

const heroCard = () => `
<div class="card" style="padding: 20px 24px 16px;">
  <div class="row" style="justify-content: space-between; margin-bottom: 14px;">
    <div class="row" style="gap: 10px;"><span class="display" style="font-size: 17px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase;">Your matchup</span><span class="note">Week 3</span></div>
    ${statusChip(HERO.status)}
  </div>
  <div style="display: grid; grid-template-columns: minmax(0, 1fr) 220px minmax(0, 1fr); gap: 24px; align-items: center;">
    ${heroSide({ ...HERO.home, you: true }, 'left', 64)}
    <div class="stack" style="gap: 10px; align-items: center;">
      <span class="label">Win probability</span>
      <div class="row num" style="gap: 12px; font-size: 22px; font-weight: 700;">
        <span style="color: var(--home);">${HERO.home.wp}%</span><span style="color: var(--faint); font-size: 14px; font-weight: 500;">vs</span><span style="color: var(--away);">${HERO.away.wp}%</span>
      </div>
      <div style="width: 100%;">${splitBar(HERO.home.wp, 10)}</div>
      <span class="note" style="text-align: center;">Ahead now, projected to trail by 13.4 with 6 of theirs still to play</span>
    </div>
    ${heroSide(HERO.away, 'right', 64)}
  </div>
  <div class="hair" style="margin: 16px 0 12px;"></div>
  <div class="row" style="justify-content: space-between;">
    <div class="row" style="gap: 14px; font-size: 13px; color: var(--dim);">
      <span class="row" style="gap: 6px;"><span class="dot" style="color: var(--danger);"></span>5 games in progress</span>
      <span class="row" style="gap: 6px;">${icon('clock', 14)}Next kickoff Sun 7:20 PM</span>
    </div>
    <div class="row" style="gap: 10px;">
      <div class="btn">Compare rosters</div>
      <div class="btn primary">Set lineup</div>
    </div>
  </div>
</div>`;

const heroCardMobile = () => `
<div class="card" style="padding: 16px 14px 12px;">
  <div class="row" style="justify-content: space-between; margin-bottom: 12px;">
    <div class="row" style="gap: 8px;"><span class="display" style="font-size: 16px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase;">Your matchup</span><span class="note">Week 3</span></div>
    ${statusChip(HERO.status)}
  </div>
  ${[{ s: { ...HERO.home, you: true } }, { s: HERO.away }].map(({ s }) => `
  <div class="row" style="gap: 12px; padding: 8px 0;">
    ${avatar(s.t, 44, s.t.color)}
    <div class="stack grow" style="min-width: 0;">
      <div class="row" style="gap: 6px;"><span class="display ellip" style="font-size: 18px; font-weight: 700; line-height: 1.1;">${s.t.name}</span>${s.you ? '<span class="chip you">You</span>' : ''}</div>
      <span class="note num">${s.t.rec} · EF ${s.ef} · PMR ${s.pmr}</span>
    </div>
    <div class="display num" style="font-size: 34px; font-weight: 700; line-height: 1;">${s.score}</div>
  </div>`).join('')}
  <div class="stack" style="gap: 6px; margin-top: 8px;">
    <div class="row num" style="justify-content: space-between; font-size: 13px; font-weight: 700;"><span style="color: var(--home);">${HERO.home.wp}%</span><span class="label">Win probability</span><span style="color: var(--away);">${HERO.away.wp}%</span></div>
    ${splitBar(HERO.home.wp, 8)}
    <span class="note">Ahead now, projected to trail by 13.4</span>
  </div>
  <div class="row" style="gap: 8px; margin-top: 14px;">
    <div class="btn grow">Compare rosters</div>
    <div class="btn primary grow">Set lineup</div>
  </div>
</div>`;

// League matchup card (desktop grid).
const matchupCard = (m) => {
  const started = m.status !== 'scheduled';
  const teamRow = (s, win) => `
  <div class="row" style="gap: 10px; padding: 6px 0;">
    ${avatar(s.t, 32)}
    <div class="stack grow" style="min-width: 0;">
      <span class="ellip" style="font-size: 14px; font-weight: ${win ? 700 : 500};">${s.t.name}</span>
      <span class="note num">${s.t.rec}${m.status === 'played' || m.status === 'final' ? '' : ` · EF ${s.ef} · PMR ${s.pmr}`}</span>
    </div>
    <div class="row" style="gap: 6px;">
      ${win && (m.status === 'played' || m.status === 'final') ? `<span style="color: var(--success); display: flex;">${icon('check', 16)}</span>` : ''}
      <span class="display num" style="font-size: 26px; font-weight: 700; line-height: 1; color: ${started ? 'var(--ink)' : 'var(--faint)'};">${started ? s.score : s.ef}</span>
    </div>
  </div>`;
  const hs = Number(m.home.score); const as = Number(m.away.score);
  return `
<div class="card" style="padding: 12px 16px 12px;">
  <div class="row" style="justify-content: space-between; margin-bottom: 4px;">
    <span class="note">${started ? 'Week 3' : `Kicks off ${m.kickoff}`}</span>${statusChip(m.status)}
  </div>
  ${teamRow(m.home, hs > as)}
  ${started ? `<div style="padding: 2px 0 6px;">${splitBar(m.wp, 5)}</div>` : '<div class="hair" style="margin: 2px 0 6px;"></div>'}
  ${teamRow(m.away, as > hs)}
  <div class="row" style="justify-content: space-between; margin-top: 8px; font-size: 12px; color: var(--faint);">
    <span class="num">${started ? (m.status === 'played' ? 'Waiting on the score of record' : `Win probability ${m.wp}% · ${100 - m.wp}%`) : 'Projected totals shown until kickoff'}</span>
    <span class="row" style="gap: 4px;">Details ${icon('chevR', 14)}</span>
  </div>
</div>`;
};

// Compact list row (mobile).
const matchupRowMobile = (m) => {
  const started = m.status !== 'scheduled';
  const hs = Number(m.home.score); const as = Number(m.away.score);
  const line = (s, win) => `
  <div class="row" style="gap: 10px; padding: 5px 0;">
    ${avatar(s.t, 28)}
    <div class="stack grow" style="min-width: 0;"><span class="ellip" style="font-size: 14px; font-weight: ${win ? 700 : 500};">${s.t.name}</span><span class="note num">${started ? `EF ${s.ef || '-'} · PMR ${s.pmr}` : `Proj ${s.ef}`}</span></div>
    <span class="display num" style="font-size: 24px; font-weight: 700; line-height: 1; color: ${started ? 'var(--ink)' : 'var(--faint)'};">${started ? s.score : ''}</span>
  </div>`;
  return `
<div class="card" style="padding: 10px 14px;">
  <div class="row" style="justify-content: space-between; margin-bottom: 2px;"><span class="note">${started ? 'Week 3' : `Kicks off ${m.kickoff}`}</span>${statusChip(m.status)}</div>
  ${line(m.home, hs > as)}
  ${started ? splitBar(m.wp, 4) : '<div class="hair"></div>'}
  ${line(m.away, as > hs)}
</div>`;
};

const feedCard = (limit, compact) => `
<div class="card">
  <div class="row" style="gap: 10px; padding: 14px 18px; border-bottom: 1px solid var(--line);">
    <span class="display" style="font-size: 17px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase;">Scoring feed</span><span class="note">Week 3</span>
    <div class="grow"></div><span class="note">TDs only</span>
  </div>
  <div class="stack">
    ${FEED.slice(0, limit).map((f, i) => `
    <div class="row" style="gap: 12px; padding: 10px 18px; ${i ? 'border-top: 1px solid var(--line);' : ''}">
      <span class="num note" style="width: 56px; flex: none;">${f.at}</span>
      <span class="dot" style="color: ${f.side === 'home' ? 'var(--home)' : f.side === 'away' ? 'var(--away)' : 'var(--faint)'};"></span>
      <div class="stack grow" style="min-width: 0;">
        <span class="ellip" style="font-size: 13px;"><strong>${f.who}</strong> · ${f.play}</span>
        <span class="note ellip">${f.nfl} · ${f.team.name}</span>
      </div>
      <span class="num" style="font-weight: 700; color: var(--success);">${f.pts}</span>
    </div>`).join('')}
  </div>
  ${compact ? '' : '<div class="row" style="justify-content: center; padding: 10px; border-top: 1px solid var(--line); font-size: 13px; color: var(--dim);">Show all 14 plays</div>'}
</div>`;

const weekGlance = () => `
<div class="card">
  <div class="row" style="gap: 10px; padding: 14px 18px; border-bottom: 1px solid var(--line);">
    <span class="display" style="font-size: 17px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase;">Week at a glance</span>
  </div>
  <div class="stack" style="padding: 8px 0;">
    ${[
      ['Top score', T.wolf.name, '101.3'],
      ['Closest', 'Blizzard · Mavericks', '3.4'],
      ['Biggest lead', 'Sentinels over Rail Kings', '15.8'],
      ['Still to play', 'Starters league-wide', '27'],
    ].map(([k, v, n]) => `<div class="row" style="gap: 12px; padding: 8px 18px;"><div class="stack grow" style="min-width: 0;"><span class="label">${k}</span><span class="ellip" style="font-size: 13px;">${v}</span></div><span class="display num" style="font-size: 22px; font-weight: 700;">${n}</span></div>`).join('')}
  </div>
</div>`;

// ---------------------------------------------------------------------------
// Artboard: Game Center desktop
// ---------------------------------------------------------------------------
const gameCenterDesktop = () => page({
  width: 1440,
  height: 1180,
  body: `
${appBar(false)}
<div style="max-width: 1200px; margin: 0 auto; padding: 24px 24px 40px;">
  <div class="stack" style="gap: 6px; margin-bottom: 18px;">
    ${breadcrumb()}
    <div class="row" style="justify-content: space-between; gap: 24px;">
      <div class="stack">
        <h1 class="display" style="margin: 0; font-size: 36px; font-weight: 700; letter-spacing: .02em; line-height: 1.05; text-transform: uppercase;">Game Center</h1>
        ${syncLine()}
      </div>
      <div class="row" style="gap: 12px;">${weekStepper(false)}<div class="btn">All weeks</div></div>
    </div>
  </div>
  <div style="margin-bottom: 18px;">${tickerStrip(false)}</div>
  <div style="display: grid; grid-template-columns: minmax(0, 1fr) 340px; gap: 20px; align-items: start;">
    <div class="stack" style="gap: 18px;">
      ${heroCard()}
      <div class="row" style="gap: 10px; margin-top: 4px;"><span class="display" style="font-size: 17px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase;">League matchups</span><span class="note">4 more</span><div class="grow"></div><div class="row" style="gap: 8px; font-size: 12px; color: var(--faint);"><span class="row" style="gap: 4px;"><span class="dot" style="color: var(--home);"></span>Home</span><span class="row" style="gap: 4px;"><span class="dot" style="color: var(--away);"></span>Away</span></div></div>
      <div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px;">
        ${GRID.map(matchupCard).join('')}
      </div>
    </div>
    <div class="stack" style="gap: 18px;">
      ${feedCard(6, false)}
      ${weekGlance()}
    </div>
  </div>
</div>`,
});

// ---------------------------------------------------------------------------
// Artboard: Game Center mobile (390)
// ---------------------------------------------------------------------------
const gameCenterMobile = () => page({
  width: 390,
  height: 1560,
  body: `
${appBar(true)}
<div class="stack" style="padding: 14px 14px 32px; gap: 14px;">
  <div class="stack" style="gap: 4px;">
    <span class="note">Northwoods League</span>
    <h1 class="display" style="margin: 0; font-size: 30px; font-weight: 700; line-height: 1.05; text-transform: uppercase;">Game Center</h1>
    ${syncLine()}
  </div>
  ${weekStepper(true)}
  ${tickerStrip(true)}
  ${heroCardMobile()}
  <div class="row" style="gap: 8px; margin-top: 4px;"><span class="display" style="font-size: 16px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase;">League matchups</span><span class="note">4 more</span></div>
  ${GRID.map(matchupRowMobile).join('')}
  ${feedCard(3, true)}
</div>`,
});

// ---------------------------------------------------------------------------
// Matchup Detail pieces
// ---------------------------------------------------------------------------
const detailHeader = (mobile, mode) => `
<div class="row" style="justify-content: space-between; gap: 12px; flex-wrap: wrap;">
  <div class="stack" style="gap: 4px;">
    <span class="note">Northwoods League · Game Center</span>
    <div class="row" style="gap: 10px;"><h1 class="display" style="margin: 0; font-size: ${mobile ? 28 : 34}px; font-weight: 700; line-height: 1.05; text-transform: uppercase;">Week 3 Matchup</h1>${statusChip('live')}</div>
  </div>
  <div class="row" style="gap: 10px; ${mobile ? 'width: 100%;' : ''}">
    <div class="seg" style="${mobile ? 'flex: 1 1 0;' : ''}">
      <div class="${mode === 'standard' ? 'on' : ''}" style="gap: 6px; ${mobile ? 'flex: 1 1 0; justify-content: center;' : ''}">${icon('list', 15)}Standard</div>
      <div class="${mode === 'scoreboard' ? 'on' : ''}" style="gap: 6px; ${mobile ? 'flex: 1 1 0; justify-content: center;' : ''}">${icon('field', 15)}Scoreboard</div>
    </div>
    ${mobile ? '' : '<div class="btn primary">Set lineup</div>'}
  </div>
</div>`;

const scoreboardSide = (s, align, mobile) => `
<div class="stack" style="align-items: ${align === 'right' ? 'flex-end' : 'flex-start'}; gap: 6px; min-width: 0; text-align: ${align};">
  <div class="row" style="gap: 10px; flex-direction: ${align === 'right' ? 'row-reverse' : 'row'};">
    ${avatar(s.t, mobile ? 40 : 52, s.t.color)}
    <div class="stack" style="min-width: 0; align-items: ${align === 'right' ? 'flex-end' : 'flex-start'};">
      <div class="row" style="gap: 6px;"><span class="display ellip" style="font-size: ${mobile ? 17 : 22}px; font-weight: 700; line-height: 1.1;">${s.t.name}</span>${s.you ? '<span class="chip you">You</span>' : ''}</div>
      <span class="note num">${s.t.rec}</span>
    </div>
  </div>
  <div class="display num" style="font-size: ${mobile ? 40 : 60}px; font-weight: 700; line-height: 1;">${s.score}</div>
  <div class="row num" style="gap: 10px; font-size: 12px; color: var(--dim);"><span>EF <strong style="color: var(--ink);">${s.ef}</strong></span><span>PMR <strong style="color: var(--ink);">${s.pmr}</strong></span></div>
</div>`;

const stickyScoreboardMobile = () => `
<div class="card" style="padding: 12px 14px; box-shadow: var(--shadow-2);">
  <div style="display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 10px; align-items: center;">
    <div class="row" style="gap: 8px; min-width: 0;">${avatar(HERO.home.t, 36, HERO.home.t.color)}<div class="stack" style="min-width: 0;"><span class="display ellip" style="font-size: 16px; font-weight: 700; line-height: 1.1;">${HERO.home.t.name}</span><span class="row" style="gap: 6px;"><span class="note num">${HERO.home.t.rec}</span><span class="chip you">You</span></span></div></div>
    <div class="row" style="gap: 8px; min-width: 0; flex-direction: row-reverse; text-align: right;">${avatar(HERO.away.t, 36, HERO.away.t.color)}<div class="stack" style="min-width: 0; align-items: flex-end;"><span class="display ellip" style="font-size: 16px; font-weight: 700; line-height: 1.1;">${HERO.away.t.name}</span><span class="note num">${HERO.away.t.rec}</span></div></div>
  </div>
  <div style="display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 14px; align-items: center; margin-top: 10px;">
    <span class="display num" style="font-size: 44px; font-weight: 700; line-height: 1;">${HERO.home.score}</span>
    <div class="stack" style="gap: 6px;">
      <div class="row num" style="justify-content: space-between; font-size: 13px; font-weight: 700;"><span style="color: var(--home);">${HERO.home.wp}%</span><span class="label">Win</span><span style="color: var(--away);">${HERO.away.wp}%</span></div>
      ${splitBar(HERO.home.wp, 6)}
    </div>
    <span class="display num" style="font-size: 44px; font-weight: 700; line-height: 1;">${HERO.away.score}</span>
  </div>
  <div class="row num" style="justify-content: space-between; margin-top: 8px; font-size: 12px; color: var(--dim);">
    <span>EF <strong style="color: var(--ink);">${HERO.home.ef}</strong> · PMR <strong style="color: var(--ink);">${HERO.home.pmr}</strong></span>
    <span>EF <strong style="color: var(--ink);">${HERO.away.ef}</strong> · PMR <strong style="color: var(--ink);">${HERO.away.pmr}</strong></span>
  </div>
</div>`;

const stickyScoreboard = (mobile) => mobile ? stickyScoreboardMobile() : `
<div class="card" style="padding: 18px 24px; box-shadow: var(--shadow-2);">
  <div style="display: grid; grid-template-columns: minmax(0, 1fr) 200px minmax(0, 1fr); gap: 20px; align-items: center;">
    ${scoreboardSide({ ...HERO.home, you: true }, 'left', mobile)}
    <div class="stack" style="gap: 8px; align-items: center;">
      <div class="row num" style="gap: 8px; font-size: ${mobile ? 15 : 20}px; font-weight: 700;"><span style="color: var(--home);">${HERO.home.wp}%</span><span style="color: var(--faint); font-size: 12px; font-weight: 500;">win</span><span style="color: var(--away);">${HERO.away.wp}%</span></div>
      <div style="width: 100%;">${splitBar(HERO.home.wp, mobile ? 6 : 10)}</div>
      ${mobile ? '' : '<span class="note">Live win probability</span>'}
    </div>
    ${scoreboardSide(HERO.away, 'right', mobile)}
  </div>
</div>`;

const nflStrip = (mobile) => `
<div class="row" style="gap: 8px; overflow: hidden; white-space: nowrap;">
  ${NFL.slice(0, mobile ? 4 : 6).map((g) => `<div class="tile row" style="gap: 8px; padding: 6px 10px; flex: none; font-size: 12px;">
    ${g.live ? '<span class="dot" style="color: var(--danger);"></span>' : `<span style="color: var(--faint); display: flex;">${icon('clock', 12)}</span>`}
    <span class="num" style="font-weight: 600;">${g.a}${g.as == null ? '' : ` ${g.as}`}</span><span style="color: var(--faint);">${g.as == null ? '@' : '-'}</span><span class="num" style="font-weight: 600;">${g.b}${g.bs == null ? '' : ` ${g.bs}`}</span>
    <span class="num" style="color: var(--faint);">${g.clock}</span>
  </div>`).join('')}
</div>`;

const benchWhatIf = (mobile) => `
<div class="card" style="padding: ${mobile ? '12px 14px' : '14px 18px'}; border-color: var(--warning);">
  <div class="row" style="gap: 12px;">
    <span style="color: var(--warning); display: flex;">${icon('bolt', 18)}</span>
    <div class="stack grow" style="min-width: 0;">
      <span style="font-size: 14px; font-weight: 600;">Bench what-if</span>
      <span class="note">+11.3 still on your bench. Locked players cannot be swapped.</span>
    </div>
    <div class="btn" style="height: 32px;">Hide</div>
  </div>
  <div class="row" style="gap: 10px; margin-top: 12px; padding: 10px 12px; border-radius: 10px; background: var(--surface2); flex-wrap: wrap;">
    <span style="color: var(--faint); text-decoration: line-through;">D. Adams 0.0</span>
    <span style="color: var(--faint); display: flex;">${icon('swap', 16)}</span>
    <span style="font-weight: 600;">J. Waddle 11.3</span>
    <span class="chip warn">+11.3</span>
    <div class="grow"></div>
    <div class="btn primary" style="height: 32px;">Swap in lineup</div>
  </div>
</div>`;

// Player headshot: PlayerAvatar's slot (photo_url from the ESPN headshot
// resolver, position-colored initials when there is none). The mockup draws a
// silhouette where the photo goes; D/ST rows show the initials fallback.
const headshot = (p, pos, size) => {
  const isDst = pos === 'def';
  const ring = `box-shadow: 0 0 0 2px var(--pos-${pos});`;
  if (isDst) return `<div class="avatar" style="width: ${size}px; height: ${size}px; font-size: ${Math.round(size * 0.36)}px; background: var(--pos-def); color: var(--on-pos); ${ring}">${p.nfl}</div>`;
  return `<div style="width: ${size}px; height: ${size}px; border-radius: 999px; overflow: hidden; flex: none; background: var(--surface3); ${ring}">
    <svg width="${size}" height="${size}" viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="12" r="6" fill="var(--faint)"/><path d="M4 32c0-7 5.4-11 12-11s12 4 12 11z" fill="var(--faint)"/></svg>
  </div>`;
};

// One player cell in the slot comparison. Mirrored for the away side.
const playerCell = (p, side, mobile, pos) => {
  const rev = side === 'away';
  const dim = p.st === 'sched';
  if (mobile) {
    return `
<div class="row grow" style="gap: 8px; flex-direction: ${rev ? 'row-reverse' : 'row'}; min-width: 0; padding: 8px 2px; border-radius: 8px; ${p.flash ? 'background: var(--accent-soft);' : ''}">
  ${headshot(p, pos, 28)}
  <div class="stack grow" style="min-width: 0; align-items: ${rev ? 'flex-end' : 'flex-start'}; text-align: ${rev ? 'right' : 'left'};">
    <div class="row" style="gap: 4px; flex-direction: ${rev ? 'row-reverse' : 'row'}; max-width: 100%;"><span class="ellip" style="font-size: 13px; font-weight: 600; color: ${dim ? 'var(--dim)' : 'var(--ink)'};">${p.n}</span>${stateDot(p.st)}</div>
    <div class="row" style="gap: 6px; flex-direction: ${rev ? 'row-reverse' : 'row'}; justify-content: space-between; width: 100%;"><span class="note ellip">${p.nfl} ${p.vs}</span><span class="display num" style="font-size: 18px; font-weight: 700; line-height: 1; color: ${dim ? 'var(--faint)' : 'var(--ink)'};">${p.pts.toFixed(1)}</span></div>
  </div>
</div>`;
  }
  return `
<div class="row grow" style="gap: ${mobile ? 8 : 12}px; flex-direction: ${rev ? 'row-reverse' : 'row'}; min-width: 0; padding: ${mobile ? '8px 4px' : '10px 12px'}; border-radius: 8px; ${p.flash ? 'background: var(--accent-soft);' : ''}">
  ${headshot(p, pos, mobile ? 30 : 38)}
  <div class="stack grow" style="min-width: 0; align-items: ${rev ? 'flex-end' : 'flex-start'}; text-align: ${rev ? 'right' : 'left'};">
    <div class="row" style="gap: 6px; flex-direction: ${rev ? 'row-reverse' : 'row'}; max-width: 100%;">
      <span class="ellip" style="font-size: ${mobile ? 13 : 14}px; font-weight: 600; color: ${dim ? 'var(--dim)' : 'var(--ink)'};">${p.n}</span>
      ${stateDot(p.st)}
    </div>
    <span class="note ellip">${p.nfl} ${p.vs}${p.game ? ` · ${p.game}` : ''}</span>
    ${mobile ? '' : `<div class="row" style="gap: 8px; margin-top: 6px; flex-direction: ${rev ? 'row-reverse' : 'row'};">${paceBar(p.pts, p.proj, 90)}<span class="note num">${p.proj.toFixed(1)} proj</span></div>`}
  </div>
  <div class="stack" style="align-items: flex-end; flex: none; width: ${mobile ? 44 : 56}px; text-align: right;">
    <span class="display num" style="font-size: ${mobile ? 20 : 24}px; font-weight: 700; line-height: 1; color: ${dim ? 'var(--faint)' : 'var(--ink)'};">${p.pts.toFixed(1)}</span>
    ${mobile ? `<span class="note num">${p.proj.toFixed(1)}</span>` : ''}
  </div>
</div>`;
};

const slotList = (mobile) => `
<div class="card">
  <div class="row" style="gap: 10px; padding: ${mobile ? '12px 14px' : '14px 18px'}; border-bottom: 1px solid var(--line);">
    <span class="display" style="font-size: 17px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase;">Starters</span>
    <span class="note">9 slots</span>
    <div class="grow"></div>
    ${mobile ? '' : `<div class="row" style="gap: 12px; font-size: 12px; color: var(--faint);"><span class="row" style="gap: 4px;"><span class="dot" style="color: var(--danger);"></span>In progress</span><span class="row" style="gap: 4px;">${icon('check', 13)}Final</span><span class="row" style="gap: 4px;">${icon('clock', 13)}Yet to play</span></div>`}
  </div>
  <div class="row" style="padding: 6px ${mobile ? 14 : 18}px; font-size: 11px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: var(--faint); border-bottom: 1px solid var(--line);">
    <span class="grow ellip">${T.dock.name}</span><span style="width: 56px; text-align: center;">Slot</span><span class="grow ellip" style="text-align: right;">${T.frost.name}</span>
  </div>
  ${ROWS.map((r, i) => `
  <div class="row" style="padding: 0 ${mobile ? 8 : 6}px; ${i ? 'border-top: 1px solid var(--line);' : ''}">
    ${playerCell(r.home, 'home', mobile, r.pos)}
    <div style="width: ${mobile ? 48 : 56}px; display: flex; justify-content: center; flex: none;">${posChip(r.pos, r.slot)}</div>
    ${playerCell(r.away, 'away', mobile, r.pos)}
  </div>
  ${i === 1 ? `<div class="${mobile ? 'stack' : 'row'}" style="gap: ${mobile ? 6 : 12}px; padding: 8px ${mobile ? 14 : 18}px 12px; background: var(--surface2); border-top: 1px solid var(--line);">
    <div class="row" style="gap: 8px;"><span class="note" style="flex: none;">A. Jones</span><span style="font-size: 13px; color: var(--dim);">14 car · 71 rush yds · 1 rush TD · 3 rec · 22 rec yds</span></div>
    ${mobile ? '' : '<div class="grow"></div>'}
    <div class="row" style="gap: 8px;">${paceBar(14.3, 13.8, 120)}<span class="note num">14.3 / 13.8 proj</span>${mobile ? '' : `<span style="color: var(--faint); display: flex;">${icon('chevU', 16)}</span>`}</div>
  </div>` : ''}`).join('')}
  <div class="row" style="justify-content: space-between; padding: 12px ${mobile ? 14 : 18}px; border-top: 1px solid var(--line); background: var(--surface2); border-radius: 0 0 14px 14px;">
    <div class="row" style="gap: 8px;"><span class="display num" style="font-size: 22px; font-weight: 700;">${HERO.home.score}</span><span class="note num">EF ${HERO.home.ef}</span></div>
    <span class="label">Totals</span>
    <div class="row" style="gap: 8px;"><span class="note num">EF ${HERO.away.ef}</span><span class="display num" style="font-size: 22px; font-weight: 700;">${HERO.away.score}</span></div>
  </div>
</div>`;

const benchSection = (mobile) => `
<div class="card row" style="justify-content: space-between; padding: ${mobile ? '12px 14px' : '14px 18px'};">
  <div class="row" style="gap: 10px;"><span class="display" style="font-size: 17px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase;">Bench</span><span class="note">6 · 7 players</span></div>
  <div class="row" style="gap: 6px; font-size: 13px; color: var(--dim);">Show ${icon('chevD', 16)}</div>
</div>`;

// ---------------------------------------------------------------------------
// Artboard: Matchup Standard desktop
// ---------------------------------------------------------------------------
const matchupStandardDesktop = () => page({
  width: 1440,
  height: 1320,
  body: `
${appBar(false)}
<div style="max-width: 1120px; margin: 0 auto; padding: 24px 24px 40px;">
  <div class="stack" style="gap: 16px;">
    ${detailHeader(false, 'standard')}
    ${stickyScoreboard(false)}
    ${nflStrip(false)}
    ${benchWhatIf(false)}
    ${slotList(false)}
    ${benchSection(false)}
  </div>
</div>`,
});

const matchupStandardMobile = () => page({
  width: 390,
  height: 1500,
  body: `
${appBar(true)}
<div class="stack" style="padding: 14px 14px 32px; gap: 12px;">
  ${detailHeader(true, 'standard')}
  ${stickyScoreboard(true)}
  ${nflStrip(true)}
  ${benchWhatIf(true)}
  ${slotList(true)}
  ${benchSection(true)}
  <div class="btn primary" style="height: 44px;">Set lineup</div>
</div>`,
});

// ---------------------------------------------------------------------------
// Scoreboard view: LED board + retro field + roster preview.
// ---------------------------------------------------------------------------
const ledBoard = (mobile) => {
  const digit = (v, size) => `<span class="led num" style="font-size: ${size}px; color: var(--led); text-shadow: 0 0 10px var(--led-dim);">${v}</span>`;
  const small = (v) => `<span class="led" style="font-size: ${mobile ? 8 : 10}px; color: var(--led); opacity: .85; letter-spacing: .04em;">${v}</span>`;
  return `
<div style="background: var(--board); border: 1px solid var(--line-strong); border-radius: 14px; padding: ${mobile ? '14px 14px' : '22px 28px'}; box-shadow: var(--shadow-2);">
  <div class="row" style="justify-content: space-between; margin-bottom: ${mobile ? 10 : 16}px;">
    ${small('NORTHWOODS LEAGUE')}${small('WEEK 3')}${small('LIVE')}
  </div>
  <div style="display: grid; grid-template-columns: minmax(0, 1fr) ${mobile ? '' : 'auto'} minmax(0, 1fr); gap: ${mobile ? 8 : 24}px; align-items: end;">
    <div class="stack" style="gap: 8px; min-width: 0;">
      ${small(mobile ? 'DOCKWORKERS' : T.dock.name.toUpperCase())}
      ${digit(HERO.home.score, mobile ? 26 : 56)}
    </div>
    ${mobile ? '' : `<div class="stack" style="gap: 6px; align-items: center; padding-bottom: 4px;">
      ${small('WIN')}
      <div class="row" style="gap: 8px;">${digit(HERO.home.wp, 20)}<span class="led" style="font-size: 10px; color: var(--led); opacity: .5;">-</span>${digit(HERO.away.wp, 20)}</div>
    </div>`}
    <div class="stack" style="gap: 8px; min-width: 0; align-items: flex-end; text-align: right;">
      ${small(mobile ? 'FROSTBITE' : T.frost.name.toUpperCase())}
      ${digit(HERO.away.score, mobile ? 26 : 56)}
    </div>
  </div>
  ${mobile ? `<div class="row" style="justify-content: center; gap: 10px; margin-top: 10px;">${small('WIN')}${digit(HERO.home.wp, 12)}<span class="led" style="font-size: 8px; color: var(--led); opacity: .5;">-</span>${digit(HERO.away.wp, 12)}</div>` : ''}
  <div style="height: 1px; background: var(--led-dim); margin: ${mobile ? 10 : 16}px 0;"></div>
  <div style="display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px;">
    ${[['EXP FINAL', HERO.home.ef], ['TO PLAY', HERO.home.pmr], ['TO PLAY', HERO.away.pmr], ['EXP FINAL', HERO.away.ef]].map(([k, v], i) => `<div class="stack" style="gap: 4px; align-items: ${i < 2 ? 'flex-start' : 'flex-end'};">${small(k)}${digit(v, mobile ? 12 : 16)}</div>`).join('')}
  </div>
</div>`;
};

const retroField = (mobile) => {
  const w = mobile ? 362 : 1072;
  const h = mobile ? 140 : 200;
  const ez = mobile ? 30 : 56;
  const inner = w - ez * 2;
  const yard = (i) => ez + (inner / 10) * i;
  const homeX = ez + inner * (0.08 + 0.76 * (HERO.home.wp / 100));
  const awayX = ez + inner * (0.16 + 0.76 * (HERO.home.wp / 100));
  const sc = mobile ? 1.1 : 1.9;
  const sprite = (x, y, c1, c2, label) => `
    <g transform="translate(${x.toFixed(1)}, ${y}) scale(${sc})">
      <rect x="-8" y="0" width="16" height="12" rx="3" fill="${c1}"/>
      <rect x="-9" y="12" width="18" height="16" rx="3" fill="${c2}"/>
      <rect x="-9" y="28" width="7" height="12" rx="2" fill="${c1}"/><rect x="2" y="28" width="7" height="12" rx="2" fill="${c1}"/>
      <text x="0" y="52" text-anchor="middle" font-family="Press Start 2P, monospace" font-size="7" fill="#fff">${label}</text>
    </g>`;
  return `
<div class="card" style="padding: ${mobile ? 10 : 14}px; overflow: hidden;">
  <svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="Field position reflects win probability">
    <rect x="0" y="0" width="${w}" height="${h}" rx="10" fill="#1d5f36"/>
    <rect x="0" y="0" width="${ez}" height="${h}" fill="var(--home)"/>
    <rect x="${w - ez}" y="0" width="${ez}" height="${h}" fill="var(--away)"/>
    ${Array.from({ length: 11 }, (_, i) => `<line x1="${yard(i).toFixed(1)}" y1="0" x2="${yard(i).toFixed(1)}" y2="${h}" stroke="rgba(255,255,255,.55)" stroke-width="${i === 5 ? 2 : 1}"/>`).join('')}
    ${['10', '20', '30', '40', '50', '40', '30', '20', '10'].map((t, i) => `<text x="${yard(i + 1).toFixed(1)}" y="${mobile ? 16 : 22}" text-anchor="middle" font-family="Press Start 2P, monospace" font-size="${mobile ? 7 : 10}" fill="rgba(255,255,255,.8)">${t}</text>`).join('')}
    <text x="${ez / 2}" y="${h / 2 + 4}" text-anchor="middle" transform="rotate(-90 ${ez / 2} ${h / 2})" font-family="Barlow Condensed, sans-serif" font-weight="700" font-size="${mobile ? 10 : 14}" fill="#fff" letter-spacing=".08em">${mobile ? 'DD' : 'DOCKWORKERS'}</text>
    <text x="${w - ez / 2}" y="${h / 2 + 4}" text-anchor="middle" transform="rotate(90 ${w - ez / 2} ${h / 2})" font-family="Barlow Condensed, sans-serif" font-weight="700" font-size="${mobile ? 10 : 14}" fill="#fff" letter-spacing=".08em">${mobile ? 'FF' : 'FROSTBITE'}</text>
    ${sprite(homeX, mobile ? 28 : 34, '#f0b34e', '#1e5bb8', 'DD')}
    ${sprite(awayX, mobile ? 62 : 86, '#f0b34e', '#1b7d4f', 'FF')}
    <g transform="translate(${(w / 2).toFixed(1)}, ${h - (mobile ? 22 : 34)})">
      <rect x="-${mobile ? 78 : 118}" y="-11" width="${mobile ? 156 : 236}" height="22" rx="6" fill="rgba(0,0,0,.55)"/>
      <text x="0" y="4" text-anchor="middle" font-family="Press Start 2P, monospace" font-size="${mobile ? 6 : 8}" fill="#ffb547">JEFFERSON 34 YD TD  +10.4</text>
    </g>
  </svg>
  ${mobile ? '' : `<div class="row" style="justify-content: space-between; margin-top: 10px; font-size: 12px; color: var(--faint);"><span>Sprites move with win probability. Plays flash on the field as they land.</span><div class="row" style="gap: 6px;">${icon('lock', 13)}Celebrations on</div></div>`}
</div>`;
};

const rosterPreview = (mobile) => `
<div class="card">
  <div class="row" style="gap: 10px; padding: ${mobile ? '12px 14px' : '14px 18px'}; border-bottom: 1px solid var(--line);">
    <span class="display" style="font-size: 17px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase;">Lineups</span><span class="note">Slot by slot</span>
    <div class="grow"></div><span class="row" style="gap: 4px; font-size: 13px; color: var(--dim);">Full comparison ${icon('chevR', 14)}</span>
  </div>
  ${ROWS.map((r, i) => `
  <div class="row" style="gap: 8px; padding: 6px ${mobile ? 12 : 18}px; ${i ? 'border-top: 1px solid var(--line);' : ''}">
    <div class="row grow" style="gap: 8px; min-width: 0;">${headshot(r.home, r.pos, 28)}<div class="stack grow" style="min-width: 0;"><span class="ellip" style="font-size: 13px; font-weight: 600;">${r.home.n}</span><span class="note num">${r.home.pts.toFixed(1)} · proj ${r.home.proj.toFixed(1)}</span></div></div>
    ${posChip(r.pos, r.slot)}
    <div class="row grow" style="gap: 8px; min-width: 0; flex-direction: row-reverse; text-align: right;">${headshot(r.away, r.pos, 28)}<div class="stack grow" style="min-width: 0; align-items: flex-end;"><span class="ellip" style="font-size: 13px; font-weight: 600;">${r.away.n}</span><span class="note num">${r.away.pts.toFixed(1)} · proj ${r.away.proj.toFixed(1)}</span></div></div>
  </div>`).join('')}
</div>`;

const liveTicker = (mobile) => `
<div class="card row" style="gap: 12px; padding: 8px 12px; overflow: hidden;">
  <span class="label" style="flex: none;">Last plays</span>
  <div class="row grow" style="gap: 18px; white-space: nowrap; overflow: hidden;">
    ${FEED.filter((f) => f.side).slice(0, mobile ? 1 : 4).map((f) => `<span class="row" style="gap: 6px; font-size: 13px; color: ${f.side === 'home' ? 'var(--home)' : 'var(--away)'};"><span class="dot"></span><strong>${f.who}</strong><span style="color: var(--dim);">${f.play}</span><span class="num" style="font-weight: 700;">${f.pts}</span></span>`).join('')}
  </div>
</div>`;

const matchupScoreboardDesktop = () => page({
  width: 1440,
  height: 1180,
  body: `
${appBar(false)}
<div style="max-width: 1120px; margin: 0 auto; padding: 24px 24px 40px;">
  <div class="stack" style="gap: 16px;">
    ${detailHeader(false, 'scoreboard')}
    ${ledBoard(false)}
    ${retroField(false)}
    ${liveTicker(false)}
    <div style="display: grid; grid-template-columns: minmax(0, 1fr) 340px; gap: 16px; align-items: start;">
      ${rosterPreview(false)}
      <div class="stack" style="gap: 16px;">
        ${benchWhatIf(false)}
        <div class="card" style="padding: 14px 18px;">
          <div class="row" style="gap: 10px; margin-bottom: 8px;"><span class="display" style="font-size: 17px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase;">Games</span><span class="note">5 live</span></div>
          <div class="stack" style="gap: 6px;">${NFL.map((g) => `<div class="row" style="gap: 8px; font-size: 13px;">${g.live ? '<span class="dot" style="color: var(--danger);"></span>' : `<span style="color: var(--faint); display: flex;">${icon('clock', 12)}</span>`}<span class="num" style="font-weight: 600; width: 92px;">${g.a}${g.as == null ? '' : ` ${g.as}`} ${g.as == null ? '@' : '-'} ${g.b}${g.bs == null ? '' : ` ${g.bs}`}</span><span class="note num">${g.clock}</span></div>`).join('')}</div>
        </div>
      </div>
    </div>
  </div>
</div>`,
});

const matchupScoreboardMobile = () => page({
  width: 390,
  height: 1420,
  body: `
${appBar(true)}
<div class="stack" style="padding: 14px 14px 32px; gap: 12px;">
  ${detailHeader(true, 'scoreboard')}
  ${ledBoard(true)}
  ${retroField(true)}
  ${liveTicker(true)}
  ${nflStrip(true)}
  ${rosterPreview(true)}
  ${benchWhatIf(true)}
</div>`,
});

// ---------------------------------------------------------------------------
// FSD slice map: which slice renders which region. Layers top to bottom;
// imports point down only (ADR 0020, 0029).
// ---------------------------------------------------------------------------
const fsdMap = () => {
  const box = (name, sub, tone) => `<div class="tile stack" style="padding: 10px 12px; gap: 2px; min-width: 0; ${tone === 'new' ? 'border-color: var(--accent-line); background: var(--accent-soft);' : tone === 'exists' ? '' : 'border-style: dashed;'}"><span style="font-size: 13px; font-weight: 600; font-family: ui-monospace, Menlo, Consolas, monospace;">${name}</span><span class="note">${sub}</span></div>`;
  const layer = (title, rule, items) => `
  <div style="display: grid; grid-template-columns: 200px minmax(0, 1fr); gap: 16px; align-items: start; padding: 14px 0; border-top: 1px solid var(--line);">
    <div class="stack"><span class="display" style="font-size: 20px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase;">${title}</span><span class="note">${rule}</span></div>
    <div style="display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px;">${items.join('')}</div>
  </div>`;
  return page({
    width: 1200,
    height: 820,
    body: `
<div style="padding: 28px 32px;">
  <div class="row" style="justify-content: space-between; margin-bottom: 6px;">
    <h1 class="display" style="margin: 0; font-size: 30px; font-weight: 700; text-transform: uppercase;">FSD slice map</h1>
    <div class="row" style="gap: 14px; font-size: 12px; color: var(--faint);"><span class="row" style="gap: 6px;"><span style="width: 12px; height: 12px; border-radius: 3px; background: var(--accent-soft); border: 1px solid var(--accent-line);"></span>New slice</span><span class="row" style="gap: 6px;"><span style="width: 12px; height: 12px; border-radius: 3px; background: var(--surface2); border: 1px solid var(--line);"></span>Exists</span><span class="row" style="gap: 6px;"><span style="width: 12px; height: 12px; border-radius: 3px; border: 1px dashed var(--line-strong);"></span>Changed</span></div>
  </div>
  <p class="note" style="margin: 0 0 12px; max-width: 760px;">Game Center and Matchup Detail move from src/components into the island as two page slices. Imports point down only. A widget never imports another widget; the page passes shared values down (ADR 0020). Entities import shared only (ADR 0029).</p>
  ${layer('pages', 'Compose widgets and features', [box('pages/game-center', 'Replaces components/GameCenter', 'new'), box('pages/matchup', 'Replaces components/MatchupDetail, owns view mode', 'new'), '<div></div>', '<div></div>'])}
  ${layer('widgets', 'One region each, read the entity', [box('widgets/matchup-hero', 'Your matchup card', 'new'), box('widgets/matchup-grid', 'League matchup cards and rows', 'new'), box('widgets/scoring-feed', 'Ticker strip and feed list', 'new'), box('widgets/week-glance', 'Derived from the list read', 'new'), box('widgets/scoreboard-strip', 'Sticky score, EF, PMR, win prob', 'new'), box('widgets/slot-comparison', 'Starters paired by slot, pace, expand', 'new'), box('widgets/retro-scoreboard', 'LED board and field, moved from components', 'changed'), box('widgets/nfl-game-strip', 'Wraps LiveGameStatus', 'new')])}
  ${layer('features', 'One user action each', [box('features/pick-week', 'Stepper plus segmented weeks', 'new'), box('features/toggle-matchup-view', 'Standard or Scoreboard, remembered', 'new'), box('features/bench-what-if', 'Swap suggestion with a lineup action', 'changed'), box('features/celebrate-touchdown', 'Cutscene queue and toasts', 'changed')])}
  ${layer('entities', 'Domain read models, shared only', [box('entities/matchup', 'Read model, status view, pairing', 'exists'), box('entities/matchup + starter.gameState', 'Adds per-starter game state and next kickoff to the detail row', 'changed'), '<div></div>', '<div></div>'])}
  ${layer('shared', 'No imports from above', [box('shared/ui Card, Badge, Skeleton', 'Exists', 'exists'), box('shared/ui StatTile, SplitBar, PosChip', 'New kit pieces', 'new'), box('shared/ui SegmentedControl', 'Week and view pickers', 'new'), box('shared/lib scoreFeed, useEndpoint', 'Exists', 'exists')])}
</div>`,
  });
};

// ---------------------------------------------------------------------------
// Write everything
// ---------------------------------------------------------------------------
const files = {
  'Main.dc.html': gameCenterDesktop(),
  'GameCenterMobile.dc.html': gameCenterMobile(),
  'MatchupStandard.dc.html': matchupStandardDesktop(),
  'MatchupStandardMobile.dc.html': matchupStandardMobile(),
  'MatchupScoreboard.dc.html': matchupScoreboardDesktop(),
  'MatchupScoreboardMobile.dc.html': matchupScoreboardMobile(),
  'FsdSliceMap.dc.html': fsdMap(),
};
for (const [name, html] of Object.entries(files)) {
  if (/—/.test(html)) throw new Error(`em dash in ${name}`);
  writeFileSync(join(here, name), html);
}

const note = (id, x, y, w, text, pageId) => ({ id, x, y, w, text, page: pageId });
const canvas = {
  pages: [
    { id: 'game-center', name: 'Game Center' },
    { id: 'matchup-standard', name: 'Matchup · Standard' },
    { id: 'matchup-scoreboard', name: 'Matchup · Scoreboard' },
    { id: 'fsd', name: 'FSD plan' },
  ],
  artboards: [
    { file: 'Main.dc.html', title: 'Game Center · Desktop', x: 0, y: 0, w: 1440, h: 900, page: 'game-center' },
    { file: 'GameCenterMobile.dc.html', title: 'Game Center · Mobile', x: 1540, y: 0, w: 390, h: 1560, page: 'game-center' },
    { file: 'MatchupStandard.dc.html', title: 'Matchup Standard · Desktop', x: 0, y: 0, w: 1440, h: 1620, page: 'matchup-standard' },
    { file: 'MatchupStandardMobile.dc.html', title: 'Matchup Standard · Mobile', x: 1540, y: 0, w: 390, h: 1540, page: 'matchup-standard' },
    { file: 'MatchupScoreboard.dc.html', title: 'Matchup Scoreboard · Desktop', x: 0, y: 0, w: 1440, h: 1300, page: 'matchup-scoreboard' },
    { file: 'MatchupScoreboardMobile.dc.html', title: 'Matchup Scoreboard · Mobile', x: 1540, y: 0, w: 390, h: 1440, page: 'matchup-scoreboard' },
    { file: 'FsdSliceMap.dc.html', title: 'FSD slice map', x: 0, y: 0, w: 1200, h: 820, page: 'fsd' },
  ],
  annotations: [
    note('gc-audit', 0, -480, 460, 'AUDIT · Game Center today\n1. Hero card carries no avatars, no record, and the score sits under the name in body type; nothing reads as the headline.\n2. Win probability bar has no percentages next to the teams it belongs to and the caption says only "Win Probability".\n3. Ticker and feed both render the emoji football and the same line twice on screen (strip and list).\n4. Matchup cards print "Team (82.2)" in one string, so the score never aligns and a winner is bold weight only.\n5. Week filter is a native select plus two icon buttons; on mobile it collapses under the title.\n6. The page uses Inter and plain MUI Cards while the League Dashboard uses the Barlow/Archivo kit (ADR 0020); the two league surfaces look like different apps.', 'game-center'),
    note('gc-changes', 480, -480, 460, 'CHANGES · Game Center\n1. Dashboard kit: Card, Badge and the dash-* tokens, Barlow Condensed for names and scores.\n2. Hero: 64px avatars, You pill, 56px tabular score, Expected final and PMR as stat tiles, win probability with per-side percentages and one plain sentence.\n3. Grid cards align score right at 26px, carry record and a 5px win-probability bar; scheduled cards show projected totals and the first kickoff.\n4. Feed moves to a right rail (desktop) with time, side dot and team; the strip is one line with a Live pill and no emoji.\n5. Week at a glance is derived from the list read (top score, closest, biggest lead).\n6. Mobile: full-width week segmented control, stacked hero, matchup rows instead of cards, feed collapsed to three.', 'game-center'),
    note('gc-wire', 960, -480, 460, 'WIRE ADDITIONS needed for this page\n1. First kickoff per Matchup (nfl_games.kickoff_at, already read by the Expected final producer) for "Kicks off Sun 7:20 PM".\n2. Team record on the list row (or the page passes standings down).\n3. Last sync time on the list response for "Scores synced 3:42 PM".\nEverything else on these boards is on the wire today (ADR 0029/0030 shapes).', 'game-center'),
    note('ms-audit', 0, -480, 460, 'AUDIT · Matchup Standard today\n1. Sticky scoreboard is one text line "Team 82.2 - 77.0 Team" with a 4px bar; no avatars, no EF, no PMR, so the sticky state loses the two numbers a manager scrolls back for.\n2. Score, Projected and Players remaining are printed a second time below the win probability card in body type.\n3. Slot rows show name and points only; pace and stat line hide behind a click, and nothing says which players are done, live or yet to play.\n4. Bench what-if is a paper with a Show button and an arrow glyph, not an action.\n5. NFL game strip is unstyled outlined papers.\n6. Status is a server fact (ADR 0030) but the page still has no per-starter state to show.', 'matchup-standard'),
    note('ms-changes', 480, -480, 460, 'CHANGES · Matchup Standard\n1. Scoreboard card: avatars with team-color rings, 60px scores, EF and PMR under each side, percentages beside the bar. It is the sticky element; nothing below repeats it.\n2. Starters table: NFL player headshot beside each name (PlayerAvatar, position-colored ring, initials fallback for D/ST), position chip in the slot column, per-player state (live dot, final check, clock), NFL game clock on the second line, inline pace bar with the projection; expand row keeps the stat line.\n3. Totals footer sums the columns so the table and scoreboard agree.\n4. Bench what-if becomes a warning-bordered card with the swap and a real action.\n5. NFL games are tiles with a live dot or a kickoff clock.\n6. Mobile drops the inline pace bar, shows projection under the points, keeps the state icon.\n\nWIRE: the detail starter rows need photo_url (players table has it; the ESPN headshot resolver fills it) and a per-starter game state plus clock from the Expected final classification.', 'matchup-standard'),
    note('sb-audit', 0, -420, 460, 'AUDIT · Scoreboard view today\n1. LED board is Courier New with a green glow on pure black, integer scores only, no EF or PMR, and the status word floats between the teams.\n2. Retro field and roster preview use MUI initials avatars; the preview repeats the standard list with less information.\n3. The view toggle is a bare MUI ToggleButtonGroup, easy to miss.\n4. Nothing on this view says which NFL games are on.', 'matchup-scoreboard'),
    note('sb-changes', 480, -420, 460, 'CHANGES · Scoreboard view\n1. Board uses Press Start 2P (already self-hosted for the Tecmo cutscene), amber LED on the board token, one-decimal scores, win percentages in the middle, EF and TO PLAY on a second LED row.\n2. Field is inline SVG: team-color end zones, yard numbers, sprites placed by win probability, last play flashed on the field.\n3. Lineups preview keeps the slot chip and adds the projection; Games tile lists every NFL game with clock.\n4. Toggle is a segmented control with icons in both views.', 'matchup-scoreboard'),
    note('fsd-note', 1240, 0, 420, 'HOW TO BUILD IT\nOne ticket per widget slice, page slices last (ADR 0020 pattern). Each widget reads entities/matchup only and takes leagueId or the model as props; the page owns the week and view state.\nContrast: every new ink-on-surface pairing (LED amber on board, home/away on surface2, pos chips) gets a row in tokens.contrast.test.js before the widget merges.\nCopy: middots, hyphen scores, no em dashes (ADR 0016).\nThe theme tweak on each artboard flips the same token names the app resolves.', 'fsd'),
  ],
  launch: { view: 'canvas', page: 'game-center' },
};
writeFileSync(join(here, 'canvas.json'), JSON.stringify(canvas, null, 2) + '\n');
console.log('wrote', Object.keys(files).length, 'artboards + canvas.json');
