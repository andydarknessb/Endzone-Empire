// Generates the .dc.html artboards for the League Dashboard v2 canvas.
// Run: node build.mjs   (writes Main.dc.html + siblings + canvas.json beside this file)
// Every artboard is self-contained (artboards share nothing at runtime), so
// the shared CSS below is inlined into each one. Tokens are lifted from
// src/theme/tokens.js (dash-* group, both modes) and the app-shell tokens the
// Nav paints; the [data-theme] blocks stand in for AppThemeProvider.
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Tokens (literal on purpose: the artboard has no theme provider).
// ---------------------------------------------------------------------------
const CSS = (width) => `
[data-theme="dark"]{
  --bg:#0b1015; --surface:#141b23; --surface2:#1b242f; --surface3:#222e3b;
  --line:rgba(154,183,211,.12); --line-strong:rgba(154,183,211,.22);
  --ink:#e8eef4; --dim:#93a4b5; --faint:#8a9bad;
  --accent:#2fd97b; --accent-soft:rgba(47,217,123,.12); --accent-line:rgba(47,217,123,.35); --on-accent:#0b1015;
  --grade-a:#2fd97b; --grade-b:#a8cc4a; --grade-c:#e5b04a; --grade-d:#e07a45; --grade-f:#e25c5c; --on-grade:#0b1015;
  --grade-a-text:#2fd97b; --grade-b-text:#a8cc4a; --grade-c-text:#e5b04a; --grade-d-text:#e07a45; --grade-f-text:#f07f7f;
  --home:#7eaaff; --home-soft:rgba(126,170,255,.16); --away:#7ee2a8; --away-soft:rgba(126,226,168,.16);
  --danger:#ff6b6b; --danger-soft:rgba(255,107,107,.14); --warning:#f0b34e; --warning-soft:rgba(240,179,78,.14);
  --pos-qb:#ff8a80; --pos-rb:#7ee2a8; --pos-wr:#7fb0ff; --pos-te:#f0b34e; --pos-k:#c4a2f5; --pos-def:#b0bec5; --on-pos:#0f1419;
  --app-bar:#222c37; --app-bg:#0f1419; --app-ink:#e6edf3; --app-accent:#7eaaff; --app-line:#2a3441;
  --shadow-1:0 1px 2px rgba(0,0,0,.45); --shadow-2:0 6px 16px rgba(0,0,0,.5);
}
[data-theme="light"]{
  --bg:#eef2f6; --surface:#ffffff; --surface2:#f4f7fa; --surface3:#e6ecf2;
  --line:rgba(31,45,58,.12); --line-strong:rgba(31,45,58,.22);
  --ink:#141b23; --dim:#55636f; --faint:#5e6a74;
  --accent:#0f6a41; --accent-soft:rgba(15,106,65,.12); --accent-line:rgba(15,106,65,.32); --on-accent:#ffffff;
  --grade-a:#2fd97b; --grade-b:#a8cc4a; --grade-c:#e5b04a; --grade-d:#e07a45; --grade-f:#e25c5c; --on-grade:#0b1015;
  --grade-a-text:#0f7a45; --grade-b-text:#587611; --grade-c-text:#8a6212; --grade-d-text:#b0491f; --grade-f-text:#c62f2f;
  --home:#1e5bb8; --home-soft:rgba(30,91,184,.10); --away:#1b7d4f; --away-soft:rgba(27,125,79,.08);
  --danger:#c62828; --danger-soft:rgba(198,40,40,.10); --warning:#8a5a00; --warning-soft:rgba(138,90,0,.12);
  --pos-qb:#c62828; --pos-rb:#15663f; --pos-wr:#1e5bb8; --pos-te:#9a5100; --pos-k:#6d28d9; --pos-def:#4b5c66; --on-pos:#ffffff;
  --app-bar:#ffffff; --app-bg:#f4f6f8; --app-ink:#1a2129; --app-accent:#1e5bb8; --app-line:#dde2e7;
  --shadow-1:0 1px 2px rgba(16,24,32,.08); --shadow-2:0 4px 12px rgba(16,24,32,.10);
}
*{box-sizing:border-box}
body{margin:0}
a{color:var(--accent);text-decoration:none}
a:hover{color:var(--accent);text-decoration:underline}
.root{width:${width}px;min-height:100%;overflow-x:hidden;background:var(--bg);color:var(--ink);font-family:"Archivo","Helvetica Neue",Arial,sans-serif;font-size:14px;line-height:1.45;-webkit-font-smoothing:antialiased}
.display{font-family:"Barlow Condensed",Impact,sans-serif}
.num{font-variant-numeric:tabular-nums}
.card{background:var(--surface);border:1px solid var(--line);border-radius:14px;color:var(--ink);min-width:0;overflow:hidden}
.tile{overflow:hidden}
.card-h{display:flex;align-items:center;gap:10px;padding:14px 18px;border-bottom:1px solid var(--line)}
.card-t{font-family:"Barlow Condensed",Impact,sans-serif;font-size:17px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--ink);margin:0}
.card-c{font-size:12px;font-weight:600;color:var(--faint)}
.card-tail{margin-left:auto;font-size:12px;color:var(--faint);display:flex;align-items:center;gap:8px}
.tile{display:flex;flex-direction:column;gap:2px;padding:10px 12px;min-width:0;background:var(--surface2);border:1px solid var(--line);border-radius:10px}
.tile .l{font-size:11px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--faint);white-space:nowrap}
.tile .v{font-family:"Barlow Condensed",Impact,sans-serif;font-size:24px;font-weight:700;line-height:1.2;color:var(--ink);font-variant-numeric:tabular-nums}
.tile.sm .v{font-family:"Archivo","Helvetica Neue",Arial,sans-serif;font-size:14px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tile .l{overflow:hidden;text-overflow:ellipsis}
.chip{display:inline-flex;align-items:center;gap:6px;padding:4px 10px;border-radius:999px;font-size:11.5px;font-weight:600;letter-spacing:.04em;border:1px solid var(--line);background:var(--surface2);color:var(--dim);white-space:nowrap;line-height:1.3}
.chip.live{background:var(--accent-soft);color:var(--accent);border-color:var(--accent-line)}
.chip.you{background:var(--accent-soft);color:var(--accent);border-color:var(--accent-line);font-size:10.5px;font-weight:700;letter-spacing:.08em}
.chip.warn{background:var(--warning-soft);color:var(--warning);border-color:var(--warning)}
.chip.danger{background:var(--danger-soft);color:var(--danger);border-color:var(--danger)}
.chip.success{background:var(--away-soft);color:var(--away);border-color:var(--away)}
.dot{width:8px;height:8px;border-radius:999px;background:currentColor;flex:none}
.pos{display:inline-flex;align-items:center;justify-content:center;min-width:34px;height:20px;padding:0 6px;border-radius:6px;font-size:10.5px;font-weight:700;letter-spacing:.06em;color:var(--on-pos)}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;height:38px;padding:0 16px;border-radius:9px;font-size:13px;font-weight:600;border:1px solid var(--line-strong);color:var(--dim);background:transparent;white-space:nowrap;line-height:1.2}
.btn.primary{background:var(--accent);border-color:var(--accent);color:var(--on-accent)}
.btn.ink{color:var(--ink)}
.btn.sm{height:32px;padding:0 12px;font-size:12.5px}
.btn.lg{height:44px}
.btn.danger{color:var(--danger);border-color:var(--danger)}
.btn.band{width:100%;justify-content:space-between;height:44px;background:var(--surface2);border-color:var(--line);color:var(--ink);padding:0 10px}
.label{font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--faint)}
.hair{height:1px;background:var(--line)}
.avatar{display:flex;align-items:center;justify-content:center;border-radius:999px;background:var(--surface3);color:var(--ink);font-weight:700;flex:none;font-size:12px}
.split{display:flex;height:8px;border-radius:999px;overflow:hidden;background:var(--surface3)}
.row{display:flex;align-items:center}
.stack{display:flex;flex-direction:column}
.grow{flex:1 1 0;min-width:0}
.ellip{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.note{font-size:12px;color:var(--faint)}
.grade{display:flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:999px;font-family:"Barlow Condensed",Impact,sans-serif;font-size:14px;font-weight:700;color:var(--on-grade);flex:none}
table{border-collapse:collapse;width:100%;font-family:"Archivo","Helvetica Neue",Arial,sans-serif}
th{text-align:left;padding:10px 12px;font-size:11px;font-weight:600;letter-spacing:.07em;text-transform:uppercase;color:var(--faint);white-space:nowrap;box-shadow:inset 0 -1px 0 var(--line);background:var(--surface)}
td{padding:10px 12px;font-size:13.5px;color:var(--ink);white-space:nowrap;border-top:1px solid var(--line);font-variant-numeric:tabular-nums}
th.r,td.r{text-align:right}
table.m th,table.m td{padding:10px 8px}
td.muted{color:var(--dim)}
tr.me td{background:var(--accent-soft);box-shadow:inset 3px 0 0 var(--accent)}
tr.cut td{border-top:2px solid var(--line-strong)}
.nav{height:56px;display:flex;align-items:center;gap:22px;padding:0 20px;background:var(--app-bar);color:var(--app-ink);border-bottom:1px solid var(--app-line);font-family:"Inter","Roboto","Helvetica","Arial",sans-serif}
.nav .brand{font-weight:800;font-size:17px;color:var(--app-accent);display:flex;align-items:center;gap:8px}
.nav .links{display:flex;gap:18px;font-size:13px;color:var(--app-ink)}
.nav .links{height:56px;align-items:stretch}
.nav .links span{display:flex;align-items:center}
.nav .links .on{color:var(--app-accent);box-shadow:inset 0 -2px 0 var(--app-accent)}
.nav .search{margin-left:auto;height:32px;width:170px;border:1px solid var(--app-line);border-radius:8px;display:flex;align-items:center;padding:0 10px;font-size:12px;color:var(--dim);gap:8px}
.switch{width:34px;height:18px;border-radius:999px;background:var(--surface3);border:1px solid var(--line-strong);position:relative;flex:none}
.switch::after{content:"";position:absolute;top:2px;left:2px;width:12px;height:12px;border-radius:999px;background:var(--dim)}
.switch.on{background:var(--accent-soft);border-color:var(--accent-line)}
.switch.on::after{left:18px;background:var(--accent)}
.field{height:38px;border:1px solid var(--line-strong);border-radius:9px;display:flex;align-items:center;padding:0 12px;font-size:13px;color:var(--ink);background:var(--surface);gap:8px;justify-content:space-between}
.field .ph{color:var(--dim)}
.sect{display:flex;align-items:center;gap:10px;height:40px;padding:0 12px;border-radius:9px;font-size:13.5px;font-weight:600;color:var(--dim)}
.sect.on{background:var(--accent-soft);color:var(--accent)}
.fsd-box{border:1px solid var(--line);border-radius:10px;padding:10px 12px;background:var(--surface2);font-size:12.5px;line-height:1.35}
.fsd-box b{display:block;font-family:"Barlow Condensed",Impact,sans-serif;font-size:15px;letter-spacing:.04em;text-transform:uppercase;font-weight:600;color:var(--ink)}
.fsd-box.new{border-color:var(--accent-line);background:var(--accent-soft)}
.fsd-box.changed{border-color:var(--warning);background:var(--warning-soft)}
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
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600;700&amp;family=Archivo:wght@400;500;600;700&amp;family=Inter:wght@400;600;800&amp;display=swap">
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
    chevR: '<path d="M7.5 4.5 13 10l-5.5 5.5"/>',
    chevD: '<path d="M5 7.5 10 12.5 15 7.5"/>',
    chevU: '<path d="M5 12.5 10 7.5l5 5"/>',
    check: '<path d="M4 10.5 8 14.5 16 6"/>',
    clock: '<circle cx="10" cy="10" r="7"/><path d="M10 6v4l3 2"/>',
    swap: '<path d="M4 7h11m0 0-3-3m3 3-3 3M16 13H5m0 0 3-3m-3 3 3 3"/>',
    list: '<path d="M4 6h12M4 10h12M4 14h12"/>',
    menu: '<path d="M3 6h14M3 10h14M3 14h14"/>',
    search: '<circle cx="9" cy="9" r="5.5"/><path d="m13 13 4 4"/>',
    bell: '<path d="M5 14V9a5 5 0 0 1 10 0v5l1.5 2h-13z"/><path d="M8.5 17.5a1.5 1.5 0 0 0 3 0"/>',
    gear: '<circle cx="10" cy="10" r="2.5"/><path d="M10 3v2M10 15v2M3 10h2M15 10h2M5 5l1.5 1.5M13.5 13.5 15 15M5 15l1.5-1.5M13.5 6.5 15 5"/>',
    lock: '<rect x="5" y="9" width="10" height="8" rx="1.5"/><path d="M7 9V6.5a3 3 0 0 1 6 0V9"/>',
    users: '<circle cx="7.5" cy="7" r="2.5"/><circle cx="13.5" cy="8" r="2"/><path d="M3 16a4.5 4.5 0 0 1 9 0M12 16a3.5 3.5 0 0 1 5-3"/>',
    board: '<rect x="3" y="4" width="14" height="12" rx="1.5"/><path d="M3 8h14M8 8v8"/>',
    tv: '<rect x="2.5" y="4.5" width="15" height="10" rx="1.5"/><path d="M7 17.5h6"/>',
    ballot: '<rect x="4" y="3" width="12" height="14" rx="1.5"/><path d="m7 10 2 2 4-4"/>',
    trend: '<path d="M3 14l4.5-5 3 3L17 6"/><path d="M13 6h4v4"/>',
    trophy: '<path d="M6 4h8v4a4 4 0 0 1-8 0z"/><path d="M6 6H3.5a2.5 2.5 0 0 0 2.5 3M14 6h2.5A2.5 2.5 0 0 1 14 9M10 12v3M7 16h6"/>',
    book: '<path d="M4 4h5a2 2 0 0 1 2 2v10a1.5 1.5 0 0 0-1.5-1.5H4zM16 4h-5a2 2 0 0 0-2 2v10a1.5 1.5 0 0 1 1.5-1.5H16z"/>',
    copy: '<rect x="7" y="7" width="9" height="9" rx="1.5"/><path d="M13 7V5.5A1.5 1.5 0 0 0 11.5 4h-6A1.5 1.5 0 0 0 4 5.5v6A1.5 1.5 0 0 0 5.5 13H7"/>',
    chat: '<path d="M4 5.5A1.5 1.5 0 0 1 5.5 4h9A1.5 1.5 0 0 1 16 5.5v7a1.5 1.5 0 0 1-1.5 1.5H8l-4 3z"/>',
    arrowR: '<path d="M4 10h12m0 0-4-4m4 4-4 4"/>',
    alert: '<path d="M10 3.5 17 16H3z"/><path d="M10 8v4M10 14v.5"/>',
    shield: '<path d="M10 3 4 5.5V10c0 3.5 2.5 6 6 7 3.5-1 6-3.5 6-7V5.5z"/>',
    star: '<path d="m10 3 2.1 4.4 4.9.7-3.5 3.4.8 4.8L10 14l-4.3 2.3.8-4.8L3 8.1l4.9-.7z"/>',
    calendar: '<rect x="3" y="4.5" width="14" height="12" rx="1.5"/><path d="M3 8.5h14M7 3v3M13 3v3"/>',
    activity: '<path d="M3 10h3l2-5 4 10 2-5h3"/>',
  };
  return `<svg width="${size}" height="${size}" viewBox="0 0 20 20" fill="none" stroke="${color}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]}</svg>`;
};

