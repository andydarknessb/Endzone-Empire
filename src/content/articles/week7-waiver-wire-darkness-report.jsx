import React from 'react';
import { Box } from '@mui/material';
import {
  Lead, P, H2, H3, UL, OL, LI, Quote,
  Table, THead, TBody, TR, TH, TD,
} from '../../components/public/kit/Prose';
import { positionColorVar } from '../../components/public/kit/positionColor';

// Body only: the frontmatter lives in week7-waiver-wire-darkness-report.meta.js so listings can be
// built without loading this prose; content/articles/index.js loads it on demand.
//
// Every color below the hero is a theme token, so the cards, charts and chips read in light and
// dark. The hero is a dark illustration in both themes, like the Week 3 start/sit banner.

function HeroBanner() {
  // Claim cards fanned across the field: taller card, bigger bid. The Big Three are green.
  const bids = [
    { x: 150, h: 150, label: 'McKEE', fill: '#2fd97b' },
    { x: 262, h: 125, label: 'COOPER', fill: '#2fd97b' },
    { x: 374, h: 100, label: 'DOUGLAS', fill: '#2fd97b' },
    { x: 486, h: 83, label: 'STROUD', fill: '#7eaaff' },
    { x: 598, h: 67, label: 'PENIX', fill: '#7eaaff' },
  ];
  return (
    <Box
      component="svg"
      viewBox="0 0 800 300"
      xmlns="http://www.w3.org/2000/svg"
      sx={{ width: '100%', borderRadius: 'var(--radius-md, 10px)', overflow: 'hidden', mb: 4, display: 'block' }}
      role="img"
      aria-labelledby="wk7ww-hero-title wk7ww-hero-desc"
    >
      <title id="wk7ww-hero-title">Week 7 Waiver Wire: The Darkness Report</title>
      <desc id="wk7ww-hero-desc">
        A night field under a floodlight with five glowing bid bars rising from the turf, tallest
        first: Tanner McKee, Omar Cooper Jr., DeMario Douglas, C.J. Stroud and Michael Penix Jr.,
        over the headline Week 7 Waiver Wire. The first three are the Big Three.
      </desc>
      <defs>
        <linearGradient id="wk7ww-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#060910" />
          <stop offset="0.55" stopColor="#0c1424" />
          <stop offset="1" stopColor="#161027" />
        </linearGradient>
        <radialGradient id="wk7ww-flood" cx="0.5" cy="0" r="0.85">
          <stop offset="0" stopColor="#7eaaff" stopOpacity="0.34" />
          <stop offset="1" stopColor="#7eaaff" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="wk7ww-bar" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.28" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <rect width="800" height="300" fill="url(#wk7ww-bg)" />
      <rect width="800" height="300" fill="url(#wk7ww-flood)" />
      {Array.from({ length: 11 }, (_, i) => (
        <line key={`yd${i}`} x1={40 + i * 72} y1="120" x2={6 + i * 79} y2="300" stroke="rgba(255,255,255,0.06)" />
      ))}
      <line x1="0" y1="206" x2="800" y2="206" stroke="rgba(255,255,255,0.12)" strokeDasharray="6 8" />
      {bids.map((b) => (
        <g key={b.label}>
          <rect x={b.x} y={206 - b.h} width="56" height={b.h} rx="8" fill={b.fill} opacity="0.2" />
          <rect x={b.x} y={206 - b.h} width="56" height={b.h} rx="8" fill="url(#wk7ww-bar)" />
          <rect x={b.x} y={206 - b.h} width="56" height="5" rx="2.5" fill={b.fill} />
          <text x={b.x + 28} y={198 - b.h} textAnchor="middle" fill={b.fill} fontFamily="system-ui, sans-serif" fontWeight="800" fontSize="11" letterSpacing="1.5">{b.label}</text>
        </g>
      ))}
      <text x="400" y="34" textAnchor="middle" fill="#8badc9" fontFamily="system-ui, sans-serif" fontWeight="700" fontSize="12" letterSpacing="4">THE DARKNESS REPORT</text>
      <rect x="120" y="222" width="560" height="64" rx="14" fill="rgba(3,8,20,0.84)" stroke="rgba(126,170,255,0.25)" />
      <text x="400" y="253" textAnchor="middle" fill="#ffffff" fontFamily="system-ui, sans-serif" fontWeight="850" fontSize="24" letterSpacing="1">WEEK 7 WAIVER WIRE</text>
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
    id: 'tanner-mckee', rank: 1, name: 'Tanner McKee', pos: 'QB', team: 'PHI', matchup: 'vs DAL (Mon)',
    min: 8, max: 14, rostered: '2.6% rostered', window: 'Season', windowTone: 'var(--success)',
    take: 'Jalen Hurts is on IR: new imaging over the weekend found several blood clots in his lungs, and he is expected to miss multiple months, the rest of the season (Tom Pelissero). McKee\'s first start in Week 6 was 215 yards, a TD and no picks, worth 12.6 points. Philadelphia hosts Dallas on Monday night, implied for 20.0. In 1QB leagues he is a $1 bench quarterback. In superflex he is the most valuable thing on the wire.',
    pro: 'A season-long starter at 2.6%.',
    con: 'Barkley is out too, and Philadelphia is a 4.5-point home underdog.',
  },
  {
    id: 'omar-cooper', rank: 2, name: 'Omar Cooper Jr.', pos: 'WR', team: 'NYJ', matchup: 'vs MIA',
    min: 8, max: 12, rostered: '2.9% rostered', window: 'Season', windowTone: 'var(--success)',
    take: 'In his first game off IR, Cooper caught 6 passes for 103 yards and a TD on a 24% target share, worth 19.3 points. Adonai Mitchell is out (finger). The Jets host Miami and are implied for 21.5.',
    pro: 'A quarter of the targets in his first game back.',
    con: 'Geno Smith, and a 38.5 total.',
  },
  {
    id: 'demario-douglas', rank: 3, name: 'DeMario Douglas', pos: 'WR', team: 'NE', matchup: 'at CHI (Thu)',
    min: 6, max: 10, rostered: '13.8% rostered', window: 'Until Doubs is back', windowTone: 'var(--warning)',
    take: 'Douglas caught 7 passes for 86 yards and a TD on a 27% target share, worth 16.1 points, after 20.5 the week before (4 for 65 and two TDs). Romeo Doubs is on IR (shoulder), hopeful to return after the Week 11 bye (Fowler). A.J. Brown (ankle) was limited Monday. New England is at Chicago on Thursday night, implied for 23.75 in a 50.5 total.',
    pro: 'The target share Rule 1 asks for, in a 50.5 total.',
    con: 'He locks Thursday, and a healthy Brown takes targets.',
  },
];

// Bid ranges, % of a $100 budget. Big Three first, then the top of the priced board.
const LADDER = [
  ['Tanner McKee', 'QB', 8, 14, true],
  ['Omar Cooper Jr.', 'WR', 8, 12, true],
  ['DeMario Douglas', 'WR', 6, 10, true],
  ['C.J. Stroud', 'QB', 4, 7, false],
  ['Michael Penix Jr.', 'QB', 4, 7, false],
  ['Roschon Johnson', 'RB', 4, 7, false],
  ['Jaylin Noel', 'WR', 3, 6, false],
  ['Kyler Murray', 'QB', 3, 6, false],
  ['Aaron Rodgers', 'QB', 3, 6, false],
  ['Tre Tucker', 'WR', 3, 6, false],
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
  { def: 'HOU', opp: 'NYG', pts: 16.25, kind: 'stream' },
  { def: 'NYJ', opp: 'MIA', pts: 17, kind: 'stream' },
  { def: 'MIN', opp: 'IND', pts: 17.5, kind: 'stream' },
  { def: 'CLE', opp: 'TEN', pts: 18.5, kind: 'stream' },
  { def: 'DEN', opp: 'ARI', pts: 19.5, kind: 'stream' },
  { def: 'SEA', opp: 'KC', pts: 20, kind: 'stream' },
  { def: 'DAL', opp: 'PHI', pts: 20, kind: 'stream' },
  { def: 'CAR', opp: 'TB', pts: 20.5, kind: 'stream' },
  { def: 'PIT', opp: 'NO', pts: 20.5, kind: 'stream' },
  { def: 'LV', opp: 'LAR', pts: 26, kind: 'avoid' },
  { def: 'NYG', opp: 'HOU', pts: 26.25, kind: 'avoid' },
  { def: 'NE', opp: 'CHI', pts: 26.75, kind: 'avoid' },
  { def: 'ATL', opp: 'SF', pts: 26.75, kind: 'avoid' },
  { def: 'CIN', opp: 'BAL', pts: 27.25, kind: 'avoid' },
  { def: 'GB', opp: 'DET', pts: 28.25, kind: 'avoid' },
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
      Week 6 left the wire with Jalen Hurts on IR with blood clots in his lungs, Davante Adams
      with a ruptured hamstring, and a report card that says the two receivers we bought on target
      share returned 36.3 points and the two players we bought on touchdowns returned 3.1. The darkness has a shape this
      week, and it is a quarterback&apos;s. Let&apos;s spend.
    </Lead>
    <P>
      Every bid below is a percentage of a $100 FAAB budget. The league is half-PPR with one
      quarterback slot and a superflex. Rostered figures come from our own snapshot, taken early
      Tuesday. Lines are ESPN&apos;s as of Tuesday. Injury statuses are our database as of
      Tuesday with Monday&apos;s reporting layered on, and where the two disagree I trust the
      database and say so. Buffalo, Jacksonville, the Chargers and Washington are on bye, so 28
      teams play. Thursday is New England at Chicago at 8:15 p.m. ET, Pittsburgh and New Orleans
      kick off in Paris on Sunday at 9:30 a.m. ET, Sunday night is Kansas City at Seattle, and
      Monday night is Dallas at Philadelphia.
    </P>

    <H2>The Big Three</H2>
    <P>
      McKee for the quarterback slot, Cooper for the receiver room, Douglas for the target share.
      Two of the three are a season and one has a clock on it, so price them that way. If you
      have the budget, you want all three.
    </P>
    {BIG_THREE.map((p) => <PriorityCard key={p.id} p={p} />)}
    <H3>Not in the Big Three: Jaylin Noel</H3>
    <P>
      Noel (WR, HOU, 4.7% rostered) caught 4 passes for 107 yards and a TD, and has scored in
      double digits three straight weeks. DeMeco Ryans said Monday that Tank Dell (knee) is on
      track to come off IR and make his season debut Sunday against the Giants. That is why Noel
      is a 3&ndash;6% bid and not a 6&ndash;10% one.
    </P>

    <H2>The FAAB Ladder</H2>
    <P>
      The top of the priced board on one scale. Highlighted bars are the Big Three. Anything that
      tops out at 7% or less is a cheap bid: pick a number in the range and don&apos;t lose sleep.
      Johnson is the exception: he is a bid only while Kyle Monangai is out.
    </P>
    <FaabLadder />

    <H2>The Full Board</H2>
    <P>
      Window is how long the role should last. Season means no starter is coming back to take it,
      and &quot;While X is out&quot; means exactly that. Rostered% is our snapshot, so a name at
      40% is already in two out of five leagues out there.
    </P>
    <Table aria-label="Week 7 offensive waiver board">
      <THead>
        <TR>
          <TH scope="col">#</TH><TH scope="col">Player</TH><TH scope="col">Pos</TH><TH scope="col">Team</TH><TH scope="col">Why</TH><TH scope="col">Wk 7</TH><TH scope="col">Window</TH><TH scope="col">Bid</TH><TH scope="col">Rostered%</TH>
        </TR>
      </THead>
      <TBody>
        <TR><TD>1</TD><TD><strong>Tanner McKee</strong></TD><TD>QB</TD><TD>PHI</TD><TD>Hurts out for the season (blood clots). 215 yards and a TD in his first start.</TD><TD>vs DAL (Mon)</TD><TD>Season</TD><TD>8&ndash;14%</TD><TD>2.6%</TD></TR>
        <TR><TD>2</TD><TD><strong>Omar Cooper Jr.</strong></TD><TD>WR</TD><TD>NYJ</TD><TD>6 for 103 and a TD on a 24% target share, first game off IR.</TD><TD>vs MIA</TD><TD>Season</TD><TD>8&ndash;12%</TD><TD>2.9%</TD></TR>
        <TR><TD>3</TD><TD><strong>DeMario Douglas</strong></TD><TD>WR</TD><TD>NE</TD><TD>7 for 86 and a TD on a 27% target share. Doubs on IR.</TD><TD>at CHI (Thu)</TD><TD>Until Doubs is back</TD><TD>6&ndash;10%</TD><TD>13.8%</TD></TR>
        <TR><TD>4</TD><TD><strong>C.J. Stroud</strong></TD><TD>QB</TD><TD>HOU</TD><TD>20-plus points three straight weeks. Giants implied for 16.25.</TD><TD>vs NYG</TD><TD>Season</TD><TD>4&ndash;7%</TD><TD>43.7%</TD></TR>
        <TR><TD>5</TD><TD><strong>Michael Penix Jr.</strong></TD><TD>QB</TD><TD>ATL</TD><TD>225 yards and 3 TDs. A 50.5 total against the 49ers.</TD><TD>vs SF</TD><TD>Season</TD><TD>4&ndash;7%</TD><TD>11.2%</TD></TR>
        <TR><TD>6</TD><TD><strong>Roschon Johnson</strong></TD><TD>RB</TD><TD>CHI</TD><TD>Monangai out (thumb/toe). 51 yards and a TD behind Swift.</TD><TD>vs NE (Thu)</TD><TD>While Monangai is out</TD><TD>4&ndash;7%</TD><TD>3.9%</TD></TR>
        <TR><TD>7</TD><TD><strong>Jaylin Noel</strong></TD><TD>WR</TD><TD>HOU</TD><TD>4 for 107 and a TD. Dell (knee) is on track to return Sunday.</TD><TD>vs NYG</TD><TD>Until Dell is up to speed</TD><TD>3&ndash;6%</TD><TD>4.7%</TD></TR>
        <TR><TD>8</TD><TD><strong>Kyler Murray</strong></TD><TD>QB</TD><TD>MIN</TD><TD>18.3 points before the bye. Colts implied for 17.5.</TD><TD>vs IND</TD><TD>Season</TD><TD>3&ndash;6%</TD><TD>48.6%</TD></TR>
        <TR><TD>9</TD><TD><strong>Aaron Rodgers</strong></TD><TD>QB</TD><TD>PIT</TD><TD>16.0 after three straight 3-TD games. Paris, early kick.</TD><TD>at NO (Paris)</TD><TD>Season</TD><TD>3&ndash;6%</TD><TD>26.2%</TD></TR>
        <TR><TD>10</TD><TD><strong>Tre Tucker</strong></TD><TD>WR</TD><TD>LV</TD><TD>5 for 97 and two TDs on an 18% target share.</TD><TD>vs LAR</TD><TD>Season</TD><TD>3&ndash;6%</TD><TD>44.2%</TD></TR>
        <TR><TD>11</TD><TD><strong>Ja&apos;Kobi Lane</strong></TD><TD>WR</TD><TD>BAL</TD><TD>Back from IR, 4 for 40 on a 16% share. Ravens implied for 27.25.</TD><TD>vs CIN</TD><TD>Season</TD><TD>3&ndash;6%</TD><TD>9.9%</TD></TR>
        <TR><TD>12</TD><TD><strong>Kendre Miller</strong></TD><TD>RB</TD><TD>NO</TD><TD>70 rushing yards, the early-down half of the Saints backfield.</TD><TD>vs PIT (Paris)</TD><TD>Committee</TD><TD>3&ndash;5%</TD><TD>33.2%</TD></TR>
        <TR><TD>13</TD><TD><strong>Michael Mayer</strong></TD><TD>TE</TD><TD>LV</TD><TD>7 for 95 on a 23% target share.</TD><TD>vs LAR</TD><TD>Stream</TD><TD>2&ndash;4%</TD><TD>14.9%</TD></TR>
        <TR><TD>14</TD><TD><strong>Keenan Allen</strong></TD><TD>WR</TD><TD>IND</TD><TD>8 for 82 on a 29% target share. Warren out.</TD><TD>at MIN</TD><TD>Season</TD><TD>2&ndash;4%</TD><TD>39.1%</TD></TR>
        <TR><TD>15</TD><TD><strong>Hunter Henry</strong></TD><TD>TE</TD><TD>NE</TD><TD>4 for 48 and a TD, 17% share. 13.8, 11.9 and 8.7 the last three weeks.</TD><TD>at CHI (Thu)</TD><TD>Season</TD><TD>2&ndash;4%</TD><TD>42.6%</TD></TR>
        <TR><TD>16</TD><TD><strong>Jaleel McLaughlin</strong></TD><TD>RB</TD><TD>CLE</TD><TD>Judkins out (ankle). 41 yards and 4 catches on a 16% share.</TD><TD>at TEN</TD><TD>While Judkins is out</TD><TD>2&ndash;4%</TD><TD>7.8%</TD></TR>
        <TR><TD>17</TD><TD><strong>Bam Knight</strong></TD><TD>RB</TD><TD>ARI</TD><TD>80 rushing yards with Love out. Love may run Tuesday.</TD><TD>vs DEN</TD><TD>If Love sits</TD><TD>1&ndash;3%</TD><TD>0.3%</TD></TR>
        <TR><TD>18</TD><TD><strong>Colby Parkinson</strong></TD><TD>TE</TD><TD>LAR</TD><TD>5 for 31 and a TD on a 19% share. Adams out.</TD><TD>at LV</TD><TD>Stream</TD><TD>1&ndash;3%</TD><TD>0.8%</TD></TR>
        <TR><TD>19</TD><TD><strong>Ryan Flournoy</strong></TD><TD>WR</TD><TD>DAL</TD><TD>7 for 40 and a TD. 13.5 and 10.5 the last two weeks.</TD><TD>at PHI (Mon)</TD><TD>Stream</TD><TD>1&ndash;3%</TD><TD>8.0%</TD></TR>
        <TR><TD>20</TD><TD><strong>J.J. McCarthy</strong></TD><TD>QB</TD><TD>NYG</TD><TD>243 yards and a TD in Week 6. Starter not yet named.</TD><TD>at HOU</TD><TD>If named starter</TD><TD>1&ndash;3%</TD><TD>0.9%</TD></TR>
        <TR><TD>21</TD><TD><strong>Geno Smith</strong></TD><TD>QB</TD><TD>NYJ</TD><TD>8.8, 10.0 and 12.0 the last three weeks. Home against Miami.</TD><TD>vs MIA</TD><TD>Superflex stream</TD><TD>1&ndash;2%</TD><TD>5.6%</TD></TR>
        <TR><TD>22</TD><TD><strong>Jahan Dotson</strong></TD><TD>WR</TD><TD>ATL</TD><TD>3 for 87 and a TD on a 15% share.</TD><TD>vs SF</TD><TD>Stream</TD><TD>1&ndash;2%</TD><TD>1.4%</TD></TR>
        <TR><TD>23</TD><TD><strong>Jawhar Jordan</strong></TD><TD>RB</TD><TD>HOU</TD><TD>Montgomery out. 43 yards and a TD; Houston is a 10-point favorite.</TD><TD>vs NYG</TD><TD>Handcuff</TD><TD>1&ndash;2%</TD><TD>0.1%</TD></TR>
        <TR><TD>24</TD><TD><strong>Audric Estime</strong></TD><TD>RB</TD><TD>CLE</TD><TD>Judkins out, Sampson still on IR. A TD on 19 yards.</TD><TD>at TEN</TD><TD>Handcuff</TD><TD>$1</TD><TD>0.3%</TD></TR>
        <TR><TD>25</TD><TD><strong>Darnell Washington</strong></TD><TD>TE</TD><TD>PIT</TD><TD>4 for 25 and a TD on a 14% share; Freiermuth had 7%.</TD><TD>at NO (Paris)</TD><TD>Stream</TD><TD>$1</TD><TD>2.1%</TD></TR>
      </TBody>
    </Table>
    <P>
      Four of these bids hang on an injury report. Roschon Johnson needs Monangai out, Bam Knight
      needs Love out, McLaughlin needs Judkins out, and Huntley (below) needs Jackson out. Love
      may run Tuesday and Jackson may practice, which is why none of them is above 7%.
    </P>

    <H2>Superflex Corner</H2>
    <P>
      Quarterbacks are where this format is won on the wire, so here is the ranking, with Week 6
      points.
    </P>
    <UL>
      <LI>
        <strong>C.J. Stroud</strong> (HOU, 43.7% rostered) is first at 22.98, after 23.08 and
        20.94 before it.
      </LI>
      <LI>
        <strong>Michael Penix Jr.</strong> (ATL, 11.2%) is second at 23.10.
      </LI>
      <LI>
        <strong>Kyler Murray</strong> (MIN, 48.6%) was on bye in Week 6 and scored 18.26 in Week
        5. He faces a Colts team implied for 17.5.
      </LI>
      <LI>
        <strong>Aaron Rodgers</strong> (PIT, 26.2%) scored 16.02.
      </LI>
      <LI>
        <strong>Tanner McKee</strong> (PHI, 2.6%) scored 12.6, and he is the only one of these who
        is a season-long starter at under 5%.
      </LI>
      <LI>
        <strong>Tyler Huntley</strong> (BAL, 5.3%) scored 13.40 and starts only if Jackson sits.
        Jesse Minter said Monday that Jackson could &quot;potentially&quot; practice this week.
      </LI>
      <LI>
        <strong>J.J. McCarthy</strong> (NYG, 0.9%) scored 16.32. He is a 1&ndash;3% bid, and only
        if the Giants name him.
      </LI>
      <LI>
        <strong>Geno Smith</strong> (NYJ, 5.6%) scored 11.98.
      </LI>
      <LI>
        <strong>Avoid Daniel Jones</strong> (IND, 16.9%, 13.76) at Minnesota with the Colts
        implied for 17.5.
      </LI>
      <LI>
        <strong>Jameis Winston</strong> (NYG, 33.5%) threw 152 yards and two picks. Hold him in
        superflex until the Giants name a starter.
      </LI>
      <LI>
        On bye and useless this week: the Buffalo, Jacksonville, Chargers and Washington
        quarterbacks.
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
        <strong>Houston</strong> hosts the Giants (16.25 implied), the best number on the board.
        The Houston D/ST scored 0 last week and 22 the week before.
      </LI>
      <LI>
        <strong>New York Jets</strong> host Miami (17.0). <strong>Minnesota</strong> hosts
        Indianapolis (17.5) off a bye.
      </LI>
      <LI>
        <strong>Cleveland</strong> at Tennessee (18.5) has scored 13 and 13 the last two weeks.{' '}
        <strong>Denver</strong> at Arizona (19.5) has scored 16 and 12.
      </LI>
      <LI>
        <strong>Seattle</strong> hosts Kansas City (20.0) on Sunday night, with Rice out.{' '}
        <strong>Dallas</strong> at Philadelphia (20.0) is Monday night, and Tanner McKee&apos;s
        second start.
      </LI>
      <LI>
        <strong>Carolina</strong> hosts Tampa Bay (20.5) and scored 8 last week.{' '}
        <strong>Pittsburgh</strong> draws New Orleans (20.5) in Paris and scored 14 last week.
      </LI>
    </UL>
    <P>
      <strong>Avoid:</strong> Green Bay (faces Detroit, 28.25), Cincinnati (faces Baltimore,
      27.25), New England (faces Chicago, 26.75), Atlanta (faces San Francisco, 26.75), the Giants
      (face Houston, 26.25) and Las Vegas (faces the Rams, 26.0). The grey bars above are those
      defenses.
    </P>

    <H2>Kickers</H2>
    <P>
      Kicker ownership is in our snapshot. The play is a kicker on an offense that scores, and the
      best of that group is Detroit&apos;s, indoors. Blake Grupe (LAR) tore his ACL, so cut him.
    </P>
    <Table aria-label="Week 7 kicker streamers">
      <THead>
        <TR>
          <TH scope="col">#</TH><TH scope="col">Kicker</TH><TH scope="col">Team</TH><TH scope="col">Team total</TH><TH scope="col">Rostered%</TH>
        </TR>
      </THead>
      <TBody>
        <TR><TD>1</TD><TD><strong>Jake Bates</strong></TD><TD>DET</TD><TD>28.25, in a 53.5 total, indoors, off a bye</TD><TD>38.8%</TD></TR>
        <TR><TD>2</TD><TD><strong>Chris Boswell</strong></TD><TD>PIT</TD><TD>24.0 in Paris, and 19 last week</TD><TD>30.5%</TD></TR>
        <TR><TD>3</TD><TD><strong>Cairo Santos</strong></TD><TD>CHI</TD><TD>26.75, Thursday, and 9 last week</TD><TD>25.3%</TD></TR>
        <TR><TD>4</TD><TD><strong>Evan McPherson</strong></TD><TD>CIN</TD><TD>24.25 at Baltimore in a 51.5 total, off a bye</TD><TD>21.8%</TD></TR>
        <TR><TD>5</TD><TD><strong>Ryan Fitzgerald</strong></TD><TD>CAR</TD><TD>24.0 vs TB, and 10 last week</TD><TD>3.4%</TD></TR>
      </TBody>
    </Table>

    <H2>IDP Waiver Board</H2>
    <P>
      Lines are Week 6 box scores from our database. IDP rostered percentages are not tracked, so I
      can&apos;t tell you who is sitting on your wire. Tackle volume is the currency at linebacker
      and safety. Pressure is the currency on the line. Tennessee hosts a Cleveland offense
      implied for 20.0, so Simmons, Johnson and Hooker are the stack. The Pittsburgh and New
      Orleans game kicks first.
    </P>
    <H3>Linebacker</H3>
    <Table aria-label="IDP linebackers">
      <THead>
        <TR><TH scope="col">#</TH><TH scope="col">Player</TH><TH scope="col">Team</TH><TH scope="col">Type</TH><TH scope="col">Week 6</TH><TH scope="col">Wk 7</TH></TR>
      </THead>
      <TBody>
        <TR><TD>1</TD><TD><strong>Bobby Okereke</strong></TD><TD>CAR</TD><TD><Tag kind="both" /></TD><TD>7 solo and 1 assisted tackle, a sack, 3 tackles for loss and 2 passes defended.</TD><TD>vs TB</TD></TR>
        <TR><TD>2</TD><TD><strong>Nick Herbig</strong></TD><TD>PIT</TD><TD><Tag kind="BP" /></TD><TD>6 solo tackles, 2 sacks and 3 tackles for loss.</TD><TD>at NO (Paris, early kick)</TD></TR>
        <TR><TD>3</TD><TD><strong>Jamien Sherwood</strong></TD><TD>NYJ</TD><TD><Tag kind="T" /></TD><TD>6 solo and 5 assisted tackles and a forced fumble.</TD><TD>vs MIA</TD></TR>
        <TR><TD>4</TD><TD><strong>Carson Schwesinger</strong></TD><TD>CLE</TD><TD><Tag kind="T" /></TD><TD>5 solo and 8 assisted tackles and a forced fumble.</TD><TD>at TEN</TD></TR>
        <TR><TD>5</TD><TD><strong>Alex Singleton</strong></TD><TD>DEN</TD><TD><Tag kind="T" /></TD><TD>4 solo and 9 assisted tackles.</TD><TD>at ARI</TD></TR>
        <TR><TD>6</TD><TD><strong>David Walker</strong></TD><TD>TB</TD><TD><Tag kind="BP" /></TD><TD>4 solo and 3 assisted tackles and 2 sacks.</TD><TD>at CAR</TD></TR>
      </TBody>
    </Table>
    <H3>Defensive line and edge</H3>
    <Table aria-label="IDP defensive line">
      <THead>
        <TR><TH scope="col">#</TH><TH scope="col">Player</TH><TH scope="col">Pos</TH><TH scope="col">Team</TH><TH scope="col">Week 6</TH><TH scope="col">Wk 7</TH></TR>
      </THead>
      <TBody>
        <TR><TD>1</TD><TD><strong>Jeffery Simmons</strong></TD><TD>DT</TD><TD>TEN</TD><TD>3 solo and 3 assisted tackles, 2 sacks, 2 tackles for loss and a forced fumble.</TD><TD>vs CLE</TD></TR>
        <TR><TD>2</TD><TD><strong>George Karlaftis</strong></TD><TD>DE</TD><TD>KC</TD><TD>A sack, 2 tackles for loss and 2 passes defended.</TD><TD>at SEA (SNF)</TD></TR>
        <TR><TD>3</TD><TD><strong>Jermaine Johnson II</strong></TD><TD>DE</TD><TD>TEN</TD><TD>2 sacks and 2 tackles for loss.</TD><TD>vs CLE</TD></TR>
        <TR><TD>4</TD><TD><strong>Quinnen Williams</strong></TD><TD>DT</TD><TD>DAL</TD><TD>A sack and 2 tackles for loss.</TD><TD>at PHI (Mon)</TD></TR>
        <TR><TD>5</TD><TD><strong>Daniel Hardy</strong></TD><TD>DE</TD><TD>CHI</TD><TD>A sack and a forced fumble.</TD><TD>vs NE (Thu)</TD></TR>
      </TBody>
    </Table>
    <H3>Defensive back</H3>
    <Table aria-label="IDP defensive backs">
      <THead>
        <TR><TH scope="col">#</TH><TH scope="col">Player</TH><TH scope="col">Pos</TH><TH scope="col">Team</TH><TH scope="col">Type</TH><TH scope="col">Week 6</TH><TH scope="col">Wk 7</TH></TR>
      </THead>
      <TBody>
        <TR><TD>1</TD><TD><strong>Martin Emerson Jr.</strong></TD><TD>CB</TD><TD>NO</TD><TD><Tag kind="BP" /></TD><TD>7 solo tackles, 2 interceptions and 4 passes defended.</TD><TD>vs PIT (Paris, early kick)</TD></TR>
        <TR><TD>2</TD><TD><strong>Jalen Ramsey</strong></TD><TD>CB</TD><TD>PIT</TD><TD><Tag kind="both" /></TD><TD>9 solo and 1 assisted tackle, 2 sacks and 4 tackles for loss.</TD><TD>at NO (Paris)</TD></TR>
        <TR><TD>3</TD><TD><strong>Kyler Gordon</strong></TD><TD>CB</TD><TD>CHI</TD><TD><Tag kind="BP" /></TD><TD>4 solo tackles, 3 sacks, 3 tackles for loss and 2 forced fumbles.</TD><TD>vs NE (Thu)</TD></TR>
        <TR><TD>4</TD><TD><strong>Amani Hooker</strong></TD><TD>S</TD><TD>TEN</TD><TD><Tag kind="both" /></TD><TD>7 solo and 6 assisted tackles and an interception.</TD><TD>vs CLE</TD></TR>
        <TR><TD>5</TD><TD><strong>Ja&apos;Quan McMillian</strong></TD><TD>CB</TD><TD>DEN</TD><TD><Tag kind="BP" /></TD><TD>5 solo tackles, a sack, an interception and 2 passes defended.</TD><TD>at ARI</TD></TR>
        <TR><TD>6</TD><TD><strong>Jamel Dean</strong></TD><TD>CB</TD><TD>PIT</TD><TD><Tag kind="BP" /></TD><TD>An interception and 6 passes defended.</TD><TD>at NO (Paris)</TD></TR>
      </TBody>
    </Table>
    <P>
      Tackle-heavy scoring: bump the Tackles tags a tier. Big-play scoring: bump the Big play tags.
      Okereke, Ramsey and Hooker carry both.
    </P>

    <H2>The Injury Ledger</H2>
    <H3>Out or on IR</H3>
    <UL>
      <LI><strong>Jalen Hurts</strong> (PHI QB): IR. Blood clots in his lungs, expected to miss multiple months and the rest of the season (Pelissero). McKee.</LI>
      <LI><strong>Saquon Barkley</strong> (PHI RB): out, hamstring. Dameon Pierce (55.7% rostered) scored 13.0 in his place.</LI>
      <LI><strong>Davante Adams</strong> (LAR WR): ruptured left hamstring, procedure, and he hopes to return &quot;a little after&quot; the Rams&apos; Week 11 bye (Rapoport). Parkinson (19% share) over Higbee (13%, 2.2 points). <strong>Terrance Ferguson</strong> (LAR TE): IR, ankle, expected back after his four-game stint. That closes the Parkinson window, and he is the stash if your league lets you.</LI>
      <LI><strong>Blake Grupe</strong> (LAR K): torn ACL, out for the season (McVay Monday). Cut him.</LI>
      <LI><strong>Terry McLaurin</strong> (WSH WR): MRI Tuesday, and the Commanders fear a season-ending left knee injury (Rapoport). Washington is on bye: Antonio Williams (5.4%) is a stash, not a start.</LI>
      <LI><strong>Jacory Croskey-Merritt</strong> (WSH RB): IR, groin. Rachaad White (59.3%) has the backfield, after the bye.</LI>
      <LI><strong>Kyle Monangai</strong> (CHI RB): thumb/toe, and he did not practice on Monday&apos;s estimated report. Roschon Johnson behind D&apos;Andre Swift.</LI>
      <LI><strong>Quinshon Judkins</strong> (CLE RB): out, ankle. <strong>Dylan Sampson</strong> (knee) was not activated from IR. McLaughlin, Estime.</LI>
      <LI><strong>David Montgomery</strong> (HOU RB): out. Woody Marks (70.3%) leads, and Jawhar Jordan scored.</LI>
      <LI><strong>Tank Dell</strong> (HOU WR): IR, knee. Ryans said Monday he is on track to make his season debut Sunday against the Giants. Noel&apos;s bid drops.</LI>
      <LI><strong>Adonai Mitchell</strong> (NYJ WR): out. Omar Cooper Jr.</LI>
      <LI><strong>Jeremiyah Love</strong> (ARI RB): out, ankle, and Mike LaFleur expects him to do some running Tuesday. Bam Knight ran for 80, and Allgeier had 5.3.</LI>
      <LI><strong>Lamar Jackson</strong> (BAL QB): out in our database, though Minter says he could &quot;potentially&quot; practice in Week 7, day-to-day. Huntley.</LI>
      <LI><strong>Michael Pittman Jr.</strong> and <strong>Roman Wilson</strong> (PIT WR): IR. Germie Bernard (44.4%) has the room.</LI>
      <LI><strong>Romeo Doubs</strong> (NE WR): IR, shoulder, and hopeful to return after the Week 11 bye (Fowler). Douglas.</LI>
      <LI><strong>Rashee Rice</strong> (KC WR): out, hamstring. <strong>Tyquan Thornton</strong>: IR. Xavier Worthy (74.0%) had a 24% share.</LI>
      <LI><strong>Tyler Warren</strong> (IND TE): out. Keenan Allen took 29% of the targets.</LI>
      <LI><strong>Deebo Samuel Sr.</strong> (SF WR): inactive Monday. <strong>Jordyn Tyson</strong> (NO WR): IR, hamstring, and he traveled to Paris. A stash.</LI>
      <LI><strong>DJ Moore</strong> (BUF WR): out, shoulder, and Buffalo is on bye.</LI>
    </UL>
    <H3>Questionable and week-to-week</H3>
    <UL>
      <LI><strong>Mike Evans</strong> (SF WR): left Monday with right Achilles tendinitis, and Shanahan does not expect more testing or imaging.</LI>
      <LI><strong>A.J. Brown</strong> (NE WR): ankle, limited on Monday&apos;s estimated report. Thursday game.</LI>
      <LI><strong>Rashod Bateman</strong> (BAL WR): shoulder, &quot;should be OK&quot; (Minter). Lane&apos;s bid assumes Bateman plays.</LI>
      <LI><strong>T.J. Hockenson</strong> and <strong>Jordan Addison</strong> (MIN): questionable coming off the bye.</LI>
      <LI><strong>Ladd McConkey</strong> (LAC WR): concussion. The bye buys him a week.</LI>
    </UL>

    <H2>Receipts: Grading Week 6</H2>
    <P>
      Last week&apos;s board, graded in half-PPR points from our database. The hits first.
    </P>
    <Table aria-label="Week 6 board hits">
      <THead>
        <TR><TH scope="col">Player</TH><TH scope="col">Points</TH><TH scope="col">Wk 6 bid</TH></TR>
      </THead>
      <TBody>
        <TR><TD><strong>Germie Bernard</strong></TD><TD>20.2</TD><TD>8&ndash;12%</TD></TR>
        <TR><TD><strong>Jordan Love</strong></TD><TD>20.2</TD><TD>5&ndash;8%</TD></TR>
        <TR><TD><strong>DeMario Douglas</strong></TD><TD>16.1</TD><TD>4&ndash;7%</TD></TR>
        <TR><TD><strong>Aaron Rodgers</strong></TD><TD>16.0</TD><TD>4&ndash;7%</TD></TR>
        <TR><TD><strong>Ryan Flournoy</strong></TD><TD>13.5</TD><TD>1&ndash;3%</TD></TR>
        <TR><TD><strong>Tyler Huntley</strong></TD><TD>13.4</TD><TD>3&ndash;6%</TD></TR>
        <TR><TD><strong>Dameon Pierce</strong></TD><TD>13.0</TD><TD>2&ndash;5%</TD></TR>
        <TR><TD><strong>Keenan Allen</strong></TD><TD>12.2</TD><TD>2&ndash;4%</TD></TR>
        <TR><TD><strong>Chig Okonkwo</strong></TD><TD>10.4</TD><TD>1&ndash;3%</TD></TR>
      </TBody>
    </Table>
    <P>
      Bernard was the best return on the board: 20.2 points on 11 catches for 87 yards and a TD,
      a 27% target share. Douglas caught 7 for 86 and a TD. Pierce scored 13.0 because Barkley
      sat, and Allen caught 8 for 82 on a 29% share. Now the misses and the shrugs.
    </P>
    <Table aria-label="Week 6 board misses and pushes">
      <THead>
        <TR><TH scope="col">Player</TH><TH scope="col">Points</TH><TH scope="col">Wk 6 bid</TH><TH scope="col">What happened</TH></TR>
      </THead>
      <TBody>
        <TR><TD><strong>Woody Marks</strong></TD><TD>9.1</TD><TD>12&ndash;18%</TD><TD>A push: the job, not the points.</TD></TR>
        <TR><TD><strong>Jameis Winston</strong></TD><TD>6.5</TD><TD>6&ndash;10%</TD><TD>152 yards and two picks. J.J. McCarthy threw for 243.</TD></TR>
        <TR><TD><strong>Pat Freiermuth</strong></TD><TD>2.1</TD><TD>4&ndash;7%</TD><TD>Not enough.</TD></TR>
        <TR><TD><strong>MarShawn Lloyd</strong></TD><TD>1.0</TD><TD>4&ndash;7%</TD><TD>Not enough.</TD></TR>
        <TR><TD><strong>Brandin Cooks</strong></TD><TD>1.8</TD><TD>3&ndash;6%</TD><TD>Not enough.</TD></TR>
        <TR><TD><strong>Tyler Higbee</strong></TD><TD>2.2</TD><TD>3&ndash;5%</TD><TD>Not enough.</TD></TR>
        <TR><TD><strong>Kimani Vidal</strong></TD><TD>5.5</TD><TD>2&ndash;5%</TD><TD>Not enough.</TD></TR>
        <TR><TD><strong>Darius Cooper</strong></TD><TD>1.4</TD><TD>2&ndash;4%</TD><TD>Not enough.</TD></TR>
        <TR><TD><strong>Brenton Strange</strong></TD><TD>6.9</TD><TD>2&ndash;4%</TD><TD>A push.</TD></TR>
        <TR><TD><strong>Kendrick Bourne</strong></TD><TD>7.2</TD><TD>1&ndash;3%</TD><TD>A push.</TD></TR>
        <TR><TD><strong>Kendre Miller</strong></TD><TD>8.0</TD><TD>1&ndash;2%</TD><TD>A push.</TD></TR>
        <TR><TD><strong>Raheim Sanders</strong></TD><TD>DNP</TD><TD>1&ndash;3%</TD><TD>On IR.</TD></TR>
        <TR><TD><strong>Isaiah Bond</strong></TD><TD>DNP</TD><TD>1&ndash;2%</TD><TD>Did not play.</TD></TR>
        <TR><TD><strong>Kyle Williams</strong></TD><TD>1.7</TD><TD>$1</TD><TD>Not enough.</TD></TR>
        <TR><TD><strong>Efton Chism III</strong></TD><TD>0.0</TD><TD>$1</TD><TD>A zero.</TD></TR>
        <TR><TD><strong>Corey Kiner</strong></TD><TD>6.2</TD><TD>$1</TD><TD>A push.</TD></TR>
      </TBody>
    </Table>
    <H3>The lesson</H3>
    <P>
      The two receivers bought on target share returned 36.3 between them: Bernard on 30%,
      and Douglas on 16% plus two scores, who then drew 27% of the targets. The two players bought on last week&apos;s
      touchdowns, Freiermuth&apos;s two and Lloyd&apos;s two, returned 3.1, and the market paid
      for both anyway.
    </P>
    <H3>Where the market went</H3>
    <UL>
      <LI><strong>Germie Bernard</strong>: 3.0% to 44.4% rostered.</LI>
      <LI><strong>Jameis Winston</strong>: 4.0% to 33.5%, and then he threw two picks.</LI>
      <LI><strong>Pat Freiermuth</strong>: 20.3% to 57.9%, on 2.1 points.</LI>
      <LI><strong>MarShawn Lloyd</strong>: 48.7% to 75.3%, on 1.0.</LI>
      <LI><strong>Dameon Pierce</strong>: 2.4% to 55.7%.</LI>
      <LI><strong>Jordan Love</strong>: 47.9% to 85.9%.</LI>
      <LI><strong>Woody Marks</strong>: 48.0% to 70.3%.</LI>
      <LI><strong>Tyler Higbee</strong>: 3.2% to 22.8%, on 2.2.</LI>
    </UL>

    <H2>The Darkness Doctrine</H2>
    <P>
      Last week&apos;s receipts wrote this week&apos;s rules. Five of them.
    </P>
    <H3>Rule 1: Target share over touchdowns, again</H3>
    <P>
      Bernard&apos;s 27% scored 20.2. Freiermuth and Lloyd were bought on two touchdowns each and
      returned 3.1 combined, and the market took them to 57.9% and 75.3% anyway. This
      week&apos;s touchdown traps: Tyrone Tracy Jr. (two scores on a 7% share and 18 rushing
      yards), Foster Moreau (two scores on two catches) and Tommy Tremble (two scores on 11%).
    </P>
    <H3>Rule 2: Starters over rentals, with a footnote</H3>
    <P>
      McKee is a season-long starter at 2.6%. The footnote is Winston: last week&apos;s starter
      threw two picks while J.J. McCarthy threw for 243. A starter is a starter until the coach
      names someone else.
    </P>
    <H3>Rule 3: Four byes</H3>
    <P>
      Buffalo, Jacksonville, the Chargers and Washington are off. Check the lineup before the
      wire. Spend only on stashes (Rachaad White, Antonio Williams), never on a Week 7 start.
    </P>
    <H3>Rule 4: Thursday and Paris lock first</H3>
    <P>
      New England at Chicago is Thursday night (Douglas, Johnson, Henry, Santos, Kyler Gordon).
      Pittsburgh and New Orleans kick off in Paris on Sunday at 9:30 a.m. ET (Rodgers, Miller,
      Darnell Washington, Boswell, Herbig, Ramsey, Emerson). Set them before you go to bed
      Saturday.
    </P>
    <H3>Rule 5: Price the second bet</H3>
    <P>
      Johnson needs Monangai out, Knight needs Love out, McLaughlin needs Judkins out, Huntley
      needs Jackson out. Love may run Tuesday and Jackson may practice. That is why none of them
      is above 7%.
    </P>
    <Quote>
      Buy the target share. Rent the touchdown. Never pay for last week&apos;s.
    </Quote>

    <H2>Who to Cut</H2>
    <UL>
      <LI><strong>Pat Freiermuth</strong>: 2.1 on a 7% share, at 57.9% rostered.</LI>
      <LI><strong>MarShawn Lloyd</strong>: 1.0 on 10 yards, at 75.3% rostered.</LI>
      <LI><strong>Blake Grupe</strong>: torn ACL.</LI>
      <LI><strong>Brandin Cooks</strong>: 1.8.</LI>
      <LI><strong>Darius Cooper</strong>: 1.4.</LI>
      <LI><strong>Efton Chism III</strong>: 0.0, and <strong>Kyle Williams</strong>: 1.7.</LI>
      <LI><strong>Raheim Sanders</strong>: IR.</LI>
      <LI><strong>Bo Nix</strong>, in 1QB leagues only: 4.48 and 7.92 the last two weeks. A starter is still a starter in superflex.</LI>
      <LI><strong>Jalen Hurts</strong> goes to an IR slot or the wire.</LI>
      <LI><strong>Hold</strong> Jameis Winston in superflex until the Giants name a starter, Davante Adams and Terry McLaurin in IR slots, and Rachaad White through the bye.</LI>
    </UL>

    <H2>The Week 7 Bid Sheet</H2>
    <P>Set your claims in this order.</P>
    <OL>
      <LI><strong>Tanner McKee</strong> at 8&ndash;14% (superflex; $1 in 1QB).</LI>
      <LI><strong>Omar Cooper Jr.</strong> at 8&ndash;12%.</LI>
      <LI><strong>DeMario Douglas</strong> at 6&ndash;10%. He locks Thursday.</LI>
      <LI>Superflex: <strong>C.J. Stroud</strong> at 4&ndash;7% if he is there, then <strong>Michael Penix Jr.</strong> at 4&ndash;7%, then <strong>Kyler Murray</strong> at 3&ndash;6%.</LI>
      <LI><strong>Roschon Johnson</strong> at 4&ndash;7%. He locks Thursday.</LI>
      <LI><strong>Jaylin Noel</strong>, <strong>Tre Tucker</strong> and <strong>Ja&apos;Kobi Lane</strong> at 3&ndash;6%.</LI>
      <LI>The rest of the Full Board at the ranges listed, and $1 on Audric Estime and Darnell Washington.</LI>
    </OL>
    <P>
      Injury statuses are as of Tuesday. Monangai, Love, Judkins and Jackson decide four of these
      bids before kickoff, the Giants still have to name a quarterback, and Thursday night is New
      England at Chicago. Andy Darkness is a pen name and has no rooting interest, allegedly.
    </P>
  </>
);

export default Body;
