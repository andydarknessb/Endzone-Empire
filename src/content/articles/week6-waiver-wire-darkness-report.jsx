import React from 'react';
import { Box } from '@mui/material';
import {
  Lead, P, H2, H3, UL, OL, LI, Quote,
  Table, THead, TBody, TR, TH, TD,
} from '../../components/public/kit/Prose';
import { positionColorVar } from '../../components/public/kit/positionColor';

// Body only: the frontmatter lives in week6-waiver-wire-darkness-report.meta.js so listings can be
// built without loading this prose; content/articles/index.js loads it on demand.
//
// Every color below the hero is a theme token, so the cards, charts and chips read in light and
// dark. The hero is a dark illustration in both themes, like the Week 3 start/sit banner.

function HeroBanner() {
  // Claim cards fanned across the field: taller card, bigger bid. The Big Three are green.
  const bids = [
    { x: 150, h: 150, label: 'MARKS', fill: '#2fd97b' },
    { x: 262, h: 125, label: 'BERNARD', fill: '#2fd97b' },
    { x: 374, h: 100, label: 'WINSTON', fill: '#2fd97b' },
    { x: 486, h: 83, label: 'LOVE', fill: '#7eaaff' },
    { x: 598, h: 67, label: 'FREIERMUTH', fill: '#7eaaff' },
  ];
  return (
    <Box
      component="svg"
      viewBox="0 0 800 300"
      xmlns="http://www.w3.org/2000/svg"
      sx={{ width: '100%', borderRadius: 'var(--radius-md, 10px)', overflow: 'hidden', mb: 4, display: 'block' }}
      role="img"
      aria-labelledby="wk6ww-hero-title wk6ww-hero-desc"
    >
      <title id="wk6ww-hero-title">Week 6 Waiver Wire: The Darkness Report</title>
      <desc id="wk6ww-hero-desc">
        A night field under a floodlight with five glowing bid bars rising from the turf, tallest
        first: Woody Marks, Germie Bernard, Jameis Winston, Jordan Love and Pat Freiermuth, over
        the headline Week 6 Waiver Wire. The first three are the Big Three.
      </desc>
      <defs>
        <linearGradient id="wk6ww-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#060910" />
          <stop offset="0.55" stopColor="#0c1424" />
          <stop offset="1" stopColor="#161027" />
        </linearGradient>
        <radialGradient id="wk6ww-flood" cx="0.5" cy="0" r="0.85">
          <stop offset="0" stopColor="#7eaaff" stopOpacity="0.34" />
          <stop offset="1" stopColor="#7eaaff" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="wk6ww-bar" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.28" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <rect width="800" height="300" fill="url(#wk6ww-bg)" />
      <rect width="800" height="300" fill="url(#wk6ww-flood)" />
      {Array.from({ length: 11 }, (_, i) => (
        <line key={`yd${i}`} x1={40 + i * 72} y1="120" x2={6 + i * 79} y2="300" stroke="rgba(255,255,255,0.06)" />
      ))}
      <line x1="0" y1="206" x2="800" y2="206" stroke="rgba(255,255,255,0.12)" strokeDasharray="6 8" />
      {bids.map((b) => (
        <g key={b.label}>
          <rect x={b.x} y={206 - b.h} width="56" height={b.h} rx="8" fill={b.fill} opacity="0.2" />
          <rect x={b.x} y={206 - b.h} width="56" height={b.h} rx="8" fill="url(#wk6ww-bar)" />
          <rect x={b.x} y={206 - b.h} width="56" height="5" rx="2.5" fill={b.fill} />
          <text x={b.x + 28} y={198 - b.h} textAnchor="middle" fill={b.fill} fontFamily="system-ui, sans-serif" fontWeight="800" fontSize="11" letterSpacing="1.5">{b.label}</text>
        </g>
      ))}
      <text x="400" y="34" textAnchor="middle" fill="#8badc9" fontFamily="system-ui, sans-serif" fontWeight="700" fontSize="12" letterSpacing="4">THE DARKNESS REPORT</text>
      <rect x="120" y="222" width="560" height="64" rx="14" fill="rgba(3,8,20,0.84)" stroke="rgba(126,170,255,0.25)" />
      <text x="400" y="253" textAnchor="middle" fill="#ffffff" fontFamily="system-ui, sans-serif" fontWeight="850" fontSize="24" letterSpacing="1">WEEK 6 WAIVER WIRE</text>
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
    id: 'woody-marks', rank: 1, name: 'Woody Marks', pos: 'RB', team: 'HOU', matchup: 'at JAX (London)',
    min: 12, max: 18, rostered: '48.0% rostered', window: 'While Montgomery is out', windowTone: 'var(--warning)',
    take: 'Marks carried 15 times for 62 yards and caught all 4 of his targets for 23, worth 10.5 points, after David Montgomery (groin) left. DeMeco Ryans called Montgomery week-to-week on Monday, and our database has him Doubtful. Marks is the only other back on the roster with a stat line. Houston plays Jacksonville in London on Sunday at 9:30 a.m. ET, implied for 19.75.',
    pro: 'A whole backfield, not a half of one.',
    con: 'He ran for 4.1 yards a carry, Houston is implied for just 19.75, half the league already has him (48.0%), and he locks Sunday morning.',
  },
  {
    id: 'germie-bernard', rank: 2, name: 'Germie Bernard', pos: 'WR', team: 'PIT', matchup: 'at TB',
    min: 8, max: 12, rostered: '3.0% rostered', window: '4+ weeks', windowTone: 'var(--warning)',
    take: 'Bernard caught 6 of 9 targets for 80 yards, a 30% target share, worth 11.4 points. Michael Pittman Jr. is on IR (foot, four games minimum), Roman Wilson (finger) is ruled out for Sunday and Ben Skowronek (calf) is out. Metcalf and Bernard are the receivers. Pittsburgh is at Tampa Bay, implied for 21.75, and Aaron Rodgers has thrown three touchdowns in three straight games.',
    pro: '30% of the targets with the room empty for a month.',
    con: 'No touchdown yet, and a 40.5 total.',
  },
  {
    id: 'jameis-winston', rank: 3, name: 'Jameis Winston', pos: 'QB', team: 'NYG', matchup: 'vs NO',
    min: 6, max: 10, rostered: '4.0% rostered', window: 'Season', windowTone: 'var(--success)',
    take: 'Winston threw for 326 yards and 3 touchdowns with no interceptions, worth 25.7 points, after 19.0 the week before. Jaxson Dart is on IR for the regular season. New York hosts New Orleans and is implied for 23.5. He is a superflex starter.',
    pro: 'Last week\'s board had him at 3 to 6% and he was the best return on it.',
    con: 'He is Winston, which means interceptions.',
  },
];

// Bid ranges, % of a $100 budget. Big Three first, then the top of the priced board.
const LADDER = [
  ['Woody Marks', 'RB', 12, 18, true],
  ['Germie Bernard', 'WR', 8, 12, true],
  ['Jameis Winston', 'QB', 6, 10, true],
  ['Jordan Love', 'QB', 5, 8, false],
  ['Pat Freiermuth', 'TE', 4, 7, false],
  ['Aaron Rodgers', 'QB', 4, 7, false],
  ['DeMario Douglas', 'WR', 4, 7, false],
  ['MarShawn Lloyd', 'RB', 4, 7, false],
  ['Tyler Huntley', 'QB', 3, 6, false],
  ['Brandin Cooks', 'WR', 3, 6, false],
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
  { def: 'KC', opp: 'LAC', pts: 17, kind: 'stream' },
  { def: 'NE', opp: 'NYJ', pts: 18, kind: 'stream' },
  { def: 'BAL', opp: 'CLE', pts: 18, kind: 'stream' },
  { def: 'PIT', opp: 'TB', pts: 18.75, kind: 'stream' },
  { def: 'IND', opp: 'TEN', pts: 18.75, kind: 'stream' },
  { def: 'JAX', opp: 'HOU', pts: 19.75, kind: 'stream' },
  { def: 'DEN', opp: 'SEA', pts: 21.5, kind: 'stream' },
  { def: 'WSH', opp: 'SF', pts: 29, kind: 'avoid' },
  { def: 'LV', opp: 'BUF', pts: 29.75, kind: 'avoid' },
  { def: 'ARI', opp: 'LAR', pts: 33, kind: 'avoid' },
];

function OpponentChart() {
  const max = 35;
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
      Week 5 left the wire with a Houston backfield missing Montgomery, a Pittsburgh receiver room
      missing Pittman, and a report card that says the starters we priced at 3 to 7% beat the
      rentals we priced at up to 18%. The darkness has a shape this week, and it is a quarterback&apos;s.
      Let&apos;s spend.
    </Lead>
    <P>
      Every bid below is a percentage of a $100 FAAB budget. The league is half-PPR with one
      quarterback slot and a superflex. Rostered figures come from our own snapshot, taken early
      Tuesday. Lines are ESPN&apos;s as of Tuesday morning. Injury statuses are our database as of
      Tuesday with Monday&apos;s reporting layered on, and where the two disagree I trust the
      database and say so. Cincinnati, Detroit, Miami and Minnesota are on bye, so 28 teams play.
      Thursday is Seattle at Denver, Houston at Jacksonville kicks off Sunday at 9:30 a.m. ET in
      London, Sunday night is Dallas at Green Bay, and Monday night is Washington at San
      Francisco.
    </P>

    <H2>The Big Three</H2>
    <P>
      Marks for the backfield, Bernard for the receiver room, Winston for the quarterback slot.
      Two of the three have a clock on them and one is a season, so price them that way. If you
      have the budget, you want all three.
    </P>
    {BIG_THREE.map((p) => <PriorityCard key={p.id} p={p} />)}
    <H3>Just outside the Big Three: Jordan Love</H3>
    <P>
      Love (QB, GB, 47.9% rostered) threw for 367 yards and 2 TDs for 25.28 points. Green Bay
      hosts Dallas on Sunday night in a 52.5 total, and the Packers are implied for 27.0. Bid
      5&ndash;8%, and note that half the league already has him.
    </P>

    <H2>The FAAB Ladder</H2>
    <P>
      The top of the priced board on one scale. Highlighted bars are the Big Three. Anything that
      tops out at 7% or less is a cheap bid: pick a number in the range and don&apos;t lose sleep.
      Huntley is the exception: he is a bid only if Jackson is ruled out.
    </P>
    <FaabLadder />

    <H2>The Full Board</H2>
    <P>
      Window is how long the role should last. Season means no starter is coming back to take it,
      and &quot;While X is out&quot; means exactly that. Rostered% is our snapshot, so a name at
      48% is already in half the leagues out there.
    </P>
    <Table aria-label="Week 6 offensive waiver board">
      <THead>
        <TR>
          <TH scope="col">#</TH><TH scope="col">Player</TH><TH scope="col">Pos</TH><TH scope="col">Team</TH><TH scope="col">Why</TH><TH scope="col">Wk 6</TH><TH scope="col">Window</TH><TH scope="col">Bid</TH><TH scope="col">Rostered%</TH>
        </TR>
      </THead>
      <TBody>
        <TR><TD>1</TD><TD><strong>Woody Marks</strong></TD><TD>RB</TD><TD>HOU</TD><TD>Montgomery week-to-week (groin). 15 carries for 62 and 4 catches.</TD><TD>at JAX (London)</TD><TD>While Montgomery is out</TD><TD>12&ndash;18%</TD><TD>48.0%</TD></TR>
        <TR><TD>2</TD><TD><strong>Germie Bernard</strong></TD><TD>WR</TD><TD>PIT</TD><TD>6 for 80 on a 30% target share. Pittman on IR, Roman Wilson out.</TD><TD>at TB</TD><TD>4+ wks</TD><TD>8&ndash;12%</TD><TD>3.0%</TD></TR>
        <TR><TD>3</TD><TD><strong>Jameis Winston</strong></TD><TD>QB</TD><TD>NYG</TD><TD>326 yards and 3 TDs, no picks. Dart out for the season.</TD><TD>vs NO</TD><TD>Season</TD><TD>6&ndash;10%</TD><TD>4.0%</TD></TR>
        <TR><TD>4</TD><TD><strong>Jordan Love</strong></TD><TD>QB</TD><TD>GB</TD><TD>367 yards and 2 TDs. Sunday night in a 52.5 total.</TD><TD>vs DAL (SNF)</TD><TD>Season</TD><TD>5&ndash;8%</TD><TD>47.9%</TD></TR>
        <TR><TD>5</TD><TD><strong>Pat Freiermuth</strong></TD><TD>TE</TD><TD>PIT</TD><TD>5 for 44 and two TDs, 23% target share. Pittman on IR.</TD><TD>at TB</TD><TD>Season</TD><TD>4&ndash;7%</TD><TD>20.3%</TD></TR>
        <TR><TD>6</TD><TD><strong>Aaron Rodgers</strong></TD><TD>QB</TD><TD>PIT</TD><TD>Three TDs in each of the last three games.</TD><TD>at TB</TD><TD>Season</TD><TD>4&ndash;7%</TD><TD>19.3%</TD></TR>
        <TR><TD>7</TD><TD><strong>DeMario Douglas</strong></TD><TD>WR</TD><TD>NE</TD><TD>4 for 65 and two TDs. Hollins on IR.</TD><TD>vs NYJ</TD><TD>2+ wks</TD><TD>4&ndash;7%</TD><TD>2.3%</TD></TR>
        <TR><TD>8</TD><TD><strong>MarShawn Lloyd</strong></TD><TD>RB</TD><TD>GB</TD><TD>Two rushing TDs. Jacobs out, Brooks on IR.</TD><TD>vs DAL (SNF)</TD><TD>While Jacobs is out</TD><TD>4&ndash;7%</TD><TD>48.7%</TD></TR>
        <TR><TD>9</TD><TD><strong>Tyler Huntley</strong></TD><TD>QB</TD><TD>BAL</TD><TD>24.0 points in his first start. Lamar Jackson (ankle) still out.</TD><TD>at CLE</TD><TD>While Jackson is out</TD><TD>3&ndash;6%</TD><TD>1.7%</TD></TR>
        <TR><TD>10</TD><TD><strong>Brandin Cooks</strong></TD><TD>WR</TD><TD>SF</TD><TD>Deebo Samuel out for weeks (hamstring). Kirk, Pearsall, Robinson on IR.</TD><TD>vs WSH (Mon)</TD><TD>While Samuel is out</TD><TD>3&ndash;6%</TD><TD>0.3%</TD></TR>
        <TR><TD>11</TD><TD><strong>Tyler Higbee</strong></TD><TD>TE</TD><TD>LAR</TD><TD>5 for 83. Rams implied for 33.0 against Arizona.</TD><TD>vs ARI</TD><TD>Until Ferguson is back</TD><TD>3&ndash;5%</TD><TD>3.2%</TD></TR>
        <TR><TD>12</TD><TD><strong>Dameon Pierce</strong></TD><TD>RB</TD><TD>PHI</TD><TD>Shipley out multiple weeks, Bigsby on IR. Barkley &quot;hopeful&quot;.</TD><TD>vs CAR</TD><TD>If Barkley sits</TD><TD>2&ndash;5%</TD><TD>2.4%</TD></TR>
        <TR><TD>13</TD><TD><strong>Kimani Vidal</strong></TD><TD>RB</TD><TD>LAC</TD><TD>57 yards and a TD. Two straight double-digit weeks.</TD><TD>at KC</TD><TD>Committee</TD><TD>2&ndash;5%</TD><TD>2.0%</TD></TR>
        <TR><TD>14</TD><TD><strong>Darius Cooper</strong></TD><TD>WR</TD><TD>PHI</TD><TD>2 for 71 and a TD, 17.8 and 14.1 the last two weeks.</TD><TD>vs CAR</TD><TD>While Smith is out</TD><TD>2&ndash;4%</TD><TD>8.9%</TD></TR>
        <TR><TD>15</TD><TD><strong>Keenan Allen</strong></TD><TD>WR</TD><TD>IND</TD><TD>5 for 45, 21% target share. Pierce on IR, Slayton out.</TD><TD>vs TEN</TD><TD>Season</TD><TD>2&ndash;4%</TD><TD>37.0%</TD></TR>
        <TR><TD>16</TD><TD><strong>Brenton Strange</strong></TD><TD>TE</TD><TD>JAX</TD><TD>7 for 68 on 8 targets, 21% target share.</TD><TD>vs HOU (London)</TD><TD>Season</TD><TD>2&ndash;4%</TD><TD>27.2%</TD></TR>
        <TR><TD>17</TD><TD><strong>Kendrick Bourne</strong></TD><TD>WR</TD><TD>ARI</TD><TD>5 for 70 on 8 targets. A 13.5-point dog throws all day.</TD><TD>at LAR</TD><TD>Stream</TD><TD>1&ndash;3%</TD><TD>1.7%</TD></TR>
        <TR><TD>18</TD><TD><strong>Ryan Flournoy</strong></TD><TD>WR</TD><TD>DAL</TD><TD>3 for 90. Lamb (quad bruise) expected to play.</TD><TD>at GB (SNF)</TD><TD>Stream</TD><TD>1&ndash;3%</TD><TD>4.3%</TD></TR>
        <TR><TD>19</TD><TD><strong>Chig Okonkwo</strong></TD><TD>TE</TD><TD>WSH</TD><TD>4 for 60, 26% target share with Daniels back.</TD><TD>at SF (Mon)</TD><TD>Stream</TD><TD>1&ndash;3%</TD><TD>3.1%</TD></TR>
        <TR><TD>20</TD><TD><strong>Raheim Sanders</strong></TD><TD>RB</TD><TD>CLE</TD><TD>Judkins day-to-day (ankle). Sanders is questionable himself (hip).</TD><TD>vs BAL</TD><TD>If Judkins sits</TD><TD>1&ndash;3%</TD><TD>1.2%</TD></TR>
        <TR><TD>21</TD><TD><strong>Kendre Miller</strong></TD><TD>RB</TD><TD>NO</TD><TD>10 for 30 and a TD. Kamara limited (back).</TD><TD>at NYG</TD><TD>Committee</TD><TD>1&ndash;2%</TD><TD>11.8%</TD></TR>
        <TR><TD>22</TD><TD><strong>Isaiah Bond</strong></TD><TD>WR</TD><TD>CLE</TD><TD>3 for 74, 22% target share. Concepcion in concussion protocol.</TD><TD>vs BAL</TD><TD>Stream</TD><TD>1&ndash;2%</TD><TD>0.1%</TD></TR>
        <TR><TD>23</TD><TD><strong>Kyle Williams</strong></TD><TD>WR</TD><TD>NE</TD><TD>3 for 91 and a TD.</TD><TD>vs NYJ</TD><TD>Stream</TD><TD>$1</TD><TD>0.5%</TD></TR>
        <TR><TD>24</TD><TD><strong>Efton Chism III</strong></TD><TD>WR</TD><TD>NE</TD><TD>Team-high six targets, 5 for 57.</TD><TD>vs NYJ</TD><TD>Stream</TD><TD>$1</TD><TD>0.7%</TD></TR>
        <TR><TD>25</TD><TD><strong>Corey Kiner</strong></TD><TD>RB</TD><TD>NE</TD><TD>52 rushing yards. Henderson (ankle) questionable.</TD><TD>vs NYJ</TD><TD>Handcuff</TD><TD>$1</TD><TD>0.1%</TD></TR>
      </TBody>
    </Table>
    <P>
      Two of these bids hang on an injury report. Dameon Pierce is 2&ndash;5% as priced, and
      8&ndash;12% only if Saquon Barkley is ruled out Friday. Tyler Huntley is a bid only if Lamar
      Jackson is ruled out. Cooks, Higbee and Sanders ride on a report too, at prices that already
      say so.
    </P>

    <H2>Superflex Corner</H2>
    <P>
      Quarterbacks are where this format is won on the wire, so here is the ranking, with Week 5
      points.
    </P>
    <UL>
      <LI>
        <strong>Jameis Winston</strong> (NYG, 4.0% rostered) is first at 25.74. Jaxson Dart is on
        IR, which makes Winston the full-season starter.
      </LI>
      <LI>
        <strong>Jordan Love</strong> (GB, 47.9%) is second at 25.28, with Dallas coming to Green
        Bay on Sunday night.
      </LI>
      <LI>
        <strong>Aaron Rodgers</strong> (PIT, 19.3%) scored 22.0, after 22.68 and 21.96 before it.
      </LI>
      <LI>
        <strong>Tyler Huntley</strong> (BAL) scored 24.04 and starts only if Jackson sits. Jesse
        Minter said Monday that Jackson is &quot;definitely doing better&quot;.
      </LI>
      <LI>
        <strong>C.J. Stroud</strong> (HOU, 42.0%) scored 20.94 and plays in London.
      </LI>
      <LI>
        <strong>Deshaun Watson</strong> (CLE, 19.8%) scored 12.2. Dillon Gabriel is on IR, so
        Watson is the starter.
      </LI>
      <LI>
        <strong>Jalon Daniels</strong> (TB, 1.5%) scored 13.86 and faces Pittsburgh with Mayfield
        out.
      </LI>
      <LI>
        <strong>Tua Tagovailoa</strong> (ATL, 0.6%) started the overtime after Michael Penix Jr.
        (ribs) left. Penix had an MRI Monday and Stefanski promised clarity Wednesday. Bid $1, and
        only if Penix is ruled out.
      </LI>
      <LI>
        <strong>Jacoby Brissett</strong> (ARI, 50.2%): a 13.5-point dog at the Rams is garbage-time
        gold. Start him if you have him.
      </LI>
      <LI>
        On bye and useless this week: <strong>Kyler Murray</strong> (MIN), <strong>Malik
        Willis</strong> (MIA, 18.88 wasted) and <strong>Joe Burrow</strong>.
      </LI>
      <LI>
        <strong>Tyson Bagent</strong> is a drop. He scored 1.18, and the Sun-Times says Caleb
        Williams is on track for Week 6.
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
        <strong>Kansas City</strong> hosts the Chargers (17.0 implied), the best number on the
        board. Herbert scored 10.2, Ladd McConkey did not play a snap, Tre&apos; Harris is
        week-to-week and Quentin Johnston is out.
      </LI>
      <LI>
        <strong>New England</strong> hosts the Jets (18.0). Geno Smith scored 9.98.
      </LI>
      <LI>
        <strong>Baltimore</strong> at Cleveland (18.0) draws Deshaun Watson.{' '}
        <strong>Pittsburgh</strong> at Tampa Bay (18.75) draws Jalon Daniels&apos; third start.{' '}
        <strong>Indianapolis</strong> hosts Tennessee (18.75), and Cam Ward scored 5.0.
      </LI>
      <LI>
        <strong>Jacksonville</strong> hosts Houston (19.75) in London, so it locks Sunday morning.
      </LI>
      <LI>
        <strong>Denver</strong> hosts Seattle (21.5) on Thursday night, the Thursday option.
        Darnold threw 2 interceptions last week.
      </LI>
    </UL>
    <P>
      <strong>Avoid:</strong> Arizona (faces the Rams, 33.0), Las Vegas (faces Buffalo, 29.75) and
      Washington (faces San Francisco, 29.0). The grey bars above are those defenses.
    </P>

    <H2>Kickers</H2>
    <P>
      Kicker ownership is in our snapshot. The play is a kicker on an offense that scores, and the
      best of that group is Buffalo&apos;s.
    </P>
    <Table aria-label="Week 6 kicker streamers">
      <THead>
        <TR>
          <TH scope="col">#</TH><TH scope="col">Kicker</TH><TH scope="col">Team</TH><TH scope="col">Team total</TH><TH scope="col">Rostered%</TH>
        </TR>
      </THead>
      <TBody>
        <TR><TD>1</TD><TD><strong>Tyler Bass</strong></TD><TD>BUF</TD><TD>29.75, in a 53.5 total</TD><TD>9.1%</TD></TR>
        <TR><TD>2</TD><TD><strong>Trey Smack</strong></TD><TD>GB</TD><TD>27.0, Sunday night</TD><TD>14.5%</TD></TR>
        <TR><TD>3</TD><TD><strong>Matt Gay</strong></TD><TD>LV</TD><TD>23.75</TD><TD>7.8%</TD></TR>
        <TR><TD>4</TD><TD><strong>Nick Folk</strong></TD><TD>ATL</TD><TD>23.25</TD><TD>5.1%</TD></TR>
        <TR><TD>5</TD><TD><strong>Dominic Zvada</strong></TD><TD>NYG</TD><TD>23.5, with 14 and 13 points the last two weeks</TD><TD>4.0%</TD></TR>
      </TBody>
    </Table>

    <H2>IDP Waiver Board</H2>
    <P>
      Lines are Week 5 box scores from our database. IDP rostered percentages are not tracked, so I
      can&apos;t tell you who is sitting on your wire. Tackle volume is the currency at linebacker
      and safety. Pressure is the currency on the line.
    </P>
    <H3>Linebacker</H3>
    <Table aria-label="IDP linebackers">
      <THead>
        <TR><TH scope="col">#</TH><TH scope="col">Player</TH><TH scope="col">Team</TH><TH scope="col">Type</TH><TH scope="col">Week 5</TH><TH scope="col">Wk 6</TH></TR>
      </THead>
      <TBody>
        <TR><TD>1</TD><TD><strong>David Bailey</strong></TD><TD>NYJ</TD><TD><Tag kind="BP" /></TD><TD>6 solo and 2 assisted tackles, 3 sacks, 4 tackles for loss and a forced fumble.</TD><TD>at NE</TD></TR>
        <TR><TD>2</TD><TD><strong>Nate Landman</strong></TD><TD>LAR</TD><TD><Tag kind="T" /></TD><TD>8 solo and 5 assisted tackles and 2 forced fumbles.</TD><TD>vs ARI</TD></TR>
        <TR><TD>3</TD><TD><strong>Quincy Williams</strong></TD><TD>CLE</TD><TD><Tag kind="both" /></TD><TD>6 solo and 4 assisted tackles and 3 forced fumbles.</TD><TD>vs BAL</TD></TR>
        <TR><TD>4</TD><TD><strong>Zack Baun</strong></TD><TD>PHI</TD><TD><Tag kind="T" /></TD><TD>6 solo and 5 assisted tackles.</TD><TD>vs CAR</TD></TR>
        <TR><TD>5</TD><TD><strong>Zaire Franklin</strong></TD><TD>GB</TD><TD><Tag kind="T" /></TD><TD>6 solo and 3 assisted tackles and a forced fumble.</TD><TD>vs DAL</TD></TR>
        <TR><TD>6</TD><TD><strong>Kendal Daniels</strong></TD><TD>ATL</TD><TD><Tag kind="both" /></TD><TD>7 solo tackles, 1 assisted, and a sack.</TD><TD>vs CHI</TD></TR>
        <TR><TD>7</TD><TD><strong>Sonny Styles</strong></TD><TD>WSH</TD><TD><Tag kind="T" /></TD><TD>3 solo and 9 assisted tackles.</TD><TD>at SF</TD></TR>
      </TBody>
    </Table>
    <H3>Defensive line and edge</H3>
    <Table aria-label="IDP defensive line">
      <THead>
        <TR><TH scope="col">#</TH><TH scope="col">Player</TH><TH scope="col">Pos</TH><TH scope="col">Team</TH><TH scope="col">Type</TH><TH scope="col">Week 5</TH><TH scope="col">Wk 6</TH></TR>
      </THead>
      <TBody>
        <TR><TD>1</TD><TD><strong>Austin Booker</strong></TD><TD>DE</TD><TD>CHI</TD><TD><Tag kind="BP" /></TD><TD>2 sacks, 3 tackles for loss and a forced fumble.</TD><TD>at ATL</TD></TR>
        <TR><TD>2</TD><TD><strong>Byron Murphy II</strong></TD><TD>DT</TD><TD>SEA</TD><TD><Tag kind="BP" /></TD><TD>2 sacks and 3 tackles for loss.</TD><TD>at DEN (Thu)</TD></TR>
        <TR><TD>3</TD><TD><strong>Devonte Wyatt</strong></TD><TD>DT</TD><TD>GB</TD><TD><Tag kind="BP" /></TD><TD>2 sacks, 2 tackles for loss and a forced fumble.</TD><TD>vs DAL</TD></TR>
        <TR><TD>4</TD><TD><strong>Gracen Halton</strong></TD><TD>DT</TD><TD>SF</TD><TD><Tag kind="BP" /></TD><TD>A sack, 2 tackles for loss and a forced fumble.</TD><TD>vs WSH (Mon)</TD></TR>
        <TR><TD>5</TD><TD><strong>Dani Dennis-Sutton</strong></TD><TD>DE</TD><TD>GB</TD><TD><Tag kind="BP" /></TD><TD>A sack and 2 tackles for loss.</TD><TD>vs DAL</TD></TR>
      </TBody>
    </Table>
    <H3>Defensive back</H3>
    <Table aria-label="IDP defensive backs">
      <THead>
        <TR><TH scope="col">#</TH><TH scope="col">Player</TH><TH scope="col">Pos</TH><TH scope="col">Team</TH><TH scope="col">Type</TH><TH scope="col">Week 5</TH><TH scope="col">Wk 6</TH></TR>
      </THead>
      <TBody>
        <TR><TD>1</TD><TD><strong>Renardo Green</strong></TD><TD>CB</TD><TD>SF</TD><TD><Tag kind="BP" /></TD><TD>2 interceptions and 3 passes defended.</TD><TD>vs WSH (Mon)</TD></TR>
        <TR><TD>2</TD><TD><strong>Dru Phillips</strong></TD><TD>CB</TD><TD>NYG</TD><TD><Tag kind="BP" /></TD><TD>5 solo tackles and 2 sacks.</TD><TD>vs NO</TD></TR>
        <TR><TD>3</TD><TD><strong>Rasul Douglas</strong></TD><TD>CB</TD><TD>WSH</TD><TD><Tag kind="T" /></TD><TD>9 solo tackles, 1 assisted, and 2 tackles for loss.</TD><TD>at SF</TD></TR>
        <TR><TD>4</TD><TD><strong>Jacob Parrish</strong></TD><TD>CB</TD><TD>TB</TD><TD><Tag kind="both" /></TD><TD>8 solo tackles, 1 assisted, and 4 passes defended.</TD><TD>vs PIT</TD></TR>
        <TR><TD>5</TD><TD><strong>Xavier McKinney</strong></TD><TD>S</TD><TD>GB</TD><TD><Tag kind="BP" /></TD><TD>2 interceptions.</TD><TD>vs DAL</TD></TR>
        <TR><TD>6</TD><TD><strong>Jonas Sanker</strong></TD><TD>S</TD><TD>NO</TD><TD><Tag kind="T" /></TD><TD>5 solo and 2 assisted tackles.</TD><TD>at NYG</TD></TR>
      </TBody>
    </Table>
    <P>
      Tackle-heavy scoring: bump the Tackles tags a tier. Big-play scoring: bump the Big play tags.
      Williams, Daniels and Parrish carry both.
    </P>

    <H2>The Injury Ledger</H2>
    <H3>Out or on IR</H3>
    <UL>
      <LI><strong>De&apos;Von Achane</strong> (MIA RB): placed on IR Monday with a knee. Ollie Gordon II (73.6% rostered) is the lead back and Jaylen Wright (13.3%) is the next man. Miami is on bye, so Wright is a stash, not a start, and he is not on the board for that reason.</LI>
      <LI><strong>Will Shipley</strong> (PHI RB): partial plantar fascia tear, out multiple weeks per Schefter. <strong>Tank Bigsby</strong>: IR, abdomen. Dameon Pierce if Barkley sits.</LI>
      <LI><strong>Michael Pittman Jr.</strong> (PIT WR): IR, foot, four games minimum. <strong>Roman Wilson</strong> (finger): ruled out Sunday. <strong>Ben Skowronek</strong> (calf): out. Bernard.</LI>
      <LI><strong>Deebo Samuel</strong> (SF WR): strained his hamstring &quot;pretty good&quot; per Shanahan and is going to miss time. <strong>Christian Kirk</strong> (calf) is unlikely to practice this week. Pearsall and Demarcus Robinson are on IR, and Aiyuk is out. Brandin Cooks.</LI>
      <LI><strong>David Montgomery</strong> (HOU RB): week-to-week, groin. <strong>Tank Dell</strong>: IR, knee. <strong>Jayden Higgins</strong>: IR. Marks.</LI>
      <LI><strong>Caleb Williams</strong> (CHI QB): hamstring. Ben Johnson was non-committal Monday, and the Sun-Times says Williams is on track for Week 6. Bagent until then.</LI>
      <LI><strong>Baker Mayfield</strong> (TB QB): thumb, out. Jalon Daniels.</LI>
      <LI><strong>Dillon Gabriel</strong> (CLE QB): IR, back. Deshaun Watson.</LI>
      <LI><strong>Lamar Jackson</strong> (BAL QB): Out in our database, though Jesse Minter said Monday he is &quot;definitely doing better&quot;. Huntley.</LI>
      <LI><strong>Jaxson Dart</strong> (NYG QB): IR. Winston. <strong>Marcus Mariota</strong> (WSH QB): out, MCL. Jayden Daniels is back and scored 32.3.</LI>
      <LI><strong>Breece Hall</strong> (NYJ RB): out, quad. Braelon Allen (76.5% rostered) scored 18.1. <strong>Kyle Monangai</strong> (CHI RB): out. Swift scored 15.3 and Roschon Johnson had 5 catches.</LI>
      <LI><strong>Josh Jacobs</strong> (GB RB): out, no timeline. <strong>Chris Brooks</strong>: IR, ankle. Lloyd.</LI>
      <LI><strong>A.J. Brown</strong> (NE WR): IR, with &quot;a chance&quot; to return to practice this week per Vrabel. <strong>Mack Hollins</strong>: IR, calf. Douglas, Williams, Chism.</LI>
      <LI><strong>Jonah Coleman</strong> (DEN RB): IR, ankle. <strong>Pat Bryant</strong> (DEN WR): IR. <strong>Trey Lance</strong> (LAC QB): IR. <strong>Quentin Johnston</strong> (LAC WR): out.</LI>
      <LI><strong>Stefon Diggs</strong> (WSH WR): out, hamstring. <strong>DeVonta Smith</strong> and <strong>Hollywood Brown</strong> (PHI): out in our database, with Sirianni &quot;hopeful&quot; on Smith and Barkley.</LI>
      <LI><strong>T.J. Hockenson</strong> (MIN TE): concussion, and Minnesota is on bye. <strong>Jordan Addison</strong> (MIN WR): out. Both are two weeks away at best.</LI>
      <LI><strong>Tyquan Thornton</strong> (KC WR): IR, ankle. <strong>Alec Pierce</strong> (IND WR): IR, no surgery, rehabbing. <strong>Darius Slayton</strong> (IND WR): out.</LI>
    </UL>
    <H3>Questionable and week-to-week</H3>
    <UL>
      <LI><strong>Saquon Barkley</strong> (PHI RB): hamstring, with Sirianni &quot;hopeful&quot; for Sunday. Decides the Pierce bid.</LI>
      <LI><strong>TreVeyon Henderson</strong> (NE RB): ankle, with further testing Monday. Stevenson takes the work if he sits, and Kiner is the handcuff.</LI>
      <LI><strong>Quinshon Judkins</strong> (CLE RB): day-to-day with an ankle &quot;tweak&quot;. Raheim Sanders (hip) is questionable himself, and Jaleel McLaughlin is behind him.</LI>
      <LI><strong>Michael Penix Jr.</strong> (ATL QB): ribs, MRI Monday, clarity Wednesday. Tua Tagovailoa if he sits.</LI>
      <LI><strong>Alvin Kamara</strong> (NO RB): back, limited. Kendre Miller.</LI>
      <LI><strong>CeeDee Lamb</strong> (DAL WR): quad bruise, &quot;not considered serious&quot;, expected at Green Bay.</LI>
      <LI><strong>Rashee Rice</strong> (KC WR): hamstring, &quot;relatively minor&quot;, and he could be ready after the bye.</LI>
      <LI><strong>Ladd McConkey</strong> (LAC WR): foot, active but did not play a snap. <strong>Tre&apos; Harris</strong>: hamstring, week-to-week.</LI>
      <LI><strong>Jaxon Smith-Njigba</strong> (SEA WR): ankle, limited Monday. <strong>Zach Charbonnet</strong> (SEA RB): limited Monday, and the ACL return is close. Emanuel Wilson is at 81.6% rostered and his window is closing.</LI>
      <LI><strong>DJ Moore</strong> (BUF WR): shoulder, inactive Monday. Keon Coleman scored 7.2 without him.</LI>
      <LI><strong>Jalen Nailor</strong> (LV WR): concussion, expected to practice. <strong>Kenyon Sadiq</strong> (NYJ TE): concussion. <strong>KC Concepcion</strong> (CLE WR): concussion. Bond.</LI>
      <LI><strong>Terrance Ferguson</strong> (LAR TE): expected back from IR after four games. That closes the Higbee window.</LI>
    </UL>

    <H2>Receipts: Grading Week 5</H2>
    <P>
      Last week&apos;s board, graded in half-PPR points from our database. The hits first.
    </P>
    <Table aria-label="Week 5 board hits">
      <THead>
        <TR><TH scope="col">Player</TH><TH scope="col">Points</TH><TH scope="col">Wk 5 bid</TH></TR>
      </THead>
      <TBody>
        <TR><TD><strong>Jameis Winston</strong></TD><TD>25.7</TD><TD>3&ndash;6%</TD></TR>
        <TR><TD><strong>C.J. Stroud</strong></TD><TD>20.9</TD><TD>4&ndash;7%</TD></TR>
        <TR><TD><strong>MarShawn Lloyd</strong></TD><TD>16.2</TD><TD>2&ndash;4%</TD></TR>
        <TR><TD><strong>Darius Cooper</strong></TD><TD>14.1</TD><TD>2&ndash;5%</TD></TR>
        <TR><TD><strong>Jalon Daniels</strong></TD><TD>13.9</TD><TD>2&ndash;4%</TD></TR>
        <TR><TD><strong>Kirk Cousins</strong></TD><TD>13.7</TD><TD>5&ndash;8%</TD></TR>
        <TR><TD><strong>Emanuel Wilson</strong></TD><TD>12.2</TD><TD>12&ndash;18%</TD></TR>
        <TR><TD><strong>Brenton Strange</strong></TD><TD>10.3</TD><TD>3&ndash;6%</TD></TR>
      </TBody>
    </Table>
    <P>
      Winston was the best return on the board: 25.7 points on a 3&ndash;6% bid. Now the misses and
      the shrugs.
    </P>
    <Table aria-label="Week 5 board misses and pushes">
      <THead>
        <TR><TH scope="col">Player</TH><TH scope="col">Points</TH><TH scope="col">Wk 5 bid</TH><TH scope="col">What happened</TH></TR>
      </THead>
      <TBody>
        <TR><TD><strong>Will Shipley</strong></TD><TD>7.8</TD><TD>10&ndash;15%</TD><TD>Partial plantar fascia tear, out multiple weeks.</TD></TR>
        <TR><TD><strong>Keon Coleman</strong></TD><TD>7.2</TD><TD>8&ndash;12%</TD><TD>One catch for 7 and a TD with Moore out.</TD></TR>
        <TR><TD><strong>T.J. Hockenson</strong></TD><TD>1.2</TD><TD>6&ndash;10%</TD><TD>Concussion.</TD></TR>
        <TR><TD><strong>Romeo Doubs</strong></TD><TD>2.1</TD><TD>3&ndash;6%</TD><TD>Not enough.</TD></TR>
        <TR><TD><strong>Brian Robinson Jr.</strong></TD><TD>1.6</TD><TD>3&ndash;6%</TD><TD>Not enough.</TD></TR>
        <TR><TD><strong>Malik Washington</strong></TD><TD>9.1</TD><TD>1&ndash;3%</TD><TD>A push.</TD></TR>
        <TR><TD><strong>Tyler Allgeier</strong></TD><TD>2.6</TD><TD>2&ndash;4%</TD><TD>Not enough.</TD></TR>
        <TR><TD><strong>Michael Mayer</strong></TD><TD>0.7</TD><TD>2&ndash;4%</TD><TD>Not enough.</TD></TR>
        <TR><TD><strong>Keaton Mitchell</strong></TD><TD>4.4</TD><TD>1&ndash;3%</TD><TD>Not enough.</TD></TR>
        <TR><TD><strong>Dohnte Meyers</strong></TD><TD>2.2</TD><TD>1&ndash;3%</TD><TD>Not enough.</TD></TR>
        <TR><TD><strong>Tyson Bagent</strong></TD><TD>1.2</TD><TD>1&ndash;3%</TD><TD>Not enough.</TD></TR>
        <TR><TD><strong>Isaac TeSlaa</strong></TD><TD>0.0</TD><TD>$1</TD><TD>A zero.</TD></TR>
        <TR><TD><strong>Roman Wilson</strong></TD><TD>0.0</TD><TD>$1</TD><TD>A zero, and a finger injury.</TD></TR>
      </TBody>
    </Table>
    <H3>The lesson</H3>
    <P>
      The Big Three cost 30 to 45% of a budget and scored 27.2 between them. Winston and Stroud,
      the two season-long starters priced at 3 to 7%, scored 46.7. In superflex, a starting
      quarterback at 5% beats a rental back at 15%. Winston is in the Big Three this week because of
      it.
    </P>
    <H3>Where the market went</H3>
    <UL>
      <LI><strong>Emanuel Wilson</strong>: 50.1% to 81.6% rostered.</LI>
      <LI><strong>Will Shipley</strong>: 0.6% to 43.8%, and then he got hurt.</LI>
      <LI><strong>Keon Coleman</strong>: 4.2% to 39.1%.</LI>
      <LI><strong>T.J. Hockenson</strong>: 54.7% to 70.6%.</LI>
      <LI><strong>Kirk Cousins</strong>: 16.9% to 36.3%.</LI>
      <LI><strong>Roman Wilson</strong>: 3.6% to 34.2%, on a zero.</LI>
      <LI><strong>Brian Robinson Jr.</strong>: 27.0% to 50.2%, on 1.6.</LI>
    </UL>

    <H2>The Darkness Doctrine</H2>
    <P>
      Last week&apos;s receipts wrote this week&apos;s rules. Five of them.
    </P>
    <H3>Rule 1: Starters over rentals</H3>
    <P>
      Winston and Stroud out-scored the Big Three combined. In superflex, price the season-long
      quarterback above the two-week running back.
    </P>
    <H3>Rule 2: A bid on an injury report is two bets</H3>
    <P>
      The starter stays out, and the replacement stays healthy. Shipley lost the second one in
      London. Dameon Pierce is priced at 2&ndash;5% for that reason, and at 8&ndash;12% only if
      Barkley is ruled out Friday.
    </P>
    <H3>Rule 3: Target share over touchdowns</H3>
    <P>
      Bernard&apos;s 30% with no score is the bid. Douglas&apos;s two scores on 16% are the cheaper
      one. Teagan Quitoriano (ARI TE) scored two touchdowns on a 4% target share: a trap, not a
      pickup.
    </P>
    <H3>Rule 4: Four byes</H3>
    <P>
      Cincinnati, Detroit, Miami and Minnesota are off. Check the lineup before the wire, and do
      not spend on a bye-week player unless it is a stash (Jaylen Wright).
    </P>
    <H3>Rule 5: Thursday and London lock first</H3>
    <P>
      Seattle at Denver is Thursday night (Engram, the Denver D/ST, Byron Murphy II). Houston at
      Jacksonville kicks off Sunday at 9:30 a.m. ET (Marks, Strange, the Jacksonville D/ST). Set
      them before you go to bed.
    </P>
    <Quote>
      The rental gets the headline. The starter gets the points. Buy the starter.
    </Quote>

    <H2>Who to Cut</H2>
    <UL>
      <LI><strong>Tyson Bagent</strong>: 1.2, and Williams is on track.</LI>
      <LI><strong>Isaac TeSlaa</strong>: 0.0, and he is on bye.</LI>
      <LI><strong>Michael Mayer</strong>: 0.7.</LI>
      <LI><strong>Brian Robinson Jr.</strong>: 1.6 at 50% rostered, the Week 5 miss.</LI>
      <LI><strong>Dohnte Meyers</strong>: on bye, and he scored 2.2.</LI>
      <LI><strong>Keaton Mitchell</strong>: Vidal has the LAC No. 2 job.</LI>
      <LI><strong>Roman Wilson</strong>: out, and 34% of leagues chased a zero.</LI>
      <LI><strong>Will Shipley</strong>, unless you have an IR slot.</LI>
      <LI><strong>Hold</strong> Emanuel Wilson one more week (Charbonnet limited Monday) and Keon Coleman (Moore still out). Hold T.J. Hockenson only if your bench is deep: a concussion plus a bye is two weeks.</LI>
    </UL>

    <H2>The Week 6 Bid Sheet</H2>
    <P>Set your claims in this order.</P>
    <OL>
      <LI><strong>Woody Marks</strong> at 12&ndash;18%. He locks Sunday morning in London.</LI>
      <LI><strong>Germie Bernard</strong> at 8&ndash;12%.</LI>
      <LI><strong>Jameis Winston</strong> at 6&ndash;10%.</LI>
      <LI>Superflex: <strong>Jordan Love</strong> at 5&ndash;8%, then <strong>Aaron Rodgers</strong> at 4&ndash;7%.</LI>
      <LI><strong>Pat Freiermuth</strong> at 4&ndash;7% if your tight end is a streamer.</LI>
      <LI><strong>DeMario Douglas</strong> at 4&ndash;7% and <strong>MarShawn Lloyd</strong> at 4&ndash;7%.</LI>
      <LI><strong>Tyler Huntley</strong> at 3&ndash;6%, only if Jackson is ruled out.</LI>
      <LI>The rest of the Full Board at the ranges listed, and $1 on Kyle Williams, Efton Chism III and Corey Kiner.</LI>
    </OL>
    <P>
      Injury statuses are as of Tuesday. Barkley, Jackson, Penix and Henderson decide four of these
      bids before kickoff, and Thursday night is Seattle at Denver. Andy Darkness is a pen name and
      has no rooting interest, allegedly.
    </P>
  </>
);

export default Body;