// ---------------------------------------------------------------------------
// Sample data (invented; marked as sample at handover). Week 3, Tuesday
// morning: Week 2 is settled, Week 3 lineups are open. Viewer is Dockworkers,
// a commissioner (the league creator).
// ---------------------------------------------------------------------------
const TEAMS = [
  { n: 'Frostbite', i: 'FB', rec: '2-0', pct: '1.000', pf: '271.8', pa: '221.4', strk: 'W2', g: 'A', net: '+118.2', steal: 'Brock Purdy (pick 114, ADP 87.9)', reach: 'Jake Ferguson (pick 138, ADP 147.6)' },
  { n: 'Dockworkers', i: 'DW', rec: '2-0', pct: '1.000', pf: '258.1', pa: '230.0', strk: 'W2', g: 'B', net: '+95.6', steal: 'Matthew Golden (pick 126, ADP 96.2)', reach: 'Tyler Warren (pick 67, ADP 71.2)', me: true },
  { n: 'Iron Range', i: 'IR', rec: '2-0', pct: '1.000', pf: '244.7', pa: '212.9', strk: 'W2', g: 'B', net: '+92.3', steal: 'Jonathon Brooks (pick 141, ADP 88.6)', reach: 'Lamar Jackson (pick 21, ADP 56.2)' },
  { n: 'Lakeshore Lions', i: 'LL', rec: '1-1', pct: '.500', pf: '239.9', pa: '236.5', strk: 'W1', g: 'B', net: '+89.2', steal: 'Kyler Murray (pick 161, ADP 129.5)', reach: 'Trey McBride (pick 32, ADP 43.1)' },
  { n: 'Portage Pirates', i: 'PP', rec: '1-1', pct: '.500', pf: '231.2', pa: '228.7', strk: 'L1', g: 'B', net: '+82.1', steal: 'Minnesota Vikings (pick 156, ADP 114.1)', reach: 'Sam LaPorta (pick 85, ADP 97.9)' },
  { n: 'Superior Storm', i: 'SS', rec: '1-1', pct: '.500', pf: '226.4', pa: '241.0', strk: 'W1', g: 'C', net: '+77.3', steal: 'Zach Charbonnet (pick 178, ADP 137.8)', reach: 'Evan McPherson (pick 154, ADP 175)' },
  { n: 'Copper Kings', i: 'CK', rec: '1-1', pct: '.500', pf: '224.0', pa: '233.6', strk: 'L1', g: 'C', net: '+72.3', steal: 'George Kittle (pick 129, ADP 88.6)', reach: 'Josh Jacobs (pick 25, ADP 83.4)' },
  { n: 'Northwoods Owls', i: 'NO', rec: '1-1', pct: '.500', pf: '219.6', pa: '224.8', strk: 'L1', g: 'C', net: '+65.0', steal: 'Pittsburgh Steelers (pick 171, ADP 145.6)', reach: 'Tucker Kraft (pick 94, ADP 109.5)' },
  { n: 'Duluth Draft Dodgers', i: 'DD', rec: '1-1', pct: '.500', pf: '212.3', pa: '240.1', strk: 'W1', g: 'D', net: '+9.6', steal: 'Jacory Croskey-Merritt (pick 125, ADP 103.4)', reach: 'Malik Lemon (pick 92, ADP 61.0)' },
  { n: 'Sault Sasquatch', i: 'SQ', rec: '0-2', pct: '.000', pf: '204.5', pa: '250.2', strk: 'L2', g: 'D', net: '-12.9', steal: 'Woody Marks (pick 160, ADP 134.6)', reach: 'Jayden Daniels (pick 64, ADP 75.5)' },
  { n: 'Thunder Bay Trawlers', i: 'TB', rec: '0-2', pct: '.000', pf: '198.8', pa: '246.3', strk: 'L2', g: 'F', net: '-31.5', steal: 'Cooper Kupp (pick 179, ADP 157.5)', reach: 'Dallas Goedert (pick 62, ADP 118)' },
  { n: 'Mackinac Mules', i: 'MM', rec: '0-2', pct: '.000', pf: '187.2', pa: '253.0', strk: 'L2', g: 'F', net: '-44.0', steal: 'Rashid Shaheed (pick 182, ADP 150.2)', reach: 'Kenny Pickett (pick 140, ADP 199)' },
];
const ME = TEAMS[1];

