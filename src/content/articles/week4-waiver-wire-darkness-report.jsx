import React from 'react';
import { Box } from '@mui/material';
import {
  Lead, P, H2, H3, UL, OL, LI, Quote,
  Table, THead, TBody, TR, TH, TD,
} from '../../components/public/kit/Prose';

// Body only: the frontmatter lives in week4-waiver-wire-darkness-report.meta.js so listings can be
// built without loading this prose; content/articles/index.js loads it on demand.
//
// Every color below the hero is a theme token, so the cards, charts and chips read in light and
// dark. The hero is a dark illustration in both themes, like the Week 3 start/sit banner.

const POS_COLOR = {
  QB: 'var(--pos-qb)', RB: 'var(--pos-rb)', WR: 'var(--pos-wr)', TE: 'var(--pos-te)',
  DEF: 'var(--pos-def)', LB: 'var(--pos-idp)', DL: 'var(--pos-idp)', DB: 'var(--pos-idp)',
};

function HeroBanner() {
  // Claim cards fanned across the field: taller card, bigger bid.
  const bids = [
    { x: 150, h: 150, label: 'ALLEN', fill: '#2fd97b' },
    { x: 262, h: 132, label: 'GORDON', fill: '#2fd97b' },
    { x: 374, h: 104, label: 'SADIQ', fill: '#ff8c42' },
    { x: 486, h: 62, label: 'K. ALLEN', fill: '#7eaaff' },
    { x: 598, h: 58, label: 'KAMARA', fill: '#7eaaff' },
  ];
  return (
    <Box
      component="svg"
      viewBox="0 0 800 300"
      xmlns="http://www.w3.org/2000/svg"
      sx={{ width: '100%', borderRadius: 'var(--radius-md, 10px)', overflow: 'hidden', mb: 4, display: 'block' }}
      role="img"
      aria-labelledby="wk4ww-hero-title wk4ww-hero-desc"
    >
      <title id="wk4ww-hero-title">Week 4 Waiver Wire: The Darkness Report</title>
      <desc id="wk4ww-hero-desc">
        A night field under a floodlight with five glowing bid bars rising from the turf, tallest
        first: Braelon Allen, Ollie Gordon II, Kenyon Sadiq, Keenan Allen and Alvin Kamara, over the
        headline Week 4 Waiver Wire.
      </desc>
      <defs>
        <linearGradient id="wk4ww-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#060910" />
          <stop offset="0.55" stopColor="#0c1424" />
          <stop offset="1" stopColor="#161027" />
        </linearGradient>
        <radialGradient id="wk4ww-flood" cx="0.5" cy="0" r="0.85">
          <stop offset="0" stopColor="#7eaaff" stopOpacity="0.34" />
          <stop offset="1" stopColor="#7eaaff" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="wk4ww-bar" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.28" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <rect width="800" height="300" fill="url(#wk4ww-bg)" />
      <rect width="800" height="300" fill="url(#wk4ww-flood)" />
      {Array.from({ length: 11 }, (_, i) => (
        <line key={`yd${i}`} x1={40 + i * 72} y1="120" x2={6 + i * 79} y2="300" stroke="rgba(255,255,255,0.06)" />
      ))}
      <line x1="0" y1="206" x2="800" y2="206" stroke="rgba(255,255,255,0.12)" strokeDasharray="6 8" />
      {bids.map((b) => (
        <g key={b.label}>
          <rect x={b.x} y={206 - b.h} width="56" height={b.h} rx="8" fill={b.fill} opacity="0.2" />
          <rect x={b.x} y={206 - b.h} width="56" height={b.h} rx="8" fill="url(#wk4ww-bar)" />
          <rect x={b.x} y={206 - b.h} width="56" height="5" rx="2.5" fill={b.fill} />
          <text x={b.x + 28} y={198 - b.h} textAnchor="middle" fill={b.fill} fontFamily="system-ui, sans-serif" fontWeight="800" fontSize="11" letterSpacing="1.5">{b.label}</text>
        </g>
      ))}
      <text x="400" y="34" textAnchor="middle" fill="#8badc9" fontFamily="system-ui, sans-serif" fontWeight="700" fontSize="12" letterSpacing="4">THE DARKNESS REPORT</text>
      <rect x="120" y="222" width="560" height="64" rx="14" fill="rgba(3,8,20,0.84)" stroke="rgba(126,170,255,0.25)" />
      <text x="400" y="253" textAnchor="middle" fill="#ffffff" fontFamily="system-ui, sans-serif" fontWeight="850" fontSize="24" letterSpacing="1">WEEK 4 WAIVER WIRE</text>
      <text x="400" y="274" textAnchor="middle" fill="#8badc9" fontFamily="system-ui, sans-serif" fontWeight="600" fontSize="12" letterSpacing="3">FAAB LADDER &middot; D/ST STREAMS &middot; IDP &middot; INJURY LEDGER</text>
    </Box>
  );
}

const Pill = ({ children, color }) => (
  <Box
    component="span"
    sx={{
      display: 'inline-block', minWidth: '2.6em', textAlign: 'center', px: 0.75, mr: 0.75,
      borderRadius: 'var(--radius-pill, 999px)', border: '1px solid', borderColor: color, color,
      fontSize: '0.7rem', fontWeight: 800, letterSpacing: '0.04em', lineHeight: 1.7, verticalAlign: 'middle',
    }}
  >
    {children}
  </Box>
);

const Chip = ({ children, tone = 'var(--accent)' }) => (
  <Box
    component="span"
    sx={{
      display: 'inline-block', px: 1.1, py: 0.2, borderRadius: 'var(--radius-pill, 999px)',
      bgcolor: 'var(--surface-sunken)', color: tone, fontWeight: 800, fontSize: '0.75rem', letterSpacing: '0.03em',
    }}
  >
    {children}
  </Box>
);

// A bid range drawn on a 0 to 20% track, so every card and the ladder read on the same scale.
const TRACK_MAX = 20;
function BidTrack({ min, max, highlight }) {
  return (
    <Box aria-hidden="true" sx={{ position: 'relative', height: 10, borderRadius: 'var(--radius-pill, 999px)', bgcolor: 'var(--surface-sunken)', overflow: 'hidden' }}>
      <Box
        sx={{
          position: 'absolute', top: 0, bottom: 0,
          left: `${(min / TRACK_MAX) * 100}%`,
          width: `${Math.max(((max - min) / TRACK_MAX) * 100, 2)}%`,
          borderRadius: 'var(--radius-pill, 999px)',
          bgcolor: highlight ? 'var(--accent)' : 'var(--border-strong)',
        }}
      />
    </Box>
  );
}

function PriorityCard({ p }) {
  return (
    <Box
      component="section"
      aria-labelledby={`pick-${p.id}`}
      sx={{
        my: 3, p: { xs: 2, sm: 3 }, borderRadius: 'var(--radius-md, 10px)',
        bgcolor: 'var(--surface-raised)', border: '1px solid var(--border-subtle)', boxShadow: 'var(--shadow-2, none)',
        borderLeft: '5px solid', borderLeftColor: POS_COLOR[p.pos],
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1.5, flexWrap: 'wrap' }}>
        <Box component="span" aria-hidden="true" sx={{ fontSize: '2.2rem', fontWeight: 900, lineHeight: 1, color: 'var(--accent)', fontVariantNumeric: 'tabular-nums' }}>
          {p.rank}
        </Box>
        <Box component="h3" id={`pick-${p.id}`} sx={{ m: '0 !important', fontSize: { xs: '1.3rem !important', sm: '1.5rem !important' } }}>
          {p.name}
        </Box>
        <Box sx={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-muted)' }}>
          <Pill color={POS_COLOR[p.pos]}>{p.pos}</Pill>{p.team} &middot; {p.matchup}
        </Box>
      </Box>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mt: 1.5 }}>
        <Chip>Bid {p.min}&ndash;{p.max}%</Chip>
        <Chip tone="var(--text-muted)">{p.rostered}</Chip>
        <Chip tone={p.windowTone}>{p.window}</Chip>
      </Box>
      <Box sx={{ mt: 1.5 }}>
        <BidTrack min={p.min} max={p.max} highlight />
      </Box>
      <Box component="p" sx={{ mt: '16px !important', mb: '0 !important' }}>{p.take}</Box>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 1.5, mt: 2 }}>
        <Box sx={{ pl: 1.25, borderLeft: '3px solid var(--success)' }}>
          <Box sx={{ fontSize: '0.72rem', fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--success)' }}>The case</Box>
          <Box sx={{ fontSize: '0.92rem', lineHeight: 1.5 }}>{p.pro}</Box>
        </Box>
        <Box sx={{ pl: 1.25, borderLeft: '3px solid var(--danger)' }}>
          <Box sx={{ fontSize: '0.72rem', fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--danger)' }}>The risk</Box>
          <Box sx={{ fontSize: '0.92rem', lineHeight: 1.5 }}>{p.con}</Box>
        </Box>
      </Box>
    </Box>
  );
}

