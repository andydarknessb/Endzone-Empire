import React from 'react';
import { Box } from '@mui/material';
import {
  Lead, P, H2, H3, UL, OL, LI, Quote,
  Table, THead, TBody, TR, TH, TD,
} from '../../components/public/kit/Prose';

// Body only: the frontmatter lives in week5-waiver-wire-darkness-report.meta.js so listings can be
// built without loading this prose; content/articles/index.js loads it on demand.
//
// Every color below the hero is a theme token, so the cards, charts and chips read in light and
// dark. The hero is a dark illustration in both themes, like the Week 3 start/sit banner.

const POS_COLOR = {
  QB: 'var(--pos-qb)', RB: 'var(--pos-rb)', WR: 'var(--pos-wr)', TE: 'var(--pos-te)',
  DEF: 'var(--pos-def)', LB: 'var(--pos-idp)', DL: 'var(--pos-idp)', DB: 'var(--pos-idp)',
};

function HeroBanner() {
  // Claim cards fanned across the field: taller card, bigger bid. The Big Three are green.
  const bids = [
    { x: 150, h: 150, label: 'WILSON', fill: '#2fd97b' },
    { x: 262, h: 125, label: 'SHIPLEY', fill: '#2fd97b' },
    { x: 374, h: 100, label: 'COLEMAN', fill: '#2fd97b' },
    { x: 486, h: 83, label: 'HOCKENSON', fill: '#7eaaff' },
    { x: 598, h: 67, label: 'COUSINS', fill: '#7eaaff' },
  ];
  return (
    <Box
      component="svg"
      viewBox="0 0 800 300"
      xmlns="http://www.w3.org/2000/svg"
      sx={{ width: '100%', borderRadius: 'var(--radius-md, 10px)', overflow: 'hidden', mb: 4, display: 'block' }}
      role="img"
      aria-labelledby="wk5ww-hero-title wk5ww-hero-desc"
    >
      <title id="wk5ww-hero-title">Week 5 Waiver Wire: The Darkness Report</title>
      <desc id="wk5ww-hero-desc">
        A night field under a floodlight with five glowing bid bars rising from the turf, tallest
        first: Emanuel Wilson, Will Shipley, Keon Coleman, T.J. Hockenson and Kirk Cousins, over
        the headline Week 5 Waiver Wire. The first three are the Big Three.
      </desc>
      <defs>
        <linearGradient id="wk5ww-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#060910" />
          <stop offset="0.55" stopColor="#0c1424" />
          <stop offset="1" stopColor="#161027" />
        </linearGradient>
        <radialGradient id="wk5ww-flood" cx="0.5" cy="0" r="0.85">
          <stop offset="0" stopColor="#7eaaff" stopOpacity="0.34" />
          <stop offset="1" stopColor="#7eaaff" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="wk5ww-bar" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.28" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <rect width="800" height="300" fill="url(#wk5ww-bg)" />
      <rect width="800" height="300" fill="url(#wk5ww-flood)" />
      {Array.from({ length: 11 }, (_, i) => (
        <line key={`yd${i}`} x1={40 + i * 72} y1="120" x2={6 + i * 79} y2="300" stroke="rgba(255,255,255,0.06)" />
      ))}
      <line x1="0" y1="206" x2="800" y2="206" stroke="rgba(255,255,255,0.12)" strokeDasharray="6 8" />
      {bids.map((b) => (
        <g key={b.label}>
          <rect x={b.x} y={206 - b.h} width="56" height={b.h} rx="8" fill={b.fill} opacity="0.2" />
          <rect x={b.x} y={206 - b.h} width="56" height={b.h} rx="8" fill="url(#wk5ww-bar)" />
          <rect x={b.x} y={206 - b.h} width="56" height="5" rx="2.5" fill={b.fill} />
          <text x={b.x + 28} y={198 - b.h} textAnchor="middle" fill={b.fill} fontFamily="system-ui, sans-serif" fontWeight="800" fontSize="11" letterSpacing="1.5">{b.label}</text>
        </g>
      ))}
      <text x="400" y="34" textAnchor="middle" fill="#8badc9" fontFamily="system-ui, sans-serif" fontWeight="700" fontSize="12" letterSpacing="4">THE DARKNESS REPORT</text>
      <rect x="120" y="222" width="560" height="64" rx="14" fill="rgba(3,8,20,0.84)" stroke="rgba(126,170,255,0.25)" />
      <text x="400" y="253" textAnchor="middle" fill="#ffffff" fontFamily="system-ui, sans-serif" fontWeight="850" fontSize="24" letterSpacing="1">WEEK 5 WAIVER WIRE</text>
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
    id: 'emanuel-wilson', rank: 1, name: 'Emanuel Wilson', pos: 'RB', team: 'SEA', matchup: 'vs SF',
    min: 12, max: 18, rostered: '50.1% rostered', window: '1 to 2 weeks', windowTone: 'var(--warning)',
    take: 'Wilson ran for 81 yards and a touchdown, caught 3 for 39 and another score, and finished with 28.5 points. Zach Charbonnet is ruled out for Week 5 per Seahawks reporting, and Jadarian Price is on injured reserve. George Holani had 18 rushing yards. Wilson ran for 3.6 yards a carry, so this is a rental.',
    pro: 'With Charbonnet out and Price on IR, the job is his this week. Seattle is implied for 25.0 against San Francisco, the kind of number that keeps a lead back on the field.',
    con: 'Charbonnet is coming back from his ACL, gets team practice reps this week and projects to debut in Week 6. Half the league already rosters Wilson (50.1%), and two touchdowns built that 28.5. Bid for the job you can see, which is one or two weeks.',
  },
  {
    id: 'will-shipley', rank: 2, name: 'Will Shipley', pos: 'RB', team: 'PHI', matchup: 'at JAX (London)',
    min: 10, max: 15, rostered: '0.6% rostered', window: '1 to 3 weeks', windowTone: 'var(--warning)',
    take: 'Saquon Barkley (hamstring) is week-to-week, and Tank Bigsby is headed to injured reserve after core muscle surgery. Shipley is projected for 15-plus touches (NBC, October 5). In Week 4 he ran for 23 yards behind Barkley and Bigsby, so the production is still a projection.',
    pro: 'Two backs ahead of him are hurt or headed to IR, and he is at 0.6% rostered.',
    con: 'Philadelphia plays in London on Sunday morning, at Jacksonville, and is implied for just 18.0. DeVonta Smith and Hollywood Brown are out too, so the offense around him is thin. If Barkley is back, the window closes.',
  },
  {
    id: 'keon-coleman', rank: 3, name: 'Keon Coleman', pos: 'WR', team: 'BUF', matchup: 'at LAR (Mon)',
    min: 8, max: 12, rostered: '4.2% rostered', window: 'While Moore is out', windowTone: 'var(--warning)',
    take: 'Six catches for 116 yards and a touchdown on a 23% target share, worth 20.6 points, and it came with DJ Moore out from late in the second quarter. Moore re-aggravated an AC joint sprain, reported as not long-term, and is Questionable. Buffalo goes to Los Angeles on Monday night, in a game with the week\'s co-highest total (54.5).',
    pro: 'Buffalo is implied for 26.0 in that shootout, and Coleman just drew 23% of the targets. He is barely rostered (4.2%), so nobody is bidding against a crowd.',
    con: 'Moore is Questionable, not out, and this bid is a bet on an injury report. When Moore is back, the target share gets split. It is also a Monday night game, so you will not see how it breaks until the end of the week.',
  },
];

// Bid ranges, % of a $100 budget. Big Three first, then the top of the priced board.
const LADDER = [
  ['Emanuel Wilson', 'RB', 12, 18, true],
  ['Will Shipley', 'RB', 10, 15, true],
  ['Keon Coleman', 'WR', 8, 12, true],
  ['T.J. Hockenson', 'TE', 6, 10, false],
  ['Kirk Cousins', 'QB', 5, 8, false],
  ['C.J. Stroud', 'QB', 4, 7, false],
  ['Jameis Winston', 'QB', 3, 6, false],
  ['Romeo Doubs', 'WR', 3, 6, false],
  ['Brenton Strange', 'TE', 3, 6, false],
  ['B. Robinson Jr.', 'RB', 3, 6, false],
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
  { def: 'HOU', opp: 'TEN', pts: 16.25, kind: 'stream' },
  { def: 'CIN', opp: 'MIA', pts: 17.75, kind: 'stream' },
  { def: 'JAX', opp: 'PHI', pts: 18, kind: 'stream' },
  { def: 'NYJ', opp: 'CLE', pts: 18.5, kind: 'stream' },
  { def: 'DAL', opp: 'TB', pts: 19, kind: 'stream' },
  { def: 'DEN', opp: 'LAC', pts: 19.5, kind: 'stream' },
  { def: 'LAR', opp: 'BUF', pts: 26, kind: 'avoid' },
  { def: 'BUF', opp: 'LAR', pts: 28.5, kind: 'avoid' },
  { def: 'ARI', opp: 'DET', pts: 29.5, kind: 'avoid' },
];

function OpponentChart() {
  const max = 30;
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
      Week 4 left the wire with a Seattle backfield missing Charbonnet and Price, a Philadelphia
      backfield missing Barkley and Bigsby, and a Buffalo receiver who caught six for 116 once DJ
      Moore left the game. The darkness has a shape this week, and half of it is rentals. Let&apos;s
      spend.
    </Lead>
    <P>
      Every bid below is a percentage of a $100 FAAB budget. The league is half-PPR with one
      quarterback slot and a superflex. Rostered figures come from our own snapshot, taken early
      Tuesday. Lines are ESPN&apos;s as of Tuesday morning, and the Baltimore at Atlanta line
      flipped from Baltimore -2.5 to Atlanta -1.5 that morning. Injury statuses are our database as
      of Tuesday with the last few days of reporting layered on, and where the two disagree I trust
      the database and say so. Carolina and Kansas City are on bye, so 30 teams play. Thursday is
      Tampa Bay at Dallas, Philadelphia at Jacksonville kicks off Sunday at 9:30 a.m. ET in London,
      Sunday night is Baltimore at Atlanta, and Monday night is Buffalo at the Rams.
    </P>

    <H2>The Big Three</H2>
    <P>
      Wilson and Shipley for the backfields, Coleman for the receiver room. Every one of the three
      has a clock on it, so price them that way. If you have the budget, you want all three.
    </P>
    {BIG_THREE.map((p) => <PriorityCard key={p.id} p={p} />)}
    <H3>Just outside the Big Three: T.J. Hockenson</H3>
    <P>
      Hockenson (TE, MIN, 54.7% rostered) caught 13 for 119 on a 39% target share for 18.4 points
      with Justin Jefferson inactive. Jefferson (ankle) was Out in Week 4 and could play Week 5.
      With Jefferson playing in Weeks 2 and 3, Hockenson scored 4.4 and 2.1. Minnesota is
      implied for 22.0 at New Orleans. Bid 6&ndash;10%, and treat the window as however long
      Jefferson is out.
    </P>

    <H2>The FAAB Ladder</H2>
    <P>
      The top of the priced board on one scale. Highlighted bars are the Big Three. Anything that
      tops out at 6% or less is a cheap bid: pick a number in the range and don&apos;t lose sleep.
    </P>
    <FaabLadder />

    <H2>The Full Board</H2>
    <P>
      Window is how long the role should last. Season means no starter is coming back to take it,
      and &quot;While X is out&quot; means exactly that. Rostered% is our snapshot, so a name at
      50% is already in half the leagues out there.
    </P>
    <Table aria-label="Week 5 offensive waiver board">
      <THead>
        <TR>
          <TH scope="col">#</TH><TH scope="col">Player</TH><TH scope="col">Pos</TH><TH scope="col">Team</TH><TH scope="col">Why</TH><TH scope="col">Wk 5</TH><TH scope="col">Window</TH><TH scope="col">Bid</TH><TH scope="col">Rostered%</TH>
        </TR>
      </THead>
      <TBody>
        <TR><TD>1</TD><TD><strong>Emanuel Wilson</strong></TD><TD>RB</TD><TD>SEA</TD><TD>Charbonnet out Week 5, Price on IR. 81 yards, two TDs, 28.5 points.</TD><TD>vs SF</TD><TD>1&ndash;2 wks</TD><TD>12&ndash;18%</TD><TD>50.1%</TD></TR>
        <TR><TD>2</TD><TD><strong>Will Shipley</strong></TD><TD>RB</TD><TD>PHI</TD><TD>Barkley week-to-week (hamstring), Bigsby to IR. Projected for 15+ touches.</TD><TD>at JAX (London)</TD><TD>1&ndash;3 wks</TD><TD>10&ndash;15%</TD><TD>0.6%</TD></TR>
        <TR><TD>3</TD><TD><strong>Keon Coleman</strong></TD><TD>WR</TD><TD>BUF</TD><TD>6 for 116 and a TD. DJ Moore hurt (AC joint).</TD><TD>at LAR (Mon)</TD><TD>While Moore is out</TD><TD>8&ndash;12%</TD><TD>4.2%</TD></TR>
        <TR><TD>4</TD><TD><strong>T.J. Hockenson</strong></TD><TD>TE</TD><TD>MIN</TD><TD>13 for 119 on a 39% target share without Jefferson.</TD><TD>at NO</TD><TD>While Jefferson is out</TD><TD>6&ndash;10%</TD><TD>54.7%</TD></TR>
        <TR><TD>5</TD><TD><strong>Kirk Cousins</strong></TD><TD>QB</TD><TD>LV</TD><TD>20+ points three straight weeks. Superflex starter.</TD><TD>at NE</TD><TD>Season</TD><TD>5&ndash;8%</TD><TD>16.9%</TD></TR>
        <TR><TD>6</TD><TD><strong>C.J. Stroud</strong></TD><TD>QB</TD><TD>HOU</TD><TD>347 yards, 2 TDs. Draws Tennessee (16.25 implied).</TD><TD>at TEN</TD><TD>Season</TD><TD>4&ndash;7%</TD><TD>37.2%</TD></TR>
        <TR><TD>7</TD><TD><strong>Jameis Winston</strong></TD><TD>QB</TD><TD>NYG</TD><TD>Dart out for the regular season. 250 yards, 3 TDs in Week 4.</TD><TD>at WSH</TD><TD>Season</TD><TD>3&ndash;6%</TD><TD>2.8%</TD></TR>
        <TR><TD>8</TD><TD><strong>Romeo Doubs</strong></TD><TD>WR</TD><TD>NE</TD><TD>6 for 58 and two TDs, 25% target share. A.J. Brown on IR.</TD><TD>vs LV</TD><TD>2+ wks</TD><TD>3&ndash;6%</TD><TD>58.4%</TD></TR>
        <TR><TD>9</TD><TD><strong>Brenton Strange</strong></TD><TD>TE</TD><TD>JAX</TD><TD>7 for 95 on a 35% target share.</TD><TD>vs PHI (London)</TD><TD>Season</TD><TD>3&ndash;6%</TD><TD>16.7%</TD></TR>
        <TR><TD>10</TD><TD><strong>Brian Robinson Jr.</strong></TD><TD>RB</TD><TD>ATL</TD><TD>Three rushing TDs. The goal-line half of a committee.</TD><TD>vs BAL (SNF)</TD><TD>Season</TD><TD>3&ndash;6%</TD><TD>27.0%</TD></TR>
        <TR><TD>11</TD><TD><strong>Darius Cooper</strong></TD><TD>WR</TD><TD>PHI</TD><TD>Two TDs, 28% target share. DeVonta Smith and Hollywood Brown out.</TD><TD>at JAX (London)</TD><TD>1&ndash;3 wks</TD><TD>2&ndash;5%</TD><TD>0.2%</TD></TR>
        <TR><TD>12</TD><TD><strong>Jalon Daniels</strong></TD><TD>QB</TD><TD>TB</TD><TD>Mayfield out until Week 7 at the earliest (thumb). Debut start: 148 passing, 55 rushing.</TD><TD>at DAL (Thu)</TD><TD>2 wks</TD><TD>2&ndash;4%</TD><TD>1.6%</TD></TR>
        <TR><TD>13</TD><TD><strong>MarShawn Lloyd</strong></TD><TD>RB</TD><TD>GB</TD><TD>Has had the job since Week 1 with Jacobs out: 2.7 yards a carry. Committee with Kaleb Johnson.</TD><TD>vs CHI</TD><TD>Committee</TD><TD>2&ndash;4%</TD><TD>48.9%</TD></TR>
        <TR><TD>14</TD><TD><strong>Michael Mayer</strong></TD><TD>TE</TD><TD>LV</TD><TD>8 for 82, 21% target share.</TD><TD>at NE</TD><TD>Season</TD><TD>2&ndash;4%</TD><TD>12.0%</TD></TR>
        <TR><TD>15</TD><TD><strong>Tyler Allgeier</strong></TD><TD>RB</TD><TD>ARI</TD><TD>Jeremiyah Love questionable. 42 yards and a TD. Handcuff in a 54.5 total.</TD><TD>vs DET</TD><TD>Handcuff</TD><TD>2&ndash;4%</TD><TD>28.2%</TD></TR>
        <TR><TD>16</TD><TD><strong>Tyson Bagent</strong></TD><TD>QB</TD><TD>CHI</TD><TD>Caleb Williams week-to-week (hamstring). Named the Week 5 starter.</TD><TD>at GB</TD><TD>1&ndash;3 wks</TD><TD>1&ndash;3%</TD><TD>1.3%</TD></TR>
        <TR><TD>17</TD><TD><strong>Dohnte Meyers</strong></TD><TD>WR</TD><TD>CIN</TD><TD>7 for 82. Chase in concussion protocol, Higgins day-to-day.</TD><TD>at MIA</TD><TD>1&ndash;2 wks</TD><TD>1&ndash;3%</TD><TD>0.2%</TD></TR>
        <TR><TD>18</TD><TD><strong>Keaton Mitchell</strong></TD><TD>RB</TD><TD>LAC</TD><TD>5 catches, 19% target share. Pass-down role.</TD><TD>vs DEN</TD><TD>Season</TD><TD>1&ndash;3%</TD><TD>18.1%</TD></TR>
        <TR><TD>19</TD><TD><strong>Malik Washington</strong></TD><TD>WR</TD><TD>MIA</TD><TD>29% target share, 5 for 67.</TD><TD>vs CIN</TD><TD>Season</TD><TD>1&ndash;3%</TD><TD>28.3%</TD></TR>
        <TR><TD>20</TD><TD><strong>Isaac TeSlaa</strong></TD><TD>WR</TD><TD>DET</TD><TD>4 for 95. Detroit has the week&apos;s top implied total (29.5).</TD><TD>at ARI</TD><TD>Stream</TD><TD>$1</TD><TD>2.0%</TD></TR>
        <TR><TD>21</TD><TD><strong>Roman Wilson</strong></TD><TD>WR</TD><TD>PIT</TD><TD>3 for 74 and a TD. Role shrinking since Pittman&apos;s return.</TD><TD>vs IND</TD><TD>Stream</TD><TD>$1</TD><TD>3.6%</TD></TR>
      </TBody>
    </Table>
    <P>
      MarShawn Lloyd fell from the top of this board for a reason: the vacancy is four weeks old
      and the job has not paid. That is the doctrine below, working on my own list.
    </P>

    <H2>Superflex Corner</H2>
    <P>
      Quarterbacks are where this format is won on the wire, so here is the ranking.
    </P>
    <UL>
      <LI>
        <strong>Kirk Cousins</strong> (LV) over <strong>C.J. Stroud</strong> (HOU). Cousins has
        scored 20.2, 22.2 and 20.6 over the last three weeks. Stroud has gone 17.0, 11.7 and 23.1.
        Both are starters, but Cousins is the steadier one.
      </LI>
      <LI>
        <strong>Jameis Winston</strong> (NYG, 2.8% rostered) is next. Jaxson Dart is out for the
        regular season, which makes Winston the full-season starter, and he threw for 250 yards
        and 3 TDs in Week 4.
      </LI>
      <LI>
        <strong>Aaron Rodgers</strong> (PIT, 6.5%) is the deeper stream. He scored 19.96 in Week 4
        with 3 TD and 2 INT, and he gets Indianapolis at home.
      </LI>
      <LI>
        Starters under 10% worth a line: <strong>Michael Penix Jr.</strong> (ATL, 6.0%, 12.72
        points, vs BAL), <strong>Deshaun Watson</strong> (CLE, 8.6%, 14.92, at NYJ) and{' '}
        <strong>Cam Ward</strong> (TEN, 6.1%, 13.58, vs HOU).
      </LI>
      <LI>
        <strong>Jalon Daniels</strong> and <strong>Tyson Bagent</strong> are the fill-ins. A few
        dollars each, no more.
      </LI>
      <LI>
        Hold, don&apos;t cut, <strong>Jacoby Brissett</strong> (ARI hosts DET, ARI implied 25.0)
        and <strong>Geno Smith</strong>. Both are starters.
      </LI>
      <LI>
        Speculative: <strong>Tyler Huntley</strong> (BAL, 0.1%) starts Sunday night if Lamar
        Jackson sits. <strong>Athan Kaliakmanis</strong> (WSH) only matters if Jayden Daniels has a
        setback in practice.
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
        <strong>Jacksonville</strong> hosts Philadelphia (18.0 implied) in London. The Eagles are
        missing DeVonta Smith and Hollywood Brown, and Barkley is hurt.
      </LI>
      <LI>
        <strong>Dallas</strong> hosts Tampa Bay (19.0) in Jalon Daniels&apos; second start. It is
        Thursday night, so set it early.
      </LI>
      <LI>
        <strong>Houston</strong> at Tennessee (16.25) is the best number on the board. Cincinnati
        at Miami (17.75), the Jets against Cleveland (18.5) and Denver at the Chargers (19.5)
        round out the streams.
      </LI>
    </UL>
    <P>
      <strong>Avoid:</strong> anything facing Detroit (29.5), the Rams (28.5) or Buffalo (26.0).
      The grey bars above are those defenses.
    </P>

    <H2>Kickers</H2>
    <P>
      Kicker ownership is in our snapshot. The play is a kicker on an offense that scores, and the
      best of that group plays Monday night.
    </P>
    <Table aria-label="Week 5 kicker streamers">
      <THead>
        <TR>
          <TH scope="col">#</TH><TH scope="col">Kicker</TH><TH scope="col">Team</TH><TH scope="col">Team total</TH><TH scope="col">Rostered%</TH>
        </TR>
      </THead>
      <TBody>
        <TR><TD>1</TD><TD><strong>Tyler Bass</strong></TD><TD>BUF</TD><TD>26.0, in a 54.5 total</TD><TD>9.9%</TD></TR>
        <TR><TD>2</TD><TD><strong>Cairo Santos</strong></TD><TD>CHI</TD><TD>24.25</TD><TD>28.7%</TD></TR>
        <TR><TD>3</TD><TD><strong>Wil Lutz</strong></TD><TD>DEN</TD><TD>23.0</TD><TD>4.5%</TD></TR>
        <TR><TD>4</TD><TD><strong>Trey Smack</strong></TD><TD>GB</TD><TD>21.25</TD><TD>17.6%</TD></TR>
      </TBody>
    </Table>

    <H2>IDP Waiver Board</H2>
    <P>
      Lines are Week 4 box scores from our database. IDP rostered percentages are not tracked, so I
      can&apos;t tell you who is sitting on your wire. Tackle volume is the currency at linebacker
      and safety. Pressure is the currency on the line.
    </P>
    <H3>Linebacker</H3>
    <Table aria-label="IDP linebackers">
      <THead>
        <TR><TH scope="col">#</TH><TH scope="col">Player</TH><TH scope="col">Team</TH><TH scope="col">Type</TH><TH scope="col">Week 4</TH><TH scope="col">Wk 5</TH></TR>
      </THead>
      <TBody>
        <TR><TD>1</TD><TD><strong>Jeremiah Trotter Jr.</strong></TD><TD>PHI</TD><TD><Tag kind="T" /></TD><TD>10 solo and 4 assisted tackles.</TD><TD>at JAX (London)</TD></TR>
        <TR><TD>2</TD><TD><strong>Jacob Rodriguez</strong></TD><TD>MIA</TD><TD><Tag kind="T" /></TD><TD>18 tackles, 9 solo and 9 assisted.</TD><TD>vs CIN</TD></TR>
        <TR><TD>3</TD><TD><strong>Ernest Jones IV</strong></TD><TD>SEA</TD><TD><Tag kind="both" /></TD><TD>6 solo, 6 assisted, a sack and an interception.</TD><TD>vs SF</TD></TR>
        <TR><TD>4</TD><TD><strong>Jamien Sherwood</strong></TD><TD>NYJ</TD><TD><Tag kind="T" /></TD><TD>5 solo, 7 assisted and a forced fumble.</TD><TD>vs CLE</TD></TR>
        <TR><TD>5</TD><TD><strong>Jake Hansen</strong></TD><TD>HOU</TD><TD><Tag kind="both" /></TD><TD>7 solo, 5 assisted, a sack and 2 tackles for loss.</TD><TD>at TEN</TD></TR>
        <TR><TD>6</TD><TD><strong>Barrett Carter</strong></TD><TD>CIN</TD><TD><Tag kind="T" /></TD><TD>5 solo and 6 assisted tackles.</TD><TD>at MIA</TD></TR>
      </TBody>
    </Table>
    <H3>Defensive line and edge</H3>
    <Table aria-label="IDP defensive line">
      <THead>
        <TR><TH scope="col">#</TH><TH scope="col">Player</TH><TH scope="col">Pos</TH><TH scope="col">Team</TH><TH scope="col">Type</TH><TH scope="col">Week 4</TH><TH scope="col">Wk 5</TH></TR>
      </THead>
      <TBody>
        <TR><TD>1</TD><TD><strong>Zach Sieler</strong></TD><TD>DT</TD><TD>MIA</TD><TD><Tag kind="BP" /></TD><TD>2 sacks and 2 tackles for loss.</TD><TD>vs CIN</TD></TR>
        <TR><TD>2</TD><TD><strong>Boye Mafe</strong></TD><TD>DE</TD><TD>CIN</TD><TD><Tag kind="BP" /></TD><TD>A sack and 3 tackles for loss.</TD><TD>at MIA</TD></TR>
        <TR><TD>3</TD><TD><strong>Walter Nolen III</strong></TD><TD>DT</TD><TD>ARI</TD><TD><Tag kind="BP" /></TD><TD>A sack and 2 tackles for loss.</TD><TD>vs DET</TD></TR>
        <TR><TD>4</TD><TD><strong>Maliek Collins</strong></TD><TD>DT</TD><TD>CLE</TD><TD><Tag kind="BP" /></TD><TD>A sack and 2 tackles for loss.</TD><TD>at NYJ</TD></TR>
      </TBody>
    </Table>
    <H3>Defensive back</H3>
    <Table aria-label="IDP defensive backs">
      <THead>
        <TR><TH scope="col">#</TH><TH scope="col">Player</TH><TH scope="col">Pos</TH><TH scope="col">Team</TH><TH scope="col">Type</TH><TH scope="col">Week 4</TH><TH scope="col">Wk 5</TH></TR>
      </THead>
      <TBody>
        <TR><TD>1</TD><TD><strong>Minkah Fitzpatrick</strong></TD><TD>S</TD><TD>NYJ</TD><TD><Tag kind="both" /></TD><TD>8 solo, 8 assisted and an interception.</TD><TD>vs CLE</TD></TR>
        <TR><TD>2</TD><TD><strong>Greg Newsome II</strong></TD><TD>CB</TD><TD>NYG</TD><TD><Tag kind="BP" /></TD><TD>4 solo, 3 assisted, an interception and 3 passes defended.</TD><TD>at WSH</TD></TR>
        <TR><TD>3</TD><TD><strong>Jacob Parrish</strong></TD><TD>CB</TD><TD>TB</TD><TD><Tag kind="BP" /></TD><TD>5 solo tackles, an interception and a forced fumble.</TD><TD>at DAL (Thu)</TD></TR>
        <TR><TD>4</TD><TD><strong>Evan Williams</strong></TD><TD>S</TD><TD>GB</TD><TD><Tag kind="BP" /></TD><TD>3 solo, 4 assisted, a sack and an interception.</TD><TD>vs CHI</TD></TR>
        <TR><TD>5</TD><TD><strong>Deonte Banks</strong></TD><TD>CB</TD><TD>NYG</TD><TD><Tag kind="BP" /></TD><TD>An interception and 4 passes defended.</TD><TD>at WSH</TD></TR>
      </TBody>
    </Table>
    <P>
      Tackle-heavy scoring: bump the Tackles tags a tier. Big-play scoring: bump the Big play tags.
      Jones, Hansen and Fitzpatrick carry both.
    </P>

    <H2>The Injury Ledger</H2>
    <H3>Out or on IR</H3>
    <UL>
      <LI><strong>Marcus Mariota</strong> (WSH QB): started Week 4 and sprained his MCL in London. Out indefinitely, no timetable. <strong>Athan Kaliakmanis</strong> (186 yards, a TD and an INT in relief) is the backup.</LI>
      <LI><strong>Caleb Williams</strong> (CHI QB): Out, hamstring, week-to-week. Bagent is named the Week 5 starter.</LI>
      <LI><strong>Baker Mayfield</strong> (TB QB): dislocated thumb on the throwing hand. Todd Bowles named Week 7 as the earliest return. Jalon Daniels made his first start in Week 4 against Green Bay, and Thursday at Dallas is his second.</LI>
      <LI><strong>Zach Charbonnet</strong> (SEA RB): Out, ruled out for Week 5. Jadarian Price is on IR. Emanuel Wilson.</LI>
      <LI><strong>Josh Jacobs</strong> (GB RB): Out, no timeline.</LI>
      <LI><strong>Tank Bigsby</strong> (PHI RB): Out, core muscle surgery, headed to IR. Shipley.</LI>
      <LI><strong>DeVonta Smith</strong> (PHI WR): Out, hamstring, up to three weeks. <strong>Hollywood Brown</strong>: Out, ankle. Darius Cooper.</LI>
      <LI><strong>Terry McLaurin</strong> (WSH WR): Out, hamstring. <strong>Jaylin Lane</strong>: season over, fractured and dislocated ankle.</LI>
      <LI><strong>Breece Hall</strong> (NYJ RB): Out, quad, week-to-week. Braelon Allen is 75.9% rostered, so he is gone.</LI>
      <LI><strong>Mason Taylor</strong> (NYJ TE): Out, thumb. Sadiq keeps the job despite a zero in Week 4.</LI>
      <LI><strong>Alec Pierce</strong> (IND WR): on IR.</LI>
      <LI><strong>Tyquan Thornton</strong> (KC WR): Out in our database, and Kansas City is on bye. Do not chase the 25.6 points.</LI>
    </UL>
    <H3>Out in Week 4, Week 5 still open</H3>
    <UL>
      <LI><strong>Jayden Daniels</strong> (WSH QB): Out in Week 4 with a left elbow. Dan Quinn is aiming for a full practice week and a Week 5 start.</LI>
      <LI><strong>Justin Jefferson</strong> (MIN WR): Out in Week 4 with an ankle, and he could play Week 5. Decides how much Hockenson sees.</LI>
      <LI><strong>Keenan Allen</strong> (IND WR): Out in Week 4 with a groin. No Week 5 designation yet.</LI>
    </UL>
    <H3>Questionable and week-to-week</H3>
    <UL>
      <LI><strong>Lamar Jackson</strong> (BAL QB): Questionable. He sprained his left ankle in Week 4 and did not play the second half. The Baltimore at Atlanta line flipped from Baltimore -2.5 to Atlanta -1.5 on Tuesday morning. Tyler Huntley starts if he sits.</LI>
      <LI><strong>Saquon Barkley</strong> (PHI RB): Questionable, hamstring, week-to-week. Decides how big Shipley gets.</LI>
      <LI><strong>Ja&apos;Marr Chase</strong> (CIN WR): Questionable, concussion protocol. <strong>Tee Higgins</strong>: Questionable, adductor, day-to-day (11 for 157 in Week 4). Dohnte Meyers.</LI>
      <LI><strong>DJ Moore</strong> (BUF WR): Questionable, AC joint, reported as not long-term. Coleman.</LI>
      <LI><strong>Chris Brooks</strong> (GB RB): Questionable, ankle.</LI>
    </UL>

    <H2>Receipts: Grading Week 4</H2>
    <P>
      Last week&apos;s board, graded in half-PPR points from our database. The hits first.
    </P>
    <Table aria-label="Week 4 board hits">
      <THead>
        <TR><TH scope="col">Player</TH><TH scope="col">Points</TH><TH scope="col">Wk 4 bid</TH></TR>
      </THead>
      <TBody>
        <TR><TD><strong>Kirk Cousins</strong></TD><TD>20.6</TD><TD>$1</TD></TR>
        <TR><TD><strong>Alvin Kamara</strong></TD><TD>20.3</TD><TD>5&ndash;8%</TD></TR>
        <TR><TD><strong>Ollie Gordon II</strong></TD><TD>17.0</TD><TD>12&ndash;15%</TD></TR>
        <TR><TD><strong>Sam Darnold</strong></TD><TD>13.3</TD><TD>1&ndash;3%</TD></TR>
        <TR><TD><strong>Mike Gesicki</strong></TD><TD>11.5</TD><TD>$1</TD></TR>
      </TBody>
    </Table>
    <P>
      Cousins was the best return on the board: a $1 bid for 20.6 points. Now the misses and the
      shrugs.
    </P>
    <Table aria-label="Week 4 board misses and pushes">
      <THead>
        <TR><TH scope="col">Player</TH><TH scope="col">Points</TH><TH scope="col">Wk 4 bid</TH><TH scope="col">What happened</TH></TR>
      </THead>
      <TBody>
        <TR><TD><strong>Braelon Allen</strong></TD><TD>7.7</TD><TD>12&ndash;18%</TD><TD>The top bid on the board.</TD></TR>
        <TR><TD><strong>Kenyon Sadiq</strong></TD><TD>0.0</TD><TD>8&ndash;12%</TD><TD>A zero.</TD></TR>
        <TR><TD><strong>Jaylen Wright</strong></TD><TD>0.7</TD><TD>3&ndash;7%</TD><TD>The losing half of a backfield.</TD></TR>
        <TR><TD><strong>Kendre Miller</strong></TD><TD>0.9</TD><TD>$1</TD><TD>The losing half of a backfield.</TD></TR>
        <TR><TD><strong>Keenan Allen</strong></TD><TD>DNP</TD><TD>3&ndash;6%</TD><TD>Groin. Did not play.</TD></TR>
        <TR><TD><strong>Jakobi Meyers</strong></TD><TD>4.8</TD><TD>2&ndash;4%</TD><TD>Not enough.</TD></TR>
        <TR><TD><strong>Darren Waller</strong></TD><TD>5.1</TD><TD>2&ndash;4%</TD><TD>Not enough, and Carolina is on bye.</TD></TR>
        <TR><TD><strong>Mack Hollins</strong></TD><TD>6.8</TD><TD>1&ndash;2%</TD><TD>Questionable now.</TD></TR>
        <TR><TD><strong>Tre&apos; Harris</strong></TD><TD>7.5</TD><TD>1&ndash;2%</TD><TD>Not enough.</TD></TR>
        <TR><TD><strong>Marcus Mariota</strong></TD><TD>n/a</TD><TD>$1</TD><TD>Started in London and got hurt. Our stat feed is missing a rushing TD, so there is no point figure.</TD></TR>
      </TBody>
    </Table>
    <H3>The lesson</H3>
    <P>
      I priced backfield halves like jobs. Wright and Miller were the other half of a vacancy, and
      they scored 0.7 and 0.9. Gordon and Kamara took the whole job, and they scored 17.0 and 20.3.
      Pay for the back with the snaps, not the vacancy.
    </P>
    <H3>Where the market went</H3>
    <UL>
      <LI><strong>Braelon Allen</strong>: 14.3% to 75.9% rostered.</LI>
      <LI><strong>Ollie Gordon II</strong>: 1.6% to 62.3%.</LI>
      <LI><strong>Kenyon Sadiq</strong>: 33.6% to 58.2%, on a zero.</LI>
    </UL>

    <H2>The Darkness Doctrine</H2>
    <P>
      Last week&apos;s misses wrote this week&apos;s rules. Five of them.
    </P>
    <H3>Rule 1: Pay for the job, not the vacancy</H3>
    <P>
      A hurt starter creates a hole, and the hole is not the same thing as a role. Wright and
      Miller were priced like jobs when they were halves of one, and the box score sent the bill.
      MarShawn Lloyd is this week&apos;s example: the vacancy is four weeks old, the job has not
      paid, and he dropped off the top of the board.
    </P>
    <H3>Rule 2: A fill-in quarterback is worth a few dollars</H3>
    <P>
      In superflex, a fill-in starting QB is worth a few dollars. A backup to a backup is not.
      That is why Jalon Daniels and Bagent sit at 1&ndash;4%.
    </P>
    <H3>Rule 3: On a bye week, check the lineup before you bid</H3>
    <P>
      Carolina and Kansas City are off. Look at your lineup first, because a bid for a replacement
      is cheaper than a zero in a starting slot.
    </P>
    <H3>Rule 4: Thursday locks first</H3>
    <P>
      Tampa Bay at Dallas kicks off the week. Jalon Daniels and the Dallas D/ST have to be set
      before Thursday night.
    </P>
    <H3>Rule 5: London locks early</H3>
    <P>
      Philadelphia at Jacksonville kicks off Sunday at 9:30 a.m. ET. Shipley, Cooper, Strange,
      Trotter and the Jacksonville D/ST lock then, so set them before you go to bed Saturday.
    </P>
    <Quote>
      The vacancy gets the headline. The snaps get the points. Buy the snaps.
    </Quote>

    <H2>Who to Cut</H2>
    <UL>
      <LI><strong>Jaylen Wright</strong> and <strong>Kendre Miller</strong>: the losing halves. Receipts above.</LI>
      <LI><strong>Darren Waller</strong>: Carolina is on bye, and he scored 5.1.</LI>
      <LI><strong>Mack Hollins</strong>: Questionable.</LI>
      <LI><strong>Tyquan Thornton</strong>: Out, and Kansas City is on bye. Do not chase the 25.6 points.</LI>
      <LI><strong>Hold</strong> Jacoby Brissett and Geno Smith in superflex. Hold Kenyon Sadiq. Hold Keenan Allen until Friday&apos;s injury report.</LI>
    </UL>

    <H2>The Week 5 Bid Sheet</H2>
    <P>Set your claims in this order.</P>
    <OL>
      <LI><strong>Emanuel Wilson</strong> at 12&ndash;18%. A rental, so don&apos;t go past the top of the range.</LI>
      <LI><strong>Will Shipley</strong> at 10&ndash;15%. He locks Sunday morning in London.</LI>
      <LI><strong>Keon Coleman</strong> at 8&ndash;12%.</LI>
      <LI><strong>T.J. Hockenson</strong> at 6&ndash;10% if your tight end is a streamer.</LI>
      <LI>Superflex: <strong>Kirk Cousins</strong> at 5&ndash;8%, then <strong>C.J. Stroud</strong> at 4&ndash;7%.</LI>
      <LI><strong>Jameis Winston</strong> at 3&ndash;6% if you need a third quarterback.</LI>
      <LI>The rest of the Full Board at the ranges listed, and $1 on Isaac TeSlaa and Roman Wilson.</LI>
    </OL>
    <P>
      Injury statuses are as of Tuesday. Jefferson, Moore and Barkley decide three of these bids
      before kickoff, and Lamar Jackson decides the Sunday night quarterback picture, so check the
      report before you lock lineups. Thursday night is Tampa Bay at Dallas. Andy Darkness is a pen
      name and has no rooting interest, allegedly.
    </P>
  </>
);

export default Body;
