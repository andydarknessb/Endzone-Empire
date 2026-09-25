import React from 'react';
import { Box } from '@mui/material';
import {
  Lead, P, H2, Quote,
  Table, THead, TBody, TR, TH, TD,
} from '../../components/public/kit/Prose';

// Body only: the frontmatter lives in week3-start-sit-darkness-report.meta.js so listings can be
// built without loading this prose; content/articles/index.js loads it on demand.
//
// Every color below the hero is a theme token, so the chart, cards and chips read in light and
// dark. The hero is a dark illustration in both themes, like the Week 1 banner.

const POS_COLOR = {
  QB: 'var(--pos-qb)', RB: 'var(--pos-rb)', WR: 'var(--pos-wr)', TE: 'var(--pos-te)',
  K: 'var(--pos-k)', DEF: 'var(--pos-def)', LB: 'var(--pos-idp)', DL: 'var(--pos-idp)', DB: 'var(--pos-idp)',
};
const TONE = {
  start: { label: 'Start', color: 'var(--success)' },
  sit: { label: 'Sit', color: 'var(--danger)' },
  watch: { label: 'Watch the inactives', color: 'var(--warning)' },
  sleepers: { label: 'Sleepers', color: 'var(--accent)' },
  idp: { label: 'IDP', color: 'var(--pos-idp)' },
};