const STARTERS = [
  { pos: 'QB', name: 'Jared Goff', team: 'DET', opp: 'vs GB', when: 'Sun 4:25', proj: '19.2', st: 'ok' },
  { pos: 'RB', name: 'Bijan Robinson', team: 'ATL', opp: '@ CAR', when: 'Sun 1:00', proj: '17.8', st: 'ok' },
  { pos: 'RB', name: 'Josh Jacobs', team: 'GB', opp: '@ DET', when: 'Sun 4:25', proj: '15.1', st: 'ok' },
  { pos: 'WR', name: 'Justin Jefferson', team: 'MIN', opp: 'vs CHI', when: 'Mon 8:15', proj: '18.9', st: 'ok' },
  { pos: 'WR', name: 'Amon-Ra St. Brown', team: 'DET', opp: 'vs GB', when: 'Sun 4:25', proj: '16.4', st: 'q' },
  { pos: 'TE', name: 'Sam LaPorta', team: 'DET', opp: 'vs GB', when: 'Sun 4:25', proj: '9.7', st: 'ok' },
];

const AROUND = [
  { a: TEAMS[1], b: TEAMS[0], pa: '112.4', pb: '118.9', share: 44, me: true },
  { a: TEAMS[2], b: TEAMS[3], pa: '109.0', pb: '104.6', share: 55 },
  { a: TEAMS[4], b: TEAMS[5], pa: '101.3', pb: '107.7', share: 43 },
  { a: TEAMS[6], b: TEAMS[7], pa: '98.5', pb: '96.2', share: 52 },
  { a: TEAMS[8], b: TEAMS[9], pa: '95.1', pb: '92.8', share: 53 },
  { a: TEAMS[10], b: TEAMS[11], pa: '90.4', pb: '84.7', share: 58 },
];

const ACTIVITY = [
  { t: '2h ago', team: TEAMS[0], type: 'Waiver', v: 'neutral', text: 'Claimed Rashid Shaheed, dropped Dontayvion Wicks' },
  { t: '5h ago', team: TEAMS[2], type: 'Trade', v: 'live', text: 'Sent Josh Jacobs to Lakeshore Lions for David Montgomery' },
  { t: 'Yesterday', team: TEAMS[1], type: 'Add', v: 'success', text: 'Added Tank Bigsby from free agents' },
  { t: 'Yesterday', team: TEAMS[11], type: 'Drop', v: 'danger', text: 'Dropped Kenny Pickett' },
  { t: 'Mon', team: TEAMS[6], type: 'Waiver', v: 'neutral', text: 'Claimed J.K. Dobbins at priority 3' },
  { t: 'Mon', team: null, type: 'Settings', v: 'warn', text: 'Commissioner set the waiver clear period to 48h' },
  { t: 'Sun', team: TEAMS[9], type: 'Lineup', v: 'neutral', text: 'Moved Jayden Daniels to the bench after kickoff lock' },
  { t: 'Sun', team: TEAMS[4], type: 'Add', v: 'success', text: 'Added Minnesota Vikings D/ST' },
];

const FACTS = [
  ['Transactions', 'Open'],
  ['Teams locked', '0 of 12'],
  ['Trade deadline', 'Week 11'],
  ['Waivers', 'Priority · 48h'],
  ['Trade review', '24h'],
  ['Roster', '9 starters · 6 bench · 1 IR'],
  ['Scoring', 'Half PPR'],
];

