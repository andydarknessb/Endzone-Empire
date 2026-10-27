import React from 'react';
import { Box } from '@mui/material';
import {
  Lead, P, H2, H3, UL, OL, LI, Quote,
  Table, THead, TBody, TR, TH, TD,
} from '../../components/public/kit/Prose';
import { positionColorVar } from '../../components/public/kit/positionColor';

// Body only: the frontmatter lives in week8-waiver-wire-darkness-report.meta.js so listings can be
// built without loading this prose; content/articles/index.js loads it on demand.
//
// Every color below the hero is a theme token, so the cards, charts and chips read in light and
// dark. The hero is a dark illustration in both themes, like the Week 3 start/sit banner.

function HeroBanner() {
  // Claim cards fanned across the field: taller card, bigger bid. The Big Three are green.
  const bids = [
    { x: 150, h: 150, label: 'COLEMAN', fill: '#2fd97b' },
    { x: 262, h: 113, label: 'CONCEPCION', fill: '#2fd97b' },
    { x: 374, h: 94, label: 'COOPER', fill: '#2fd97b' },
    { x: 486, h: 75, label: 'WILLIS', fill: '#7eaaff' },
    { x: 598, h: 66, label: 'WILLIAMS', fill: '#7eaaff' },
  ];
  return (
    <Box
      component="svg"
      viewBox="0 0 800 300"
      xmlns="http://www.w3.org/2000/svg"
      sx={{ width: '100%', borderRadius: 'var(--radius-md, 10px)', overflow: 'hidden', mb: 4, display: 'block' }}
      role="img"
      aria-labelledby="wk8ww-hero-title wk8ww-hero-desc"
    >
      <title id="wk8ww-hero-title">Week 8 Waiver Wire: The Darkness Report</title>
      <desc id="wk8ww-hero-desc">
        A night field under a floodlight with five glowing bid bars rising from the turf, tallest
        first: Jonah Coleman, KC Concepcion, Omar Cooper Jr., Malik Willis and Antonio Williams,
        over the headline Week 8 Waiver Wire. The first three are the Big Three.
      </desc>
      <defs>
        <linearGradient id="wk8ww-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#060910" />
          <stop offset="0.55" stopColor="#0c1424" />
          <stop offset="1" stopColor="#161027" />
        </linearGradient>
        <radialGradient id="wk8ww-flood" cx="0.5" cy="0" r="0.85">
          <stop offset="0" stopColor="#7eaaff" stopOpacity="0.34" />
          <stop offset="1" stopColor="#7eaaff" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="wk8ww-bar" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.28" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <rect width="800" height="300" fill="url(#wk8ww-bg)" />
      <rect width="800" height="300" fill="url(#wk8ww-flood)" />
      {Array.from({ length: 11 }, (_, i) => (
        <line key={`yd${i}`} x1={40 + i * 72} y1="120" x2={6 + i * 79} y2="300" stroke="rgba(255,255,255,0.06)" />
      ))}
      <line x1="0" y1="206" x2="800" y2="206" stroke="rgba(255,255,255,0.12)" strokeDasharray="6 8" />
      {bids.map((b) => (
        <g key={b.label}>
          <rect x={b.x} y={206 - b.h} width="56" height={b.h} rx="8" fill={b.fill} opacity="0.2" />
          <rect x={b.x} y={206 - b.h} width="56" height={b.h} rx="8" fill="url(#wk8ww-bar)" />
          <rect x={b.x} y={206 - b.h} width="56" height="5" rx="2.5" fill={b.fill} />
          <text x={b.x + 28} y={198 - b.h} textAnchor="middle" fill={b.fill} fontFamily="system-ui, sans-serif" fontWeight="800" fontSize="11" letterSpacing="1.5">{b.label}</text>
        </g>
      ))}
      <text x="400" y="34" textAnchor="middle" fill="#8badc9" fontFamily="system-ui, sans-serif" fontWeight="700" fontSize="12" letterSpacing="4">THE DARKNESS REPORT</text>
      <rect x="120" y="222" width="560" height="64" rx="14" fill="rgba(3,8,20,0.84)" stroke="rgba(126,170,255,0.25)" />
      <text x="400" y="253" textAnchor="middle" fill="#ffffff" fontFamily="system-ui, sans-serif" fontWeight="850" fontSize="24" letterSpacing="1">WEEK 8 WAIVER WIRE</text>
      <text x="400" y="274" textAnchor="middle" fill="#8badc9" fontFamily="system-ui, sans-serif" fontWeight="600" fontSize="12" letterSpacing="3">THE BIG THREE &middot; FAAB LADDER &middot; D/ST &middot; IDP &middot; RECEIPTS</text>
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
        borderLeft: '5px solid', borderLeftColor: positionColorVar(p.pos),
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
          <Pill color={positionColorVar(p.pos)}>{p.pos}</Pill>{p.team} &middot; {p.matchup}
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
    id: 'jonah-coleman', rank: 1, name: 'Jonah Coleman', pos: 'RB', team: 'DEN', matchup: 'vs KC',
    min: 10, max: 16, rostered: '24.2% rostered', window: 'Season', windowTone: 'var(--success)',
    take: 'In his first game off IR, Coleman ran for 54 yards and caught 2 passes for 15, worth 7.9 points. J.K. Dobbins ran for 23 yards and a TD, and RJ Harvey ran for 6 and had a 54-yard receiving day. Denver hosts Kansas City and is implied for 20.0.',
    pro: 'The most rushing yards of Denver\'s three backs in his first game back, at 24% rostered.',
    con: 'Three backs, Dobbins keeps the goal line, and Denver is a home underdog in a 41.5 total.',
  },
  {
    id: 'kc-concepcion', rank: 2, name: 'KC Concepcion', pos: 'WR', team: 'CLE', matchup: 'at PIT',
    min: 7, max: 12, rostered: '42.9% rostered', window: 'Season', windowTone: 'var(--success)',
    take: 'Concepcion caught 8 passes for 129 yards on a 29% target share and added 23 rushing yards, worth 19.2 points. He had 24% shares in Weeks 4 and 6; Week 5 was 11 snaps. Cleveland is at Pittsburgh and is implied for 18.0.',
    pro: 'Three of four weeks at 24% or better. That is Rule 1.',
    con: 'Deshaun Watson, and the week\'s lowest total (39.5).',
  },
  {
    id: 'omar-cooper', rank: 3, name: 'Omar Cooper Jr.', pos: 'WR', team: 'NYJ', matchup: 'vs LV',
    min: 6, max: 10, rostered: '34.7% rostered', window: 'Season', windowTone: 'var(--success)',
    take: 'Cooper caught 5 passes for 115 yards and a TD on a 17% target share, worth 20.0 points, after 19.3 in his first game off IR on a 24% share. The Jets host Las Vegas and are implied for 22.0.',
    pro: 'Two games back, two 100-yard days, and still unrostered in 65% of leagues.',
    con: 'Geno Smith, and the share dipped from 24% to 17%.',
  },
];

// Bid ranges, % of a $100 budget. Big Three first, then the top of the priced board.
const LADDER = [
  ['Jonah Coleman', 'RB', 10, 16, true],
  ['KC Concepcion', 'WR', 7, 12, true],
  ['Omar Cooper Jr.', 'WR', 6, 10, true],
  ['Malik Willis', 'QB', 4, 8, false],
  ['Antonio Williams', 'WR', 4, 7, false],
  ['Makai Lemon', 'WR', 4, 7, false],
  ['Keon Coleman', 'WR', 3, 6, false],
  ['Jacoby Brissett', 'QB', 3, 6, false],
  ['Michael Penix Jr.', 'QB', 3, 6, false],
  ['Greg Dulcich', 'TE', 3, 5, false],
];

function FaabLadder() {
  const summary = LADDER.map(([name, , min, max]) => `${name} ${min} to ${max}%`).join(', ');
  return (
    <Box role="img" aria-label={`Recommended bids as a percent of budget: ${summary}`} sx={{ my: 3, display: 'grid', rowGap: 0.9 }}>
      {LADDER.map(([name, pos, min, max, top]) => (
        <Box key={name} aria-hidden="true" sx={{ display: 'grid', gridTemplateColumns: { xs: '8.5em 1fr 3.6em', sm: '11em 1fr 4em' }, alignItems: 'center', gap: 1, fontSize: '0.85rem' }}>
          <Box component="span" sx={{ fontWeight: top ? 800 : 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            <Box component="span" sx={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', bgcolor: positionColorVar(pos), mr: 0.75 }} />
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
  { def: 'PIT', opp: 'CLE', pts: 18, kind: 'stream' },
  { def: 'WSH', opp: 'PHI', pts: 18, kind: 'stream' },
  { def: 'CIN', opp: 'TEN', pts: 18.25, kind: 'stream' },
  { def: 'NE', opp: 'MIA', pts: 18.5, kind: 'stream' },
  { def: 'LAR', opp: 'LAC', pts: 19, kind: 'stream' },
  { def: 'JAX', opp: 'IND', pts: 19.5, kind: 'stream' },
  { def: 'KC', opp: 'DEN', pts: 20, kind: 'stream' },
  { def: 'CAR', opp: 'GB', pts: 25.5, kind: 'avoid' },
  { def: 'LAC', opp: 'LAR', pts: 25.5, kind: 'avoid' },
  { def: 'MIA', opp: 'NE', pts: 26, kind: 'avoid' },
  { def: 'IND', opp: 'JAX', pts: 27, kind: 'avoid' },
  { def: 'TEN', opp: 'CIN', pts: 28.25, kind: 'avoid' },
  { def: 'BAL', opp: 'BUF', pts: 28.5, kind: 'avoid' },
  { def: 'ARI', opp: 'DAL', pts: 30.25, kind: 'avoid' },
];

function OpponentChart() {
  const max = 32;
  const summary = DST_TARGETS.map((r) => `${r.def} defense faces ${r.opp} at ${r.pts}`).join(', ');
  return (
    <Box sx={{ my: 3 }}>
      <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-muted)', mb: 1.25 }}>
        <Box component="span"><Box component="span" sx={{ display: 'inline-block', width: 10, height: 10, borderRadius: '3px', bgcolor: 'var(--accent)', mr: 0.75 }} />Stream</Box>
        <Box component="span"><Box component="span" sx={{ display: 'inline-block', width: 10, height: 10, borderRadius: '3px', bgcolor: 'var(--border-strong)', mr: 0.75 }} />Avoid</Box>
      </Box>
      <Box role="img" aria-label={`Opponent implied points: ${summary}`} sx={{ display: 'grid', rowGap: 0.7 }}>
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
      Week 7 left the wire with Terry McLaurin&apos;s season over with a torn patellar tendon, four
      teams on bye, and a report card where four cheap superflex quarterbacks returned 70.6 points
      on bids that topped out at 7%. Two of the Big Three just came off IR. Let&apos;s spend.
    </Lead>
    <P>
      Every bid below is a percentage of a $100 FAAB budget. The league is half-PPR with one
      quarterback slot and a superflex. Rostered figures come from our own snapshot, taken early
      Tuesday. Lines are ESPN&apos;s as of Tuesday. Injury statuses are our database as of
      Tuesday with Monday&apos;s reporting layered on, and where the two disagree I trust the
      database and say so. Houston, New Orleans, the Giants and San Francisco are on bye, so 28
      teams play. Thursday is Carolina at Green Bay at 8:15 p.m. ET. The clocks go back Sunday
      morning, so Sunday kickoffs are 1:00, 4:05 and 4:25 p.m. ET. Sunday night is Philadelphia at
      Washington, and Monday night is Chicago at Seattle. Week 7 carry and snap counts are not in
      our data yet, so I quote yards, catches, target share and points.
    </P>

    <H2>The Big Three</H2>
    <P>
      Coleman for the backfield, Concepcion for the target share, Cooper for the receiver room.
      All three are season windows, so price them that way. If you have the budget, you want all
      three.
    </P>
    {BIG_THREE.map((p) => <PriorityCard key={p.id} p={p} />)}
    <H3>Not in the Big Three: Antonio Williams</H3>
    <P>
      Williams (WR, WSH, 7.1% rostered) steps into a vacancy: McLaurin&apos;s season is over
      (Dan Quinn, Monday). He played 67&ndash;69% of the snaps before the bye, but drew 3 and 4
      targets in the two games before it, 11&ndash;13% shares. That is why he is a 4&ndash;7% bid,
      a role bet and not a target-share one.
    </P>

    <H2>The FAAB Ladder</H2>
    <P>
      The top of the priced board on one scale. Highlighted bars are the Big Three. Anything that
      tops out at 8% or less is a cheap bid: pick a number in the range and don&apos;t lose sleep.
      Lemon is the one to watch, because he is better if DeVonta Smith and Dontayvion Wicks sit.
    </P>
    <FaabLadder />

    <H2>The Full Board</H2>
    <P>
      Window is how long the role should last. Season means no starter is coming back to take it,
      and &quot;If X sits&quot; means exactly that. Rostered% is our snapshot, so a name at 40%
      is already in two out of five leagues out there.
    </P>
    <Table aria-label="Week 8 offensive waiver board">
      <THead>
        <TR>
          <TH scope="col">#</TH><TH scope="col">Player</TH><TH scope="col">Pos</TH><TH scope="col">Team</TH><TH scope="col">Why</TH><TH scope="col">Wk 8</TH><TH scope="col">Window</TH><TH scope="col">Bid</TH><TH scope="col">Rostered%</TH>
        </TR>
      </THead>
      <TBody>
        <TR><TD>1</TD><TD><strong>Jonah Coleman</strong></TD><TD>RB</TD><TD>DEN</TD><TD>54 rushing yards to Dobbins&apos; 23 in his first game off IR.</TD><TD>vs KC</TD><TD>Season</TD><TD>10&ndash;16%</TD><TD>24.2%</TD></TR>
        <TR><TD>2</TD><TD><strong>KC Concepcion</strong></TD><TD>WR</TD><TD>CLE</TD><TD>8 for 129 on a 29% target share; 24% in Weeks 4 and 6.</TD><TD>at PIT</TD><TD>Season</TD><TD>7&ndash;12%</TD><TD>42.9%</TD></TR>
        <TR><TD>3</TD><TD><strong>Omar Cooper Jr.</strong></TD><TD>WR</TD><TD>NYJ</TD><TD>5 for 115 and a TD. 19.3 and 20.0 in two games off IR.</TD><TD>vs LV</TD><TD>Season</TD><TD>6&ndash;10%</TD><TD>34.7%</TD></TR>
        <TR><TD>4</TD><TD><strong>Malik Willis</strong></TD><TD>QB</TD><TD>MIA</TD><TD>26.0 and 18.9 in his two starts, 111 rushing yards.</TD><TD>vs NE</TD><TD>As the starter</TD><TD>4&ndash;8%</TD><TD>6.3%</TD></TR>
        <TR><TD>5</TD><TD><strong>Antonio Williams</strong></TD><TD>WR</TD><TD>WSH</TD><TD>McLaurin out for the season. 67&ndash;69% of the snaps before the bye.</TD><TD>vs PHI (SNF)</TD><TD>Season</TD><TD>4&ndash;7%</TD><TD>7.1%</TD></TR>
        <TR><TD>6</TD><TD><strong>Makai Lemon</strong></TD><TD>WR</TD><TD>PHI</TD><TD>7 for 67 and a TD on a 24% share. Smith and Wicks questionable.</TD><TD>at WSH (SNF)</TD><TD>Season</TD><TD>4&ndash;7%</TD><TD>37.5%</TD></TR>
        <TR><TD>7</TD><TD><strong>Keon Coleman</strong></TD><TD>WR</TD><TD>BUF</TD><TD>A TD in each of Weeks 4&ndash;6. Moore questionable; Bills implied 28.5.</TD><TD>vs BAL</TD><TD>Season</TD><TD>3&ndash;6%</TD><TD>28.9%</TD></TR>
        <TR><TD>8</TD><TD><strong>Jacoby Brissett</strong></TD><TD>QB</TD><TD>ARI</TD><TD>16.5 points. Arizona implied 24.25 in a 54.5 total, the week&apos;s highest.</TD><TD>at DAL</TD><TD>Superflex stream</TD><TD>3&ndash;6%</TD><TD>19.7%</TD></TR>
        <TR><TD>9</TD><TD><strong>Michael Penix Jr.</strong></TD><TD>QB</TD><TD>ATL</TD><TD>20.4 and 23.1 the last two weeks.</TD><TD>at TB</TD><TD>Season</TD><TD>3&ndash;6%</TD><TD>12.8%</TD></TR>
        <TR><TD>10</TD><TD><strong>Greg Dulcich</strong></TD><TD>TE</TD><TD>MIA</TD><TD>5 for 86 on a 24% target share.</TD><TD>vs NE</TD><TD>Season</TD><TD>3&ndash;5%</TD><TD>1.0%</TD></TR>
        <TR><TD>11</TD><TD><strong>Geno Smith</strong></TD><TD>QB</TD><TD>NYJ</TD><TD>287 yards and 3 TDs, 23.5 points.</TD><TD>vs LV</TD><TD>Superflex stream</TD><TD>2&ndash;4%</TD><TD>13.1%</TD></TR>
        <TR><TD>12</TD><TD><strong>Chig Okonkwo</strong></TD><TD>TE</TD><TD>WSH</TD><TD>26% and 20% target shares before the bye. McLaurin out.</TD><TD>vs PHI (SNF)</TD><TD>Season</TD><TD>2&ndash;4%</TD><TD>4.9%</TD></TR>
        <TR><TD>13</TD><TD><strong>Hunter Henry</strong></TD><TD>TE</TD><TD>NE</TD><TD>7 for 71 on a 23% share. Double digits three straight weeks.</TD><TD>at MIA</TD><TD>Season</TD><TD>2&ndash;4%</TD><TD>47.2%</TD></TR>
        <TR><TD>14</TD><TD><strong>Tanner McKee</strong></TD><TD>QB</TD><TD>PHI</TD><TD>The starter for the season. 12.6 and 10.5 in two starts.</TD><TD>at WSH (SNF)</TD><TD>Season</TD><TD>2&ndash;4%</TD><TD>6.0%</TD></TR>
        <TR><TD>15</TD><TD><strong>Dameon Pierce</strong></TD><TD>RB</TD><TD>PHI</TD><TD>Barkley&apos;s back and hamstring. 47 yards and a TD on Monday.</TD><TD>at WSH (SNF)</TD><TD>If Barkley sits</TD><TD>2&ndash;4%</TD><TD>41.9%</TD></TR>
        <TR><TD>16</TD><TD><strong>Deshaun Watson</strong></TD><TD>QB</TD><TD>CLE</TD><TD>308 yards, 18.2 points.</TD><TD>at PIT</TD><TD>Superflex stream</TD><TD>2&ndash;3%</TD><TD>14.8%</TD></TR>
        <TR><TD>17</TD><TD><strong>Tez Johnson</strong></TD><TD>WR</TD><TD>TB</TD><TD>18% share, a TD and 14 rushing yards. Egbuka questionable.</TD><TD>vs ATL</TD><TD>If Egbuka sits</TD><TD>1&ndash;3%</TD><TD>0.5%</TD></TR>
        <TR><TD>18</TD><TD><strong>AJ Barner</strong></TD><TD>TE</TD><TD>SEA</TD><TD>19% share; Arroyo likely out for the season.</TD><TD>vs CHI (Mon)</TD><TD>Stream</TD><TD>1&ndash;3%</TD><TD>6.2%</TD></TR>
        <TR><TD>19</TD><TD><strong>Mason Taylor</strong></TD><TD>TE</TD><TD>NYJ</TD><TD>5 for 62 and two TDs on a 21% share.</TD><TD>vs LV</TD><TD>Stream</TD><TD>1&ndash;3%</TD><TD>0.3%</TD></TR>
        <TR><TD>20</TD><TD><strong>Dylan Sampson</strong></TD><TD>RB</TD><TD>CLE</TD><TD>45 yards and 3 catches behind Judkins.</TD><TD>at PIT</TD><TD>Handcuff</TD><TD>1&ndash;2%</TD><TD>8.7%</TD></TR>
        <TR><TD>21</TD><TD><strong>Colby Parkinson</strong></TD><TD>TE</TD><TD>LAR</TD><TD>5 for 48 on a 21% share. Ferguson not expected back next week.</TD><TD>vs LAC</TD><TD>Stream</TD><TD>1&ndash;2%</TD><TD>6.6%</TD></TR>
        <TR><TD>22</TD><TD><strong>Elic Ayomanor</strong></TD><TD>WR</TD><TD>TEN</TD><TD>23% target share; Tennessee is a 10-point underdog.</TD><TD>at CIN</TD><TD>Stream</TD><TD>1&ndash;2%</TD><TD>0.1%</TD></TR>
        <TR><TD>23</TD><TD><strong>Ryan Flournoy</strong></TD><TD>WR</TD><TD>DAL</TD><TD>4 for 70. Dallas implied 30.25, the week&apos;s highest.</TD><TD>vs ARI</TD><TD>Stream</TD><TD>1&ndash;2%</TD><TD>15.9%</TD></TR>
        <TR><TD>24</TD><TD><strong>Caleb Douglas</strong></TD><TD>WR</TD><TD>MIA</TD><TD>Two TDs on two catches, a 14% share. A rental.</TD><TD>vs NE</TD><TD>Dart</TD><TD>$1</TD><TD>9.7%</TD></TR>
        <TR><TD>25</TD><TD><strong>Drew Sample</strong></TD><TD>TE</TD><TD>CIN</TD><TD>All (knee) left Sunday, Hudson on IR. Bengals implied 28.25.</TD><TD>vs TEN</TD><TD>Stream</TD><TD>$1</TD><TD>0.1%</TD></TR>
      </TBody>
    </Table>
    <P>
      Several of these bids hang on an injury report. Pierce needs Barkley out, Tez Johnson needs
      Egbuka out, and Lemon is better if Smith and Wicks sit. Lamar Jackson ends Huntley (below)
      and Jeremiyah Love&apos;s practice ends Bam Knight. That is why none of them is above 7%.
    </P>

    <H2>Superflex Corner</H2>
    <P>
      Quarterbacks are where this format is won on the wire, so here is the ranking, with Week 7
      points.
    </P>
    <UL>
      <LI>
        <strong>Malik Willis</strong> (MIA, 6.3% rostered) is first at 26.02, after 18.88 in his
        other start. He has 111 rushing yards in two starts, and he faces New England with Miami
        implied for 18.5.
      </LI>
      <LI>
        <strong>Jacoby Brissett</strong> (ARI, 19.7%) is second at 16.48. Arizona is implied for
        24.25 in the week&apos;s highest total.
      </LI>
      <LI>
        <strong>Michael Penix Jr.</strong> (ATL, 12.8%) scored 20.42.
      </LI>
      <LI>
        <strong>Geno Smith</strong> (NYJ, 13.1%) scored 23.48.
      </LI>
      <LI>
        <strong>Tanner McKee</strong> (PHI, 6.0%) scored 10.54, and he is the season-long starter.
      </LI>
      <LI>
        <strong>Deshaun Watson</strong> (CLE, 14.8%) scored 18.22 and is at Pittsburgh with
        Cleveland implied for 18.0.
      </LI>
      <LI>
        <strong>Hold, do not cut:</strong> Bo Nix (59.0%) scored 26.28 with 74 rushing yards. Last
        week&apos;s column said to cut him in 1QB leagues, and the Receipts below own that. Hold
        Kirk Cousins (57.0%, 20.40) too.
      </LI>
      <LI>
        <strong>Sam Darnold</strong> (31.0%, 13.98) is a Monday-night start against Chicago, with
        Seattle implied for 25.0.
      </LI>
      <LI>
        <strong>Avoid Tyler Huntley</strong> (BAL, 4.3%): Jesse Minter says Lamar Jackson is
        &quot;in a decent spot&quot; to play Sunday.
      </LI>
      <LI>
        <strong>Avoid Daniel Jones</strong> (IND, 13.5%, 3.62 last week) at Jacksonville with the
        Colts implied for 19.5, and <strong>Cam Ward</strong> (TEN, 4.2%, 5.74), with Tennessee
        implied for 18.25.
      </LI>
      <LI>
        On bye and useless this week: Houston (Stroud), the Giants (McCarthy, Winston), San
        Francisco and New Orleans.
      </LI>
    </UL>

    <H2>D/ST Streaming Board</H2>
    <P>
      The recipe never changes: a backup quarterback, a thin set of weapons, and a low implied
      total. The chart below is the implied total of the offense each defense faces. Short bar,
      happy defense. D/ST rostered percentages are not in our snapshot, so check your own wire
      before you plan around a name.
    </P>
    <OpponentChart />
    <UL>
      <LI>
        <strong>Pittsburgh</strong> hosts Cleveland (18.0), the best number on the board. The
        Pittsburgh D/ST scored 14 and 12 the last two weeks.
      </LI>
      <LI>
        <strong>Washington</strong> hosts Philadelphia (18.0) on Sunday night, in McKee&apos;s
        third start and off a bye.
      </LI>
      <LI>
        <strong>Cincinnati</strong> hosts Tennessee (18.25) and scored 10 last week.{' '}
        <strong>New England</strong> at Miami (18.5) scored 7 and 1.
      </LI>
      <LI>
        <strong>Los Angeles Rams</strong> host the Chargers (19.0), with Ladd McConkey in a
        no-contact jersey.{' '}
        <strong>Jacksonville</strong> hosts Indianapolis (19.5) off a bye, after Daniel Jones
        scored 3.6 last week.
      </LI>
      <LI>
        <strong>Kansas City</strong> at Denver (20.0) scored 19 and 2.
      </LI>
    </UL>
    <P>
      <strong>Avoid:</strong> Arizona (faces Dallas, 30.25), Baltimore (faces Buffalo, 28.5),
      Tennessee (faces Cincinnati, 28.25), Indianapolis (faces Jacksonville, 27.0), Miami (faces
      New England, 26.0), and Carolina and the Chargers (both face 25.5). The grey bars above are
      those defenses.
    </P>

    <H2>Kickers</H2>
    <P>
      Kicker ownership is in our snapshot. The play is a kicker on an offense that scores, and the
      best of that group is Buffalo&apos;s, at 28.5 in a 53.5 total. Points are Week 6 then Week 7.
    </P>
    <Table aria-label="Week 8 kicker streamers">
      <THead>
        <TR>
          <TH scope="col">#</TH><TH scope="col">Kicker</TH><TH scope="col">Team</TH><TH scope="col">Team total</TH><TH scope="col">Rostered%</TH>
        </TR>
      </THead>
      <TBody>
        <TR><TD>1</TD><TD><strong>Tyler Bass</strong></TD><TD>BUF</TD><TD>28.5 in a 53.5 total; 17 in Week 6, bye in Week 7</TD><TD>9.6%</TD></TR>
        <TR><TD>2</TD><TD><strong>Evan McPherson</strong></TD><TD>CIN</TD><TD>28.25 vs TEN; 5 last week, bye in Week 6</TD><TD>21.2%</TD></TR>
        <TR><TD>3</TD><TD><strong>Chad Ryland</strong></TD><TD>ARI</TD><TD>24.25 at DAL in a 54.5 total; 19 and 11</TD><TD>9.5%</TD></TR>
        <TR><TD>4</TD><TD><strong>Chase McLaughlin</strong></TD><TD>TB</TD><TD>24.5 vs ATL; 17 and 12</TD><TD>25.1%</TD></TR>
        <TR><TD>5</TD><TD><strong>Trey Smack</strong></TD><TD>GB</TD><TD>25.5, Thursday; 12 and 6</TD><TD>14.4%</TD></TR>
      </TBody>
    </Table>
    <P>
      Bye cover: Ka&apos;imi Fairbairn (HOU), Eddy Pineiro (SF) and Dominic Zvada (NYG) are off.
    </P>

    <H2>IDP Waiver Board</H2>
    <P>
      Lines are Week 7 box scores from our database. IDP rostered percentages are not tracked, so I
      can&apos;t tell you who is sitting on your wire. Tackle volume is the currency at linebacker
      and safety. Pressure is the currency on the line. Tennessee is a 10-point underdog at
      Cincinnati, so its defense will be on the field. Winston and Anthony Hill Jr. (5
      solo and 7 assisted tackles and a forced fumble) are the tackle floor.
    </P>
    <H3>Linebacker</H3>
    <Table aria-label="IDP linebackers">
      <THead>
        <TR><TH scope="col">#</TH><TH scope="col">Player</TH><TH scope="col">Team</TH><TH scope="col">Type</TH><TH scope="col">Week 7</TH><TH scope="col">Wk 8</TH></TR>
      </THead>
      <TBody>
        <TR><TD>1</TD><TD><strong>Blake Cashman</strong></TD><TD>MIN</TD><TD><Tag kind="both" /></TD><TD>8 solo and 4 assisted tackles, 2 sacks, 2 tackles for loss and 4 passes defended.</TD><TD>at DET</TD></TR>
        <TR><TD>2</TD><TD><strong>Alex Singleton</strong></TD><TD>DEN</TD><TD><Tag kind="T" /></TD><TD>12 solo and 7 assisted tackles and a sack.</TD><TD>vs KC</TD></TR>
        <TR><TD>3</TD><TD><strong>Kendal Daniels</strong></TD><TD>ATL</TD><TD><Tag kind="both" /></TD><TD>9 solo and 2 assisted tackles and an interception.</TD><TD>at TB</TD></TR>
        <TR><TD>4</TD><TD><strong>Nakobe Dean</strong></TD><TD>LV</TD><TD><Tag kind="T" /></TD><TD>3 solo and 9 assisted tackles and an interception.</TD><TD>at NYJ</TD></TR>
        <TR><TD>5</TD><TD><strong>Patrick Queen</strong></TD><TD>PIT</TD><TD><Tag kind="T" /></TD><TD>7 solo and 3 assisted tackles and a sack.</TD><TD>vs CLE</TD></TR>
        <TR><TD>6</TD><TD><strong>Yaya Diaby</strong></TD><TD>TB</TD><TD><Tag kind="BP" /></TD><TD>3 sacks and 3 tackles for loss.</TD><TD>vs ATL</TD></TR>
      </TBody>
    </Table>
    <H3>Defensive line and edge</H3>
    <Table aria-label="IDP defensive line">
      <THead>
        <TR><TH scope="col">#</TH><TH scope="col">Player</TH><TH scope="col">Pos</TH><TH scope="col">Team</TH><TH scope="col">Week 7</TH><TH scope="col">Wk 8</TH></TR>
      </THead>
      <TBody>
        <TR><TD>1</TD><TD><strong>Adetomiwa Adebawore</strong></TD><TD>DT</TD><TD>IND</TD><TD>4 solo and 1 assisted tackle, 2 sacks and 2 tackles for loss.</TD><TD>at JAX</TD></TR>
        <TR><TD>2</TD><TD><strong>Quinnen Williams</strong></TD><TD>DT</TD><TD>DAL</TD><TD>4 solo tackles, a sack and 3 tackles for loss.</TD><TD>vs ARI</TD></TR>
        <TR><TD>3</TD><TD><strong>Boye Mafe</strong></TD><TD>DE</TD><TD>CIN</TD><TD>3 solo and 2 assisted tackles and 1.5 sacks.</TD><TD>vs TEN</TD></TR>
        <TR><TD>4</TD><TD><strong>Maason Smith</strong></TD><TD>DT</TD><TD>ATL</TD><TD>A sack, 2 tackles for loss and a forced fumble.</TD><TD>at TB</TD></TR>
        <TR><TD>5</TD><TD><strong>Aidan Hutchinson</strong></TD><TD>DE</TD><TD>DET</TD><TD>A sack.</TD><TD>vs MIN</TD></TR>
      </TBody>
    </Table>
    <H3>Defensive back</H3>
    <Table aria-label="IDP defensive backs">
      <THead>
        <TR><TH scope="col">#</TH><TH scope="col">Player</TH><TH scope="col">Pos</TH><TH scope="col">Team</TH><TH scope="col">Type</TH><TH scope="col">Week 7</TH><TH scope="col">Wk 8</TH></TR>
      </THead>
      <TBody>
        <TR><TD>1</TD><TD><strong>Jessie Bates III</strong></TD><TD>S</TD><TD>ATL</TD><TD><Tag kind="BP" /></TD><TD>2 solo and 7 assisted tackles, an interception, a forced fumble and 2 passes defended.</TD><TD>at TB</TD></TR>
        <TR><TD>2</TD><TD><strong>Kevin Winston Jr.</strong></TD><TD>S</TD><TD>TEN</TD><TD><Tag kind="T" /></TD><TD>8 solo and 6 assisted tackles.</TD><TD>at CIN</TD></TR>
        <TR><TD>3</TD><TD><strong>Nohl Williams</strong></TD><TD>CB</TD><TD>KC</TD><TD><Tag kind="both" /></TD><TD>4 solo and 6 assisted tackles and an interception.</TD><TD>at DEN</TD></TR>
        <TR><TD>4</TD><TD><strong>Marcus Jones</strong></TD><TD>CB</TD><TD>NE</TD><TD><Tag kind="both" /></TD><TD>5 solo and 4 assisted tackles, a sack and 2 tackles for loss.</TD><TD>at MIA</TD></TR>
        <TR><TD>5</TD><TD><strong>Denzel Ward</strong></TD><TD>CB</TD><TD>CLE</TD><TD><Tag kind="BP" /></TD><TD>An interception and 3 passes defended.</TD><TD>at PIT</TD></TR>
        <TR><TD>6</TD><TD><strong>Harrison Smith</strong></TD><TD>S</TD><TD>MIN</TD><TD><Tag kind="BP" /></TD><TD>An interception and half a sack.</TD><TD>at DET</TD></TR>
      </TBody>
    </Table>
    <P>
      Tackle-heavy scoring: bump the Tackles tags a tier. Big-play scoring: bump the Big play tags.
      Cashman, Daniels, Nohl Williams and Marcus Jones carry both.
    </P>

    <H2>The Injury Ledger</H2>
    <H3>Out or on IR</H3>
    <UL>
      <LI><strong>Terry McLaurin</strong> (WSH WR): torn patellar tendon in his left knee, out for the season (Quinn, Monday). Antonio Williams, Chig Okonkwo.</LI>
      <LI><strong>Jalen Hurts</strong> (PHI QB): IR, blood clots, expected to miss the rest of the season. McKee.</LI>
      <LI><strong>De&apos;Von Achane</strong> (MIA RB): on IR (knee) as of Monday. Ollie Gordon II (80.5%) ran for 103 and a TD Sunday, so he is not a waiver add. <strong>Jaylen Wright</strong> (quadriceps) left Sunday&apos;s game and did not return.</LI>
      <LI><strong>Davante Adams</strong> (LAR WR): placed on IR Tuesday, hamstring (Rapoport).</LI>
      <LI><strong>Jacory Croskey-Merritt</strong> (WSH RB): IR, groin. Rachaad White (56.5%) has the backfield coming off the bye.</LI>
      <LI><strong>Jordyn Tyson</strong> (NO WR): IR, hamstring. Mickey Loomis says he is &quot;getting closer&quot; but will not practice this week. New Orleans is on bye. A stash, at 34.3%.</LI>
      <LI><strong>Terrance Ferguson</strong> (LAR TE): IR, ankle, eligible next week but not expected to be ready then (Schefter). Parkinson.</LI>
      <LI><strong>Jadarian Price</strong> (SEA RB): IR, chest. Mike Macdonald says he will be designated to return during Week 8.</LI>
      <LI><strong>Elijah Arroyo</strong> (SEA TE): shoulder surgery, likely out for the season (Macdonald). Barner.</LI>
      <LI><strong>Cole Kmet</strong> (CHI TE): IR, knee. Colston Loveland (92.5%) had a 40% share.</LI>
      <LI><strong>Romeo Doubs</strong> (NE WR): IR, shoulder, hopeful to return after the Week 11 bye.</LI>
      <LI><strong>Roman Wilson</strong> (PIT WR): IR, finger.</LI>
    </UL>
    <H3>Questionable and day-to-day</H3>
    <UL>
      <LI><strong>Lamar Jackson</strong> (BAL QB): ankle. Minter says he is &quot;in a decent spot&quot; to play Sunday at Buffalo. Cut Huntley.</LI>
      <LI><strong>Saquon Barkley</strong> (PHI RB): says the back injury was compensatory after he tweaked his hamstring on his first run Monday. Pierce.</LI>
      <LI><strong>DeVonta Smith</strong> and <strong>Dontayvion Wicks</strong> (PHI WR): questionable. Neither recorded a stat Monday night. Lemon.</LI>
      <LI><strong>Christian McCaffrey</strong> (SF RB): a mild hamstring strain, not a quadriceps injury, and the 49ers think he is ready after the bye. Cut Kaelon Black. <strong>Mike Evans</strong> (Achilles) and <strong>Deebo Samuel Sr.</strong> (hamstring) are also expected back after the bye.</LI>
      <LI><strong>Jeremiyah Love</strong> (ARI RB): ankle. Mike LaFleur says he practices Wednesday. Bam Knight&apos;s window is closing.</LI>
      <LI><strong>Breece Hall</strong> (NYJ RB): questionable, missed Week 7. Braelon Allen (81.2%) ran for 104.</LI>
      <LI><strong>Amon-Ra St. Brown</strong> (DET WR): tweaked his ankle Sunday and should practice Thursday (Dan Campbell).</LI>
      <LI><strong>Aaron Jones Sr.</strong> (MIN RB): left knee, not considered significant, day-to-day (Schefter).</LI>
      <LI><strong>Jaylen Waddle</strong> (DEN WR): chest, did not return Sunday.</LI>
      <LI><strong>Matthew Golden</strong> (GB WR): shoulder and foot, did not practice on Monday&apos;s estimated report. Thursday game.</LI>
      <LI><strong>Jalen Coker</strong> (CAR WR): shoulder, limited on Monday&apos;s estimated report. Thursday game.</LI>
      <LI><strong>Emeka Egbuka</strong> (TB WR): questionable. Tez Johnson.</LI>
      <LI><strong>DJ Moore</strong> (BUF WR): questionable, shoulder. Keon Coleman.</LI>
      <LI><strong>Erick All Jr.</strong> (CIN TE): knee, ruled out of Sunday&apos;s game. Drew Sample.</LI>
      <LI><strong>Jaylin Noel</strong> (HOU WR): toe, seen in a walking boot after Sunday&apos;s game, and Houston is on bye. Cut.</LI>
      <LI><strong>Cam Skattebo</strong> (NYG RB): tweaked a hamstring and is expected to be OK (Mike Garafolo). Tyrone Tracy Jr. (hamstring) did not return. The Giants are on bye.</LI>
      <LI><strong>Ladd McConkey</strong> (LAC WR): concussion, no-contact jersey at Monday&apos;s practice. <strong>Rashid Shaheed</strong> (SEA WR): knee, early returns positive.</LI>
      <LI><strong>Kyle Monangai</strong> (CHI RB), <strong>Tyjae Spears</strong> (TEN RB), <strong>Calvin Ridley</strong> (TEN WR), <strong>Rashee Rice</strong> (KC WR), <strong>Tyler Warren</strong> (IND TE) and <strong>Brian Robinson Jr.</strong> (ATL RB): questionable, no new detail.</LI>
    </UL>

    <H2>Receipts: Grading Week 7</H2>
    <P>
      Last week&apos;s board, graded in half-PPR points from our database. The hits first.
    </P>
    <Table aria-label="Week 7 board hits">
      <THead>
        <TR><TH scope="col">Player</TH><TH scope="col">Points</TH><TH scope="col">Wk 7 bid</TH></TR>
      </THead>
      <TBody>
        <TR><TD><strong>Geno Smith</strong></TD><TD>23.5</TD><TD>1&ndash;2%</TD></TR>
        <TR><TD><strong>Michael Penix Jr.</strong></TD><TD>20.4</TD><TD>4&ndash;7%</TD></TR>
        <TR><TD><strong>Omar Cooper Jr.</strong></TD><TD>20.0</TD><TD>8&ndash;12%</TD></TR>
        <TR><TD><strong>Tre Tucker</strong></TD><TD>18.8</TD><TD>3&ndash;6%</TD></TR>
        <TR><TD><strong>C.J. Stroud</strong></TD><TD>16.5</TD><TD>4&ndash;7%</TD></TR>
        <TR><TD><strong>Kyler Murray</strong></TD><TD>13.9</TD><TD>3&ndash;6%</TD></TR>
        <TR><TD><strong>Aaron Rodgers</strong></TD><TD>13.1</TD><TD>3&ndash;6%</TD></TR>
        <TR><TD><strong>Hunter Henry</strong></TD><TD>10.6</TD><TD>2&ndash;4%</TD></TR>
        <TR><TD><strong>J.J. McCarthy</strong></TD><TD>10.2</TD><TD>1&ndash;3%</TD></TR>
      </TBody>
    </Table>
    <P>
      Smith threw for 287 yards and 3 TDs. Cooper caught 5 for 115 and a TD. Tucker caught 5 for
      103 and a TD on a 28% share. Henry caught 7 for 71 on a 23% share, and McCarthy was named
      the starter. Now the misses and the shrugs.
    </P>
    <Table aria-label="Week 7 board misses and pushes">
      <THead>
        <TR><TH scope="col">Player</TH><TH scope="col">Points</TH><TH scope="col">Wk 7 bid</TH><TH scope="col">What happened</TH></TR>
      </THead>
      <TBody>
        <TR><TD><strong>Tanner McKee</strong></TD><TD>10.5</TD><TD>8&ndash;14%</TD><TD>A push: the job, not the points.</TD></TR>
        <TR><TD><strong>Ryan Flournoy</strong></TD><TD>9.0</TD><TD>1&ndash;3%</TD><TD>A push.</TD></TR>
        <TR><TD><strong>Bam Knight</strong></TD><TD>7.8</TD><TD>1&ndash;3%</TD><TD>A push. Love sat.</TD></TR>
        <TR><TD><strong>Colby Parkinson</strong></TD><TD>7.3</TD><TD>1&ndash;3%</TD><TD>A push.</TD></TR>
        <TR><TD><strong>Darnell Washington</strong></TD><TD>6.9</TD><TD>$1</TD><TD>A push.</TD></TR>
        <TR><TD><strong>DeMario Douglas</strong></TD><TD>3.8</TD><TD>6&ndash;10%</TD><TD>3 for 23 on a 13% share.</TD></TR>
        <TR><TD><strong>Roschon Johnson</strong></TD><TD>1.3</TD><TD>4&ndash;7%</TD><TD>Swift scored 17.0.</TD></TR>
        <TR><TD><strong>Jaylin Noel</strong></TD><TD>0.7</TD><TD>3&ndash;6%</TD><TD>Hurt his toe.</TD></TR>
        <TR><TD><strong>Ja&apos;Kobi Lane</strong></TD><TD>4.0</TD><TD>3&ndash;6%</TD><TD>Not enough.</TD></TR>
        <TR><TD><strong>Kendre Miller</strong></TD><TD>4.3</TD><TD>3&ndash;5%</TD><TD>Not enough.</TD></TR>
        <TR><TD><strong>Michael Mayer</strong></TD><TD>4.7</TD><TD>2&ndash;4%</TD><TD>Not enough.</TD></TR>
        <TR><TD><strong>Keenan Allen</strong></TD><TD>4.6</TD><TD>2&ndash;4%</TD><TD>Not enough.</TD></TR>
        <TR><TD><strong>Jaleel McLaughlin</strong></TD><TD>0.0</TD><TD>2&ndash;4%</TD><TD>Judkins returned.</TD></TR>
        <TR><TD><strong>Jahan Dotson</strong></TD><TD>1.1</TD><TD>1&ndash;2%</TD><TD>Not enough.</TD></TR>
        <TR><TD><strong>Jawhar Jordan</strong></TD><TD>DNP</TD><TD>1&ndash;2%</TD><TD>Did not play.</TD></TR>
        <TR><TD><strong>Audric Estime</strong></TD><TD>DNP</TD><TD>$1</TD><TD>Did not play.</TD></TR>
      </TBody>
    </Table>
    <P>
      Also on the record: last week&apos;s column said to cut Bo Nix in 1QB leagues. He scored 26.3
      with 74 rushing yards. I own it.
    </P>
    <H3>The lesson</H3>
    <P>
      The Big Three went one hit, one push, one miss. The cheap superflex quarterbacks carried the
      week: Geno Smith, Penix, Stroud and McCarthy returned 70.6 points on bids that topped out at
      7%. The two handcuffs bought on someone else&apos;s injury, Johnson and McLaughlin, returned
      1.3 when the starter played.
    </P>
    <H3>Where the market went</H3>
    <UL>
      <LI><strong>Omar Cooper Jr.</strong>: 2.9% to 34.7% rostered.</LI>
      <LI><strong>DeMario Douglas</strong>: 13.8% to 48.0%, and then 3.8 points.</LI>
      <LI><strong>Roschon Johnson</strong>: 3.9% to 23.7%, on 1.3.</LI>
      <LI><strong>Jaylin Noel</strong>: 4.7% to 24.3%, on 0.7.</LI>
      <LI><strong>J.J. McCarthy</strong>: 0.9% to 21.7%.</LI>
      <LI><strong>C.J. Stroud</strong>: 43.7% to 79.1%.</LI>
      <LI><strong>Aaron Rodgers</strong>: 26.2% to 56.5%.</LI>
      <LI><strong>Bam Knight</strong>: 0.3% to 17.1%.</LI>
    </UL>

    <H2>The Darkness Doctrine</H2>
    <P>
      Last week&apos;s receipts wrote this week&apos;s rules. Five of them.
    </P>
    <H3>Rule 1: Target share over touchdowns, again</H3>
    <P>
      Cooper was bought on a 24% share and scored 20.0. Henry (23%) scored 10.6. Last week&apos;s
      named touchdown traps, Tyrone Tracy Jr., Foster Moreau and Tommy Tremble, returned 9.5
      combined. This week&apos;s traps: Caleb Douglas (two TDs on two catches, a 14% share), Davis
      Allen (LAR TE, two TDs on 20 yards), Darren Waller (CAR TE, a TD on one catch, a 7% share)
      and Sean Tucker (TB RB, a TD as the third back).
    </P>
    <H3>Rule 2: Buy the job</H3>
    <P>
      Coleman&apos;s rushing share, Williams&apos; vacancy, Willis&apos; starts. McKee was a push
      for the same reason: 10.5 points, but the job is his for the season.
    </P>
    <H3>Rule 3: Four byes</H3>
    <P>
      Houston, New Orleans, the Giants and San Francisco are off. Check the lineup before the
      wire. Spend only on stashes (Jordyn Tyson), never on a Week 8 start from those four.
    </P>
    <H3>Rule 4: Thursday locks first</H3>
    <P>
      Carolina at Green Bay is Thursday night (Golden questionable, Coker limited, Smack). Sunday
      night is Philadelphia at Washington (Williams, Okonkwo, Lemon, McKee, Pierce), and Monday
      night is Chicago at Seattle (Barner, Darnold).
    </P>
    <H3>Rule 5: Price the second bet</H3>
    <P>
      Pierce needs Barkley out, Tez Johnson needs Egbuka out, Lemon is better if Smith and Wicks
      sit, Lamar Jackson ends Huntley, and Love&apos;s practice ends Knight. That is why none of
      them is above 7%.
    </P>
    <Quote>
      Buy the job. Rent the touchdown. Never pay for last week&apos;s.
    </Quote>

    <H2>Who to Cut</H2>
    <UL>
      <LI><strong>Jaylin Noel</strong>: toe, walking boot, bye, at 24.3% rostered.</LI>
      <LI><strong>Roschon Johnson</strong>: 1.3 points while Swift scored 17.0, at 23.7%.</LI>
      <LI><strong>Kaelon Black</strong>: McCaffrey is expected back after the bye, at 21.9%.</LI>
      <LI><strong>Tyler Huntley</strong>: Jackson is &quot;in a decent spot.&quot;</LI>
      <LI><strong>Bam Knight</strong>, once Love practices, at 17.1%.</LI>
      <LI><strong>Michael Mayer</strong>: 4.7 on a 7% share, at 28.2%.</LI>
      <LI><strong>Jaleel McLaughlin</strong>: 0.0, with Judkins back. <strong>Jahan Dotson</strong>: 1.1.</LI>
      <LI><strong>Hold</strong> Davante Adams and Terry McLaurin in IR slots (McLaurin goes to the wire in leagues without one), and Jalen Hurts in an IR slot or on the wire.</LI>
      <LI><strong>Hold</strong> McCaffrey, Evans and Samuel through the bye, and DeMario Douglas for one more week (3.8 on a 13% share after 20.5 and 16.1).</LI>
    </UL>

    <H2>The Week 8 Bid Sheet</H2>
    <P>Set your claims in this order.</P>
    <OL>
      <LI><strong>Jonah Coleman</strong> at 10&ndash;16%.</LI>
      <LI><strong>KC Concepcion</strong> at 7&ndash;12%.</LI>
      <LI><strong>Omar Cooper Jr.</strong> at 6&ndash;10%.</LI>
      <LI>Superflex: <strong>Malik Willis</strong> at 4&ndash;8% ($1 in 1QB), then <strong>Jacoby Brissett</strong> at 3&ndash;6% and <strong>Michael Penix Jr.</strong> at 3&ndash;6%.</LI>
      <LI><strong>Antonio Williams</strong> and <strong>Makai Lemon</strong> at 4&ndash;7%. Both play Sunday night.</LI>
      <LI><strong>Keon Coleman</strong> at 3&ndash;6% and <strong>Greg Dulcich</strong> at 3&ndash;5%.</LI>
      <LI>The rest of the Full Board at the ranges listed, and $1 on Caleb Douglas and Drew Sample.</LI>
    </OL>
    <P>
      Injury statuses are as of Tuesday. Barkley, Egbuka, Smith and Wicks, and Lamar Jackson decide
      five of these bids before kickoff, Thursday night is Carolina at Green Bay, and the clocks go
      back Sunday morning. Andy Darkness is a pen name and has no rooting interest, allegedly.
    </P>
  </>
);

export default Body;