const BIG_THREE = [
  {
    id: 'braelon-allen', rank: 1, name: 'Braelon Allen', pos: 'RB', team: 'NYJ', matchup: 'at CHI',
    min: 12, max: 18, rostered: '19% Yahoo · 51% CBS', window: '1 to 3 weeks', windowTone: 'var(--warning)',
    take: 'Last week I called Allen a $2 handcuff. Then Breece Hall went down with a thigh injury against Detroit, Monday\'s MRI came back "not as significant as feared", and the Jets are calling him week-to-week. Allen is the lead back for a Geno Smith offense that just dropped 321 yards and three scores on the Lions.',
    pro: 'Best Week 4 start on the wire. Yahoo has him as its top FAAB target at $19 and CBS says 20% or more. Chicago is starting a backup quarterback, which keeps this game close and keeps Allen on the field.',
    con: 'Hall avoided the worst, so the window may be two games. Isaiah Davis takes some of the work, and Allen is at 3.2 yards a carry this year (19 for 61 and a score, 4 catches for 11).',
  },
  {
    id: 'ollie-gordon', rank: 2, name: 'Ollie Gordon II', pos: 'RB', team: 'MIA', matchup: 'at MIN',
    min: 12, max: 15, rostered: '3% Yahoo · 6% CBS', window: 'Season', windowTone: 'var(--success)',
    take: 'De\'Von Achane tore his ACL and went on injured reserve Monday. His season is over. Gordon took over Sunday: 17 carries for 41 yards and a touchdown, plus 3 catches for 14, and nobody else on this board has a path that long.',
    pro: 'The only season-long lead-back job on the wire. Jaylen Wright missed Week 3 with a stinger and foot injury. Bleacher Report has Gordon as its top target at $15 to $25.',
    con: 'Week 4 is ugly. Miami has the lowest implied total on the slate (13.5) as an 11.5-point dog in Minnesota, against a run defense ranked third against backs. He also ran for 2.4 yards a carry. Wright, whom Jeff Hafley calls day-to-day, will split the work when he\'s back.',
  },
  {
    id: 'kenyon-sadiq', rank: 3, name: 'Kenyon Sadiq', pos: 'TE', team: 'NYJ', matchup: 'at CHI',
    min: 8, max: 12, rostered: '18% Yahoo · 44% CBS', window: 'Season', windowTone: 'var(--success)',
    take: 'Seven catches, 105 yards and a touchdown for the rookie in Week 3. Mason Taylor is out with a thumb injury. Tight end is a wasteland in most leagues, and this is a first-year tight end catching passes from a quarterback on a heater.',
    pro: 'The clear TE add of the week on every list we read. Yahoo $9, Bleacher Report $8 to $15.',
    con: 'One big game. When Taylor returns, the snaps get shared. Bid for the role you can see, not the 23.5 points.',
  },
];