const QUICK = [
  { g: 'Play', items: [
    ['board', 'Draft Room', 'Draft complete · review the board'],
    ['list', 'Set Lineup', 'Week 3 lineup set · 1 questionable', true],
    ['tv', 'Game Center', 'Week 3 live scores'],
    ['ballot', "Pick'em", 'Week 3 picks lock at kickoff'],
  ] },
  { g: 'Moves', items: [
    ['swap', 'Waivers', 'Claims process Wed 3:00 AM'],
    ['users', 'Trades', '1 offer awaiting your review'],
  ] },
  { g: 'League', items: [
    ['activity', 'Activity', 'Recent roster and league moves'],
    ['trend', 'Power Rankings', 'See where your team stacks up'],
    ['trophy', 'History', 'Past seasons and champions'],
    ['book', 'League Rules', 'Scoring and roster settings'],
    ['gear', 'Draft Settings', 'Configure the upcoming draft'],
  ] },
];

// ---------------------------------------------------------------------------
// Small parts.
// ---------------------------------------------------------------------------
const chip = (text, cls = '', dot = false) =>
  `<span class="chip ${cls}">${dot ? '<span class="dot"></span>' : ''}${text}</span>`;
const avatar = (t, size = 28) =>
  `<span class="avatar" style="width:${size}px;height:${size}px;font-size:${Math.round(size * 0.4)}px">${t.i}</span>`;
const grade = (g) => `<span class="grade" style="background:var(--grade-${g.toLowerCase()})">${g}</span>`;
const pos = (p) => `<span class="pos" style="background:var(--pos-${p.toLowerCase()})">${p}</span>`;
const tile = (l, v, cls = '') => `<div class="tile ${cls}"><span class="l">${l}</span><span class="v">${v}</span></div>`;
const cardH = (title, { count, tail } = {}) =>
  `<div class="card-h"><h2 class="card-t">${title}</h2>${count != null ? `<span class="card-c">${count}</span>` : ''}${tail ? `<span class="card-tail">${tail}</span>` : ''}</div>`;
const btn = (label, cls = '', ic = '') => `<span class="btn ${cls}">${ic}${label}</span>`;
const split = (share, h = 8) =>
  `<div class="split" style="height:${h}px"><div style="width:${share}%;background:var(--home)"></div><div style="flex:1;background:var(--away)"></div></div>`;

function nav(mobile = false) {
  if (mobile) {
    return `<div class="nav" style="padding:0 14px;gap:14px">${icon('menu', 22, 'var(--app-ink)')}<span class="brand">Endzone Empire</span><span style="margin-left:auto;display:flex;gap:14px;align-items:center">${icon('search', 20, 'var(--app-ink)')}${icon('bell', 20, 'var(--app-ink)')}<span class="avatar" style="width:28px;height:28px;background:var(--app-accent);color:#fff">A</span></span></div>`;
  }
  return `<div class="nav"><span class="brand">${icon('shield', 18, 'var(--app-accent)')}Endzone Empire</span><span class="links"><span>Home</span><span class="on">League</span><span>Discover</span><span>Players</span><span>Roster</span><span>Mock Draft</span></span><span class="search">${icon('search', 14)}Search players...</span>${icon('bell', 20, 'var(--app-ink)')}${icon('gear', 20, 'var(--app-ink)')}<span class="avatar" style="width:32px;height:32px;background:var(--app-accent);color:#fff;font-size:14px">A</span></div>`;
}

// ---------------------------------------------------------------------------
// Dashboard blocks (shared by the desktop and mobile artboards).
// ---------------------------------------------------------------------------
function header(mobile) {
  const chips = `<span class="row" style="gap:8px;flex-wrap:wrap">${chip('Week 3 · In season', 'live')}${chip('12 Teams')}${chip('Draft Complete')}</span>`;
  if (mobile) {
    return `<div class="stack" style="gap:10px">
  <h1 class="display" style="margin:0;font-size:28px;font-weight:700;letter-spacing:.02em;text-transform:uppercase;color:var(--ink);line-height:1.05">Great Lakes Gridiron</h1>
  ${chips}
  <div class="row" style="gap:8px">${btn('Invite <code style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;color:var(--ink)">7K3D9Q</code>', 'lg', icon('copy', 16))}</div>
</div>`;
  }
  return `<div class="row" style="gap:14px;flex-wrap:wrap;align-items:baseline">
  <h1 class="display" style="margin:0;font-size:34px;font-weight:700;letter-spacing:.02em;text-transform:uppercase;color:var(--ink);line-height:1.05">Great Lakes Gridiron</h1>
  ${chips}
  <span class="row" style="margin-left:auto;gap:10px">${btn('Invite <code style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;color:var(--ink)">7K3D9Q</code>', 'sm', icon('copy', 16))}</span>
</div>`;
}

// The commissioner strip: one band directly under the header, commissioner
// only. Facts read left to right, the queue and the week control sit at the
// end. Administration is a link to its own route, never a tree inside a rail.
function commissionerStrip(mobile) {
  const facts = FACTS.slice(0, 5).map(([l, v]) => tile(l, v, 'sm')).join('');
  if (mobile) {
    return `<section class="card" style="padding:12px 14px;display:flex;flex-direction:column;gap:12px">
  <div class="row" style="gap:10px">
    <h2 class="card-t">Commissioner</h2>
    <span style="margin-left:auto;display:flex;align-items:center;gap:8px;min-width:0">${chip('Join requests · 2', 'warn')}${icon('chevD', 18, 'var(--dim)')}</span>
  </div>
  <div style="display:grid;grid-template-columns:repeat(2, minmax(0, 1fr));gap:8px">${FACTS.slice(0, 4).map(([l, v]) => tile(l, v, 'sm')).join('')}</div>
  <div class="stack" style="gap:8px">${btn('Advance to Week 4', 'lg ink', icon('arrowR', 16))}${btn('League administration', 'lg', icon('gear', 16))}</div>
</section>`;
  }
  return `<section class="card" style="padding:12px 18px;display:flex;align-items:center;gap:14px">
  <div class="stack" style="gap:2px;flex:none;min-width:130px">
    <h2 class="card-t">Commissioner</h2>
    <span class="note">Commissioners only · 2</span>
  </div>
  <div style="display:grid;grid-template-columns:repeat(5, minmax(0, 1fr));gap:8px;flex:1 1 0;min-width:0">${facts}</div>
  <span class="row" style="gap:8px;flex:none">
    ${chip('Join requests · 2', 'warn')}
    ${btn('Advance to Week 4', 'sm ink', icon('arrowR', 16))}
    ${btn('League administration', 'sm', icon('gear', 16))}
  </span>
</section>`;
}

