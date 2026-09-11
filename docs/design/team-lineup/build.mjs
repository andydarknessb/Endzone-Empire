// Generates the .dc.html artboards for the My Team (Lineup) canvas.
// Run: node build.mjs   (writes Main.dc.html + siblings beside this file)
// Every artboard is self-contained (artboards share nothing at runtime), so
// the shared CSS below is inlined into each one. Tokens and component
// vocabulary extend docs/design/game-center-matchups (same league, same
// type pairing, same [data-theme] provider lifted from src/theme/tokens.js).
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

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
  --shadow-1:0 1px 2px rgba(16,24,32,.08); --shadow-2:0 4px 12px rgba(16,24,32,.10);
}
*{box-sizing:border-box}
body{margin:0}
a{color:var(--accent);text-decoration:none}
a:hover{color:var(--accent);text-decoration:underline}
.root{width:${width}px;min-height:100%;overflow-x:hidden;background:var(--bg);color:var(--ink);font-family:"Archivo","Helvetica Neue",Arial,sans-serif;font-size:14px;line-height:1.45;-webkit-font-smoothing:antialiased}
.display{font-family:"Barlow Condensed",Impact,sans-serif}
.num{font-variant-numeric:tabular-nums}
.card{background:var(--surface);border:1px solid var(--line);border-radius:14px}
.tile{background:var(--surface2);border:1px solid var(--line);border-radius:10px}
.chip{display:inline-flex;align-items:center;gap:6px;height:22px;padding:0 9px;border-radius:999px;font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;border:1px solid var(--line);background:var(--surface2);color:var(--dim);white-space:nowrap}
.chip.live{background:var(--danger-soft);color:var(--danger);border-color:var(--danger)}
.chip.final{background:var(--success-soft);color:var(--success);border-color:var(--success)}
.chip.you{background:var(--accent-soft);color:var(--accent);border-color:var(--accent-line);font-size:10.5px;letter-spacing:.08em}
.chip.warn{background:var(--warning-soft);color:var(--warning);border-color:var(--warning)}
.chip.bad{background:var(--danger-soft);color:var(--danger);border-color:var(--danger)}
.chip.sm{height:18px;padding:0 6px;font-size:10px;gap:4px}
.dot{width:8px;height:8px;border-radius:999px;background:currentColor;flex:none}
.pos{display:inline-flex;align-items:center;justify-content:center;min-width:34px;height:20px;padding:0 6px;border-radius:6px;font-size:10.5px;font-weight:700;letter-spacing:.06em;color:var(--on-pos)}
.slot{display:inline-flex;align-items:center;justify-content:center;width:44px;height:24px;border-radius:6px;font-size:11px;font-weight:700;letter-spacing:.06em;background:var(--surface3);color:var(--dim);flex:none}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;height:38px;padding:0 16px;border-radius:9px;font-size:13px;font-weight:600;border:1px solid var(--line-strong);color:var(--dim);background:transparent;white-space:nowrap}
.btn.primary{background:var(--accent);border-color:var(--accent);color:var(--on-accent)}
.btn.icon{width:38px;padding:0}
.btn.sm{height:30px;padding:0 12px;font-size:12px;border-radius:8px}
.btn.sm.icon{width:30px;padding:0}
.seg{display:inline-flex;background:var(--surface2);border:1px solid var(--line);border-radius:9px;padding:3px;gap:2px}
.seg > div{height:30px;padding:0 14px;border-radius:7px;display:flex;align-items:center;font-size:13px;font-weight:600;color:var(--dim)}
.seg > div.on{background:var(--surface);color:var(--ink);box-shadow:var(--shadow-1)}
.label{font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--faint)}
.hair{height:1px;background:var(--line)}
.avatar{display:flex;align-items:center;justify-content:center;border-radius:999px;background:var(--surface3);color:var(--ink);font-weight:700;flex:none;position:relative}
.kit{position:absolute;right:-2px;bottom:-2px;width:12px;height:12px;border-radius:999px;border:2px solid var(--surface)}
.pace{height:5px;border-radius:3px;background:var(--surface3);overflow:hidden}
.pace > div{height:100%;border-radius:3px}
.range{position:relative;height:6px;border-radius:3px;background:var(--surface3)}
.range > .band{position:absolute;top:0;bottom:0;border-radius:3px;background:var(--accent-soft);border:1px solid var(--accent-line)}
.range > .tick{position:absolute;top:-3px;width:2px;height:12px;border-radius:1px;background:var(--accent)}
.row{display:flex;align-items:center}
.stack{display:flex;flex-direction:column}
.grow{flex:1 1 0;min-width:0}
.ellip{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.note{font-size:12px;color:var(--faint)}
.mono{font-family:ui-monospace,Menlo,Consolas,monospace}
svg{display:block}
`;

const FONTS = `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600;700&amp;family=Archivo:wght@400;500;600;700&amp;family=Patrick+Hand&amp;display=swap">`;

const page = ({ width, height, body, extraCss = '' }) => `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
  ${FONTS}
  <style>
${CSS(width)}${extraCss}
  </style>
</helmet>
<div class="root" data-theme="{{theme}}" style="width: ${width}px; min-height: ${height}px; background: var(--bg); color: var(--ink);">
${body}
</div>
</x-dc>
<script data-dc-script data-props='{"theme":{"editor":"enum","options":["dark","light"],"default":"dark","section":"Theme"},"$preview":{"width":${width},"height":${height}}}'>
class Component extends DCLogic {
  renderVals() {
    return { theme: this.props.theme === 'light' ? 'light' : 'dark' };
  }
}
</script>
</body>
</html>
`;

// ---------------------------------------------------------------------------
// Icons: stroke SVG on a 20px grid, one style.
// ---------------------------------------------------------------------------
const svg = (size, paths, extra = '') =>
  `<svg width="${size}" height="${size}" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"${extra}>${paths}</svg>`;
const ic = {
  ball: (s = 16) => svg(s, '<path d="M4 16c3-9 7-12 12-12 0 5-3 9-12 12z"/><path d="m8 12 4-4M9 13l1-1M11 9l1-1"/>'),
  search: (s = 20) => svg(s, '<circle cx="9" cy="9" r="5.5"/><path d="m13 13 4 4"/>'),
  bell: (s = 20) => svg(s, '<path d="M5 14V9a5 5 0 0 1 10 0v5l1.5 2h-13z"/><path d="M8.5 17.5a1.5 1.5 0 0 0 3 0"/>'),
  left: (s = 18) => svg(s, '<path d="M12.5 4.5 7 10l5.5 5.5"/>'),
  right: (s = 18) => svg(s, '<path d="M7.5 4.5 13 10l-5.5 5.5"/>'),
  lock: (s = 14) => svg(s, '<rect x="5" y="9" width="10" height="8" rx="2"/><path d="M7 9V6.5a3 3 0 0 1 6 0V9"/>'),
  swap: (s = 16) => svg(s, '<path d="M4 7h11l-3-3M16 13H5l3 3"/>'),
  bolt: (s = 16) => svg(s, '<path d="M11 2 4 11h5l-1 7 7-9h-5z"/>'),
  wind: (s = 14) => svg(s, '<path d="M3 8h9a2 2 0 1 0-2-2M3 12h12a2 2 0 1 1-2 2M3 16h6"/>'),
  dome: (s = 14) => svg(s, '<path d="M3 15a7 7 0 0 1 14 0z"/><path d="M2 15h16M10 8V6"/>'),
  sun: (s = 14) => svg(s, '<circle cx="10" cy="10" r="3.5"/><path d="M10 3v2M10 15v2M3 10h2M15 10h2M5 5l1.5 1.5M13.5 13.5 15 15M15 5l-1.5 1.5M6.5 13.5 5 15"/>'),
  rain: (s = 14) => svg(s, '<path d="M6 12a4 4 0 0 1 .5-8 5 5 0 0 1 9.5 1.5A3.2 3.2 0 0 1 15 12z"/><path d="M8 14l-1 3M12 14l-1 3"/>'),
  info: (s = 14) => svg(s, '<circle cx="10" cy="10" r="7"/><path d="M10 9v5M10 6.5v.5"/>'),
  warn: (s = 14) => svg(s, '<path d="M10 3 2.5 16h15z"/><path d="M10 8v4M10 14v.5"/>'),
  check: (s = 14) => svg(s, '<path d="m4 10.5 4 4 8-9"/>'),
  more: (s = 16) => svg(s, '<circle cx="5" cy="10" r="1.2"/><circle cx="10" cy="10" r="1.2"/><circle cx="15" cy="10" r="1.2"/>'),
  chevD: (s = 14) => svg(s, '<path d="m5 8 5 5 5-5"/>'),
  chevU: (s = 14) => svg(s, '<path d="m5 12 5-5 5 5"/>'),
  x: (s = 16) => svg(s, '<path d="m5 5 10 10M15 5 5 15"/>'),
  trend: (s = 14) => svg(s, '<path d="M3 14l5-5 3 3 6-6"/><path d="M13 6h4v4"/>'),
  target: (s = 14) => svg(s, '<circle cx="10" cy="10" r="7"/><circle cx="10" cy="10" r="3"/><path d="M10 3v2M10 15v2M3 10h2M15 10h2"/>'),
  clock: (s = 14) => svg(s, '<circle cx="10" cy="10" r="7"/><path d="M10 6v4l3 2"/>'),
  news: (s = 14) => svg(s, '<rect x="3" y="4" width="14" height="12" rx="2"/><path d="M6 8h8M6 11h8M6 14h4"/>'),
  sync: (s = 14) => svg(s, '<path d="M16 8A6.5 6.5 0 0 0 4.5 6.5M4 12a6.5 6.5 0 0 0 11.5 1.5"/><path d="M16 3v5h-5M4 17v-5h5"/>'),
  compare: (s = 16) => svg(s, '<rect x="3" y="4" width="6" height="12" rx="1.5"/><rect x="11" y="4" width="6" height="12" rx="1.5"/>'),
  redzone: (s = 12) => svg(s, '<rect x="3" y="5" width="14" height="10" rx="1"/><path d="M3 10h14"/>'),
  filter: (s = 16) => svg(s, '<path d="M3 5h14l-5.5 6v5l-3-1.5V11z"/>'),
  grip: (s = 16) => svg(s, '<circle cx="7" cy="5" r="1.2"/><circle cx="13" cy="5" r="1.2"/><circle cx="7" cy="10" r="1.2"/><circle cx="13" cy="10" r="1.2"/><circle cx="7" cy="15" r="1.2"/><circle cx="13" cy="15" r="1.2"/>'),
  home: (s = 20) => svg(s, '<path d="M3 9.5 10 4l7 5.5V16a1 1 0 0 1-1 1h-4v-5H8v5H4a1 1 0 0 1-1-1z"/>'),
  users: (s = 20) => svg(s, '<circle cx="8" cy="7" r="3"/><path d="M2.5 17a5.5 5.5 0 0 1 11 0"/><path d="M14 4.5a3 3 0 0 1 0 5.5M17.5 17a5.5 5.5 0 0 0-3.5-5"/>'),
  list: (s = 20) => svg(s, '<path d="M4 6h12M4 10h12M4 14h12"/>'),
};

// ---------------------------------------------------------------------------
// Sample data. Real NFL players, fictional Northwoods League (shared with the
// Game Center canvas). Numbers are illustrative, labelled sample at handover.
// ---------------------------------------------------------------------------
const kits = { BUF: '#00338d', ATL: '#a71930', DET: '#0076b6', MIN: '#4f2683', DAL: '#041e42', CIN: '#fb4f14', PIT: '#ffb612', KC: '#e31837', GB: '#203731', CAR: '#0085ca', SF: '#aa0000', LV: '#000000', TB: '#d50a0a' };

// Game context states. `kind`: pre | live | final | bye
const starters = [
  { slot: 'QB', pos: 'QB', name: 'Josh Allen', team: 'BUF', opp: 'vs MIA', kind: 'live', state: 'Q3 10:12', score: 'BUF 21 · MIA 14', sit: 'BUF ball · 1st & 10 · MIA 18', rz: true, proj: 22.4, pts: 18.6, pace: 0.83, line: 'BUF -6.5 · O/U 48.5' },
  { slot: 'RB', pos: 'RB', name: 'Bijan Robinson', team: 'ATL', opp: '@ KC', kind: 'pre', state: 'Sun 4:25 PM', proj: 17.8, pts: null, line: 'KC -3.5 · O/U 49.5', wx: 'dome', wxText: 'Dome', defRank: 'Opp +1.2 · KC vs RB' },
  { slot: 'RB', pos: 'RB', name: 'Jahmyr Gibbs', team: 'DET', opp: 'vs ARI', kind: 'live', state: 'Q3 4:48', score: 'DET 17 · ARI 20', sit: 'ARI ball · 3rd & 7 · DET 44', rz: false, proj: 14.9, pts: 9.2, pace: 0.62, line: 'DET -7 · O/U 51' },
  { slot: 'WR', pos: 'WR', name: 'Justin Jefferson', team: 'MIN', opp: '@ CIN', kind: 'final', state: 'Final', score: 'MIN 27 · CIN 24', proj: 19.1, pts: 26.4, pace: 1 },
  { slot: 'WR', pos: 'WR', name: 'CeeDee Lamb', team: 'DAL', opp: 'vs BAL', kind: 'pre', state: 'Sun 4:25 PM', proj: 16.3, pts: null, injury: 'Q', injuryText: 'Ankle · full Fri', line: 'BAL -2.5 · O/U 47', wx: 'sun', wxText: '84° · wind 4', defRank: 'Opp -1.1 · BAL vs WR', flag: 'advice' },
  { slot: 'TE', pos: 'TE', name: 'Sam LaPorta', team: 'DET', opp: 'vs ARI', kind: 'live', state: 'Q3 4:48', score: 'DET 17 · ARI 20', sit: '3 targets · 2 rec · 31 yds', rz: false, proj: 11.2, pts: 6.1, pace: 0.54 },
  { slot: 'FLEX', pos: 'RB', name: 'Chase Brown', team: 'CIN', opp: 'vs MIN', kind: 'final', state: 'Final', score: 'MIN 27 · CIN 24', proj: 12.6, pts: 11.3, pace: 1 },
  { slot: 'K', pos: 'K', name: 'Jake Bates', team: 'DET', opp: 'vs ARI', kind: 'live', state: 'Q3 4:48', score: 'DET 17 · ARI 20', sit: '1/1 FG · 2/2 XP', proj: 8.4, pts: 5.0, pace: 0.6 },
  { slot: 'DEF', pos: 'DEF', name: 'Steelers', team: 'PIT', opp: 'vs LAC', kind: 'pre', state: 'Sun 8:20 PM', proj: 7.9, pts: null, line: 'PIT -1 · O/U 41.5', wx: 'rain', wxText: '58° · rain · wind 12', defRank: 'Opp +0.8 · LAC line' },
];
const bench = [
  { pos: 'WR', name: 'Rashee Rice', team: 'KC', opp: 'vs ATL', kind: 'pre', state: 'Sun 4:25 PM', proj: 15.8, pts: null, line: 'KC -3.5 · O/U 49.5', wx: 'dome', wxText: 'Dome', flag: 'startworthy', note: 'Above Lamb at WR' },
  { pos: 'WR', name: 'Jayden Reed', team: 'GB', opp: '@ LV', kind: 'pre', state: 'Mon 8:15 PM', proj: 12.4, pts: null, line: 'GB -4 · O/U 44', wx: 'dome', wxText: 'Dome' },
  { pos: 'TE', name: 'Brock Bowers', team: 'LV', opp: 'vs GB', kind: 'pre', state: 'Mon 8:15 PM', proj: 10.9, pts: null, line: 'GB -4 · O/U 44', wx: 'dome', wxText: 'Dome' },
  { pos: 'RB', name: 'Chuba Hubbard', team: 'CAR', opp: 'Bye', kind: 'bye', state: 'Bye week', proj: 0, pts: null },
  { pos: 'RB', name: 'Tank Bigsby', team: 'JAX', opp: '@ TB', kind: 'final', state: 'Final', score: 'TB 31 · JAX 20', proj: 8.1, pts: 4.7, pace: 1 },
  { pos: 'QB', name: 'Baker Mayfield', team: 'TB', opp: 'vs JAX', kind: 'final', state: 'Final', score: 'TB 31 · JAX 20', proj: 18.2, pts: 24.9, pace: 1 },
];
const ir = [
  { pos: 'RB', name: 'Christian McCaffrey', team: 'SF', opp: '@ LAR', kind: 'pre', state: 'Thu 8:15 PM', proj: 0, pts: null, injury: 'IR', injuryText: 'Achilles · Wk 6' },
];

const posVar = (pos) => `var(--pos-${pos.toLowerCase()})`;
const initials = (name) => name.split(' ').map((w) => w[0]).slice(0, 2).join('');

const avatar = (p, size = 36) => `<div class="avatar" style="width: ${size}px; height: ${size}px; font-size: ${Math.round(size * 0.36)}px;">${initials(p.name)}<span class="kit" style="background: ${kits[p.team] || '#9aa0a6'};"></span></div>`;

const injuryTag = (p) => {
  if (!p.injury) return '';
  const cls = p.injury === 'Q' || p.injury === 'D' ? 'warn' : 'bad';
  return `<span class="chip sm ${cls}">${p.injury}</span>`;
};

const wxIcon = (p) => (p.wx === 'dome' ? ic.dome() : p.wx === 'rain' ? ic.rain() : p.wx === 'sun' ? ic.sun() : '');

// Game-context cell: three states, all from the ESPN scoreboard payload.
const gameCell = (p) => {
  if (p.kind === 'bye') {
    return `<div class="stack" style="gap: 2px; min-width: 0;"><span class="chip sm warn" style="align-self: flex-start;">Bye</span><span class="note ellip">No game this week</span></div>`;
  }
  if (p.kind === 'live') {
    return `<div class="stack" style="gap: 3px; min-width: 0;">
      <div class="row" style="gap: 8px;"><span class="chip sm live"><span class="dot"></span>${p.state}</span><span class="num" style="font-size: 12px; font-weight: 600; white-space: nowrap;">${p.score}</span></div>
      <div class="row" style="gap: 6px; font-size: 12px; color: var(--dim);">${p.rz ? `<span class="row" style="gap: 4px; color: var(--danger); font-weight: 600;">${ic.redzone()}RZ</span>` : ''}<span class="ellip">${p.sit}</span></div>
    </div>`;
  }
  if (p.kind === 'final') {
    return `<div class="stack" style="gap: 3px; min-width: 0;">
      <div class="row" style="gap: 8px;"><span class="chip sm final">Final</span><span class="num" style="font-size: 12px; font-weight: 600; color: var(--dim);">${p.score}</span></div>
      <span class="note ellip">${p.opp}</span>
    </div>`;
  }
  return `<div class="stack" style="gap: 3px; min-width: 0;">
    <div class="row" style="gap: 8px; font-size: 13px;"><span style="font-weight: 600;">${p.opp}</span><span style="color: var(--faint);">${p.state}</span></div>
    <div class="row" style="gap: 10px; font-size: 12px; color: var(--dim);"><span class="num ellip">${p.line || ''}</span>${p.wxText ? `<span class="row" style="gap: 4px; flex: none;">${wxIcon(p)}${p.wxText}</span>` : ''}</div>
  </div>`;
};

// Edge cell: the one line that answers "why start him". Defensive matchup or
// injury/practice status, whichever the manager needs first.
const edgeCell = (p) => {
  if (p.injury) return `<div class="row" style="gap: 6px; font-size: 12px; color: var(--warning); min-width: 0;">${ic.warn()}<span class="ellip">${p.injuryText}</span></div>`;
  if (p.note) return `<div class="row" style="gap: 6px; font-size: 12px; color: var(--accent); min-width: 0;">${ic.trend()}<span class="ellip">${p.note}</span></div>`;
  if (p.defRank) return `<div class="row" style="gap: 6px; font-size: 12px; color: var(--dim); min-width: 0;">${ic.target()}<span class="ellip">${p.defRank}</span></div>`;
  if (p.kind === 'live') return `<div class="stack" style="gap: 4px;"><div class="pace"><div style="width: ${Math.round(p.pace * 100)}%; background: var(--accent);"></div></div><span class="note">${Math.round(p.pace * 100)}% of projection</span></div>`;
  if (p.kind === 'final') return `<span class="note">${p.pts >= p.proj ? 'Beat proj by' : 'Under proj by'} ${Math.abs(p.pts - p.proj).toFixed(1)}</span>`;
  return '';
};

const unavailable = (p) => (p.kind === 'bye' ? 'on bye' : p.injury === 'IR' ? 'on IR' : p.injury === 'O' ? 'out' : null);
const projCell = (p) => unavailable(p)
  ? `<div class="stack" style="align-items: flex-end;"><span style="font-size: 13px; font-weight: 600; color: var(--warning); white-space: nowrap;">${unavailable(p)}</span><span class="label" style="font-size: 10px;">Proj</span></div>`
  : `<div class="stack num" style="align-items: flex-end;"><span style="font-size: 15px; font-weight: 600;">${p.proj.toFixed(1)}</span><span class="label" style="font-size: 10px;">Proj</span></div>`;
const ptsCell = (p) => {
  const color = p.pts == null ? 'var(--faint)' : p.kind === 'live' ? 'var(--danger)' : 'var(--ink)';
  return `<div class="stack num" style="align-items: flex-end;"><span class="display" style="font-size: 22px; font-weight: 700; line-height: 1; color: ${color};">${p.pts == null ? '–' : p.pts.toFixed(1)}</span><span class="label" style="font-size: 10px;">${p.kind === 'live' ? 'Live' : p.kind === 'final' ? 'Final' : 'Pts'}</span></div>`;
};

const COLS = '52px 40px minmax(0, 1fr) minmax(0, 1.55fr) minmax(0, 0.95fr) 64px 64px 38px';

const playerRow = (p, { slotLabel, stripe = false, highlight = false, locked = false } = {}) => {
  const bg = highlight ? 'var(--accent-soft)' : stripe ? 'var(--surface2)' : 'transparent';
  const outline = highlight ? 'box-shadow: inset 3px 0 0 var(--accent);' : '';
  return `<div style="display: grid; grid-template-columns: ${COLS}; gap: 14px; align-items: center; padding: 10px 16px; min-height: 64px; background: ${bg}; border-top: 1px solid var(--line); ${outline}">
    <span class="slot" style="${slotLabel === 'FLEX' ? 'font-size: 10px;' : ''}">${slotLabel || p.pos}</span>
    ${avatar(p)}
    <div class="stack" style="gap: 2px; min-width: 0;">
      <div class="row" style="gap: 6px; min-width: 0;"><span class="ellip" style="font-size: 14px; font-weight: 600;">${p.name}</span>${injuryTag(p)}${locked ? `<span style="color: var(--faint); display: inline-flex;">${ic.lock()}</span>` : ''}</div>
      <div class="row" style="gap: 6px;"><span class="pos" style="background: ${posVar(p.pos)};">${p.pos}</span><span class="note">${p.team}</span></div>
    </div>
    ${gameCell(p)}
    ${edgeCell(p)}
    ${projCell(p)}
    ${ptsCell(p)}
    <div class="btn sm icon" style="border: 0; color: var(--faint);">${locked ? ic.lock(16) : ic.swap()}</div>
  </div>`;
};

const columnHead = () => `<div class="label" style="display: grid; grid-template-columns: ${COLS}; gap: 14px; padding: 8px 16px 6px; font-size: 10px;">
  <span>Slot</span><span></span><span>Player</span><span>Game</span><span>Edge</span><span style="text-align: right;">Proj</span><span style="text-align: right;">Pts</span><span></span>
</div>`;

// ---------------------------------------------------------------------------
// Shared chrome
// ---------------------------------------------------------------------------
const nav = () => `<div class="row" style="height: 56px; padding: 0 24px; gap: 24px; background: var(--surface); border-bottom: 1px solid var(--line);">
  <div class="row display" style="gap: 10px; font-size: 22px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase;">
    <div style="width: 26px; height: 26px; border-radius: 7px; background: var(--accent); color: var(--on-accent); display: flex; align-items: center; justify-content: center;">${ic.ball()}</div>
    <span>Endzone Empire</span>
  </div>
  <div class="row" style="gap: 4px; margin-left: 8px;">
    ${['Dashboard', 'Lineup', 'Game Center', 'Players', 'Waivers', 'Trades'].map((n) => `<div style="padding: 8px 12px; border-radius: 8px; font-size: 14px; font-weight: 500; color: ${n === 'Lineup' ? 'var(--accent)' : 'var(--dim)'}; background: ${n === 'Lineup' ? 'var(--accent-soft)' : 'transparent'};">${n}</div>`).join('')}
  </div>
  <div class="grow"></div>
  <div class="row" style="gap: 6px; color: var(--dim);">
    <div class="btn icon" style="border: 0;">${ic.search()}</div>
    <div class="btn icon" style="border: 0;">${ic.bell()}</div>
    <div class="avatar" style="width: 32px; height: 32px; font-size: 12px; background: var(--home-soft); color: var(--home);">CA</div>
  </div>
</div>`;

const weekStepper = () => `<div class="row" style="gap: 6px;">
  <div class="btn icon" aria-label="Previous week">${ic.left()}</div>
  <div class="seg"><div>Wk 1</div><div>Wk 2</div><div class="on">Wk 3</div><div>Wk 4</div></div>
  <div class="btn icon" aria-label="Next week">${ic.right()}</div>
</div>`;

const statTile = (label, value, sub, tone) => `<div class="stack" style="gap: 2px; padding: 12px 18px; min-width: 0; border-left: 1px solid var(--line);">
  <span class="label">${label}</span>
  <span class="display num" style="font-size: 26px; font-weight: 700; line-height: 1.05; color: ${tone || 'var(--ink)'};">${value}</span>
  <span class="note ellip">${sub}</span>
</div>`;

// ---------------------------------------------------------------------------
// Desktop: Main.dc.html
// ---------------------------------------------------------------------------
const header = () => `<div class="stack" style="gap: 6px; margin-bottom: 18px;">
  <div class="row" style="gap: 8px; font-size: 13px; color: var(--faint);"><span>Leagues</span><span>/</span><span>Northwoods League</span><span>/</span><span style="color: var(--dim);">Lineup</span></div>
  <div class="row" style="justify-content: space-between; gap: 24px;">
    <div class="row" style="gap: 16px;">
      <div class="avatar" style="width: 56px; height: 56px; font-size: 20px; background: var(--home-soft); color: var(--home);">FF</div>
      <div class="stack">
        <div class="row" style="gap: 10px;"><h1 class="display" style="margin: 0; font-size: 36px; font-weight: 700; letter-spacing: .02em; line-height: 1.05; text-transform: uppercase;">Fargo Frostbite</h1><span class="chip you">Your team</span></div>
        <div class="row" style="gap: 10px; font-size: 13px; color: var(--dim);"><span class="num">2-0 · 3rd of 12</span><span style="color: var(--faint);">·</span><span class="num">FAAB $87</span><span style="color: var(--faint);">·</span><span class="row" style="gap: 6px; color: var(--faint); font-size: 12px;">${ic.sync()}<span>Scores synced 3:42 PM · next pass in 8 min</span></span></div>
      </div>
    </div>
    <div class="row" style="gap: 12px;">${weekStepper()}<div class="btn primary">${ic.bolt()}Apply advice</div></div>
  </div>
</div>`;

const summaryStrip = () => `<div class="card row" style="margin-bottom: 18px; overflow: hidden;">
  <div class="stack" style="gap: 2px; padding: 12px 18px; min-width: 220px;">
    <span class="label">Week 3 · vs Duluth Dockworkers</span>
    <div class="row" style="gap: 10px; align-items: baseline;"><span class="display num" style="font-size: 26px; font-weight: 700; line-height: 1.05;">76.6</span><span class="note num">of 128.4 proj</span></div>
    <div class="split" style="display: flex; height: 6px; border-radius: 999px; overflow: hidden; background: var(--surface3); margin-top: 4px;"><div style="width: 54%; background: var(--home);"></div><div style="width: 46%; background: var(--away);"></div></div>
    <span class="note num">Dockworkers 71.2 · proj 121.9</span>
  </div>
  ${statTile('Start/Sit advice', '+3.5', '1 swap · Rice for Lamb', 'var(--accent)')}
  ${statTile('Yet to play', '3 of 9', 'Starters · 6 locked', '')}
  ${statTile('Win probability', '58%', 'Up from 51% at kickoff', '')}
  <div class="stack grow" style="gap: 6px; padding: 12px 18px; border-left: 1px solid var(--line);">
    <span class="label">Needs attention</span>
    <div class="row" style="gap: 8px; flex-wrap: wrap;"><span class="chip warn">${ic.warn(12)}Lamb Q · ankle</span><span class="chip warn">Hubbard on bye</span><span class="chip bad">Wk 5 · 3 byes</span></div>
  </div>
</div>`;

const startersCard = () => `<div class="card" style="overflow: hidden;">
  <div class="row" style="justify-content: space-between; padding: 14px 18px 8px;">
    <div class="row" style="gap: 10px;"><span class="display" style="font-size: 20px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase;">Starters</span><span class="note">9 of 9 filled</span></div>
    
  </div>
  ${columnHead()}
  ${starters.map((p, i) => playerRow(p, { slotLabel: p.slot, locked: p.kind !== 'pre', highlight: p.flag === 'advice' })).join('')}
</div>`;

const benchCard = () => `<div class="card" style="overflow: hidden; margin-top: 18px;">
  <div class="row" style="justify-content: space-between; padding: 14px 18px 8px;">
    <div class="row" style="gap: 10px;"><span class="display" style="font-size: 20px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase;">Bench</span><span class="note">6 of 7 · sorted by projection</span></div>
    <span class="note num">Bench points left on the table this season: 41.8</span>
  </div>
  ${columnHead()}
  ${bench.map((p) => playerRow(p, { highlight: p.flag === 'startworthy', locked: p.kind === 'final' })).join('')}
  <div class="row" style="padding: 14px 18px; border-top: 1px solid var(--line); gap: 12px;">
    <span class="display" style="font-size: 16px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: var(--dim);">IR</span><span class="note">1 of 1</span>
  </div>
  ${ir.map((p) => playerRow(p, { slotLabel: 'IR' })).join('')}
</div>`;

const advicePanel = () => `<div class="card" style="overflow: hidden;">
  <div class="row" style="justify-content: space-between; padding: 14px 18px 10px;">
    <div class="row" style="gap: 8px;"><span style="color: var(--accent); display: inline-flex;">${ic.bolt(18)}</span><span class="display" style="font-size: 18px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase;">Start / Sit</span></div>
    <span class="chip">1 swap</span>
  </div>
  <div class="hair"></div>
  <div class="stack" style="padding: 14px 18px; gap: 12px;">
    <div class="row" style="gap: 10px;">
      <div class="stack grow" style="gap: 2px; min-width: 0;"><span class="label" style="color: var(--danger);">Sit</span><span class="ellip" style="font-weight: 600;">CeeDee Lamb</span><span class="note">WR · DAL · Q ankle</span></div>
      <span style="color: var(--faint); display: inline-flex;">${ic.swap(18)}</span>
      <div class="stack grow" style="gap: 2px; min-width: 0; text-align: right;"><span class="label" style="color: var(--accent);">Start</span><span class="ellip" style="font-weight: 600;">Rashee Rice</span><span class="note">WR · KC · healthy</span></div>
    </div>
    <div class="stack" style="gap: 6px;">
      <div class="row" style="justify-content: space-between; font-size: 12px;"><div class="stack"><span class="note">Lamb floor 6.4</span><span class="note">ceiling 24.1</span></div><div class="stack" style="text-align: right;"><span class="note">Rice floor 9.8</span><span class="note">ceiling 21.6</span></div></div>
      <div class="range"><div class="band" style="left: 20%; right: 20%;"></div><div class="tick" style="left: 54%;"></div><div class="tick" style="left: 52%; background: var(--warning);"></div></div>
      <div class="row" style="gap: 8px; flex-wrap: wrap;"><span class="chip sm warn">Lean</span><span class="note">Rice has the higher floor. Lamb keeps the ceiling if he plays every snap.</span></div>
    </div>
    <div class="stack" style="gap: 6px; font-size: 12px; color: var(--dim);">
      <div class="row" style="gap: 8px;">${ic.target()}<span>BAL allows the 4th-fewest points to WR. KC vs ATL has the week's 2nd-highest total.</span></div>
      <div class="row" style="gap: 8px;">${ic.clock()}<span>Both kick off Sun 4:25 PM. Decide by 4:20.</span></div>
    </div>
    <div class="row" style="gap: 8px;"><div class="btn sm primary">Apply swap</div><div class="btn sm">Compare</div><div class="btn sm" style="border: 0; color: var(--faint);">Dismiss</div></div>
  </div>
</div>`;

const outlookPanel = () => `<div class="card" style="overflow: hidden;">
  <div class="row" style="justify-content: space-between; padding: 14px 18px 10px;">
    <span class="display" style="font-size: 18px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase;">Bye clusters</span>
    <span class="note">Wk 4 to 10</span>
  </div>
  <div class="hair"></div>
  <div style="display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 6px; padding: 14px 18px 8px;">
    ${[['4', 0, []], ['5', 3, ['RB', 'RB', 'WR']], ['6', 1, ['TE']], ['7', 1, ['QB']], ['8', 0, []], ['9', 2, ['WR', 'DEF']], ['10', 1, ['K']]].map(([wk, n, ps]) => `<div class="tile stack" style="align-items: center; gap: 4px; padding: 8px 4px; ${n >= 3 ? 'border-color: var(--danger); background: var(--danger-soft);' : n === 2 ? 'border-color: var(--warning);' : ''}"><span class="label" style="font-size: 10px; white-space: nowrap;">Wk ${wk}</span><span class="display num" style="font-size: 20px; font-weight: 700; line-height: 1; color: ${n >= 3 ? 'var(--danger)' : n === 2 ? 'var(--warning)' : 'var(--ink)'};">${n}</span><div class="stack" style="gap: 2px; align-items: center;">${ps.map((p) => `<span class="pos" style="min-width: 26px; height: 16px; font-size: 9px; background: ${posVar(p)};">${p}</span>`).join('')}</div></div>`).join('')}
  </div>
  <div class="row" style="gap: 8px; padding: 4px 18px 14px; font-size: 12px; color: var(--dim);">${ic.warn()}<span>Week 5: Robinson, Hubbard and Reed all sit. Waivers close Tue 11:59 PM.</span></div>
</div>`;

const matchupPanel = () => `<div class="card" style="overflow: hidden;">
  <div class="row" style="justify-content: space-between; padding: 14px 18px 10px;">
    <span class="display" style="font-size: 18px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase;">Opponent this week</span>
    <a href="#" style="font-size: 12px; font-weight: 600;">Matchup</a>
  </div>
  <div class="hair"></div>
  <div class="stack" style="padding: 14px 18px; gap: 10px;">
    <div class="row" style="gap: 12px;"><div class="avatar" style="width: 36px; height: 36px; font-size: 13px; background: var(--away-soft); color: var(--away);">DD</div><div class="stack grow" style="min-width: 0;"><span class="ellip" style="font-weight: 600;">Duluth Dockworkers</span><span class="note num">1-1 · 7th · 71.2 live, 121.9 proj</span></div></div>
    <div class="stack" style="gap: 6px; font-size: 12px; color: var(--dim);">
      <div class="row" style="justify-content: space-between;"><span>Their best remaining</span><span class="num" style="color: var(--ink);">P. Mahomes · KC · 21.6</span></div>
      <div class="row" style="justify-content: space-between;"><span>Yet to play</span><span class="num" style="color: var(--ink);">5 starters</span></div>
      <div class="row" style="justify-content: space-between;"><span>Shared game</span><span class="num" style="color: var(--ink);">ATL @ KC · both sides</span></div>
    </div>
  </div>
</div>`;

const newsPanel = () => `<div class="card" style="overflow: hidden;">
  <div class="row" style="justify-content: space-between; padding: 14px 18px 10px;">
    <span class="display" style="font-size: 18px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase;">Your players in the news</span>
  </div>
  <div class="hair"></div>
  <div class="stack" style="padding: 6px 0;">
    ${[
      ['CeeDee Lamb', 'Full practice Friday, no designation change. Expected to play.', '2h ago'],
      ['Christian McCaffrey', 'Designated to return; 21-day window opens Week 5.', '1d ago'],
      ['Jayden Reed', 'Snap share climbed to 79% with Watson out.', '2d ago'],
    ].map(([n, t, when]) => `<div class="row" style="gap: 10px; padding: 8px 18px; align-items: flex-start;"><span style="color: var(--faint); display: inline-flex; margin-top: 2px;">${ic.news()}</span><div class="stack grow" style="gap: 2px; min-width: 0;"><span style="font-size: 13px; font-weight: 600;">${n}</span><span class="note" style="color: var(--dim);">${t}</span></div><span class="note" style="flex: none;">${when}</span></div>`).join('')}
  </div>
</div>`;

const main = page({
  width: 1440,
  height: 1640,
  body: `${nav()}
<div style="max-width: 1240px; margin: 0 auto; padding: 24px 24px 40px;">
  ${header()}
  ${summaryStrip()}
  <div style="display: grid; grid-template-columns: minmax(0, 1fr) 340px; gap: 20px; align-items: start;">
    <div class="stack" style="min-width: 0;">
      ${startersCard()}
      ${benchCard()}
    </div>
    <div class="stack" style="gap: 16px;">
      ${advicePanel()}
      ${outlookPanel()}
      ${matchupPanel()}
    </div>
  </div>
</div>`,
});

// ---------------------------------------------------------------------------
// Player decision card (row expanded / drawer). 560 wide.
// ---------------------------------------------------------------------------
const usageRow = (label, vals, tone) => `<div class="row num" style="gap: 8px; padding: 6px 0; border-top: 1px solid var(--line); font-size: 13px;"><span class="grow" style="color: var(--dim);">${label}</span>${vals.map((v, i) => `<span style="width: 52px; text-align: right; ${i === vals.length - 1 ? 'font-weight: 600;' : ''}">${v}</span>`).join('')}</div>`;

const decisionCard = page({
  width: 560,
  height: 1180,
  body: `<div class="stack" style="padding: 20px 22px 24px; gap: 16px;">
  <div class="row" style="gap: 14px;">
    <div class="avatar" style="width: 56px; height: 56px; font-size: 20px;">CL<span class="kit" style="background: ${kits.DAL}; width: 16px; height: 16px;"></span></div>
    <div class="stack grow" style="gap: 3px; min-width: 0;">
      <div class="row" style="gap: 8px;"><span class="display" style="font-size: 26px; font-weight: 700; line-height: 1; letter-spacing: .01em;">CeeDee Lamb</span><span class="chip sm warn">Q</span></div>
      <div class="row" style="gap: 8px; font-size: 13px; color: var(--dim);"><span class="pos" style="background: var(--pos-wr);">WR</span><span>DAL · #88</span><span style="color: var(--faint);">·</span><span>Starting WR2 · 5th year</span></div>
    </div>
    <div class="btn icon" style="border: 0; color: var(--faint);">${ic.x()}</div>
  </div>

  <div class="row" style="gap: 8px;"><div class="btn sm primary">${ic.swap(14)}Move to bench</div><div class="btn sm">${ic.compare(14)}Compare</div><div class="btn sm">Trade</div><div class="grow"></div><div class="btn sm icon" style="border: 0; color: var(--faint);">${ic.more()}</div></div>

  <div class="tile stack" style="padding: 12px 14px; gap: 8px; border-color: var(--warning); background: var(--warning-soft);">
    <div class="row" style="gap: 8px; color: var(--warning); font-weight: 600; font-size: 13px;">${ic.warn()}<span>Questionable · right ankle</span><span class="grow"></span><span class="note">Updated Fri 4:10 PM</span></div>
    <span class="note">Full practice Friday. Expected to play without a snap count.</span>
  </div>

  <div class="card stack" style="padding: 14px 16px; gap: 10px;">
    <div class="row" style="justify-content: space-between;"><span class="label">This week's game</span><span class="note">Sun 4:25 PM · FOX</span></div>
    <div class="row" style="gap: 12px;">
      <span class="display" style="font-size: 22px; font-weight: 700;">DAL vs BAL</span>
      <div class="grow"></div>
      <div class="stack num" style="align-items: flex-end; gap: 1px;"><span style="font-size: 14px; font-weight: 600;">BAL -2.5 · O/U 47</span><span class="note">DAL implied 22.3 · 18th of 32</span></div>
    </div>
    <div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px;">
      <div class="tile stack" style="padding: 8px 10px; gap: 2px;"><span class="label" style="font-size: 10px;">Weather</span><span class="row" style="gap: 6px; font-size: 13px; font-weight: 600;">${ic.sun()}84° · wind 4</span><span class="note">Outdoor · AT&amp;T Stadium roof open</span></div>
      <div class="tile stack" style="padding: 8px 10px; gap: 2px;"><span class="label" style="font-size: 10px;">Opponent factor</span><span style="font-size: 13px; font-weight: 600; color: var(--danger);">-1.1 · BAL vs WR</span><span class="note">BAL allows 28.1 pts/g to WR</span></div>
    </div>
  </div>

  <div class="card stack" style="padding: 14px 16px; gap: 10px;">
    <div class="row" style="justify-content: space-between;"><span class="label">Projection</span><span class="note">Endzone Forecast</span></div>
    <div class="row" style="gap: 14px; align-items: baseline;"><span class="display num" style="font-size: 34px; font-weight: 700; line-height: 1;">16.3</span><span class="note num">WR12 this week · floor 6.4 · ceiling 24.1</span></div>
    <div class="range" style="margin: 6px 0 2px;"><div class="band" style="left: 21%; right: 20%;"></div><div class="tick" style="left: 54%;"></div></div>
    <div class="row num" style="justify-content: space-between; font-size: 11px; color: var(--faint);"><span>0</span><span>10</span><span>20</span><span>30</span></div>
    <div class="row" style="gap: 8px; font-size: 12px; color: var(--dim);">${ic.info()}<span>Injury discount applied: minus 1.8 for a Q tag with a full Friday practice.</span></div>
  </div>

  <div class="card stack" style="padding: 14px 16px; gap: 4px;">
    <div class="row" style="justify-content: space-between; margin-bottom: 4px;"><span class="label">Usage · last 3 weeks (2 played)</span><span class="row num label" style="gap: 8px; font-size: 10px;"><span style="width: 52px; text-align: right;">Wk 1</span><span style="width: 52px; text-align: right;">Wk 2</span><span style="width: 52px; text-align: right;">Avg</span></span></div>
    ${usageRow('Targets', ['12', '9', '10.5'])}
    ${usageRow('Target share', ['31%', '26%', '28%'])}
    ${usageRow('Carries', ['1', '0', '0.5'])}
    ${usageRow('Air yards', ['118', '94', '106'])}
    ${usageRow('Fantasy pts', ['21.4', '13.8', '17.6'])}
    <div class="row" style="gap: 8px; font-size: 12px; color: var(--dim); padding-top: 8px;">${ic.trend()}<span>Top-3 WR in targets both weeks. Usage is not the question, the ankle is.</span></div>
  </div>

  <div class="card stack" style="padding: 14px 16px; gap: 8px;">
    <span class="label">Bench options for this slot</span>
    ${[['Rashee Rice', 'WR · KC vs ATL · 4:25', '15.8', 'Higher floor, healthy'], ['Jayden Reed', 'WR · GB @ LV · Mon', '12.4', 'Keeps a Monday hedge']].map(([n, m, p, why]) => `<div class="row" style="gap: 12px; padding: 8px 0; border-top: 1px solid var(--line);"><div class="stack grow" style="min-width: 0; gap: 1px;"><span style="font-weight: 600; font-size: 13px;">${n}</span><span class="note">${m}</span></div><span class="note ellip" style="max-width: 150px;">${why}</span><span class="display num" style="font-size: 20px; font-weight: 700;">${p}</span><div class="btn sm">Swap</div></div>`).join('')}
  </div>
</div>`,
});

// ---------------------------------------------------------------------------
// Mobile: 390 wide
// ---------------------------------------------------------------------------
const mRow = (p, { slotLabel, highlight = false, locked = false } = {}) => {
  const bg = highlight ? 'var(--accent-soft)' : 'transparent';
  const outline = highlight ? 'box-shadow: inset 3px 0 0 var(--accent);' : '';
  const status = p.kind === 'live'
    ? `<span class="chip sm live"><span class="dot"></span>${p.state}</span><span class="num" style="font-size: 12px; color: var(--dim); white-space: nowrap;">${p.score}</span>`
    : p.kind === 'final'
      ? `<span class="chip sm final">Final</span><span class="num" style="font-size: 12px; color: var(--dim); white-space: nowrap;">${p.score}</span>`
      : p.kind === 'bye'
        ? `<span class="chip sm warn">Bye</span>`
        : `<span style="font-size: 12px; font-weight: 600;">${p.opp}</span><span class="note">${p.state}</span>`;
  const second = p.kind === 'live'
    ? `${p.rz ? `<span class="row" style="gap: 3px; color: var(--danger); font-weight: 600;">${ic.redzone()}RZ</span>` : ''}<span class="ellip">${p.sit}</span>`
    : p.injury ? `<span class="row" style="gap: 4px; color: var(--warning);">${ic.warn(12)}<span class="ellip">${p.injuryText}</span></span>`
    : p.note ? `<span class="row" style="gap: 4px; color: var(--accent);">${ic.trend(12)}<span class="ellip">${p.note}</span></span>`
    : p.line ? `<span class="num ellip">${p.line}</span>${p.wxText ? `<span class="row" style="gap: 3px; flex: none;">${wxIcon(p)}${p.wxText}</span>` : ''}`
    : p.kind === 'final' ? `<span>${p.pts >= p.proj ? 'Beat' : 'Under'} projection by ${Math.abs(p.pts - p.proj).toFixed(1)}</span>` : '';
  return `<div style="display: grid; grid-template-columns: 40px 36px minmax(0, 1fr) 60px; gap: 10px; align-items: center; padding: 10px 14px; min-height: 68px; background: ${bg}; border-top: 1px solid var(--line); ${outline}">
    <span class="slot" style="width: 40px; ${slotLabel === 'FLEX' ? 'font-size: 9.5px;' : ''}">${slotLabel || p.pos}</span>
    ${avatar(p, 36)}
    <div class="stack" style="gap: 3px; min-width: 0;">
      <div class="row" style="gap: 6px; min-width: 0;"><span class="ellip" style="font-size: 14px; font-weight: 600;">${p.name}</span><span class="pos" style="min-width: 28px; height: 16px; font-size: 9px; background: ${posVar(p.pos)};">${p.pos}</span>${injuryTag(p)}${locked ? `<span style="color: var(--faint); display: inline-flex;">${ic.lock(12)}</span>` : ''}</div>
      <div class="row" style="gap: 6px; min-width: 0;">${status}</div>
      <div class="row" style="gap: 6px; font-size: 11px; color: var(--dim); min-width: 0;">${second}</div>
    </div>
    <div class="stack num" style="align-items: flex-end; gap: 1px;">
      <span class="display" style="font-size: 22px; font-weight: 700; line-height: 1; color: ${p.pts == null ? 'var(--faint)' : p.kind === 'live' ? 'var(--danger)' : 'var(--ink)'};">${p.pts == null ? '–' : p.pts.toFixed(1)}</span>
      <span class="note num" style="white-space: nowrap; ${unavailable(p) ? 'color: var(--warning);' : ''}">${unavailable(p) ? unavailable(p) : p.proj.toFixed(1) + ' proj'}</span>
    </div>
  </div>`;
};

const mobile = page({
  width: 390,
  height: 1660,
  body: `<div class="row" style="height: 52px; padding: 0 14px; gap: 10px; background: var(--surface); border-bottom: 1px solid var(--line);">
  <div style="width: 26px; height: 26px; border-radius: 7px; background: var(--accent); color: var(--on-accent); display: flex; align-items: center; justify-content: center;">${ic.ball()}</div>
  <div class="stack grow" style="min-width: 0;"><span class="display ellip" style="font-size: 18px; font-weight: 700; letter-spacing: .03em; text-transform: uppercase; line-height: 1.1;">Fargo Frostbite</span><span class="note num">2-0 · 3rd of 12 · Northwoods</span></div>
  <div class="btn icon" style="border: 0; width: 34px;">${ic.bell()}</div>
  <div class="avatar" style="width: 30px; height: 30px; font-size: 11px; background: var(--home-soft); color: var(--home);">CA</div>
</div>

<div class="stack" style="padding: 12px 14px 0; gap: 12px;">
  <div class="row" style="gap: 6px; justify-content: space-between;">
    <div class="btn icon sm" style="width: 30px;">${ic.left(16)}</div>
    <div class="seg grow" style="justify-content: center;"><div>Wk 2</div><div class="on">Wk 3</div><div>Wk 4</div></div>
    <div class="btn icon sm" style="width: 30px;">${ic.right(16)}</div>
  </div>

  <div class="card stack" style="padding: 12px 14px; gap: 8px;">
    <div class="row" style="justify-content: space-between;"><span class="label">vs Duluth Dockworkers</span><span class="chip sm">58% win</span></div>
    <div class="row" style="gap: 10px; align-items: baseline;"><span class="display num" style="font-size: 30px; font-weight: 700; line-height: 1;">76.6</span><span class="note num">of 128.4 proj</span><div class="grow"></div><span class="display num" style="font-size: 20px; font-weight: 600; color: var(--dim);">71.2</span></div>
    <div style="display: flex; height: 6px; border-radius: 999px; overflow: hidden; background: var(--surface3);"><div style="width: 54%; background: var(--home);"></div><div style="width: 46%; background: var(--away);"></div></div>
    <div class="row" style="gap: 6px; flex-wrap: wrap;"><span class="chip sm warn">${ic.warn(11)}Lamb Q</span><span class="chip sm warn">Hubbard bye</span><span class="chip sm bad">Wk 5 · 3 byes</span><span class="chip sm">3 of 9 to play</span></div>
  </div>

  <div class="card row" style="padding: 10px 12px; gap: 10px; border-color: var(--accent-line); background: var(--accent-soft);">
    <span style="color: var(--accent); display: inline-flex;">${ic.bolt(18)}</span>
    <div class="stack grow" style="min-width: 0; gap: 1px;"><span style="font-size: 13px; font-weight: 600;">Advice: +3.5 · 1 swap</span><span class="note ellip">Rice for Lamb (Q). Both 4:25 kickoffs.</span></div>
    <div class="btn sm primary">Apply</div>
  </div>

  <div class="seg" style="align-self: stretch;"><div class="on grow" style="justify-content: center;">Starters</div><div class="grow" style="justify-content: center;">Bench · 7</div><div class="grow" style="justify-content: center;">Outlook</div></div>
</div>

<div class="card" style="margin: 12px 14px 0; overflow: hidden;">
  ${starters.map((p) => mRow(p, { slotLabel: p.slot, locked: p.kind !== 'pre', highlight: p.flag === 'advice' })).join('')}
</div>
<div class="row" style="padding: 16px 14px 6px; gap: 8px;"><span class="display" style="font-size: 17px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase;">Bench</span><span class="note">by projection</span></div>
<div class="card" style="margin: 0 14px; overflow: hidden;">
  ${bench.slice(0, 4).map((p) => mRow(p, { highlight: p.flag === 'startworthy', locked: p.kind === 'final' })).join('')}
  <div class="row" style="justify-content: center; padding: 12px; border-top: 1px solid var(--line); font-size: 13px; font-weight: 600; color: var(--accent); gap: 6px;">Show 3 more${ic.chevD()}</div>
</div>

<div style="position: sticky; bottom: 0; margin-top: 18px; background: var(--surface); border-top: 1px solid var(--line); padding: 8px 8px 12px;">
  <div style="display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 4px;">
    ${[['Home', ic.home(), false], ['Lineup', ic.users(), true], ['Scores', ic.list(), false], ['Players', ic.search(), false]].map(([n, i, on]) => `<div class="stack" style="align-items: center; gap: 3px; padding: 6px 0; min-height: 44px; border-radius: 8px; color: ${on ? 'var(--accent)' : 'var(--faint)'}; background: ${on ? 'var(--accent-soft)' : 'transparent'};">${i}<span style="font-size: 10.5px; font-weight: 600;">${n}</span></div>`).join('')}
  </div>
</div>`,
});

// ---------------------------------------------------------------------------
// Mobile decision sheet (tap a row): same content as the card, phone width.
// ---------------------------------------------------------------------------
const mobileSheet = page({
  width: 390,
  height: 900,
  body: `<div style="padding: 60px 0 0; background: rgba(0,0,0,.35); min-height: 900px;">
  <div class="stack" style="background: var(--surface); border-radius: 18px 18px 0 0; padding: 10px 16px 24px; gap: 14px; min-height: 840px; box-shadow: var(--shadow-2);">
    <div style="width: 40px; height: 4px; border-radius: 2px; background: var(--line-strong); align-self: center;"></div>
    <div class="row" style="gap: 12px;">
      <div class="avatar" style="width: 48px; height: 48px; font-size: 17px;">CL<span class="kit" style="background: ${kits.DAL};"></span></div>
      <div class="stack grow" style="gap: 2px; min-width: 0;">
        <div class="row" style="gap: 8px;"><span class="display" style="font-size: 22px; font-weight: 700; line-height: 1;">CeeDee Lamb</span><span class="chip sm warn">Q</span></div>
        <div class="row" style="gap: 6px; font-size: 12px; color: var(--dim);"><span class="pos" style="background: var(--pos-wr); height: 16px; min-width: 28px; font-size: 9px;">WR</span><span>DAL · WR slot</span></div>
      </div>
      <div class="btn sm icon" style="border: 0; color: var(--faint);">${ic.x()}</div>
    </div>
    <div class="row" style="gap: 8px;"><div class="btn primary grow" style="height: 44px;">${ic.swap()}Move to bench</div><div class="btn grow" style="height: 44px;">${ic.compare()}Compare</div></div>

    <div class="tile stack" style="padding: 10px 12px; gap: 6px; border-color: var(--warning); background: var(--warning-soft);">
      <div class="row" style="gap: 6px; color: var(--warning); font-weight: 600; font-size: 13px;">${ic.warn()}<span>Questionable · right ankle</span><span class="grow"></span><span class="note">Fri 4:10 PM</span></div>
      <span class="note">Full practice Friday. Expected to play without a snap count.</span>
    </div>

    <div class="card stack" style="padding: 12px 14px; gap: 8px;">
      <div class="row" style="justify-content: space-between;"><span class="display" style="font-size: 18px; font-weight: 700;">DAL vs BAL</span><span class="note">Sun 4:25 · FOX</span></div>
      <div class="row num" style="justify-content: space-between; font-size: 13px;"><span style="font-weight: 600;">BAL -2.5 · O/U 47</span><span class="note">DAL implied 22.3</span></div>
      <div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px;">
        <div class="tile stack" style="padding: 8px 10px; gap: 1px;"><span class="label" style="font-size: 10px;">Weather</span><span class="row" style="gap: 5px; font-size: 13px; font-weight: 600;">${ic.sun()}84° · wind 4</span></div>
        <div class="tile stack" style="padding: 8px 10px; gap: 1px;"><span class="label" style="font-size: 10px;">Opponent factor</span><span style="font-size: 13px; font-weight: 600; color: var(--danger);">-1.1 · BAL vs WR</span></div>
      </div>
    </div>

    <div class="card stack" style="padding: 12px 14px; gap: 6px;">
      <div class="row" style="gap: 12px; align-items: baseline;"><span class="display num" style="font-size: 30px; font-weight: 700; line-height: 1;">16.3</span><span class="note num">WR12 · floor 6.4 · ceiling 24.1</span></div>
      <div class="range" style="margin-top: 6px;"><div class="band" style="left: 21%; right: 20%;"></div><div class="tick" style="left: 54%;"></div></div>
    </div>

    <div class="card stack" style="padding: 12px 14px; gap: 2px;">
      <div class="row" style="justify-content: space-between; margin-bottom: 4px;"><span class="label">Usage · last 3</span><span class="row num label" style="gap: 8px; font-size: 10px;"><span style="width: 44px; text-align: right;">Wk 1</span><span style="width: 44px; text-align: right;">Wk 2</span><span style="width: 44px; text-align: right;">Avg</span></span></div>
      ${[['Targets', ['12', '9', '10.5']], ['Target share', ['31%', '26%', '28%']], ['Carries', ['1', '0', '0.5']], ['Air yards', ['118', '94', '106']]].map(([l, v]) => `<div class="row num" style="gap: 8px; padding: 5px 0; border-top: 1px solid var(--line); font-size: 13px;"><span class="grow" style="color: var(--dim);">${l}</span>${v.map((x, i) => `<span style="width: 44px; text-align: right; ${i === 2 ? 'font-weight: 600;' : ''}">${x}</span>`).join('')}</div>`).join('')}
    </div>
  </div>
</div>`,
});

// ---------------------------------------------------------------------------
// Low-fi direction sketches (beside the deliverable, not instead of it).
// ---------------------------------------------------------------------------
const SKETCH_CSS = `
.sk{font-family:"Patrick Hand","Segoe Print","Comic Sans MS",cursive;color:#2b2f33}
.sk .box{border:2px solid #2b2f33;border-radius:6px;background:#fff}
.sk .ghost{border:2px dashed #8a9099;border-radius:6px;background:transparent;color:#6b7178}
.sk .bar{height:10px;border-radius:5px;background:#c9ced4}
.sk .hi{background:#fde68a}
`;
const sketch = (title, blurb, body) => page({
  width: 720,
  height: 700,
  extraCss: SKETCH_CSS,
  body: `<div class="sk stack" style="padding: 22px 24px; gap: 12px; background: #f6f3ea; min-height: 700px;">
  <div class="stack" style="gap: 2px;"><span style="font-size: 26px; font-weight: 700; line-height: 1.1;">${title}</span><span style="font-size: 15px; color: #5c636a;">${blurb}</span></div>
  ${body}
</div>`,
});

const skRow = (label, extra = '') => `<div class="box row" style="height: 40px; padding: 0 10px; gap: 10px; ${extra}"><span class="box" style="width: 44px; height: 22px; font-size: 12px; display: flex; align-items: center; justify-content: center;">${label}</span><span class="bar" style="width: 120px;"></span><span class="bar" style="width: 90px; background: #e2e5e9;"></span><span class="grow"></span><span class="bar" style="width: 36px;"></span><span class="bar" style="width: 36px;"></span></div>`;

const directionB = sketch('B · Command table', 'One dense, sortable grid. Every column a manager might sort on: proj, floor, ceiling, snap %, targets, O/U, kickoff. Expand a row for the decision card.',
  `<div class="box stack" style="padding: 10px; gap: 6px;">
    <div class="row" style="gap: 8px; font-size: 13px; padding: 0 10px;"><span style="width: 44px;">Slot</span><span style="width: 120px;">Player</span><span style="width: 60px;">Proj ▾</span><span style="width: 50px;">Floor</span><span style="width: 50px;">Ceil</span><span style="width: 50px;">Snap%</span><span style="width: 50px;">Tgt</span><span style="width: 50px;">O/U</span><span style="width: 70px;">Kick</span></div>
    ${['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'K', 'DEF'].map((s, i) => `<div class="row" style="gap: 8px; font-size: 13px; padding: 6px 10px; border-top: 1px solid #c9ced4; ${i === 4 ? 'background: #fde68a;' : ''}"><span style="width: 44px;">${s}</span><span class="bar" style="width: 110px;"></span><span style="width: 60px;">${(24 - i * 1.7).toFixed(1)}</span><span style="width: 50px;">${(12 - i).toFixed(0)}</span><span style="width: 50px;">${(30 - i * 2).toFixed(0)}</span><span style="width: 50px;">${90 - i * 4}%</span><span style="width: 50px;">${i % 2 ? 8 : 4}</span><span style="width: 50px;">${47 + (i % 3)}</span><span style="width: 70px;">Sun ${i % 2 ? '1:00' : '4:25'}</span></div>`).join('')}
    <div class="ghost row" style="padding: 8px 12px; font-size: 13px;">▸ expanded row: injury report · matchup · usage · swap candidates</div>
  </div>
  <div class="row" style="gap: 16px; font-size: 14px;"><span><b>Wins:</b> power users sort and scan in one screen</span><span><b>Costs:</b> weak on phones, no room for reasons</span></div>`);

const directionC = sketch('C · Slot board', 'Cards laid out like a depth chart. Each card is a mini decision: game state, edge line, proj. Tap to flip for the full card. Bench is a tray below.',
  `<div class="box" style="padding: 12px; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px;">
    ${['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'K', 'DEF'].map((s, i) => `<div class="box stack" style="padding: 8px 10px; gap: 6px; height: 92px; ${i === 4 ? 'background: #fde68a;' : ''}"><div class="row" style="justify-content: space-between; font-size: 12px;"><span>${s}</span><span>${i % 3 === 0 ? 'LIVE Q3' : i % 3 === 1 ? 'Sun 4:25' : 'FINAL'}</span></div><span class="bar" style="width: 70%;"></span><span class="bar" style="width: 50%; background: #e2e5e9;"></span><div class="row" style="justify-content: space-between; font-size: 13px;"><span>edge line</span><b>${(22 - i * 1.6).toFixed(1)}</b></div></div>`).join('')}
  </div>
  <div class="ghost row" style="padding: 8px 12px; gap: 8px; font-size: 13px;">Bench tray ▸ ${['RB', 'WR', 'WR', 'TE', 'RB'].map((p) => `<span class="box" style="padding: 2px 8px;">${p}</span>`).join('')}</div>
  <div class="row" style="gap: 16px; font-size: 14px;"><span><b>Wins:</b> glanceable on game day, fun on phones</span><span><b>Costs:</b> hard to compare two players side by side</span></div>`);

const directionA = sketch('A · Decision ledger (chosen)', 'Rows keep the slot order managers already know. Each row carries a game cell and one edge line. A right rail holds the why: start/sit, byes, opponent, news.',
  `<div class="row" style="gap: 10px; align-items: flex-start;">
    <div class="stack grow" style="gap: 6px;">
      <div class="box row" style="height: 44px; padding: 0 10px; gap: 12px; font-size: 13px;"><span>76.6 / 128.4</span><span>advice +3.5</span><span>4 to play</span><span class="hi" style="padding: 0 6px;">Lamb Q</span></div>
      ${['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'K', 'DEF'].map((s, i) => skRow(s, i === 4 ? 'background: #fde68a;' : '')).join('')}
      <div class="ghost row" style="height: 36px; padding: 0 10px; font-size: 13px;">Bench · same rows, sorted by proj</div>
    </div>
    <div class="stack" style="width: 190px; gap: 6px;">
      <div class="box stack" style="padding: 8px 10px; gap: 4px; font-size: 13px; height: 120px;"><b>Start / Sit</b><span>Rice for Lamb</span><span class="bar" style="width: 80%;"></span><span class="bar" style="width: 60%;"></span></div>
      <div class="box stack" style="padding: 8px 10px; gap: 4px; font-size: 13px; height: 90px;"><b>Bye outlook</b><span class="bar" style="width: 90%;"></span></div>
      <div class="box stack" style="padding: 8px 10px; gap: 4px; font-size: 13px; height: 80px;"><b>Opponent</b><span class="bar" style="width: 70%;"></span></div>
      <div class="box stack" style="padding: 8px 10px; gap: 4px; font-size: 13px; height: 80px;"><b>News</b><span class="bar" style="width: 70%;"></span></div>
    </div>
  </div>
  <div class="row" style="gap: 16px; font-size: 14px;"><span><b>Wins:</b> reasons next to the row, stacks cleanly on phones</span><span><b>Costs:</b> fewer raw columns than B</span></div>`);

// ---------------------------------------------------------------------------
// FSD slice map for the My Team page (extends the island on integration).
// ---------------------------------------------------------------------------
const tile = (name, note, isNew) => `<div class="tile stack" style="padding: 10px 12px; gap: 2px; min-width: 0; ${isNew ? 'border-color: var(--accent-line); background: var(--accent-soft);' : ''}"><span class="mono" style="font-size: 13px; font-weight: 600;">${name}</span><span class="note">${note}</span></div>`;
const layer = (name, sub, tiles) => `<div style="display: grid; grid-template-columns: 200px minmax(0, 1fr); gap: 16px; align-items: start; padding: 14px 0; border-top: 1px solid var(--line);">
  <div class="stack"><span class="display" style="font-size: 20px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase;">${name}</span><span class="note">${sub}</span></div>
  <div style="display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px;">${tiles.join('')}</div>
</div>`;

const fsd = page({
  width: 1200,
  height: 1040,
  body: `<div style="padding: 28px 32px;">
  <div class="row" style="justify-content: space-between; margin-bottom: 6px;">
    <h1 class="display" style="margin: 0; font-size: 30px; font-weight: 700; text-transform: uppercase;">FSD slice map · Lineup</h1>
    <div class="row" style="gap: 14px; font-size: 12px; color: var(--faint);"><span class="row" style="gap: 6px;"><span style="width: 12px; height: 12px; border-radius: 3px; background: var(--accent-soft); border: 1px solid var(--accent-line);"></span>New slice</span><span class="row" style="gap: 6px;"><span style="width: 12px; height: 12px; border-radius: 3px; background: var(--surface2); border: 1px solid var(--line);"></span>Exists on integration</span></div>
  </div>
  <p class="note" style="margin: 0 0 12px; max-width: 800px;">LineupScreen and TeamLineup (src/components) become one page slice in the island. Imports point down only. Widgets never import widgets; the page passes shared values down (ADR 0020). Entities import shared only (ADR 0029). Situation arrives through entities/nfl-game, the Line through entities/line; a widget never fetches.</p>
  ${layer('pages', 'Compose widgets and features', [
    tile('pages/lineup', 'Replaces LineupScreen + TeamLineup. Owns league pick, week, selection state', true),
    tile('pages/lineup/model/useLineupPage', 'Joins roster, lineup, advice, nfl-game, news into one view model', true),
    tile('pages/game-center', 'Exists · shares nfl-game-strip'),
    tile('pages/matchup', 'Exists · linked from Opponent panel'),
  ])}
  ${layer('widgets', 'One region each, read the entity', [
    tile('widgets/lineup-ledger', 'Starters + Bench + IR rows, column head, slot order', true),
    tile('widgets/team-summary-strip', 'Score vs opp, optimal delta, yet to play, attention chips', true),
    tile('widgets/start-sit-panel', 'Advice card with range bars and apply', true),
    tile('widgets/bye-cluster', 'Seven-week grid; two is notable, three a warning', true),
    tile('widgets/player-decision-card', 'Drawer on desktop, sheet on mobile', true),
    tile('widgets/matchup-preview', 'Exists · Opponent this week, reused as is'),
    tile('widgets/my-team-summary', 'Exists · record, rank, FAAB'),
  ])}
  ${layer('features', 'One user action each', [
    tile('features/swap-players', 'Select then target, optimistic PUT /api/team/lineup, offline queue', true),
    tile('features/apply-optimal-lineup', 'One-click apply of advice moves', true),
    tile('features/drop-player', 'DELETE + undo-drop toast', true),
    tile('features/pick-week', 'Exists · stepper + segmented'),
    tile('features/bench-what-if', 'Exists · bench points left'),
    tile('features/compare-players', 'Two decision cards side by side', true),
  ])}
  ${layer('entities', 'Domain read models, shared only', [
    tile('entities/roster', 'Exists · lineupModel, useTeamLineup'),
    tile('entities/nfl-game', 'Clock, score, Situation (live_game_states), NWS weather, roof', true),
    tile('entities/player-usage', 'nflverse weekly: snaps, targets, air yards, RZ', true),
    tile('entities/projection', 'Floor, Ceiling, top Factor; carried on the lineup entry', true),
    tile('entities/line', 'Spread, total, implied team total (ESPN odds provider)', true),
    tile('entities/matchup', 'Exists · win probability'),
  ])}
  ${layer('shared', 'No imports from above', [
    tile('shared/ui PosChip, InjuryTag, TeamAvatar', 'Exists'),
    tile('shared/ui SegmentedControl, StatTile, SplitBar', 'Exists'),
    tile('shared/ui RangeBar, GameStateChip', 'New · projection range, live/final/pre chip', true),
    tile('shared/lib kickoff, rosterSlots, numeric', 'Exists · lock + slot order'),
  ])}
</div>`,
});

// ---------------------------------------------------------------------------
writeFileSync(join(here, 'Main.dc.html'), main);
writeFileSync(join(here, 'PlayerDecisionCard.dc.html'), decisionCard);
writeFileSync(join(here, 'MyTeamMobile.dc.html'), mobile);
writeFileSync(join(here, 'MobileDecisionSheet.dc.html'), mobileSheet);
writeFileSync(join(here, 'DirectionA.dc.html'), directionA);
writeFileSync(join(here, 'DirectionB.dc.html'), directionB);
writeFileSync(join(here, 'DirectionC.dc.html'), directionC);
writeFileSync(join(here, 'FsdSliceMap.dc.html'), fsd);
console.log('wrote 8 artboards');