// Bid ranges, % of a $100 budget. Big Three first, then the rest of the priced board.
const LADDER = [
  ['Braelon Allen', 'RB', 12, 18, true],
  ['Ollie Gordon II', 'RB', 12, 15, true],
  ['Kenyon Sadiq', 'TE', 8, 12, true],
  ['Alvin Kamara', 'RB', 5, 8, false],
  ['Keenan Allen', 'WR', 3, 6, false],
  ['Jaylen Wright', 'RB', 3, 7, false],
  ['Darren Waller', 'TE', 2, 4, false],
  ['Jakobi Meyers', 'WR', 2, 4, false],
  ['Sam Darnold', 'QB', 1, 3, false],
  ['Jacoby Brissett', 'QB', 1, 3, false],
  ['Wan\'Dale Robinson', 'WR', 1, 3, false],
  ['Geno Smith', 'QB', 1, 2, false],
  ['Mack Hollins', 'WR', 1, 2, false],
  ['Tre\' Harris', 'WR', 1, 2, false],
];

function FaabLadder() {
  const summary = LADDER.map(([name, , min, max]) => `${name} ${min} to ${max}%`).join(', ');
  return (
    <Box role="img" aria-label={`Recommended bids as a percent of budget: ${summary}`} sx={{ my: 3, display: 'grid', rowGap: 0.9 }}>
      {LADDER.map(([name, pos, min, max, top]) => (
        <Box key={name} aria-hidden="true" sx={{ display: 'grid', gridTemplateColumns: { xs: '8.5em 1fr 3.6em', sm: '11em 1fr 4em' }, alignItems: 'center', gap: 1, fontSize: '0.85rem' }}>
          <Box component="span" sx={{ fontWeight: top ? 800 : 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            <Box component="span" sx={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', bgcolor: POS_COLOR[pos], mr: 0.75 }} />
            {name}
          </Box>
          <BidTrack min={min} max={max} highlight={top} />
          <Box component="span" sx={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--text-muted)' }}>{min}&ndash;{max}%</Box>
        </Box>
      ))}
      <Box aria-hidden="true" sx={{ display: 'grid', gridTemplateColumns: { xs: '8.5em 1fr 3.6em', sm: '11em 1fr 4em' }, gap: 1, fontSize: '0.72rem', color: 'var(--text-muted)' }}>
        <span />
        <Box sx={{ display: 'flex', justifyContent: 'space-between' }}><span>0%</span><span>10%</span><span>20%</span></Box>
        <span />
      </Box>
    </Box>
  );
}

// Implied points for the offense each defense faces. Lower is better for the defense.
const DST_TARGETS = [
  { def: 'MIN', opp: 'MIA', pts: 13.5, kind: 'check' },
  { def: 'BAL', opp: 'TEN', pts: 16, kind: 'check' },
  { def: 'SEA', opp: 'LAC', pts: 17.75, kind: 'check' },
  { def: 'GB', opp: 'TB', pts: 18, kind: 'stream' },
  { def: 'PIT', opp: 'CLE', pts: 18, kind: 'check' },
  { def: 'CHI', opp: 'NYJ', pts: 19.5, kind: 'stream' },
  { def: 'CLE', opp: 'PIT', pts: 20.5, kind: 'stream' },
  { def: 'BUF', opp: 'NE', pts: 20.75, kind: 'stream' },
  { def: 'ARI', opp: 'NYG', pts: 21.5, kind: 'stream' },
  { def: 'NO', opp: 'ATL', pts: 22.75, kind: 'stream' },
];

function OpponentChart() {
  const max = 24;
  const summary = DST_TARGETS.map((r) => `${r.def} defense faces ${r.opp} at ${r.pts}`).join(', ');
  return (
    <Box sx={{ my: 3 }}>
      <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-muted)', mb: 1.25 }}>
        <Box component="span"><Box component="span" sx={{ display: 'inline-block', width: 10, height: 10, borderRadius: '3px', bgcolor: 'var(--accent)', mr: 0.75 }} />Streamer, usually on the wire</Box>
        <Box component="span"><Box component="span" sx={{ display: 'inline-block', width: 10, height: 10, borderRadius: '3px', bgcolor: 'var(--border-strong)', mr: 0.75 }} />Check first, usually rostered</Box>
      </Box>
      <Box role="img" aria-label={`Opponent implied points, lowest first: ${summary}`} sx={{ display: 'grid', rowGap: 0.7 }}>
        {DST_TARGETS.map((r) => (
          <Box key={r.def} aria-hidden="true" sx={{ display: 'grid', gridTemplateColumns: '6.4em 1fr 3.4em', alignItems: 'center', gap: 1, fontSize: '0.85rem' }}>
            <Box component="span" sx={{ fontWeight: 800 }}>
              {r.def} <Box component="span" sx={{ fontWeight: 600, color: 'var(--text-muted)' }}>v {r.opp}</Box>
            </Box>
            <Box sx={{ height: 12, borderRadius: 'var(--radius-pill, 999px)', bgcolor: 'var(--surface-sunken)', overflow: 'hidden' }}>
              <Box sx={{ width: `${(r.pts / max) * 100}%`, height: '100%', bgcolor: r.kind === 'stream' ? 'var(--accent)' : 'var(--border-strong)' }} />
            </Box>
            <Box component="span" sx={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--text-muted)' }}>{r.pts}</Box>
          </Box>
        ))}
      </Box>
    </Box>
  );
}

// Tackle floor or big play, the two ways an IDP stream pays.
const Tag = ({ kind }) => (
  <Pill color={kind === 'T' ? 'var(--success)' : 'var(--warning)'}>{kind === 'T' ? 'Tackles' : kind === 'BP' ? 'Big play' : 'Both'}</Pill>
);

const Body = () => (
  <>
    <HeroBanner />
    <Lead>
      Three weeks in, and Sunday took three franchise pieces off the board. De&apos;Von Achane&apos;s
      knee is done for the year, Breece Hall&apos;s thigh is week-to-week, and Baker Mayfield&apos;s
      dislocated thumb hands Tampa Bay to an undrafted rookie. The wire has real backfields on it
      this week. Let&apos;s spend.
    </Lead>
    <P>
      Every bid below is a percentage of a $100 FAAB budget in a 12-team league. Rostered figures are
      Yahoo unless marked, as of Tuesday. Lines are ESPN&apos;s as of Tuesday afternoon. There are no
      byes this week. Thursday is Pittsburgh at Cleveland, and Sunday opens at 9:30 ET with the Colts
      and Commanders in London.
    </P>

    <H2>The Big Three</H2>
    <P>
      Allen for this week, Gordon for the rest of the season, Sadiq for your tight end hole. If you
      have the budget, you want two of these three.
    </P>
    {BIG_THREE.map((p) => <PriorityCard key={p.id} p={p} />)}

    <H2>The FAAB Ladder</H2>
    <P>
      The whole priced board on one scale. Highlighted bars are the Big Three. Everything under 3% is
      a free square: bid $1 and don&apos;t lose sleep.
    </P>
    <FaabLadder />

    <H2>The Full Board</H2>
    <P>
      Window is how long the role should last. Season means no starter is coming back to take it. A
      question mark means Friday&apos;s injury report decides it.
    </P>
    <Table aria-label="Week 4 offensive waiver board">
      <THead>
        <TR>
          <TH scope="col">#</TH><TH scope="col">Player</TH><TH scope="col">Pos</TH><TH scope="col">Team</TH><TH scope="col">The case</TH><TH scope="col">Wk 4</TH><TH scope="col">Window</TH><TH scope="col">FAAB</TH><TH scope="col">Rostered</TH>
        </TR>
      </THead>
      <TBody>
        <TR><TD>1</TD><TD><strong>Braelon Allen</strong></TD><TD>RB</TD><TD>NYJ</TD><TD>Hall week-to-week (thigh). Lead back in a hot offense.</TD><TD>at CHI</TD><TD>1&ndash;3 wks</TD><TD>12&ndash;18%</TD><TD>19%</TD></TR>
        <TR><TD>2</TD><TD><strong>Ollie Gordon II</strong></TD><TD>RB</TD><TD>MIA</TD><TD>Achane on IR, torn ACL. 17 carries, TD. Bad Week 4 spot.</TD><TD>at MIN</TD><TD>Season</TD><TD>12&ndash;15%</TD><TD>3%</TD></TR>
        <TR><TD>3</TD><TD><strong>Kenyon Sadiq</strong></TD><TD>TE</TD><TD>NYJ</TD><TD>7 for 105 and a TD. Mason Taylor out (thumb).</TD><TD>at CHI</TD><TD>Season</TD><TD>8&ndash;12%</TD><TD>18%</TD></TR>
        <TR><TD>4</TD><TD><strong>Alvin Kamara</strong></TD><TD>RB</TD><TD>NO</TD><TD>Etienne will miss time (hamstring). Thin Week 3: 9 for 36, 1 catch. Shares with Kendre Miller.</TD><TD>vs ATL (Mon)</TD><TD>2&ndash;4 wks</TD><TD>5&ndash;8%</TD><TD>43%</TD></TR>
        <TR><TD>5</TD><TD><strong>Keenan Allen</strong></TD><TD>WR</TD><TD>IND</TD><TD>Pierce on IR. 6 for 63 and a TD on 9 targets. Washington has been gashed by receivers.</TD><TD>at WAS (London)</TD><TD>Season</TD><TD>3&ndash;6%</TD><TD>21%</TD></TR>
        <TR><TD>6</TD><TD><strong>Jaylen Wright</strong></TD><TD>RB</TD><TD>MIA</TD><TD>The other half of the Achane vacancy. Missed Week 3 (stinger, foot). Coach calls him day-to-day.</TD><TD>at MIN</TD><TD>Season</TD><TD>3&ndash;7%</TD><TD>1%</TD></TR>
        <TR><TD>7</TD><TD><strong>Darren Waller</strong></TD><TD>TE</TD><TD>CAR</TD><TD>Season-high 39 snaps, double digits without a score. Coker and Legette banged up.</TD><TD>vs DET (SNF)</TD><TD>Stream</TD><TD>2&ndash;4%</TD><TD>14%</TD></TR>
        <TR><TD>8</TD><TD><strong>Jakobi Meyers</strong></TD><TD>WR</TD><TD>JAX</TD><TD>7 for 64 and a TD on 8 targets, 80%+ snaps. Highest total of the week (51.5).</TD><TD>at CIN</TD><TD>Season</TD><TD>2&ndash;4%</TD><TD>44%</TD></TR>
        <TR><TD>9</TD><TD><strong>Sam Darnold</strong></TD><TD>QB</TD><TD>SEA</TD><TD>Back from the glute: 379 yards, 4 TD. Winless Chargers at home, SEA -7.</TD><TD>vs LAC</TD><TD>Stream</TD><TD>1&ndash;3%</TD><TD>37%</TD></TR>
        <TR><TD>10</TD><TD><strong>Jacoby Brissett</strong></TD><TD>QB</TD><TD>ARI</TD><TD>Arizona&apos;s starter since Week 1. CBS&apos;s top QB add. Faces a Giants team on its backup QB.</TD><TD>at NYG</TD><TD>Season</TD><TD>1&ndash;3%</TD><TD>23% CBS</TD></TR>
        <TR><TD>11</TD><TD><strong>Wan&apos;Dale Robinson</strong></TD><TD>WR</TD><TD>TEN</TD><TD>Team-high 11 targets, 7 for 57 and a TD. PPR floor.</TD><TD>at BAL</TD><TD>Season</TD><TD>1&ndash;3%</TD><TD>47%</TD></TR>
        <TR><TD>12</TD><TD><strong>Geno Smith</strong></TD><TD>QB</TD><TD>NYJ</TD><TD>31 of 37, 321 yards, 3 TD, no picks against Detroit.</TD><TD>at CHI</TD><TD>Stream</TD><TD>1&ndash;2%</TD><TD>9%</TD></TR>
        <TR><TD>13</TD><TD><strong>Mack Hollins</strong></TD><TD>WR</TD><TD>NE</TD><TD>A.J. Brown on IR (high ankle). Team-leading 12 catches, 6 for 87 last week.</TD><TD>at BUF</TD><TD>3+ wks</TD><TD>1&ndash;2%</TD><TD>3%</TD></TR>
        <TR><TD>14</TD><TD><strong>Tre&apos; Harris</strong></TD><TD>WR</TD><TD>LAC</TD><TD>Team-high 7 targets, 6 for 76, 63% of routes. Pushing Quentin Johnston.</TD><TD>at SEA</TD><TD>Stash</TD><TD>1&ndash;2%</TD><TD>4%</TD></TR>
        <TR><TD>15</TD><TD><strong>Kirk Cousins</strong></TD><TD>QB</TD><TD>LV</TD><TD>Nine touchdown passes, three in every game.</TD><TD>vs KC</TD><TD>Stream</TD><TD>$1</TD><TD>14%</TD></TR>
        <TR><TD>16</TD><TD><strong>Mike Gesicki</strong></TD><TD>TE</TD><TD>CIN</TD><TD>Touchdown in Week 3. Same 51.5-total game as Meyers.</TD><TD>vs JAX</TD><TD>Stream</TD><TD>$1</TD><TD>5%</TD></TR>
        <TR><TD>17</TD><TD><strong>Marcus Mariota</strong></TD><TD>QB</TD><TD>WAS</TD><TD>3 TD in the win over Seattle. Only if Jayden Daniels sits.</TD><TD>vs IND (London)</TD><TD>1 wk?</TD><TD>$1</TD><TD>3%</TD></TR>
        <TR><TD>18</TD><TD><strong>Kendre Miller</strong></TD><TD>RB</TD><TD>NO</TD><TD>The other half of the Etienne vacancy. 4 for 14 and 2 catches in Week 3.</TD><TD>vs ATL (Mon)</TD><TD>2&ndash;4 wks</TD><TD>$1</TD><TD>1%</TD></TR>
      </TBody>
    </Table>
    <H3>Superflex and two-QB leagues</H3>
    <UL>
      <LI><strong>Jameis Winston</strong> (NYG): Jaxson Dart is on IR with a knee injury. Winston is the starter and the Giants won ugly, 12&ndash;7. Chaos is the product. Faces Arizona.</LI>
      <LI><strong>Jalon Daniels</strong> (TB): the undrafted rookie starts for at least three weeks while Mayfield&apos;s thumb heals. His first relief appearance: 0 for 3 with a game-ending interception. Faces Green Bay.</LI>
      <LI><strong>Case Keenum</strong> (CHI): Caleb Williams is out with a hamstring strain. Keenum is expected to start unless Tyson Bagent is cleared.</LI>
    </UL>
    <H3>Also on the radar</H3>
    <P>
      One list each, $1 or pass: <strong>Mike Washington Jr.</strong> (RB, LV),{' '}
      <strong>Keaton Mitchell</strong> (RB, LAC), <strong>Malik Washington</strong> (WR, MIA, took
      running back snaps Sunday), <strong>Chris Bell</strong> (WR, MIA). If Justin Jefferson&apos;s
      ankle keeps him out, <strong>Jordan Addison</strong> is the play, but he is 73% rostered.
    </P>

    <H2>D/ST Streaming Board</H2>
    <P>
      The recipe never changes: a backup quarterback, a bad offensive line, and a low implied total.
      Week 4 serves up an undrafted rookie in Tampa, Jameis Winston in New York, and a Miami offense
      without its best player. The chart below is the implied total of the offense each defense
      faces. Short bar, happy defense.
    </P>
    <OpponentChart />
    <P>
      Check your wire for the grey bars first. Minnesota, Baltimore, Seattle and Pittsburgh are
      usually rostered, but if one is sitting there, it beats every streamer below.
    </P>
    <Table aria-label="Week 4 D/ST streamers">
      <THead>
        <TR>
          <TH scope="col">#</TH><TH scope="col">Defense</TH><TH scope="col">Opp. total</TH><TH scope="col">Rostered</TH><TH scope="col">Why</TH>
        </TR>
      </THead>
      <TBody>
        <TR><TD>1</TD><TD><strong>Green Bay</strong> at TB</TD><TD>18</TD><TD>7%</TD><TD>An undrafted rookie making his first start for an 0&ndash;3 team. Tampa&apos;s implied 18 is tied for the fourth-lowest on the slate. The pickup of the week at this position.</TD></TR>
        <TR><TD>2</TD><TD><strong>Buffalo</strong> vs NE</TD><TD>20.75</TD><TD>25%</TD><TD>A.J. Brown on IR, a banged-up line, and Drake Maye under 12 points three straight weeks. New England has given up the third-most points to defenses.</TD></TR>
        <TR><TD>3</TD><TD><strong>Cleveland</strong> vs PIT (Thu)</TD><TD>20.5</TD><TD>2%</TD><TD>Tied for the lowest total on the board (38.5). Rodgers doesn&apos;t move. Best two-week stream: Week 5 is at the Jets.</TD></TR>
        <TR><TD>4</TD><TD><strong>Arizona</strong> at NYG</TD><TD>21.5</TD><TD>1%</TD><TD>Winston throws to both teams. Near pick&apos;em (ARI -1.5). Drop them after: Detroit is Week 5.</TD></TR>
        <TR><TD>5</TD><TD><strong>Chicago</strong> vs NYJ</TD><TD>19.5</TD><TD>9%</TD><TD>Home favorite, Hall out. If you are starting Allen, Geno or Sadiq, skip this one. You&apos;d be betting against yourself.</TD></TR>
        <TR><TD>6</TD><TD><strong>New Orleans</strong> vs ATL (Mon)</TD><TD>22.75</TD><TD>1%</TD><TD>Penix takes sacks. The Monday night fallback if your Sunday defense lays an egg.</TD></TR>
      </TBody>
    </Table>
    <P>
      <strong>Avoid:</strong> Tampa Bay (the rookie quarterback is theirs, and their defense will live
      on the field), Jacksonville at Cincinnati (51.5 total, road dog), Denver at San Francisco, and
      Indianapolis, the worst fantasy defense in football so far.
    </P>

    <H2>IDP Waiver Board</H2>
    <P>
      Three injuries opened three jobs. Brian Burns tore his ACL in the win over Tennessee, Leo Chenal
      had season-ending neck surgery, and Nick Bosa&apos;s calf keeps him out Sunday. Tackle volume is
      the currency at linebacker and safety. Pressure is the currency on the line.
    </P>
    <H3>Linebacker</H3>
    <Table aria-label="IDP linebackers">
      <THead>
        <TR><TH scope="col">#</TH><TH scope="col">Player</TH><TH scope="col">Team</TH><TH scope="col">Type</TH><TH scope="col">The case</TH><TH scope="col">Wk 4</TH></TR>
      </THead>
      <TBody>
        <TR><TD>1</TD><TD><strong>Derrick Barnes</strong></TD><TD>DET</TD><TD><Tag kind="T" /></TD><TD>Tied for LB5 in standard IDP. Every-down next to Jack Campbell. 6% rostered in IDP leagues.</TD><TD>at CAR</TD></TR>
        <TR><TD>2</TD><TD><strong>Arvell Reese</strong></TD><TD>NYG</TD><TD><Tag kind="both" /></TD><TD>13 tackles in Week 3. With Burns gone, the rookie gets more pass-rush snaps.</TD><TD>vs ARI</TD></TR>
        <TR><TD>3</TD><TD><strong>Kain Medrano</strong></TD><TD>WAS</TD><TD><Tag kind="both" /></TD><TD>Chenal done, Frankie Luvu out. Pick-six on Sunday. Plays beside Sonny Styles.</TD><TD>vs IND (London)</TD></TR>
        <TR><TD>4</TD><TD><strong>Jake Hansen</strong></TD><TD>HOU</TD><TD><Tag kind="T" /></TD><TD>100% of snaps with Henry To&apos;oTo&apos;o on IR. Pure volume.</TD><TD>vs DAL</TD></TR>
        <TR><TD>5</TD><TD><strong>Dorian Williams</strong></TD><TD>BUF</TD><TD><Tag kind="T" /></TD><TD>Team-high 24 tackles, season-high 73% of snaps.</TD><TD>vs NE</TD></TR>
        <TR><TD>6</TD><TD><strong>Jaishawn Barham</strong></TD><TD>DAL</TD><TD><Tag kind="T" /></TD><TD>6, 7 and 7 tackles while DeMarvion Overshown is out. The role ends when he returns.</TD><TD>at HOU</TD></TR>
      </TBody>
    </Table>
    <H3>Defensive line and edge</H3>
    <Table aria-label="IDP defensive line">
      <THead>
        <TR><TH scope="col">#</TH><TH scope="col">Player</TH><TH scope="col">Team</TH><TH scope="col">Type</TH><TH scope="col">The case</TH><TH scope="col">Wk 4</TH></TR>
      </THead>
      <TBody>
        <TR><TD>1</TD><TD><strong>Mason Graham</strong></TD><TD>CLE</TD><TD><Tag kind="BP" /></TD><TD>Four sacks and 15 tackles, a sack in every game. Thursday against an immobile Rodgers.</TD><TD>vs PIT</TD></TR>
        <TR><TD>2</TD><TD><strong>Kayvon Thibodeaux</strong></TD><TD>NYG</TD><TD><Tag kind="BP" /></TD><TD>Inherits the Burns role for the rest of the season.</TD><TD>vs ARI</TD></TR>
        <TR><TD>3</TD><TD><strong>Keion White</strong></TD><TD>SF</TD><TD><Tag kind="BP" /></TD><TD>Bosa is out Sunday. 13+ points in each of the last two weeks.</TD><TD>vs DEN</TD></TR>
        <TR><TD>4</TD><TD><strong>Gabe Jacas</strong></TD><TD>NE</TD><TD><Tag kind="both" /></TD><TD>A sack, an interception and a half sack in three games. Snaps up to about 70%.</TD><TD>at BUF</TD></TR>
        <TR><TD>5</TD><TD><strong>David Walker</strong></TD><TD>TB</TD><TD><Tag kind="BP" /></TD><TD>Sacks in back-to-back games with Rueben Bain Jr. out. Only 32% of snaps, so it&apos;s a dart.</TD><TD>vs GB</TD></TR>
        <TR><TD>6</TD><TD><strong>Deone Walker</strong></TD><TD>BUF</TD><TD><Tag kind="BP" /></TD><TD>Season-high snaps, elite interior win rate, and a banged-up Patriots line.</TD><TD>vs NE</TD></TR>
      </TBody>
    </Table>
    <H3>Defensive back</H3>
    <Table aria-label="IDP defensive backs">
      <THead>
        <TR><TH scope="col">#</TH><TH scope="col">Player</TH><TH scope="col">Pos</TH><TH scope="col">Team</TH><TH scope="col">Type</TH><TH scope="col">The case</TH><TH scope="col">Wk 4</TH></TR>
      </THead>
      <TBody>
        <TR><TD>1</TD><TD><strong>Brandon Jones</strong></TD><TD>S</TD><TD>DEN</TD><TD><Tag kind="T" /></TD><TD>22 tackles, DB10. San Francisco runs the same kind of offense that fed him double digits against the Rams.</TD><TD>at SF</TD></TR>
        <TR><TD>2</TD><TD><strong>Riley Moss</strong></TD><TD>CB</TD><TD>DEN</TD><TD><Tag kind="both" /></TD><TD>Fourth in the league in pass deflections. DB16.</TD><TD>at SF</TD></TR>
        <TR><TD>3</TD><TD><strong>Rayshawn Jenkins</strong></TD><TD>S</TD><TD>PIT</TD><TD><Tag kind="T" /></TD><TD>9 tackles in Week 3 with DeShon Elliott on IR.</TD><TD>at CLE (Thu)</TD></TR>
        <TR><TD>4</TD><TD><strong>Chris Johnson</strong></TD><TD>CB</TD><TD>MIA</TD><TD><Tag kind="T" /></TD><TD>94% of snaps, 8+ tackles in two of three games. Gold in CB-required leagues.</TD><TD>at MIN</TD></TR>
        <TR><TD>5</TD><TD><strong>Josh Metellus</strong></TD><TD>S</TD><TD>MIN</TD><TD><Tag kind="T" /></TD><TD>9 tackles, half a sack and a deflection last week.</TD><TD>vs MIA</TD></TR>
        <TR><TD>6</TD><TD><strong>Andre Cisco</strong></TD><TD>S</TD><TD>NYJ</TD><TD><Tag kind="both" /></TD><TD>A sack and a forced fumble this year. Chicago is on its backup.</TD><TD>at CHI</TD></TR>
      </TBody>
    </Table>
    <P>
      Tackle-heavy scoring: bump Barnes, Hansen and Jones a tier. Big-play scoring: bump Graham,
      Thibodeaux and White.
    </P>

    <H2>The Injury Ledger</H2>
    <H3>Out or on IR</H3>
    <UL>
      <LI><strong>De&apos;Von Achane</strong> (MIA): torn ACL, IR, season over. Gordon and Wright split the pie.</LI>
      <LI><strong>Baker Mayfield</strong> (TB): dislocated right thumb, about three weeks. Jalon Daniels starts.</LI>
      <LI><strong>Brian Burns</strong> (NYG): torn ACL, season-ending surgery. Thibodeaux and Reese move up.</LI>
      <LI><strong>Leo Chenal</strong> (WAS): season-ending neck surgery. Medrano.</LI>
      <LI><strong>Jaxson Dart</strong> (NYG): knee, IR. Winston.</LI>
      <LI><strong>Caleb Williams</strong> (CHI): hamstring. Keenum.</LI>
      <LI><strong>Travis Etienne Jr.</strong> (NO): hamstring, &quot;time lost&quot; per Kellen Moore. Kamara and Miller.</LI>
      <LI><strong>A.J. Brown</strong> (NE) and <strong>Alec Pierce</strong> (IND): both on IR. Hollins and Keenan Allen.</LI>
      <LI><strong>Nick Bosa</strong> (SF): calf, won&apos;t play Sunday. Keion White.</LI>
      <LI><strong>Mason Taylor</strong> (NYJ), <strong>Frankie Luvu</strong> (WAS), <strong>DeMarvion Overshown</strong> (DAL), <strong>Rueben Bain Jr.</strong> (TB): out.</LI>
    </UL>
    <H3>Friday questions</H3>
    <UL>
      <LI><strong>Breece Hall</strong> (NYJ): thigh, week-to-week. Any practice at all shrinks Allen&apos;s window.</LI>
      <LI><strong>Jayden Daniels</strong> (WAS): elbow. Traveling to London and practicing in some form. Decides Mariota.</LI>
      <LI><strong>Justin Jefferson</strong> (MIN): sprained ankle, Vikings hopeful. Decides Addison.</LI>
      <LI><strong>Puka Nacua</strong> (LAR): hip, Rams hopeful for Philadelphia.</LI>
      <LI><strong>Jaylen Wright</strong> (MIA): stinger and foot, day-to-day. Decides how much of the backfield Gordon keeps.</LI>
      <LI><strong>Terrance Ferguson</strong> (LAR): ankle, likely out. Don&apos;t add him this week.</LI>
    </UL>

    <H2>The Darkness Doctrine</H2>
    <P>
      This is the week the league splits. One manager spends 30% on a running back because the box
      score says 17 carries. Another looks at the calendar, sees Minnesota and a 13.5-point implied
      total, and bids for the role instead of the game. Three rules.
    </P>
    <H3>Rule 1: A season-ending injury is a different asset</H3>
    <P>
      Achane is not coming back. Hall probably is. That is why Gordon and Allen cost the same even
      though Allen is the better start on Sunday: Gordon&apos;s job has no expiration date, and
      Allen&apos;s might end next week.
    </P>
    <H3>Rule 2: Pay for targets, not touchdowns</H3>
    <P>
      Sadiq&apos;s eight targets are the story. His touchdown is the garnish. The same goes for Tre&apos;
      Harris and Wan&apos;Dale Robinson leading their teams in looks. Volume repeats. Scores don&apos;t.
    </P>
    <H3>Rule 3: Never stream against yourself</H3>
    <P>
      If you just spent 15% on Braelon Allen, don&apos;t pick up the Bears defense. Stack your bets in
      the same direction.
    </P>
    <Quote>
      The best pickup of September is the one still starting for you in December. Buy the job, not
      the highlight.
    </Quote>

    <H2>Who to Cut</H2>
    <UL>
      <LI><strong>De&apos;Von Achane</strong>: if you have no IR slot, he goes. If you do, park him and forget him.</LI>
      <LI><strong>Terrance Ferguson</strong>: likely out this week, and the Rams have options.</LI>
      <LI><strong>Tank Bigsby</strong> and <strong>MarShawn Lloyd</strong>: CBS&apos;s drop list, and I agree. Handcuffs to backs who stayed healthy.</LI>
      <LI>Any defense or kicker you aren&apos;t starting this week. Those are streams, not assets.</LI>
    </UL>

    <H2>The Week 4 Bid Sheet</H2>
    <P>Set your claims in this order.</P>
    <OL>
      <LI><strong>Braelon Allen</strong> at 15% if you need a Week 4 starter. If you miss, don&apos;t chase. Roll it to Gordon.</LI>
      <LI><strong>Ollie Gordon II</strong> at 13%. Add <strong>Jaylen Wright</strong> at 5% in deep leagues so you own the whole Miami backfield.</LI>
      <LI><strong>Kenyon Sadiq</strong> at 10% if your tight end isn&apos;t a top-eight name. If you miss, <strong>Waller</strong> at 3% for one week.</LI>
      <LI><strong>Kamara</strong> at 6% and <strong>Keenan Allen</strong> at 5%. Both have starts this week.</LI>
      <LI>Quarterback: <strong>Darnold</strong> at 2% for this week, <strong>Brissett</strong> at 2% for the season. Superflex: <strong>Winston</strong> and <strong>Jalon Daniels</strong> at 2%.</LI>
      <LI>Defense: <strong>Green Bay</strong> at 2%. Fall back to Buffalo, then Cleveland. Never more than 3% on a stream.</LI>
      <LI>IDP: <strong>Barnes</strong> and <strong>Graham</strong> at 5%. <strong>Reese</strong>, <strong>Medrano</strong> and <strong>Thibodeaux</strong> at 3%. Everything else at $1.</LI>
      <LI>$1 claims down the rest of the board.</LI>
    </OL>
    <P>
      Injury statuses are as of Tuesday. Hall, Daniels and Jefferson decide three of these bids on
      Friday. Check the report before you lock lineups, and remember Thursday night is Steelers and
      Browns. Andy Darkness is a pen name and has no rooting interest, allegedly.
    </P>
  </>
);

export default Body;