function myTeam(mobile) {
  const starters = STARTERS.slice(0, mobile ? 4 : 5).map((s) => `
    <div class="row" style="gap:10px;padding:7px 0;border-top:1px solid var(--line)">
      ${pos(s.pos)}
      <span class="grow stack" style="gap:1px">
        <span class="ellip" style="font-size:13.5px;font-weight:600">${s.name}${s.st === 'q' ? ` <span class="chip warn" style="padding:1px 6px;font-size:10px;margin-left:4px">Q</span>` : ''}</span>
        <span class="note ellip">${s.team} ${s.opp} · ${s.when}</span>
      </span>
      <span class="num" style="font-size:13.5px;font-weight:700">${s.proj}</span>
    </div>`).join('');
  return `<section class="card" style="padding:20px;display:flex;flex-direction:column;gap:16px;height:100%">
  <div class="row" style="gap:14px">
    ${avatar(ME, 48)}
    <div class="stack" style="gap:4px;min-width:0">
      <span class="row" style="gap:8px;flex-wrap:wrap"><h2 class="display" style="margin:0;font-size:24px;font-weight:700;letter-spacing:.02em;line-height:1.1">${ME.n}</h2>${chip('You', 'you')}</span>
      <span style="font-size:12.5px;color:var(--faint)">2-0 · 2nd of 12 · 258.1 PF</span>
    </div>
  </div>
  <div style="display:grid;grid-template-columns:repeat(${mobile ? 2 : 4}, minmax(0, 1fr));gap:10px">
    ${tile('Draft grade', '<span style="color:var(--grade-b-text)">B</span>')}
    ${tile('Proj. finish', '4th <small style="font-size:13px;font-weight:600;font-family:Archivo,sans-serif;color:var(--dim)">+1</small>')}
    ${tile('Playoff odds', '71%')}
    ${tile('Roster', '16/16')}
  </div>
  <div class="stack" style="gap:0;flex:1 1 auto">
    <div class="row" style="gap:8px;padding-bottom:6px"><span class="label">Starters · Week 3</span><span class="note" style="margin-left:auto">Proj. 112.4</span></div>
    ${starters}
    <span class="note" style="padding-top:8px">${mobile ? 'and 5 more starters' : 'and 4 more starters'} · 1 questionable</span>
  </div>
  <div class="row" style="gap:10px;padding-top:12px;border-top:1px solid var(--line)">
    <span class="row" style="gap:6px;font-size:12.5px;color:var(--dim)">${icon('check', 16, 'var(--accent)')}Lineup set · 9 of 9</span>
    <span style="margin-left:auto">${btn('Set Lineup', mobile ? 'lg primary' : 'primary')}</span>
  </div>
</section>`;
}

function matchup(mobile) {
  const side = (t, proj) => `<div class="stack" style="align-items:center;text-align:center;gap:6px;min-width:0">
    ${avatar(t, 44)}
    <span class="ellip" style="font-size:14px;font-weight:600;max-width:100%">${t.n}</span>
    <span class="display num" style="font-size:30px;font-weight:700;line-height:1.1">${proj}</span>
    <span class="label">Projected</span>
  </div>`;
  return `<section class="card" style="display:flex;flex-direction:column;height:100%">
  ${cardH('Week 3 Matchup', { tail: chip('Kicks off Sun 1:00 PM', '', false) })}
  <div style="padding:18px;display:grid;grid-template-columns:minmax(0,1fr);gap:14px;flex:1 1 auto">
    <div style="display:grid;grid-template-columns:minmax(0,1fr) auto minmax(0,1fr);align-items:center;gap:12px">
      ${side(ME, '112.4')}
      <span class="display" style="justify-self:center;font-size:16px;font-weight:600;color:var(--faint);border:1px solid var(--line);border-radius:999px;padding:6px 12px">VS</span>
      ${side(TEAMS[0], '118.9')}
    </div>
    <div style="display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:6px 10px;align-items:baseline">
      <span class="num" style="font-size:13px;font-weight:700">44%</span><span class="label" style="justify-self:center">Win probability</span><span class="num" style="font-size:13px;font-weight:700">56%</span>
      <div style="grid-column:1 / -1">${split(44)}</div>
    </div>
    <p style="margin:0;font-size:12px;text-align:center;color:var(--faint)">Projected margin · Frostbite by 6.5</p>
    <div style="display:grid;grid-template-columns:repeat(3, minmax(0,1fr));gap:8px">
      ${tile('Head to head', '1-1', 'sm')}${tile('Their streak', mobile ? 'W2' : 'W2 · 271.8 PF', 'sm')}${tile('Last meeting', mobile ? 'L 98-105' : 'L 98.2-104.6', 'sm')}
    </div>
  </div>
  <div class="row" style="gap:10px;justify-content:flex-end;padding:14px 18px;border-top:1px solid var(--line)">
    ${btn('Compare rosters', mobile ? 'lg' : '')}${btn('Set Lineup', mobile ? 'lg primary' : 'primary')}
  </div>
</section>`;
}

function aroundLeague(mobile) {
  const tiles = AROUND.map((m) => `
    <div class="tile" style="padding:10px 12px;gap:6px;${m.me ? 'border-color:var(--accent-line);box-shadow:0 0 0 1px var(--accent-line);' : ''}${mobile ? 'flex:0 0 200px;' : ''}">
      <div class="row" style="gap:8px">${avatar(m.a, 20)}<span class="ellip grow" style="font-size:12.5px;font-weight:600">${m.a.n}</span><span class="num" style="font-size:13px;font-weight:700">${m.pa}</span></div>
      <div class="row" style="gap:8px">${avatar(m.b, 20)}<span class="ellip grow" style="font-size:12.5px;font-weight:600">${m.b.n}</span><span class="num" style="font-size:13px;font-weight:700">${m.pb}</span></div>
      ${split(m.share, 5)}
    </div>`).join('');
  return `<section class="card">
  ${cardH('Around the league', { count: mobile ? '6' : '6 matchups', tail: mobile ? '<a>Game Center</a>' : 'Projected · <a>Game Center</a>' })}
  <div style="padding:14px 18px;display:${mobile ? 'flex' : 'grid'};${mobile ? 'gap:10px;overflow-x:auto' : 'grid-template-columns:repeat(6, minmax(0,1fr));gap:10px'}">${tiles}</div>
</section>`;
}

function standings(mobile) {
  const rows = TEAMS.map((t, i) => `
    <tr class="${t.me ? 'me' : ''} ${i === 6 ? 'cut' : ''}">
      <td class="r muted">${i + 1}</td>
      <td><span class="row" style="gap:10px;min-width:0">${avatar(t, 28)}<span class="stack" style="gap:2px;min-width:0"><span class="row" style="gap:8px"><span class="ellip" style="font-weight:600;max-width:${mobile ? '104px' : '260px'}">${t.n}</span>${t.me ? chip('You', 'you') : ''}</span>${mobile ? `<span class="note ellip">${t.pf} PF · ${t.pa} PA</span>` : ''}</span></span></td>
      <td class="r">${t.rec}</td>
      ${mobile ? '' : `<td class="r">${t.pct}</td><td class="r">${t.pf}</td><td class="r">${t.pa}</td>`}
      <td class="r">${t.strk}</td>
    </tr>`).join('');
  return `<section class="card">
  ${cardH('Standings', { count: '12', tail: 'Through Week 2 · playoff line after 6' })}
  <table class="${mobile ? 'm' : ''}">
    <thead><tr><th class="r">Rank</th><th>Team</th><th class="r">Record</th>${mobile ? '' : '<th class="r">PCT</th><th class="r">PF</th><th class="r">PA</th>'}<th class="r">STRK</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
</section>`;
}

// Draft grades, compact: one 40px row per Team (grade, name, net). The steal
// and reach lines show on the viewer's row only; a footer toggle opens them
// for every row. Today every row carries two lines and the card is 1119px.
function draftGrades(mobile) {
  const rows = TEAMS.map((t) => `
    <div class="row" style="gap:10px;padding:${t.me ? '8px 18px' : '7px 18px'};border-top:1px solid var(--line);${t.me ? 'background:var(--accent-soft);box-shadow:inset 3px 0 0 var(--accent)' : ''}">
      ${grade(t.g)}
      <span class="grow stack" style="gap:2px;min-width:0">
        <span class="row" style="gap:8px"><span class="ellip" style="font-size:13.5px">${t.n}</span>${t.me ? chip('You', 'you') : ''}</span>
        ${t.me ? `<span class="note ellip">Steal: ${t.steal} · Reach: ${t.reach}</span>` : ''}
      </span>
      <span class="num" style="font-size:13px;font-weight:600">${t.net}</span>
    </div>`).join('');
  return `<section class="card">
  ${cardH('Draft Grades', { tail: 'Net vs ADP' })}
  ${rows}
  <div class="row" style="padding:10px 18px;border-top:1px solid var(--line);gap:8px">
    <span class="note">Higher is better: a steal fell to the Team later than its ADP.</span>
    <a style="margin-left:auto;font-size:12.5px;font-weight:600;white-space:nowrap">Show steals and reaches</a>
  </div>
</section>`;
}