function HeroBanner() {
  const lights = Array.from({ length: 15 }, (_, i) => i);
  return (
    <Box
      component="svg"
      viewBox="0 0 800 300"
      xmlns="http://www.w3.org/2000/svg"
      sx={{ width: '100%', borderRadius: 'var(--radius-md, 10px)', overflow: 'hidden', mb: 4, display: 'block' }}
      role="img"
      aria-labelledby="wk3ss-hero-title wk3ss-hero-desc"
    >
      <title id="wk3ss-hero-title">Week 3 Start/Sit: The Darkness Report</title>
      <desc id="wk3ss-hero-desc">
        A night field under a floodlight, with fifteen game lights strung along an arc from the early
        window to Monday night, over the headline Week 3 Start/Sit.
      </desc>
      <defs>
        <linearGradient id="wk3ss-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#070a12" />
          <stop offset="0.55" stopColor="#0d1526" />
          <stop offset="1" stopColor="#1a0f24" />
        </linearGradient>
        <radialGradient id="wk3ss-flood" cx="0.5" cy="0" r="0.8">
          <stop offset="0" stopColor="#7eaaff" stopOpacity="0.35" />
          <stop offset="1" stopColor="#7eaaff" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="wk3ss-sweep" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#7eaaff" />
          <stop offset="0.6" stopColor="#2fd97b" />
          <stop offset="1" stopColor="#ff8c42" />
        </linearGradient>
      </defs>
      <rect width="800" height="300" fill="url(#wk3ss-bg)" />
      <rect width="800" height="300" fill="url(#wk3ss-flood)" />
      {Array.from({ length: 11 }, (_, i) => (
        <line key={`yd${i}`} x1={40 + i * 72} y1="150" x2={10 + i * 78} y2="300" stroke="rgba(255,255,255,0.06)" />
      ))}
      <path d="M60 200 C 220 60, 580 60, 740 200" fill="none" stroke="url(#wk3ss-sweep)" strokeWidth="14" strokeLinecap="round" opacity="0.12" />
      <path d="M60 200 C 220 60, 580 60, 740 200" fill="none" stroke="url(#wk3ss-sweep)" strokeWidth="3" strokeLinecap="round" opacity="0.85" />
      {lights.map((i) => {
        const t = i / 14;
        // Point on the cubic Bezier above, so every light sits on the arc.
        const u = 1 - t;
        const x = u * u * u * 60 + 3 * u * u * t * 220 + 3 * u * t * t * 580 + t * t * t * 740;
        const y = u * u * u * 200 + 3 * u * u * t * 60 + 3 * u * t * t * 60 + t * t * t * 200;
        // Nine early games, four late, Sunday night, Monday night.
        const fill = i < 9 ? '#7eaaff' : i < 13 ? '#2fd97b' : i < 14 ? '#ffd866' : '#ff8c42';
        return (
          <g key={`l${i}`}>
            <circle cx={x} cy={y} r="10" fill={fill} opacity="0.18" />
            <circle cx={x} cy={y} r="4.5" fill={fill} />
          </g>
        );
      })}
      <text x="400" y="150" textAnchor="middle" fill="#8badc9" fontFamily="system-ui, sans-serif" fontWeight="700" fontSize="12" letterSpacing="4">THE DARKNESS REPORT</text>
      <rect x="120" y="214" width="560" height="68" rx="14" fill="rgba(3,8,20,0.82)" stroke="rgba(126,170,255,0.25)" />
      <text x="400" y="246" textAnchor="middle" fill="#ffffff" fontFamily="system-ui, sans-serif" fontWeight="850" fontSize="24" letterSpacing="1">WEEK 3 START / SIT</text>
      <text x="400" y="269" textAnchor="middle" fill="#8badc9" fontFamily="system-ui, sans-serif" fontWeight="600" fontSize="12" letterSpacing="3">15 GAMES &middot; EVERY POSITION &middot; IDP &middot; SLEEPERS</text>
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

// Implied points for both sides as one split bar: the filled side is the favorite.
function SplitBar({ away, home, awayPts, homePts }) {
  const awayPct = (awayPts / (awayPts + homePts)) * 100;
  return (
    <Box sx={{ mt: 1.75 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-muted)', mb: 0.5, fontVariantNumeric: 'tabular-nums' }}>
        <span>{away} {awayPts}</span>
        <span>implied points</span>
        <span>{homePts} {home}</span>
      </Box>
      <Box aria-hidden="true" sx={{ display: 'flex', height: 10, borderRadius: 'var(--radius-pill, 999px)', overflow: 'hidden', bgcolor: 'var(--surface-sunken)' }}>
        <Box sx={{ width: `${awayPct}%`, bgcolor: awayPts > homePts ? 'var(--accent)' : 'var(--border-strong)' }} />
        <Box sx={{ width: '3px', bgcolor: 'var(--surface-raised)' }} />
        <Box sx={{ flex: 1, bgcolor: homePts > awayPts ? 'var(--accent)' : 'var(--border-strong)' }} />
      </Box>
    </Box>
  );
}

const CONFIDENCE = { Lean: 1, Solid: 2, Strong: 3 };
function Confidence({ level }) {
  return (
    <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.4 }}>
      {[1, 2, 3].map((i) => (
        <Box key={i} component="span" aria-hidden="true" sx={{ width: 7, height: 14, borderRadius: '2px', bgcolor: i <= CONFIDENCE[level] ? 'var(--accent)' : 'var(--border-subtle)' }} />
      ))}
      <Box component="span" sx={{ ml: 0.5, fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)' }}>{level}</Box>
    </Box>
  );
}

function CallList({ tone, items }) {
  if (!items || !items.length) return null;
  const { label, color } = TONE[tone];
  return (
    <Box sx={{ mt: 2.25 }}>
      <Box sx={{ fontSize: '0.72rem', fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase', color, mb: 0.75 }}>
        {label}
      </Box>
      <Box component="ul" sx={{ listStyle: 'none', p: '0 !important', m: '0 !important', display: 'grid', gap: 0.75 }}>
        {items.map(([name, pos, why]) => (
          <Box
            component="li"
            key={name}
            sx={{ m: '0 !important', pl: 1.25, py: 0.4, borderLeft: '3px solid', borderColor: color, fontSize: '0.95rem', lineHeight: 1.5 }}
          >
            <Pill color={POS_COLOR[pos]}>{pos}</Pill>
            <strong>{name}</strong>
            {why ? <Box component="span" sx={{ color: 'var(--text-muted)' }}> &middot; {why}</Box> : null}
          </Box>
        ))}
      </Box>
    </Box>
  );
}

function GameCard({ g }) {
  return (
    <Box
      component="section"
      aria-labelledby={`game-${g.id}`}
      sx={{
        my: 3.5, p: { xs: 2, sm: 3 }, borderRadius: 'var(--radius-md, 10px)',
        bgcolor: 'var(--surface-raised)', border: '1px solid var(--border-subtle)', boxShadow: 'var(--shadow-2, none)',
        scrollMarginTop: 92,
      }}
      id={`g-${g.id}`}
    >
      <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', justifyContent: 'space-between', columnGap: 2 }}>
        <Box component="h3" id={`game-${g.id}`} sx={{ m: '0 !important', fontSize: { xs: '1.3rem !important', sm: '1.5rem !important' } }}>
          {g.title}
        </Box>
        <Box sx={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-muted)' }}>{g.when}</Box>
      </Box>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.25, mt: 1.25, alignItems: 'center' }}>
        <Box sx={{ px: 1.25, py: 0.25, borderRadius: 'var(--radius-pill, 999px)', bgcolor: 'var(--accent-soft)', color: 'var(--accent)', fontWeight: 800, fontSize: '0.85rem' }}>
          Pick: {g.pick}
        </Box>
        <Confidence level={g.conf} />
        <Box sx={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>{g.line}</Box>
      </Box>
      <SplitBar away={g.away} home={g.home} awayPts={g.awayPts} homePts={g.homePts} />
      <Box component="p" sx={{ mt: '16px !important', mb: '0 !important' }}>{g.take}</Box>
      <CallList tone="start" items={g.start} />
      <CallList tone="sit" items={g.sit} />
      <CallList tone="watch" items={g.watch} />
      <CallList tone="sleepers" items={g.sleepers} />
      <CallList tone="idp" items={g.idp} />
    </Box>
  );
}

// Every team's implied points, highest first: the one chart that says where the points are.
function ImpliedChart() {
  const rows = GAMES
    .flatMap((g) => [
      { team: g.away, pts: g.awayPts, fav: g.awayPts > g.homePts },
      { team: g.home, pts: g.homePts, fav: g.homePts > g.awayPts },
    ])
    .sort((a, b) => b.pts - a.pts);
  const max = rows[0].pts;
  const summary = rows.map((r) => `${r.team} ${r.pts}`).join(', ');
  return (
    <Box
      role="img"
      aria-label={`Implied points by team, highest to lowest: ${summary}`}
      sx={{
        my: 3, display: 'grid', columnGap: 4, rowGap: 0.6,
        gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' },
        // Fill down the first column, then the second, so rank reads top to bottom.
        gridTemplateRows: { sm: `repeat(${Math.ceil(rows.length / 2)}, auto)` },
        gridAutoFlow: { sm: 'column' },
      }}
    >
      {rows.map((r) => (
        <Box key={r.team} aria-hidden="true" sx={{ display: 'grid', gridTemplateColumns: '2.8em 1fr 3.2em', alignItems: 'center', gap: 1, fontSize: '0.85rem' }}>
          <Box component="span" sx={{ fontWeight: 800 }}>{r.team}</Box>
          <Box sx={{ height: 12, borderRadius: 'var(--radius-pill, 999px)', bgcolor: 'var(--surface-sunken)', overflow: 'hidden' }}>
            <Box sx={{ width: `${(r.pts / max) * 100}%`, height: '100%', bgcolor: r.fav ? 'var(--accent)' : 'var(--border-strong)' }} />
          </Box>
          <Box component="span" sx={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--text-muted)' }}>{r.pts}</Box>
        </Box>
      ))}
    </Box>
  );
}

// Jump links to every game card. Plain anchors: the cards sit on this page.
function JumpGrid() {
  return (
    <Box component="nav" aria-label="Jump to a game" sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, my: 3 }}>
      {GAMES.map((g) => (
        <Box
          key={g.id}
          component="a"
          href={`#g-${g.id}`}
          sx={{
            px: 1.25, py: 0.4, borderRadius: 'var(--radius-pill, 999px)', border: '1px solid var(--border-subtle)',
            bgcolor: 'var(--surface-raised)', color: 'var(--text-primary) !important', textDecoration: 'none !important',
            fontSize: '0.8rem', fontWeight: 700, '&:hover': { borderColor: 'var(--accent)' },
          }}
        >
          {g.away} @ {g.home}
        </Box>
      ))}
    </Box>
  );
}

// [name, position, why]. Position drives the pill color; IDP uses LB, DL or DB.
const GAMES = [
  {
    id: 'sea-wsh', slot: 'early', title: 'Seahawks at Commanders', when: 'Sun 1:00 ET',
    away: 'SEA', home: 'WSH', awayPts: 24, homePts: 16.5, pick: 'Seattle', conf: 'Strong', line: 'SEA -7.5 · O/U 40.5',
    take: 'Jayden Daniels is OUT with the elbow, so Marcus Mariota gets the best defense on the slate. Frankie Luvu and Chig Okonkwo are questionable and trending toward inactive, and safety Nick Cross is already ruled out. Seattle expects Sam Darnold back after a full practice Thursday. If he cannot go, Drew Lock scored 21.4 last week.',
    start: [
      ['Jaxon Smith-Njigba', 'WR', '22.2 and 38.0. Projected 24.4. Matchup-proof.'],
      ['Stefon Diggs', 'WR', 'WR2. Backup quarterbacks lock onto the first read. 13.5 and 19.2.'],
      ['Seahawks D/ST', 'DEF', 'Backup QB, 16.5 implied. Scored 17 and 15.'],
      ['Jason Myers', 'K', 'Kicker for the biggest favorite of the early window.'],
    ],
    sit: [
      ['Terry McLaurin', 'WR', '2.4 and 6.0 with the starter. Now with Mariota.'],
      ['Jacory Croskey-Merritt', 'RB', 'Committee back into an elite run defense.'],
      ['Rachaad White', 'RB', 'Deep PPR leagues only.'],
    ],
    watch: [
      ['Jadarian Price', 'RB', 'Questionable. Zach Charbonnet is OUT.'],
      ['Sam Darnold', 'QB', 'Expected to start. Not a one-QB play either way.'],
    ],
    sleepers: [
      ['Emanuel Wilson', 'RB', 'Lead back if Price sits. 9.2 last week.'],
      ['Antonio Williams', 'WR', 'Washington slot. 14.4 in Week 1.'],
    ],
    idp: [
      ['Ernest Jones IV', 'LB', 'LB1 volume. Projected 13.2.'],
      ['Leonard Williams', 'DL', 'Backup QB and guard Sam Cosmi in concussion protocol.'],
      ['Julian Love', 'DB', 'Questionable (calf). DB1 if active.'],
      ['Sonny Styles', 'LB', 'Sleeper. Inherits the Luvu snaps if Luvu sits.'],
    ],
  },
  {
    id: 'hou-ind', slot: 'early', title: 'Texans at Colts', when: 'Sun 1:00 ET · Dome',
    away: 'HOU', home: 'IND', awayPts: 22, homePts: 20.5, pick: 'Houston', conf: 'Lean', line: 'HOU -1.5 · O/U 42.5',
    take: 'Two 0-2 teams and one broken defense: Indianapolis is giving up a league-worst 37 points a game. Nico Collins (hamstring) is questionable and expected to sit again, Tank Dell and Jayden Higgins are on IR, and Alec Pierce is OUT for the Colts.',
    start: [
      ['Jonathan Taylor', 'RB', 'Two touchdowns in each game. Projected 21.5.'],
      ['C.J. Stroud', 'QB', 'Streaming QB1 against the worst defense in football.'],
      ['Dalton Schultz', 'TE', 'TE1. Without Collins he is the passing game. 20.0 last week.'],
      ['Tyler Warren', 'TE', 'Steady TE1. 8.8 and 11.4.'],
      ['David Montgomery', 'RB', 'RB2. 27.4 then 3.4: the Woody Marks split makes him swingy.'],
      ['Josh Downs', 'WR', 'WR3 with Pierce out.'],
    ],
    sit: [
      ['Daniel Jones', 'QB', '9.0 and 11.4, and now Will Anderson and Danielle Hunter.'],
      ['Keenan Allen', 'WR', '6.2 and 1.0.'],
      ['Colts D/ST', 'DEF', 'Minus 5 and minus 4.'],
    ],
    watch: [['Nico Collins', 'WR', 'Questionable (hamstring), expected out.']],
    sleepers: [
      ['Texans D/ST', 'DEF', 'Our model says 6.0. Against this offense that is light.'],
      ['Woody Marks', 'RB', 'PPR flex. He catches what Montgomery does not.'],
    ],
    idp: [
      ['Will Anderson Jr.', 'DL', 'DL1. Projected 13.2, 13.0 last week.'],
      ['Danielle Hunter', 'DL', 'Start.'],
      ['Azeez Al-Shaair', 'LB', "LB1 with Henry To'oTo'o on IR."],
      ['Akeem Davis-Gaither', 'LB', 'Colts defense lives on the field. 11.5 last week.'],
      ['Cam Bynum', 'DB', 'Sleeper safety on the same busy defense.'],
    ],
  },
  {
    id: 'ne-jax', slot: 'early', title: 'Patriots at Jaguars', when: 'Sun 1:00 ET',
    away: 'NE', home: 'JAX', awayPts: 21.25, homePts: 24.25, pick: 'Jacksonville', conf: 'Lean', line: 'JAX -3 · O/U 45.5',
    take: 'Drake Maye has one touchdown and four interceptions, and A.J. Brown is on IR. New England defends the pass as well as anyone. It bends against the run, which is where you attack it. Storms are possible in Jacksonville Sunday.',
    start: [
      ['Parker Washington', 'WR', 'Jacksonville target leader. 16.8 and 14.3.'],
      ['Trevor Lawrence', 'QB', 'Low-end QB1. 26.1 in Week 1.'],
      ['Bhayshul Tuten', 'RB', 'RB2. Attack the run, not the secondary.'],
      ['TreVeyon Henderson', 'RB', 'RB2. 13.6 last week.'],
    ],
    sit: [
      ['Brian Thomas Jr.', 'WR', '5.5 and 5.5, into a top pass defense.'],
      ['Drake Maye', 'QB', 'Bench in one-QB leagues.'],
      ['Rhamondre Stevenson', 'RB', 'Jacksonville stops the run.'],
    ],
    sleepers: [
      ['Jaguars D/ST', 'DEF', 'Four Maye interceptions in two games.'],
      ['Romeo Doubs', 'WR', "New England's de facto WR1 without Brown. 11.1 last week."],
      ['Hunter Henry', 'TE', 'Streamer.'],
    ],
    idp: [
      ['Foyesade Oluokun', 'LB', 'LB1. Projected 13.7.'],
      ['Josh Hines-Allen', 'DL', '13.5 in Week 1.'],
      ['Christian Elliss', 'LB', '14.5 last week.'],
      ['Elijah Ponder', 'LB', 'Sleeper. 19.0 last week.'],
    ],
  },
  {
    id: 'kc-mia', slot: 'early', title: 'Chiefs at Dolphins', when: 'Sun 1:00 ET',
    away: 'KC', home: 'MIA', awayPts: 28, homePts: 17.5, pick: 'Kansas City', conf: 'Strong', line: 'KC -10.5 · O/U 45.5',
    take: 'Kansas City is 2-0. Miami is 0-2 and starting Malik Willis. The Dolphins ranked 28th against running backs last season at 4.8 yards a carry, and nothing about this start says that changed. Rashee Rice practiced fully.',
    start: [
      ['Patrick Mahomes', 'QB', '29.0 last week.'],
      ['Kenneth Walker III', 'RB', 'Smash spot. 32.6 and 20.8.'],
      ['Rashee Rice', 'WR', 'Full practice. WR1/2.'],
      ['Travis Kelce', 'TE', '20.6 last week.'],
      ['Xavier Worthy', 'WR', 'Flex.'],
      ["De'Von Achane", 'RB', 'RB1/2. The script is ugly, the catches save him.'],
      ['Harrison Butker', 'K', '28 implied points.'],
    ],
    sit: [
      ['Malik Willis', 'QB', 'Superflex only.'],
      ['Miami receivers', 'WR', 'Caleb Douglas is questionable. Nobody here is startable.'],
      ['Dolphins D/ST', 'DEF', 'Minus 4 last week.'],
    ],
    sleepers: [
      ['Chiefs D/ST', 'DEF', 'Willis carries one of the highest sack rates in the league.'],
      ['Emmett Johnson', 'RB', 'Blowout insurance behind Walker.'],
    ],
    idp: [
      ['Jordyn Brooks', 'LB', 'Led the NFL in tackles last year. Miami will be on the field all day.'],
      ['Jacob Rodriguez', 'LB', 'Same logic. 9.5 and 6.5.'],
      ['Nick Bolton', 'LB', '10.5 last week.'],
      ['Chris Jones', 'DL', 'Questionable (calf), limited all week.'],
    ],
  },
  {
    id: 'ten-nyg', slot: 'early', title: 'Titans at Giants', when: 'Sun 1:00 ET',
    away: 'TEN', home: 'NYG', awayPts: 18, homePts: 20.5, pick: 'New York', conf: 'Lean', line: 'NYG -2.5 · O/U 38.5',
    take: 'The lowest total on the board. Jaxson Dart is on IR, so Jameis Winston starts. Malik Nabers practiced fully Friday. Brian Burns (ankle) has not practiced. Tennessee has allowed 241 rushing yards in two games.',
    start: [
      ['Cam Skattebo', 'RB', 'RB2 against a leaky run defense.'],
      ['Malik Nabers', 'WR', 'Winston throws to his WR1. Often.'],
      ['Isaiah Likely', 'TE', 'TE1. 23.8 in Week 1.'],
      ["Wan'Dale Robinson", 'WR', "Tennessee's PPR WR3."],
    ],
    sit: [
      ['Cam Ward', 'QB', 'Bench in one-QB leagues.'],
      ['Carnell Tate', 'WR', '5.8 and 4.2.'],
      ['Darnell Mooney', 'WR', 'Not in this offense.'],
      ['Titans D/ST', 'DEF', 'Even against Winston, no.'],
    ],
    watch: [
      ['Tony Pollard', 'RB', 'Questionable (ankle).'],
      ['Tyjae Spears', 'RB', 'Questionable (ankle). If one sits, the other is a flex.'],
    ],
    sleepers: [
      ['Jameis Winston', 'QB', 'Superflex. Volume is a skill.'],
      ['Michael Carter', 'RB', 'Only if Pollard and Spears both sit.'],
      ['Elic Ayomanor', 'WR', '7.6 and 7.9. Boring floor.'],
    ],
    idp: [
      ['Amani Hooker', 'DB', 'Top DB on the slate. Projected 20.3.'],
      ['Anthony Hill Jr.', 'LB', 'Projected 13.3.'],
      ['Jeffery Simmons', 'DL', '10.5 last week.'],
      ['Jevon Holland', 'DB', '19.5 last week.'],
    ],
  },
  {
    id: 'cin-pit', slot: 'early', title: 'Bengals at Steelers', when: 'Sun 1:00 ET',
    away: 'CIN', home: 'PIT', awayPts: 23, homePts: 19.5, pick: 'Cincinnati', conf: 'Solid', line: 'CIN -3.5 · O/U 42.5',
    take: 'Cincinnati is 2-0. Pittsburgh scored three points in New England last week and Aaron Rodgers managed 5.0 fantasy points. Rico Dowdle (toe) has not practiced, and Jaylen Warren (shoulder) and Michael Pittman Jr. (foot) have been limited. Dry and mid-60s.',
    start: [
      ["Ja'Marr Chase", 'WR', '23.0 last week.'],
      ['Tee Higgins', 'WR', 'WR2.'],
      ['Chase Brown', 'RB', 'RB1/2.'],
      ['Joe Burrow', 'QB', 'Low-end QB1. T.J. Watt caps the ceiling.'],
      ['Evan McPherson', 'K', '20.0 and 12.0.'],
    ],
    sit: [
      ['Aaron Rodgers', 'QB', '12.5 and 5.0.'],
      ['DK Metcalf', 'WR', '6.0 and 4.7.'],
      ['Steelers D/ST', 'DEF', 'Fine, not a priority against Burrow.'],
    ],
    watch: [
      ['Jaylen Warren', 'RB', 'Flex if Dowdle sits.'],
      ['Michael Pittman Jr.', 'WR', 'WR3 if active.'],
    ],
    sleepers: [
      ['Mike Gesicki', 'TE', '16.3 in Week 1.'],
      ['Pat Freiermuth', 'TE', 'Streamer.'],
      ['Bengals D/ST', 'DEF', 'Stream it against Rodgers.'],
    ],
    idp: [
      ['T.J. Watt', 'LB', 'Must start. Projected 23.6.'],
      ['Alex Highsmith', 'LB', 'Start.'],
      ['Payton Wilson', 'LB', 'LB2.'],
      ['Demetrius Knight Jr.', 'LB', 'LB1 on a thin room. Projected 15.4.'],
      ['Cedric Johnson', 'DL', '11.5 last week.'],
    ],
  },
  {
    id: 'lac-buf', slot: 'early', title: 'Chargers at Bills', when: 'Sun 1:00 ET',
    away: 'LAC', home: 'BUF', awayPts: 21.75, homePts: 28.75, pick: 'Buffalo', conf: 'Strong', line: 'BUF -7 · O/U 50.5',
    take: 'Buffalo is 2-0 and Josh Allen has 76.5 fantasy points in two games. The Chargers are 0-2. Ladd McConkey practiced fully through the rib. DJ Moore went from limited Wednesday to no practice Thursday. Wind is in the forecast.',
    start: [
      ['Josh Allen', 'QB', 'The overall QB1.'],
      ['James Cook III', 'RB', 'RB1.'],
      ['Dalton Kincaid', 'TE', '15.5 and 19.0.'],
      ['Khalil Shakir', 'WR', 'PPR WR3.'],
      ['Omarion Hampton', 'RB', '16.5 last week.'],
      ['Ladd McConkey', 'WR', 'Full practice. WR2.'],
      ['Justin Herbert', 'QB', 'QB1 in a 50.5 total.'],
    ],
    sit: [
      ['Keon Coleman', 'WR', 'Questionable and missing practice.'],
      ['Quentin Johnston', 'WR', 'WR4.'],
      ['Cameron Dicker', 'K', '2.0 and 2.0.'],
      ['Both D/STs', 'DEF', 'Not in a 50.5 total.'],
    ],
    watch: [['DJ Moore', 'WR', 'Questionable (shoulder). Downgraded to no practice Thursday.']],
    sleepers: [
      ['Joshua Palmer', 'WR', '9.9 and 10.8 at 3% rostered. Moves up if Moore sits.'],
      ['Oronde Gadsden', 'TE', 'Streamer in a shootout.'],
    ],
    idp: [
      ['Greg Rousseau', 'LB', 'Elite edge. 20.0 and 15.0.'],
      ['Bradley Chubb', 'LB', 'Start.'],
      ['Terrel Bernard', 'LB', 'LB2.'],
      ['Derwin James Jr.', 'DB', 'DB2.'],
      ['Cam Hart', 'DB', 'Sleeper. 11.5 last week.'],
    ],
  },
  {
    id: 'car-cle', slot: 'early', title: 'Panthers at Browns', when: 'Sun 1:00 ET',
    away: 'CAR', home: 'CLE', awayPts: 22.5, homePts: 20, pick: 'Carolina', conf: 'Lean', line: 'CAR -2.5 · O/U 42.5',
    take: 'Bryce Young is the QB2 in fantasy through two weeks, behind only Josh Allen. Cleveland traded Myles Garrett to the Rams and gave up 34 in the opener without him. Jalen Coker and Devin Lloyd are the two Friday questions.',
    start: [
      ['Bryce Young', 'QB', '31.4 and 24.1.'],
      ['Tetairoa McMillan', 'WR', 'WR2.'],
      ['Chuba Hubbard', 'RB', '22.2 and 13.4.'],
      ['Denzel Boston', 'WR', '12.9 and 18.0. The rookie is real.'],
      ['Harold Fannin Jr.', 'TE', 'TE1/2.'],
    ],
    sit: [
      ['Jerry Jeudy', 'WR', '3.6 and 0.0.'],
      ['KC Concepcion', 'WR', '5.8 and 5.2.'],
      ['Quinshon Judkins', 'RB', 'Flex only. 6.0 and 7.3.'],
      ['Browns D/ST', 'DEF', 'No.'],
    ],
    watch: [['Jalen Coker', 'WR', 'Questionable. WR2 if active: 29.8 in Week 1.']],
    sleepers: [
      ['Darren Waller', 'TE', '16.8 last week, and Xavier Legette missed practice.'],
      ['Panthers D/ST', 'DEF', 'Projected 9.0.'],
    ],
    idp: [
      ['Devin Lloyd', 'LB', 'Questionable (calf). Top-three LB if he plays: 34.0 last week.'],
      ['Carson Schwesinger', 'LB', 'LB1 with Jeremiah Owusu-Koramoah OUT and Quincy Williams questionable.'],
      ['Bobby Okereke', 'LB', '15.5 last week.'],
      ['Mason Graham', 'DL', 'DT start.'],
      ['Jackson Kuwatch', 'LB', 'Sleeper if Lloyd sits.'],
    ],
  },
  {
    id: 'nyj-det', slot: 'early', title: 'Jets at Lions', when: 'Sun 1:00 ET · Dome',
    away: 'NYJ', home: 'DET', awayPts: 21, homePts: 27.5, pick: 'Detroit', conf: 'Solid', line: 'DET -6.5 · O/U 48.5',
    take: 'Detroit is missing both starting safeties, Brian Branch and Kerby Joseph, to PUP. That is an open door for Garrett Wilson. The other side is the Lions offense, and you already know.',
    start: [
      ['Jahmyr Gibbs', 'RB', 'RB1.'],
      ['Amon-Ra St. Brown', 'WR', '23.7 and 30.7.'],
      ['Jared Goff', 'QB', '29.8 last week.'],
      ['Sam LaPorta', 'TE', 'TE1.'],
      ['Breece Hall', 'RB', 'RB1/2.'],
      ['Garrett Wilson', 'WR', 'Upside against a stripped secondary.'],
    ],
    sit: [
      ['Adonai Mitchell', 'WR', 'Questionable (finger).'],
      ['Jets D/ST', 'DEF', 'At Ford Field, no.'],
    ],
    sleepers: [
      ['Geno Smith', 'QB', 'Superflex. The Detroit secondary is thin.'],
      ['Kenyon Sadiq', 'TE', 'Mason Taylor is doubtful.'],
    ],
    idp: [
      ['Aidan Hutchinson', 'DL', 'Must start. Three sacks already.'],
      ['Derrick Barnes', 'LB', '16.5 and 10.0.'],
      ['Jack Campbell', 'LB', 'LB2.'],
      ['Jamien Sherwood', 'LB', 'LB3.'],
      ['Andre Cisco', 'DB', 'DB2.'],
    ],
  },
  {
    id: 'ari-sf', slot: 'late', title: 'Cardinals at 49ers', when: 'Sun 4:05 ET',
    away: 'ARI', home: 'SF', awayPts: 20, homePts: 28.5, pick: 'San Francisco', conf: 'Strong', line: 'SF -8.5 · O/U 48.5',
    take: 'San Francisco is 2-0 and has outscored opponents 62-20. Arizona lost James Conner and Trey Benson to IR, so rookie Jeremiyah Love carries the load. Mike Evans (hip) is questionable. McCaffrey missed Wednesday for rest, which is the plan, not a problem.',
    start: [
      ['Christian McCaffrey', 'RB', 'RB1.'],
      ['Brock Purdy', 'QB', '28.5 last week.'],
      ['George Kittle', 'TE', '16.0 last week.'],
      ['Deebo Samuel', 'WR', 'WR2/3. Moves up if Evans sits.'],
      ['Trey McBride', 'TE', '20.0 and 14.1.'],
      ['Jeremiyah Love', 'RB', 'RB2 on volume alone.'],
    ],
    sit: [
      ['Jacoby Brissett', 'QB', '6.5 last week.'],
      ['Michael Wilson', 'WR', 'WR4. 8.1 and 2.8.'],
      ['Kendrick Bourne', 'WR', 'No.'],
      ['Cardinals D/ST', 'DEF', 'No.'],
    ],
    watch: [['Mike Evans', 'WR', 'Questionable (hip). WR3 if active.']],
    sleepers: [['49ers D/ST', 'DEF', 'Arizona scored 7 in Seattle.']],
    idp: [
      ['Budda Baker', 'DB', 'DB1. Projected 16.0.'],
      ['Fred Warner', 'LB', 'LB1.'],
      ['Jack Gibbens', 'LB', 'LB2.'],
      ['Andrew Wingard', 'DB', 'DB2.'],
      ["Ji'Ayir Brown", 'DB', 'Sleeper. 9.5 last week.'],
    ],
  },
  {
    id: 'min-tb', slot: 'late', title: 'Vikings at Buccaneers', when: 'Sun 4:05 ET',
    away: 'MIN', home: 'TB', awayPts: 22, homePts: 20.5, pick: 'Minnesota', conf: 'Solid', line: 'MIN -1.5 · O/U 42.5',
    take: "Kyler Murray cleared concussion protocol and starts. Minnesota is 2-0 behind Brian Flores' blitz-heavy defense, among the league leaders in sacks, and has allowed the fourth-fewest points to running backs. Baker Mayfield is expected to play through an illness. Tampa is 0-2.",
    start: [
      ['Justin Jefferson', 'WR', 'Upgrade with Murray back.'],
      ['Vikings D/ST', 'DEF', 'Top-projected defense on the slate. 21 last week.'],
      ['T.J. Hockenson', 'TE', 'TE1/2.'],
      ['Emeka Egbuka', 'WR', 'WR2.'],
      ['Bucky Irving', 'RB', 'RB2, not RB1, this week.'],
    ],
    sit: [
      ['Baker Mayfield', 'QB', '11.6 and 12.2, into the blitz.'],
      ['Kenny Gainwell', 'RB', 'No.'],
    ],
    watch: [['Aaron Jones Sr.', 'RB', 'Questionable. Flex at best.']],
    sleepers: [
      ['Kyler Murray', 'QB', 'Superflex. The legs are the floor.'],
      ['Jalen McMillan', 'WR', 'Deep WR3.'],
    ],
    idp: [
      ['Andrew Van Ginkel', 'LB', 'Projected 20.3.'],
      ['Dallas Turner', 'LB', '13.0 and 14.0, and the pressures are real.'],
      ['Blake Cashman', 'LB', 'LB2.'],
      ['Josiah Trotter', 'LB', 'Questionable. LB1 if active.'],
      ['Alex Anzalone', 'LB', 'Sleeper if Trotter sits.'],
    ],
  },
  {
    id: 'bal-dal', slot: 'late', title: 'Ravens vs. Cowboys in Rio', when: 'Sun 4:25 ET · Maracanã, Rio de Janeiro',
    away: 'BAL', home: 'DAL', awayPts: 28.5, homePts: 25, pick: 'Baltimore', conf: 'Solid', line: 'BAL -3.5 · O/U 53.5 · Dallas is the designated home team',
    take: 'The highest total on the slate, played at the Maracanã with Dallas as the designated home team. The Cowboys defense is missing DeMarvion Overshown, Cobie Durant, Malik Hooker and P.J. Locke, all OUT. Zay Flowers (hamstring) did not practice Thursday. Start everybody.',
    start: [
      ['Lamar Jackson', 'QB', 'QB1.'],
      ['Derrick Henry', 'RB', '34.8 and 16.2.'],
      ['Dak Prescott', 'QB', '29.8 last week.'],
      ['CeeDee Lamb', 'WR', '31.3 last week.'],
      ['George Pickens', 'WR', 'Slow start, perfect game script.'],
      ['Jake Ferguson', 'TE', '18.3 last week.'],
      ['Mark Andrews', 'TE', 'TE1/2.'],
      ['Javonte Williams', 'RB', 'RB2. Baltimore is stingy against backs.'],
      ['Brandon Aubrey', 'K', 'Always.'],
    ],
    sit: [
      ['Both D/STs', 'DEF', 'Not in a 53.5 total.'],
      ['Justice Hill', 'RB', 'No.'],
    ],
    watch: [['Zay Flowers', 'WR', 'Questionable (hamstring).']],
    sleepers: [['Rashod Bateman', 'WR', '19.3 last week. WR2 if Flowers sits.']],
    idp: [
      ['Roquan Smith', 'LB', 'LB1.'],
      ['Kyle Hamilton', 'DB', 'DB1.'],
      ['Caleb Downs', 'DB', 'DB1. The other Dallas safeties are OUT.'],
      ['Dee Winters', 'LB', 'Overshown is OUT. Volume bump.'],
      ['Jaishawn Barham', 'LB', 'Sleeper.'],
    ],
  },
  {
    id: 'lv-no', slot: 'late', title: 'Raiders at Saints', when: 'Sun 4:25 ET · Dome',
    away: 'LV', home: 'NO', awayPts: 20.25, homePts: 23.25, pick: 'New Orleans, upset alert', conf: 'Lean', line: 'NO -3 · O/U 43.5',
    take: 'Las Vegas is 2-0 with a +6 sack differential and one of the best pass rushes in football. New Orleans put left tackle Kelvin Banks Jr. on IR, and his replacement allowed two pressures on 15 snaps last week. That is the whole game. Brock Bowers (knee) is questionable and has not played this season.',
    start: [
      ['Chris Olave', 'WR', '23.2 and 18.6.'],
      ['Ashton Jeanty', 'RB', 'RB1.'],
      ['Raiders D/ST', 'DEF', 'Maxx Crosby against a backup left tackle.'],
      ['Juwan Johnson', 'TE', 'TE1/2.'],
      ['Tre Tucker', 'WR', '20.4 last week.'],
      ['Tyler Shough', 'QB', 'QB1/2. 22-plus both weeks, now under pressure.'],
    ],
    sit: [
      ['Kirk Cousins', 'QB', 'Bench in one-QB leagues.'],
      ['Saints D/ST', 'DEF', 'No.'],
      ['Kendre Miller', 'RB', 'No.'],
    ],
    watch: [
      ['Brock Bowers', 'TE', 'Questionable (knee). Start him if active.'],
      ['Travis Etienne Jr.', 'RB', 'Questionable. RB2 if active, Alvin Kamara if not.'],
    ],
    sleepers: [
      ['Devaughn Vele', 'WR', 'Clear WR2, double digits in Week 1.'],
      ['Michael Mayer', 'TE', 'Only if Bowers sits.'],
    ],
    idp: [
      ['Maxx Crosby', 'DL', 'DL1 against the backup tackle.'],
      ['Nakobe Dean', 'LB', 'Projected 15.9.'],
      ['Jeremy Chinn', 'DB', 'DB1/2.'],
      ['Hezekiah Masses', 'DB', '19.5 last week.'],
      ['Chase Young', 'DL', 'Start.'],
      ['Pete Werner', 'LB', '13.5 last week.'],
    ],
  },
  {
    id: 'lar-den', slot: 'prime', title: 'Rams at Broncos', when: 'Sunday Night · 8:20 ET',
    away: 'LAR', home: 'DEN', awayPts: 23, homePts: 20.5, pick: 'Los Angeles', conf: 'Lean', line: 'LAR -2.5 · O/U 43.5',
    take: "Both teams are 1-1. Matthew Stafford bounced back from a 4.1-point opener with 27.0, and Davante Adams went for 36.5. Puka Nacua (hip) is questionable. Denver's backfield is three banged-up backs splitting work.",
    start: [
      ['Matthew Stafford', 'QB', 'QB1.'],
      ['Davante Adams', 'WR', 'WR1. 36.5 last week.'],
      ['Kyren Williams', 'RB', '14.0 and 14.7. Steady.'],
      ['Jaylen Waddle', 'WR', 'WR2. 17.8 last week.'],
    ],
    sit: [
      ['Bo Nix', 'QB', 'Bench in one-QB leagues.'],
      ['Courtland Sutton', 'WR', '3.1 and 4.0.'],
      ['Denver RBs', 'RB', 'Jonah Coleman, RJ Harvey and J.K. Dobbins: all hurt, all splitting.'],
      ['Evan Engram', 'TE', '2.2 last week.'],
    ],
    watch: [['Puka Nacua', 'WR', 'Questionable (hip). WR1 if active.']],
    sleepers: [
      ['Terrance Ferguson', 'TE', '14.4 last week. Colby Parkinson is questionable.'],
      ['Blake Corum', 'RB', 'PPR flex.'],
    ],
    idp: [
      ['Quentin Lake', 'DB', 'DB1. Projected 17.6.'],
      ['Trent McDuffie', 'DB', 'Projected 14.7.'],
      ['Byron Young', 'LB', 'Start.'],
      ['Alex Singleton', 'LB', 'LB1.'],
      ['Zach Allen', 'DL', 'DL2.'],
      ['Que Robinson', 'LB', 'Sleeper. Jonathon Cooper is OUT.'],
    ],
  },
  {
    id: 'phi-chi', slot: 'prime', title: 'Eagles at Bears', when: 'Monday Night · 8:15 ET',
    away: 'PHI', home: 'CHI', awayPts: 23, homePts: 18.5, pick: 'Philadelphia', conf: 'Solid', line: 'PHI -4.5 · O/U 41.5',
    take: 'Caleb Williams (hamstring) is doubtful and Tyson Bagent is in concussion protocol, so Case Keenum likely starts for Chicago. Philadelphia is 2-0. Dallas Goedert (MCL) is doubtful and the Eagles brought back Zach Ertz. Saquon Barkley (stinger) played 16% of the snaps last week.',
    start: [
      ['Jalen Hurts', 'QB', 'QB1.'],
      ['DeVonta Smith', 'WR', 'Questionable, but 23.7 last week.'],
      ["D'Andre Swift", 'RB', 'Kyle Monangai is questionable (knee). Volume bump.'],
      ['Eagles D/ST', 'DEF', 'Against Keenum.'],
      ['Dontayvion Wicks', 'WR', 'WR3. 14.3 and 9.9.'],
    ],
    sit: [
      ['Rome Odunze', 'WR', 'Keenum caps him.'],
      ['Luther Burden III', 'WR', 'Same.'],
      ['Colston Loveland', 'TE', '0.0 and 0.8.'],
      ['Bears D/ST', 'DEF', 'No.'],
    ],
    watch: [
      ['Saquon Barkley', 'RB', 'RB1 if full-go: Chicago allows 136 rushing yards a game. Monday night, so hold a Sunday backup.'],
      ['Caleb Williams', 'QB', 'Doubtful (hamstring).'],
    ],
    sleepers: [
      ['Zach Ertz', 'TE', 'The TE with Goedert doubtful.'],
      ['Kalif Raymond', 'WR', 'PPR slot. 12.4 in Week 1.'],
    ],
    idp: [
      ['Zack Baun', 'LB', 'LB1/2.'],
      ['Jihaad Campbell', 'LB', '11.0 and 10.0.'],
      ['Devin Bush', 'LB', 'Bears defense will be on the field.'],
      ['Keidron Smith', 'DB', 'DB2.'],
      ['Jalyx Hunt', 'LB', 'Sleeper.'],
    ],
  },
];

const SLOT = (slot) => GAMES.filter((g) => g.slot === slot).map((g) => <GameCard key={g.id} g={g} />);

const Body = () => (
  <>
    <HeroBanner />

    <Lead>
      Two weeks of evidence is not a lot, but it is enough to stop pretending. Three starting
      quarterbacks are out or doubtful, a Brazilian stadium is hosting the highest total of the week, and
      somewhere a Chiefs running back is about to eat Miami alive. Fifteen games. Every call.
    </Lead>
    <P>
      Scoring is PPR. Projections are Endzone Forecast; IDP projections use tackle-heavy IDP scoring.
      Lines and implied points are Friday afternoon numbers. Injury tags are as of Friday&apos;s
      reports, and anything tagged questionable gets decided at the 90-minute inactives. Each card
      gives you the pick, the Start and Sit calls, who to watch, sleepers, and the IDP plays.
    </P>

    <JumpGrid />

    <H2>The Slate at a Glance</H2>
    <P>
      Implied points are the betting market&apos;s guess at each team&apos;s score. Filled bars are
      favorites. Buffalo, San Francisco, Baltimore, Kansas City and Detroit sit at 27.5 or better.
      Tennessee, Washington and Miami are all below 18.5, and that is where you find your D/ST.
    </P>
    <ImpliedChart />

    <H2>Sunday Early Window</H2>
    {SLOT('early')}

    <H2>Sunday Late Window</H2>
    {SLOT('late')}

    <H2>Primetime</H2>
    {SLOT('prime')}

    <H2>The Boards</H2>
    <P>
      <strong>Best matchups on the slate.</strong> Kenneth Walker III against Miami, Jonathan Taylor
      against the worst defense in football, Josh Allen at home in a 50.5 total, Jahmyr Gibbs, Derrick
      Henry against a gutted Dallas defense, Garrett Wilson against Detroit&apos;s backup safeties,
      and Dalton Schultz as Houston&apos;s whole passing game.
    </P>

    <Table aria-label="D/ST streaming board">
      <THead>
        <TR><TH scope="col">#</TH><TH scope="col">D/ST</TH><TH scope="col">Opponent</TH><TH scope="col">Why</TH></TR>
      </THead>
      <TBody>
        <TR><TD>1</TD><TD><strong>Vikings</strong></TD><TD>at TB</TD><TD>Top projection on the slate, 21 points last week, blitzes more than anyone.</TD></TR>
        <TR><TD>2</TD><TD><strong>Seahawks</strong></TD><TD>at WSH</TD><TD>Mariota, 16.5 implied, and an elite unit.</TD></TR>
        <TR><TD>3</TD><TD><strong>Chiefs</strong></TD><TD>at MIA</TD><TD>Willis takes sacks, and Miami is at 17.5 implied.</TD></TR>
        <TR><TD>4</TD><TD><strong>Raiders</strong></TD><TD>at NO</TD><TD>An elite pass rush against a backup left tackle.</TD></TR>
        <TR><TD>5</TD><TD><strong>Panthers</strong></TD><TD>at CLE</TD><TD>Projected 9.0. Scored 29 last week.</TD></TR>
        <TR><TD>6</TD><TD><strong>Eagles</strong></TD><TD>at CHI</TD><TD>Case Keenum, most likely.</TD></TR>
        <TR><TD>7</TD><TD><strong>Jaguars</strong></TD><TD>vs NE</TD><TD>Four Maye interceptions in two games.</TD></TR>
        <TR><TD>8</TD><TD><strong>Bengals</strong></TD><TD>at PIT</TD><TD>Rodgers scored 5.0 last week.</TD></TR>
      </TBody>
    </Table>

    <Table aria-label="Top IDP plays">
      <THead>
        <TR><TH scope="col">#</TH><TH scope="col">Player</TH><TH scope="col">Pos</TH><TH scope="col">Team</TH><TH scope="col">Proj</TH><TH scope="col">Why</TH></TR>
      </THead>
      <TBody>
        <TR><TD>1</TD><TD><strong>T.J. Watt</strong></TD><TD>LB</TD><TD>PIT</TD><TD>23.6</TD><TD>26.0 in Week 1. The best IDP asset in the game.</TD></TR>
        <TR><TD>2</TD><TD><strong>Andrew Van Ginkel</strong></TD><TD>LB</TD><TD>MIN</TD><TD>20.3</TD><TD>Flores sends him constantly.</TD></TR>
        <TR><TD>3</TD><TD><strong>Amani Hooker</strong></TD><TD>DB</TD><TD>TEN</TD><TD>20.3</TD><TD>Tackle machine in a low total.</TD></TR>
        <TR><TD>4</TD><TD><strong>Aidan Hutchinson</strong></TD><TD>DL</TD><TD>DET</TD><TD>19.7</TD><TD>Three sacks already.</TD></TR>
        <TR><TD>5</TD><TD><strong>Greg Rousseau</strong></TD><TD>LB</TD><TD>BUF</TD><TD>18.6</TD><TD>20.0 and 15.0.</TD></TR>
        <TR><TD>6</TD><TD><strong>Quentin Lake</strong></TD><TD>DB</TD><TD>LAR</TD><TD>17.6</TD><TD>17.5 and 11.5.</TD></TR>
        <TR><TD>7</TD><TD><strong>Budda Baker</strong></TD><TD>DB</TD><TD>ARI</TD><TD>16.0</TD><TD>Arizona will be chasing all day.</TD></TR>
        <TR><TD>8</TD><TD><strong>Nakobe Dean</strong></TD><TD>LB</TD><TD>LV</TD><TD>15.9</TD><TD>11.5 and 13.5.</TD></TR>
        <TR><TD>9</TD><TD><strong>Demetrius Knight Jr.</strong></TD><TD>LB</TD><TD>CIN</TD><TD>15.4</TD><TD>LB1 on a thin room.</TD></TR>
        <TR><TD>10</TD><TD><strong>Caleb Downs</strong></TD><TD>DB</TD><TD>DAL</TD><TD>13.3</TD><TD>Malik Hooker and P.J. Locke are OUT.</TD></TR>
        <TR><TD>11</TD><TD><strong>Carson Schwesinger</strong></TD><TD>LB</TD><TD>CLE</TD><TD>12.3</TD><TD>Owusu-Koramoah OUT, Quincy Williams questionable.</TD></TR>
        <TR><TD>12</TD><TD><strong>Jordyn Brooks</strong></TD><TD>LB</TD><TD>MIA</TD><TD>11.4</TD><TD>Projection undersells a defense that will not get off the field.</TD></TR>
      </TBody>
    </Table>

    <Table aria-label="Deep sleepers">
      <THead>
        <TR><TH scope="col">Player</TH><TH scope="col">Pos</TH><TH scope="col">Team</TH><TH scope="col">The case</TH></TR>
      </THead>
      <TBody>
        <TR><TD><strong>Joshua Palmer</strong></TD><TD>WR</TD><TD>BUF</TD><TD>9.9 and 10.8 at 3% rostered. DJ Moore is trending the wrong way.</TD></TR>
        <TR><TD><strong>Rashod Bateman</strong></TD><TD>WR</TD><TD>BAL</TD><TD>19.3 last week in the highest total of the week.</TD></TR>
        <TR><TD><strong>Kenyon Sadiq</strong></TD><TD>TE</TD><TD>NYJ</TD><TD>Mason Taylor is doubtful.</TD></TR>
        <TR><TD><strong>Zach Ertz</strong></TD><TD>TE</TD><TD>PHI</TD><TD>Dallas Goedert is doubtful.</TD></TR>
        <TR><TD><strong>Emanuel Wilson</strong></TD><TD>RB</TD><TD>SEA</TD><TD>Charbonnet OUT, Price questionable.</TD></TR>
        <TR><TD><strong>Michael Carter</strong></TD><TD>RB</TD><TD>TEN</TD><TD>Only if both Pollard and Spears sit.</TD></TR>
        <TR><TD><strong>Darren Waller</strong></TD><TD>TE</TD><TD>CAR</TD><TD>16.8 last week, boom or bust.</TD></TR>
        <TR><TD><strong>Sonny Styles</strong></TD><TD>LB</TD><TD>WSH</TD><TD>IDP. Luvu is trending out.</TD></TR>
        <TR><TD><strong>Elijah Ponder</strong></TD><TD>LB</TD><TD>NE</TD><TD>IDP. 19.0 last week.</TD></TR>
        <TR><TD><strong>Que Robinson</strong></TD><TD>LB</TD><TD>DEN</TD><TD>IDP. Jonathon Cooper is OUT.</TD></TR>
      </TBody>
    </Table>

    <H2>Inactives Checklist</H2>
    <P>
      Every name below is a Friday question. Inactives drop 90 minutes before kickoff. Set your
      pivots now so you are not scrambling at 11:30 ET.
    </P>
    <Table aria-label="Inactives checklist">
      <THead>
        <TR><TH scope="col">Player</TH><TH scope="col">Status</TH><TH scope="col">If he sits</TH></TR>
      </THead>
      <TBody>
        <TR><TD><strong>Nico Collins</strong> (HOU)</TD><TD>Q, hamstring</TD><TD>Dalton Schultz is the passing game.</TD></TR>
        <TR><TD><strong>DJ Moore</strong> (BUF)</TD><TD>Q, shoulder</TD><TD>Joshua Palmer.</TD></TR>
        <TR><TD><strong>Jalen Coker</strong> (CAR)</TD><TD>Q</TD><TD>Tetairoa McMillan and Darren Waller get the targets.</TD></TR>
        <TR><TD><strong>Tony Pollard / Tyjae Spears</strong> (TEN)</TD><TD>Q, ankles</TD><TD>The one who plays is a flex. Both out: Michael Carter.</TD></TR>
        <TR><TD><strong>Frankie Luvu</strong> (WSH)</TD><TD>Q, trending out</TD><TD>Sonny Styles in IDP.</TD></TR>
        <TR><TD><strong>Devin Lloyd</strong> (CAR)</TD><TD>Q, calf</TD><TD>Jackson Kuwatch and a Bobby Okereke bump.</TD></TR>
        <TR><TD><strong>Mike Evans</strong> (SF)</TD><TD>Q, hip</TD><TD>Deebo Samuel moves up.</TD></TR>
        <TR><TD><strong>Josiah Trotter</strong> (TB)</TD><TD>Q</TD><TD>Alex Anzalone in IDP.</TD></TR>
        <TR><TD><strong>Zay Flowers</strong> (BAL)</TD><TD>Q, hamstring</TD><TD>Rashod Bateman.</TD></TR>
        <TR><TD><strong>Brock Bowers</strong> (LV)</TD><TD>Q, knee</TD><TD>Michael Mayer.</TD></TR>
        <TR><TD><strong>Travis Etienne Jr.</strong> (NO)</TD><TD>Q</TD><TD>Alvin Kamara.</TD></TR>
        <TR><TD><strong>Puka Nacua</strong> (LAR)</TD><TD>Q, hip</TD><TD>Davante Adams soaks up the targets.</TD></TR>
        <TR><TD><strong>Saquon Barkley</strong> (PHI)</TD><TD>Q, stinger</TD><TD>Monday night. Start a Sunday back if you cannot risk a zero.</TD></TR>
        <TR><TD><strong>Caleb Williams</strong> (CHI)</TD><TD>D, hamstring</TD><TD>Case Keenum. Downgrade every Bears receiver.</TD></TR>
      </TBody>
    </Table>

    <Quote>
      Start your studs, stream the defense facing a backup, and set your pivots before you go to bed
      Saturday. See you on the other side of Monday night.
    </Quote>
  </>
);

export default Body;