function recentActivity(mobile) {
  const rows = ACTIVITY.slice(0, mobile ? 5 : 8).map((a) => `
    <div class="row" style="gap:10px;padding:8px 18px;border-top:1px solid var(--line)">
      ${chip(a.type, a.v === 'neutral' ? '' : a.v)}
      <span class="grow stack" style="gap:1px;min-width:0">
        <span class="ellip" style="font-size:13px;font-weight:600">${a.team ? a.team.n : 'Commissioner'}</span>
        <span class="ellip" style="font-size:12.5px;color:var(--dim)">${a.text}</span>
      </span>
      <span class="note" style="flex:none">${a.t}</span>
    </div>`).join('');
  return `<section class="card">
  ${cardH('Recent activity', { count: `${ACTIVITY.length}`, tail: '<a>All activity</a>' })}
  ${rows}
</section>`;
}

// Quick actions as a grouped list: the card and its h2 stay (ruling in #936),
// the tiles become 40px rows so the card is as tall as its content, never a
// grid with empty tracks.
function quickActions(mobile) {
  const group = (g) => `
    <div class="stack" style="gap:2px">
      <span class="label display" style="font-size:12px;font-weight:700;letter-spacing:.08em;padding:12px 18px 6px">${g.g} · ${g.items.length}</span>
      ${g.items.map(([ic, l, s, rec]) => `
      <div class="row" style="gap:12px;padding:${mobile ? '10px 18px' : '7px 18px'};min-height:${mobile ? '48px' : '40px'}">
        <span style="width:30px;height:30px;border-radius:8px;background:var(--surface2);display:grid;place-items:center;color:${rec ? 'var(--accent)' : 'var(--dim)'};flex:none">${icon(ic, 16)}</span>
        <span class="grow stack" style="gap:0;min-width:0"><span class="row" style="gap:8px"><span class="display" style="font-size:14px;font-weight:700;letter-spacing:.01em">${l}</span>${rec ? chip('Recommended', 'live') : ''}</span><span class="note ellip">${s}</span></span>
        ${icon('chevR', 16, 'var(--faint)')}
      </div>`).join('')}
    </div>`;
  const body = mobile
    ? QUICK.map(group).join('')
    : `<div style="display:grid;grid-template-columns:repeat(2, minmax(0, 1fr));gap:0 8px"><div>${group(QUICK[0])}${group(QUICK[1])}</div><div>${group(QUICK[2])}</div></div>`;
  return `<section class="card">
  ${cardH('Quick Actions')}
  <div style="padding-bottom:8px">${body}</div>
</section>`;
}

const chatFab = (mobile) => `<span style="position:absolute;right:${mobile ? 16 : 24}px;bottom:${mobile ? 16 : 24}px;width:56px;height:56px;border-radius:999px;background:var(--accent);color:var(--on-accent);display:grid;place-items:center;box-shadow:var(--shadow-2)">${icon('chat', 22)}</span>`;

// ---------------------------------------------------------------------------
// Dashboard · Desktop (1440). Container 1200 with 24px padding = 1152 content,
// the app's Container maxWidth="lg". Row gap 22px as the shell uses.
// ---------------------------------------------------------------------------
function dashboardDesktop() {
  return `${nav()}
<div style="position:relative;max-width:1200px;margin:0 auto;padding:28px 24px 40px;display:grid;grid-template-columns:minmax(0,1fr);gap:22px">
  ${header(false)}
  ${commissionerStrip(false)}
  <div style="display:grid;grid-template-columns:5fr 7fr;gap:22px;align-items:stretch">
    ${myTeam(false)}
    ${matchup(false)}
  </div>
  ${aroundLeague(false)}
  <div style="display:grid;grid-template-columns:minmax(0,8fr) 4fr;gap:22px;align-items:start">
    ${standings(false)}
    ${draftGrades(false)}
  </div>
  <div style="display:grid;grid-template-columns:minmax(0,8fr) 4fr;gap:22px;align-items:start">
    ${quickActions(false)}
    ${recentActivity(false)}
  </div>
</div>
${chatFab(false)}`;
}

// ---------------------------------------------------------------------------
// Dashboard · Mobile (390). One column, 16px gutters, 44px targets. The
// commissioner strip is a compact card, so the viewer's own team is the
// second block, not the fourth screen.
// ---------------------------------------------------------------------------
function dashboardMobile() {
  return `${nav(true)}
<div style="position:relative;padding:20px 16px 96px;display:grid;grid-template-columns:minmax(0,1fr);gap:18px">
  ${header(true)}
  ${commissionerStrip(true)}
  ${myTeam(true)}
  ${matchup(true)}
  ${aroundLeague(true)}
  ${standings(true)}
  ${draftGrades(true)}
  ${recentActivity(true)}
  ${quickActions(true)}
</div>
${chatFab(true)}`;
}

// ---------------------------------------------------------------------------
// Commissioner console · /league/:id/commissioner. A section rail beside a
// 720px form column. The legacy CommissionerTools sections compose as-is
// inside the column (cut ruling on #617); this page only re-parents them.
// ---------------------------------------------------------------------------
const SECTIONS = [
  ['gear', 'General settings', true],
  ['calendar', 'Season'],
  ['users', 'Roster settings'],
  ['trend', 'Scoring settings'],
  ['trophy', 'Playoffs &amp; schedule'],
  ['swap', 'Waivers &amp; trades'],
  ['alert', 'System overrides'],
];

function joinRequests(mobile) {
  const req = (name, when) => `
    <div class="row" style="gap:12px;padding:12px 18px;border-top:1px solid var(--line);flex-wrap:${mobile ? 'wrap' : 'nowrap'}">
      <span class="avatar" style="width:32px;height:32px">${name.split(' ').map((w) => w[0]).join('').slice(0, 2)}</span>
      <span class="grow stack" style="gap:2px;min-width:160px"><span style="font-size:13.5px;font-weight:600">${name}</span><span class="note">Proposed Team name · requested ${when}</span></span>
      <span class="row" style="gap:8px;${mobile ? 'width:100%' : ''}">${btn('Deny', mobile ? 'lg' : 'sm')}${btn('Approve', mobile ? 'lg primary' : 'sm primary')}</span>
    </div>`;
  return `<section class="card">
  ${cardH('Join requests', { count: '2', tail: chip('Needs you', 'warn') })}
  ${req('Bayfield Buccaneers', '2h ago')}
  ${req('Keweenaw Kraken', 'yesterday')}
</section>`;
}

function generalSettings(mobile) {
  return `<section class="card">
  ${cardH('General settings')}
  <div style="padding:18px;display:grid;grid-template-columns:minmax(0,1fr);gap:18px">
    <div class="row" style="gap:12px">
      <span class="switch"></span>
      <span class="grow stack" style="gap:2px"><span style="font-size:13.5px;font-weight:600">Lock transactions</span><span class="note">Applies immediately. Freezes adds, drops, waiver claims and trades for the entire league.</span></span>
    </div>
    <div class="hair"></div>
    <div class="stack" style="gap:10px">
      <span style="font-size:13.5px;font-weight:600">Co-commissioners</span>
      <span class="note">Co-commissioners get every commissioner power except deleting the league and managing this list.</span>
      <div class="row" style="gap:10px;padding:10px 12px;border:1px solid var(--line);border-radius:10px;background:var(--surface2)">${avatar(TEAMS[2], 28)}<span class="grow ellip" style="font-size:13.5px;font-weight:600">Iron Range</span>${chip('Co-commissioner')}${btn('Remove', 'sm')}</div>
      <div class="row" style="gap:10px;flex-wrap:wrap"><span class="field" style="flex:1 1 220px"><span class="ph">Add a co-commissioner</span>${icon('chevD', 16, 'var(--dim)')}</span>${btn('Promote', mobile ? 'lg ink' : 'ink')}</div>
    </div>
    <div class="hair"></div>
    <div class="stack" style="gap:10px">
      <span style="font-size:13.5px;font-weight:600">Team limits</span>
      <div class="row" style="gap:10px"><span class="field" style="flex:1;min-width:0"><span>Min teams</span><span class="num">8</span></span><span class="field" style="flex:1;min-width:0"><span>Max teams</span><span class="num">12</span></span></div>
    </div>
    <div class="row" style="gap:10px;justify-content:flex-end">${btn('Discard', mobile ? 'lg' : '')}${btn('Save changes', mobile ? 'lg primary' : 'primary')}</div>
  </div>
</section>`;
}

function destructive(mobile) {
  return `<section class="card" style="border-color:var(--danger)">
  <div class="card-h" style="border-bottom-color:var(--danger-soft)"><h2 class="card-t" style="color:var(--danger)">Destructive actions</h2><span class="card-tail">${chip('Owner only', 'danger')}</span></div>
  <div style="padding:18px;display:grid;grid-template-columns:minmax(0,1fr);gap:16px">
    <div class="row" style="gap:12px;flex-wrap:wrap"><span class="grow stack" style="gap:2px;min-width:200px"><span style="font-size:13.5px;font-weight:600">Remove a team</span><span class="note">Teams can't be removed once the draft has started. Removing one would rewrite the draft, rosters and schedule.</span></span>${btn('Remove a team', mobile ? 'lg danger' : 'sm danger')}</div>
    <div class="hair"></div>
    <div class="row" style="gap:12px;flex-wrap:wrap"><span class="grow stack" style="gap:2px;min-width:200px"><span style="font-size:13.5px;font-weight:600">Delete this league</span><span class="note">Deletes every team, roster, matchup and trophy. Cannot be undone.</span></span>${btn('Delete league', mobile ? 'lg danger' : 'sm danger')}</div>
  </div>
</section>`;
}

function consoleHeader(mobile) {
  return `<div class="stack" style="gap:10px">
  <span class="row" style="gap:6px;font-size:12.5px;color:var(--faint)"><a>Great Lakes Gridiron</a>${icon('chevR', 14, 'var(--faint)')}<span>Commissioner</span></span>
  <div class="row" style="gap:14px;flex-wrap:wrap;align-items:baseline">
    <h1 class="display" style="margin:0;font-size:${mobile ? 28 : 34}px;font-weight:700;letter-spacing:.02em;text-transform:uppercase;line-height:1.05">Commissioner console</h1>
    ${chip('Week 3 · In season', 'live')}${chip('Commissioners · 2')}
    ${mobile ? '' : `<span style="margin-left:auto">${btn('Advance to Week 4', 'sm ink', icon('arrowR', 16))}</span>`}
  </div>
  ${mobile ? btn('Advance to Week 4', 'lg ink', icon('arrowR', 16)) : ''}
</div>`;
}

function consoleDesktop() {
  const rail = SECTIONS.map(([ic, l, on]) => `<span class="sect ${on ? 'on' : ''}">${icon(ic, 16)}${l}</span>`).join('');
  return `${nav()}
<div style="max-width:1200px;margin:0 auto;padding:28px 24px 40px;display:grid;grid-template-columns:minmax(0,1fr);gap:22px">
  ${consoleHeader(false)}
  <div style="display:grid;grid-template-columns:repeat(7, minmax(0,1fr));gap:8px">${FACTS.map(([l, v]) => tile(l, v, 'sm')).join('')}</div>
  <div style="display:grid;grid-template-columns:240px minmax(0,1fr);gap:22px;align-items:start">
    <nav class="card" style="padding:8px;display:grid;gap:2px;position:sticky;top:22px">
      ${rail}
      <div class="hair" style="margin:6px 4px"></div>
      <span class="sect" style="color:var(--warning)">${icon('users', 16)}Join requests<span class="chip warn" style="margin-left:auto;padding:1px 7px">2</span></span>
      <span class="sect" style="color:var(--danger)">${icon('alert', 16)}Destructive actions</span>
    </nav>
    <div style="max-width:720px;display:grid;gap:22px">
      ${joinRequests(false)}
      ${generalSettings(false)}
      ${destructive(false)}
    </div>
  </div>
</div>`;
}

function consoleMobile() {
  return `${nav(true)}
<div style="padding:20px 16px 40px;display:grid;grid-template-columns:minmax(0,1fr);gap:18px">
  ${consoleHeader(true)}
  <div style="display:grid;grid-template-columns:repeat(2, minmax(0, 1fr));gap:8px">${FACTS.slice(0, 4).map(([l, v]) => tile(l, v, 'sm')).join('')}</div>
  <span class="field" style="height:44px"><span class="row" style="gap:8px">${icon('gear', 16, 'var(--dim)')}General settings</span>${icon('chevD', 16, 'var(--dim)')}</span>
  ${joinRequests(true)}
  ${generalSettings(true)}
  ${destructive(true)}
</div>`;
}

// ---------------------------------------------------------------------------
// FSD slice map for the two pages.
// ---------------------------------------------------------------------------
function fsdMap() {
  const box = (name, text, cls = '') => `<div class="fsd-box ${cls}"><b>${name}</b>${text}</div>`;
  const layer = (title, boxes, cols) => `
    <div class="stack" style="gap:8px">
      <span class="label">${title}</span>
      <div style="display:grid;grid-template-columns:repeat(${cols}, minmax(0,1fr));gap:10px">${boxes.join('')}</div>
    </div>`;
  return `<div style="padding:28px;display:grid;gap:22px">
  <div class="row" style="gap:14px;align-items:baseline"><h1 class="display" style="margin:0;font-size:30px;font-weight:700;letter-spacing:.02em;text-transform:uppercase">League Dashboard v2 · FSD slice map</h1><span class="note">ADR 0020 island, extended. Green = new slice, amber = changed slice, plain = unchanged.</span></div>
  <div class="row" style="gap:16px">${chip('New', 'live')}${chip('Changed', 'warn')}${chip('Unchanged')}</div>
  ${layer('pages', [
    box('pages/league-dashboard', 'Composes the strip, hero, around-the-league, two 8/4 rows. Owns leagueId, week, viewerTeamId. Page-level test seam unchanged.', 'changed'),
    box('pages/commissioner-console', 'Route /league/:id/commissioner. Section rail + 720px column. Mounts CommissionerTools as-is (cut ruling #617), join requests and destructive zone.', 'new'),
  ], 2)}
  ${layer('widgets', [
    box('commissioner-strip', 'Replaces commissioner-panel: facts, join count, advance-week, link to the console. No administration tree inside.', 'changed'),
    box('my-team-summary', 'Adds the starters list (entities/roster) and the lineup-status footer. Stretches to the hero row.', 'changed'),
    box('matchup-preview', 'Adds the first-kickoff tail and the three context tiles (H2H, streak, last meeting).', 'changed'),
    box('around-the-league', 'Six compact matchup tiles from entities/matchup useLeagueMatchups; viewer tile ringed.', 'new'),
    box('standings-table', 'Unchanged table; tail states the settled week and the playoff line.', ''),
    box('draft-grades', 'Compact rows (40px); steal/reach on the viewer row, footer toggle for all rows.', 'changed'),
    box('recent-activity', 'Rail card: eight rows from GET /api/league/:id/transactions; type Badge, Team, sentence, time.', 'new'),
    box('quick-actions', 'Same card and h2; tiles become grouped rows in two columns (Play + Moves, League).', 'changed'),
  ], 4)}
  ${layer('features', [
    box('advance-week', 'Unchanged; mounted by the strip and the console header.'),
    box('copy-invite', 'Unchanged; header.'),
    box('decide-join-request', 'Approve / Deny one request; today inside CommissionerTools.', 'new'),
    box('toggle-grade-details', 'Show steals and reaches for every draft-grades row.', 'new'),
  ], 4)}
  ${layer('entities', [
    box('entities/matchup', 'useLeagueMatchups (ADR 0029). Around-the-league reads it.'),
    box('entities/standings', 'useLeagueStandings. Unchanged.'),
    box('entities/roster', 'useTeamLineup(leagueId, week) over GET /api/team/lineup. Starters list.', 'new'),
    box('entities/activity', 'useLeagueTransactions over GET /api/league/:id/transactions.', 'new'),
  ], 4)}
  ${layer('shared', [
    box('shared/ui', 'Card, Badge, StatTile, GradeChip, PosChip, Skeleton. StatTile gains the compact (sm) value style used by the strip.', 'changed'),
    box('shared/lib', 'useEndpoint. Unchanged.'),
  ], 2)}
  <span class="note">Import rules as ADR 0020: page composes widgets; widgets never import widgets; entities and shared depend on nothing above them. Contrast pairings this canvas adds: none, every ink-on-surface pair is already registered; the commissioner strip paints faint and ink on surface2 tiles over a card.</span>
</div>`;
}

// ---------------------------------------------------------------------------
// Write.
// ---------------------------------------------------------------------------
const files = {
  'Main.dc.html': page({ width: 1440, height: 2300, body: dashboardDesktop() }),
  'DashboardMobile.dc.html': page({ width: 390, height: 4620, body: dashboardMobile() }),
  'CommissionerConsole.dc.html': page({ width: 1440, height: 1420, body: consoleDesktop() }),
  'CommissionerConsoleMobile.dc.html': page({ width: 390, height: 1900, body: consoleMobile() }),
  'FsdSliceMap.dc.html': page({ width: 1200, height: 1240, body: fsdMap() }),
};
for (const [name, html] of Object.entries(files)) writeFileSync(join(here, name), html);

const note = (id, x, y, w, text, pageId) => ({ id, x, y, w, text, page: pageId });
const canvas = {
  pages: [
    { id: 'dashboard', name: 'League Dashboard' },
    { id: 'console', name: 'Commissioner console' },
    { id: 'fsd', name: 'FSD plan' },
  ],
  artboards: [
    { file: 'Main.dc.html', title: 'Dashboard · Desktop', x: 0, y: 0, w: 1440, h: 2300, page: 'dashboard' },
    { file: 'DashboardMobile.dc.html', title: 'Dashboard · Mobile', x: 1540, y: 0, w: 390, h: 4620, page: 'dashboard' },
    { file: 'CommissionerConsole.dc.html', title: 'Commissioner console · Desktop', x: 0, y: 0, w: 1440, h: 1420, page: 'console' },
    { file: 'CommissionerConsoleMobile.dc.html', title: 'Commissioner console · Mobile', x: 1540, y: 0, w: 390, h: 1900, page: 'console' },
    { file: 'FsdSliceMap.dc.html', title: 'FSD slice map', x: 0, y: 0, w: 1200, h: 1240, page: 'fsd' },
  ],
  annotations: [
    note('audit', 0, -560, 470, 'AUDIT · League Dashboard today (measured in Chromium on production, league 137, commissioner view, 1200px container)\n1. Hero row: My Team is 174px tall beside a 329px matchup card. 155px of bare page under My Team, every load.\n2. Main row: Standings is 729px; the rail beside it is 1648px (Draft Grades 1119 + Commissioner 507). 919px of bare page under the standings. The rail is sticky but taller than the viewport, so it never pins.\n3. Commissioner box: opening League administration renders a 672px-wide tree inside a 377px card. The card, the tabs strip and the destructive box overflow the rail by 295px onto the page background, and the fact tiles reflow to five across.\n4. Commissioner Tools inside the box: seven tabs behind a scroll arrow, forms that want ~720px in a 307-377px column.\n5. Quick Actions: 11 tiles on an auto-fill grid; Moves fills 2 of 6 tracks, Play 4 of 6.\n6. My Team shows three tiles and not one of the viewer\'s players; Roster value is a dash. The roster read is already made.\n7. Mobile (code): the commissioner card moves above the hero, so a commissioner scrolls ~900px before their own team.', 'dashboard'),
    note('changes', 490, -560, 470, 'CHANGES · League Dashboard v2\n1. Commissioner strip: one 88px band under the header with five facts (roster and scoring stay on the console), the join count, Advance week and a link to a dedicated console route. The administration tree leaves the dashboard.\n2. Hero stretches: My Team gains a five-row Starters list (position chip, opponent, kickoff, projection, Q tag) and a lineup-status footer; the two cards are the same height.\n3. Around the league: six compact matchup tiles with a win-probability bar, viewer tile ringed.\n4. Draft Grades compact: 40px rows, steal/reach on the viewer row, toggle for the rest. Card drops from 1119px to ~600px, level with the standings.\n5. Second 8/4 row: Quick Actions as grouped rows in two columns (card and h2 kept, #936 ruling) beside a Recent activity rail card (eight transactions).\n6. Mobile: the strip is a compact stacked card (title and join chip, a 2x2 fact grid, two 44px buttons); Around the league scrolls sideways; standings fold PF/PA into the Team cell as today.\n7. Theme tweak on every artboard: dark verbatim, light derived from the same token names.', 'dashboard'),
    note('wire', 980, -560, 460, 'WIRE · what is on the wire today vs not\nON: league payload facts, join-requests count, standings, draft grades, matchups list (entities/matchup), transactions (GET /api/league/:id/transactions), lineup entries (GET /api/team/lineup?leagueId=&week=).\nNEEDED: first kickoff per matchup (same addition the Game Center canvas named); head-to-head, opponent streak and last-meeting tiles need a two-team history read (or derive from the matchups list client-side); per-starter injury status on the lineup entries if it is not already there.\nSample data on these boards is invented (Great Lakes Gridiron); the real league 137 is the one that was measured.', 'dashboard'),
    note('console-note', 0, -420, 470, 'COMMISSIONER CONSOLE · why a route\nThe #936 pass recorded this follow-up: the rail gives administration 307px and the forms want ~720px. A route (/league/:id/commissioner, precedent /draft-settings) gives the seven CommissionerTools sections a 240px rail and a 720px column, and the dashboard box becomes a strip.\nThe legacy CommissionerTools composes AS-IS inside the column (cut ruling on #617): this is a re-parenting, not a rewrite. Join requests get their own card with Approve/Deny (the decide mutation moves into a feature); destructive actions get a danger-bordered card at the end of every section, owner only.\nMobile: the section rail becomes a select; cards stack; every control is 44px.', 'console'),
    note('fsd-note', 1240, 0, 420, 'HOW TO BUILD IT\nOne ticket per slice, page tickets last (ADR 0020 pattern). New entities (roster, activity) ship before the widgets that read them. The strip replaces commissioner-panel in the same PR as the console route so no release carries both an in-rail tree and a strip.\nContrast: no new pairings; if a widget invents one it registers it in tokens.contrast.test.js first.\nCopy: middots, hyphen scores, no em dashes (ADR 0016). MUI Button house rule (#309). 44px targets on mobile.', 'fsd'),
  ],
  launch: { view: 'canvas', page: 'dashboard' },
};
writeFileSync(join(here, 'canvas.json'), JSON.stringify(canvas, null, 2) + '\n');
console.log('wrote', Object.keys(files).length, 'artboards + canvas.json');
