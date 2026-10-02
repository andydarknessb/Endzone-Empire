import React from 'react';
import { Box } from '@mui/material';
import {
  Lead, P, H2, H3, Quote,
} from '../../components/public/kit/Prose';

// Body only: the frontmatter lives in week4-start-sit-darkness-report.meta.js so listings can be
// built without loading this prose; content/articles/index.js loads it on demand.
//
// Every color below the hero is a theme token, so the board, cards and chips read in light and
// dark. The hero is a dark illustration in both themes, like the Week 3 start/sit banner.
//
// Reading key (also printed in the article): usage lines read wk1/wk2/wk3. c = carries,
// t = targets, pa = pass attempts. FPA rank: 1 = most points allowed (good matchup for the
// opposing position), 32 = fewest (tough). Weeks 1 to 3 only.

const POS_COLOR = {
  QB: 'var(--pos-qb)', RB: 'var(--pos-rb)', WR: 'var(--pos-wr)', TE: 'var(--pos-te)',
  DEF: 'var(--pos-def)', CB: 'var(--pos-idp)', S: 'var(--pos-idp)', LB: 'var(--pos-idp)', DL: 'var(--pos-idp)',
};
// 'CB/DT' takes the color of its first position.
const posColor = (pos) => POS_COLOR[String(pos).split('/')[0]] || 'var(--text-muted)';

const TONE = {
  start: { label: 'Start', color: 'var(--success)' },
  flex: { label: 'Flex', color: 'var(--accent)' },
  sit: { label: 'Sit', color: 'var(--danger)' },
  watch: { label: 'Game-time decisions', color: 'var(--warning)' },
};

function HeroBanner() {
  // Yard lines and hash marks in perspective: each line sits at a depth, hash ticks scale with it.
  const depths = [0.12, 0.26, 0.42, 0.6, 0.8, 1];
  return (
    <Box
      component="svg"
      viewBox="0 0 800 300"
      xmlns="http://www.w3.org/2000/svg"
      sx={{ width: '100%', borderRadius: 'var(--radius-md, 10px)', overflow: 'hidden', mb: 4, display: 'block' }}
      role="img"
      aria-labelledby="wk4ss-hero-title wk4ss-hero-desc"
    >
      <title id="wk4ss-hero-title">Week 4 Start/Sit: The Darkness Report</title>
      <desc id="wk4ss-hero-desc">
        A night football field in perspective, with yard lines, hash marks and goalposts under a
        floodlight, and a glowing football arcing across the sky over the headline Week 4 Start/Sit.
      </desc>
      <defs>
        <linearGradient id="wk4ss-sky" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#060910" />
          <stop offset="0.55" stopColor="#0c1424" />
          <stop offset="1" stopColor="#1a0f24" />
        </linearGradient>
        <radialGradient id="wk4ss-flood" cx="0.5" cy="0.1" r="0.85">
          <stop offset="0" stopColor="#7eaaff" stopOpacity="0.34" />
          <stop offset="1" stopColor="#7eaaff" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="wk4ss-turf" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#0f3a2a" />
          <stop offset="1" stopColor="#06180f" />
        </linearGradient>
        <linearGradient id="wk4ss-trail" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#2fd97b" stopOpacity="0" />
          <stop offset="1" stopColor="#ffd866" stopOpacity="0.95" />
        </linearGradient>
      </defs>
      <rect width="800" height="300" fill="url(#wk4ss-sky)" />
      <rect width="800" height="300" fill="url(#wk4ss-flood)" />
      <rect x="0" y="150" width="800" height="150" fill="url(#wk4ss-turf)" />
      <line x1="0" y1="150" x2="800" y2="150" stroke="rgba(126,170,255,0.35)" />
      {Array.from({ length: 9 }, (_, i) => (
        <line key={`sl${i}`} x1={400 + (i - 4) * 38} y1="150" x2={400 + (i - 4) * 150} y2="300" stroke="rgba(255,255,255,0.07)" />
      ))}
      {depths.map((d, i) => {
        const y = 150 + d * d * 150;
        const half = 40 + d * 360;
        const tick = 2 + d * 6;
        return (
          <g key={`yd${i}`}>
            <line x1={400 - half * 1.9} y1={y} x2={400 + half * 1.9} y2={y} stroke="rgba(255,255,255,0.16)" />
            {[-0.42, -0.34, 0.34, 0.42].map((k) => (
              <line key={k} x1={400 + half * k * 2} y1={y - tick} x2={400 + half * k * 2} y2={y + tick} stroke="rgba(255,255,255,0.4)" strokeWidth="1.5" />
            ))}
          </g>
        );
      })}
      <g stroke="#ffd866" strokeWidth="3" strokeLinecap="round" fill="none" opacity="0.95">
        <path d="M686 150 L686 118 M662 82 L662 118 L710 118 L710 82" />
      </g>
      <g stroke="#ffd866" strokeWidth="3" strokeLinecap="round" fill="none" opacity="0.5">
        <path d="M96 150 L96 126 M80 98 L80 126 L112 126 L112 98" />
      </g>
      <path d="M96 236 C 190 24, 420 -6, 520 96" fill="none" stroke="url(#wk4ss-trail)" strokeWidth="3" strokeLinecap="round" strokeDasharray="2 9" />
      <g transform="translate(530 104) rotate(32)">
        <ellipse rx="44" ry="25" fill="#ffd866" opacity="0.12" />
        <ellipse rx="34" ry="19" fill="#6b3416" stroke="#ff8c42" strokeWidth="2" />
        <path d="M-13 -19 Q-18 0 -13 19 M13 -19 Q18 0 13 19" fill="none" stroke="#ffffff" strokeWidth="2" opacity="0.8" />
        <line x1="-10" y1="0" x2="10" y2="0" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" />
        {[-6, 0, 6].map((x) => (
          <line key={x} x1={x} y1="-4" x2={x} y2="4" stroke="#ffffff" strokeWidth="1.6" strokeLinecap="round" />
        ))}
      </g>
      <text x="400" y="34" textAnchor="middle" fill="#8badc9" fontFamily="system-ui, sans-serif" fontWeight="700" fontSize="12" letterSpacing="4">THE DARKNESS REPORT</text>
      <rect x="110" y="212" width="580" height="72" rx="14" fill="rgba(3,8,20,0.84)" stroke="rgba(126,170,255,0.25)" />
      <text x="400" y="244" textAnchor="middle" fill="#ffffff" fontFamily="system-ui, sans-serif" fontWeight="850" fontSize="24" letterSpacing="1">WEEK 4 START / SIT</text>
      <text x="400" y="268" textAnchor="middle" fill="#8badc9" fontFamily="system-ui, sans-serif" fontWeight="600" fontSize="12" letterSpacing="2">WEEK 4 | SUNDAY + MONDAY | 15 GAMES</text>
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

const Chip = ({ children, tone = 'var(--text-muted)', soft }) => (
  <Box
    component="span"
    sx={{
      display: 'inline-block', px: 1.1, py: 0.2, borderRadius: 'var(--radius-pill, 999px)',
      bgcolor: soft ? 'var(--accent-soft)' : 'var(--surface-sunken)', color: tone, fontWeight: 800,
      fontSize: '0.75rem', letterSpacing: '0.03em',
    }}
  >
    {children}
  </Box>
);

// A callout the reader should not miss: the lines-as-of note and the legend.
const Note = ({ title, tone = 'var(--warning)', children }) => (
  <Box
    role="note"
    sx={{
      my: 3, p: 2, borderRadius: 'var(--radius-md, 10px)', bgcolor: 'var(--surface-raised)',
      border: '1px solid var(--border-subtle)', borderLeft: '5px solid', borderLeftColor: tone,
      fontSize: '0.97rem', lineHeight: 1.6,
    }}
  >
    <Box sx={{ fontSize: '0.72rem', fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase', color: tone, mb: 0.5 }}>{title}</Box>
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

// 'smash' draws a badge; 'C4' links to the matching Darkness Ruling.
function Flag({ flag }) {
  if (flag === 'smash') {
    return <Box component="span" sx={{ ml: 0.75, px: 0.75, borderRadius: '4px', bgcolor: 'var(--pos-k)', color: 'var(--text-inverse)', fontSize: '0.65rem', fontWeight: 900, letterSpacing: '0.08em', verticalAlign: 'middle' }}>SMASH</Box>;
  }
  if (/^C\d+$/.test(flag || '')) {
    return (
      <Box component="a" href={`#ruling-${flag.toLowerCase()}`} sx={{ ml: 0.75, fontSize: '0.72rem', fontWeight: 800, whiteSpace: 'nowrap' }}>
        Ruling {flag}
      </Box>
    );
  }
  return null;
}

// Items are [name, position, why, rank, flag].
function CallList({ tone, items }) {
  if (!items || !items.length) return null;
  const { label, color } = TONE[tone];
  return (
    <Box sx={{ mt: 2.25 }}>
      <Box sx={{ fontSize: '0.72rem', fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase', color, mb: 0.75 }}>
        {label}
      </Box>
      <Box component="ul" sx={{ listStyle: 'none', p: '0 !important', m: '0 !important', display: 'grid', gap: 0.75 }}>
        {items.map(([name, pos, why, rank, flag]) => (
          <Box
            component="li"
            key={name}
            sx={{ m: '0 !important', pl: 1.25, py: 0.4, borderLeft: '3px solid', borderColor: color, fontSize: '0.95rem', lineHeight: 1.5, overflowWrap: 'anywhere' }}
          >
            <Pill color={posColor(pos)}>{pos}</Pill>
            <strong>{name}</strong>
            {rank ? <Box component="span" sx={{ ml: 0.75, fontSize: '0.78rem', fontWeight: 800, color: 'var(--text-muted)' }}>{rank}</Box> : null}
            <Flag flag={flag} />
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
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mt: 1.25, alignItems: 'center' }}>
        <Chip soft tone="var(--accent)">{g.line}</Chip>
        <Chip>O/U {g.total}</Chip>
        {g.weather ? <Chip tone={g.rain ? 'var(--warning)' : 'var(--text-muted)'}>{g.weather}</Chip> : null}
      </Box>
      <SplitBar away={g.away} home={g.home} awayPts={g.awayPts} homePts={g.homePts} />
      <Box component="p" sx={{ mt: '16px !important', mb: '0 !important' }}>{g.read}</Box>
      <Box component="p" sx={{ mt: '8px !important', mb: '0 !important', fontSize: '0.8rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
        Matchups (FPA rank, 1 = most allowed): {g.fpa}
      </Box>
      <CallList tone="start" items={g.start} />
      <CallList tone="flex" items={g.flex} />
      <CallList tone="watch" items={g.watch} />
      <CallList tone="sit" items={g.sit} />
      {g.also ? (
        <Box component="p" sx={{ mt: '14px !important', mb: '0 !important', fontSize: '0.85rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
          <strong>Also sit:</strong> {g.also}
        </Box>
      ) : null}
    </Box>
  );
}

// Every game on one board: kickoff, line, total, weather, and both implied totals as bars on a
// shared scale (filled accent is the favorite).
function SlateBoard() {
  const max = 28;
  return (
    <Box sx={{ my: 3, display: 'grid', gap: 1.5, gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' } }}>
      {GAMES.map((g) => (
        <Box
          key={g.id}
          sx={{ p: 1.5, borderRadius: 'var(--radius-md, 10px)', bgcolor: 'var(--surface-raised)', border: '1px solid var(--border-subtle)', minWidth: 0 }}
        >
          <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', justifyContent: 'space-between', columnGap: 1 }}>
            <Box component="a" href={`#g-${g.id}`} sx={{ fontWeight: 800, fontSize: '0.95rem', color: 'var(--text-primary) !important', textDecoration: 'none !important' }}>
              {g.away} @ {g.home}
            </Box>
            <Box sx={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-muted)' }}>{g.kick} CT</Box>
          </Box>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, my: 0.9 }}>
            <Chip soft tone="var(--accent)">{g.line}</Chip>
            <Chip>O/U {g.total}</Chip>
            {g.weather ? <Chip tone={g.rain ? 'var(--warning)' : 'var(--text-muted)'}>{g.weather}</Chip> : null}
          </Box>
          <Box
            role="img"
            aria-label={`Implied points: ${g.away} ${g.awayPts}, ${g.home} ${g.homePts}`}
            sx={{ display: 'grid', rowGap: 0.5 }}
          >
            {[[g.away, g.awayPts, g.awayPts > g.homePts], [g.home, g.homePts, g.homePts > g.awayPts]].map(([team, pts, fav]) => (
              <Box key={team} aria-hidden="true" sx={{ display: 'grid', gridTemplateColumns: '2.8em 1fr 3.4em', alignItems: 'center', gap: 1, fontSize: '0.82rem' }}>
                <Box component="span" sx={{ fontWeight: 800 }}>{team}</Box>
                <Box sx={{ height: 10, borderRadius: 'var(--radius-pill, 999px)', bgcolor: 'var(--surface-sunken)', overflow: 'hidden' }}>
                  <Box sx={{ width: `${(pts / max) * 100}%`, height: '100%', bgcolor: fav ? 'var(--accent)' : 'var(--border-strong)' }} />
                </Box>
                <Box component="span" sx={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--text-muted)' }}>{pts}</Box>
              </Box>
            ))}
          </Box>
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

const INJ_TONE = {
  out: { label: 'OUT', color: 'var(--danger)' },
  default: { label: 'TREAT AS OUT', color: 'var(--danger)' },
  gtd: { label: 'GAME-TIME', color: 'var(--warning)' },
  likely: { label: 'LIKELY IN', color: 'var(--success)' },
  sit: { label: 'SIT EITHER WAY', color: 'var(--text-muted)' },
};

// Rows are [name, position, team, status, pivot, tone, ruling].
function InjuryGroup({ title, when, rows }) {
  return (
    <Box sx={{ my: 3 }}>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1, mb: 1 }}>
        <Box component="h3" sx={{ m: '0 !important', fontSize: '1.15rem !important' }}>{title}</Box>
        {when ? <Chip tone="var(--accent)">{when}</Chip> : null}
      </Box>
      <Box sx={{ display: 'grid', gap: 1 }}>
        {rows.map(([name, pos, team, status, pivot, tone, ruling]) => {
          const t = INJ_TONE[tone];
          return (
            <Box
              key={name}
              sx={{
                p: 1.25, borderRadius: 'var(--radius-md, 10px)', bgcolor: 'var(--surface-raised)', border: '1px solid var(--border-subtle)',
                borderLeft: '4px solid', borderLeftColor: t.color, minWidth: 0, overflowWrap: 'anywhere',
              }}
            >
              <Box sx={{ lineHeight: 1.5 }}>
                <Pill color={t.color}>{t.label}</Pill>
                <strong>{name}</strong>
                <Box component="span" sx={{ ml: 0.75, fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{pos}, {team}</Box>
                <Flag flag={ruling} />
              </Box>
              <Box sx={{ fontSize: '0.88rem', color: 'var(--text-muted)', mt: 0.4, lineHeight: 1.5 }}>{status}</Box>
              <Box sx={{ fontSize: '0.92rem', mt: 0.4, lineHeight: 1.5 }}><strong>Pivot:</strong> {pivot}</Box>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}

// One position board in SMASH / START / FLEX bands. Rows are [rank, name, team, proj, note].
const BANDS = [
  { key: 'smash', label: 'SMASH', color: 'var(--pos-k)' },
  { key: 'start', label: 'START', color: 'var(--success)' },
  { key: 'flex', label: 'FLEX', color: 'var(--accent)' },
];
function TierBoard({ pos, rows, smashMax, startMax, projLabel = 'Proj', next }) {
  const bandOf = (rk) => (rk <= smashMax ? 'smash' : rk <= startMax ? 'start' : 'flex');
  return (
    <Box sx={{ my: 3 }}>
      {BANDS.map((b) => {
        const inBand = rows.filter((r) => bandOf(r[0]) === b.key);
        if (!inBand.length) return null;
        return (
          <Box key={b.key} sx={{ mb: 1.75, borderLeft: '4px solid', borderLeftColor: b.color, pl: 1.5 }}>
            <Box sx={{ fontSize: '0.72rem', fontWeight: 900, letterSpacing: '0.12em', color: b.color, mb: 0.25 }}>
              {b.label} &middot; {pos} {inBand[0][0]}{inBand.length > 1 ? `-${inBand[inBand.length - 1][0]}` : ''}
            </Box>
            {inBand.map(([rk, name, team, proj, note]) => (
              <Box key={`${rk}-${name}`} sx={{ display: 'grid', gridTemplateColumns: '1.9em 1fr auto', columnGap: 1, alignItems: 'baseline', py: 0.5, borderBottom: '1px solid var(--border-subtle)', fontSize: '0.92rem', lineHeight: 1.4 }}>
                <Box component="span" sx={{ fontWeight: 900, color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>{rk}</Box>
                <Box sx={{ minWidth: 0, overflowWrap: 'anywhere' }}>
                  <strong>{name}</strong> <Box component="span" sx={{ color: 'var(--text-muted)', fontSize: '0.8rem', fontWeight: 700 }}>{team}</Box>
                  {note ? <Box sx={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{note}</Box> : null}
                </Box>
                <Box component="span" sx={{ fontVariantNumeric: 'tabular-nums', color: 'var(--text-muted)', fontSize: '0.85rem', textAlign: 'right' }}>
                  <Box component="span" sx={{ fontSize: '0.65rem', display: 'block', letterSpacing: '0.06em' }}>{projLabel}</Box>
                  {proj}
                </Box>
              </Box>
            ))}
          </Box>
        );
      })}
      {next ? (
        <Box component="p" sx={{ mt: '8px !important', mb: '0 !important', fontSize: '0.9rem', lineHeight: 1.55 }}>
          <strong>Next and unranked:</strong> <Box component="span" sx={{ color: 'var(--text-muted)' }}>{next}</Box>
        </Box>
      ) : null}
    </Box>
  );
}

const CONF = { 'Medium-low': 1, Medium: 2, 'Medium-high': 3, High: 4 };
function Confidence({ level }) {
  return (
    <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.4 }}>
      {[1, 2, 3, 4].map((i) => (
        <Box key={i} component="span" aria-hidden="true" sx={{ width: 7, height: 14, borderRadius: '2px', bgcolor: i <= CONF[level] ? 'var(--accent)' : 'var(--border-subtle)' }} />
      ))}
      <Box component="span" sx={{ ml: 0.5, fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)' }}>{level}</Box>
    </Box>
  );
}

// Rulings are [id, title, ruling, confidence, rule].
function RulingCard({ r: [id, title, ruling, conf, rule] }) {
  return (
    <Box
      id={`ruling-${id.toLowerCase()}`}
      sx={{ my: 2, p: { xs: 1.75, sm: 2.5 }, borderRadius: 'var(--radius-md, 10px)', bgcolor: 'var(--surface-raised)', border: '1px solid var(--border-subtle)', scrollMarginTop: 92 }}
    >
      <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', justifyContent: 'space-between', columnGap: 2, rowGap: 0.5 }}>
        <Box sx={{ fontWeight: 800, fontSize: '1.02rem' }}>
          <Box component="span" sx={{ color: 'var(--accent)', mr: 1 }}>{id}</Box>{title}
        </Box>
        <Confidence level={conf} />
      </Box>
      <Box sx={{ mt: 1, pl: 1.25, borderLeft: '3px solid var(--accent)', fontSize: '0.95rem', lineHeight: 1.55 }}>
        <Box component="span" sx={{ fontSize: '0.72rem', fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--accent)', display: 'block' }}>Ruling</Box>
        {ruling}
      </Box>
      {rule ? (
        <Box sx={{ mt: 1, pl: 1.25, borderLeft: '3px solid var(--border-strong)', fontSize: '0.92rem', lineHeight: 1.55, color: 'var(--text-muted)' }}>
          <Box component="span" sx={{ fontSize: '0.72rem', fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase', display: 'block' }}>Decision rule</Box>
          {rule}
        </Box>
      ) : null}
    </Box>
  );
}

// Plain labelled list: [lead, text] rows with a colored rail.
function RailList({ items, color = 'var(--accent)' }) {
  return (
    <Box component="ul" sx={{ listStyle: 'none', p: '0 !important', m: '16px 0 !important', display: 'grid', gap: 0.9 }}>
      {items.map(([lead, text, pos]) => (
        <Box
          component="li"
          key={lead}
          sx={{ m: '0 !important', pl: 1.25, py: 0.3, borderLeft: '3px solid', borderColor: color, fontSize: '0.95rem', lineHeight: 1.55, overflowWrap: 'anywhere' }}
        >
          {pos ? <Pill color={posColor(pos)}>{pos}</Pill> : null}
          <strong>{lead}</strong>
          <Box component="span" sx={{ color: 'var(--text-muted)' }}> &middot; {text}</Box>
        </Box>
      ))}
    </Box>
  );
}

// One inactive window: [who, what to do] rows with an open box to tick.
function WindowChecklist({ title, time, rows }) {
  return (
    <Box sx={{ my: 3, p: { xs: 1.75, sm: 2.5 }, borderRadius: 'var(--radius-md, 10px)', bgcolor: 'var(--surface-raised)', border: '1px solid var(--border-subtle)' }}>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1, mb: 1 }}>
        <Box component="h3" sx={{ m: '0 !important', fontSize: '1.15rem !important' }}>{title}</Box>
        <Chip tone="var(--accent)">{time}</Chip>
      </Box>
      <Box component="ul" sx={{ listStyle: 'none', p: '0 !important', m: '0 !important', display: 'grid', gap: 0.9 }}>
        {rows.map(([who, what]) => (
          <Box component="li" key={who} sx={{ m: '0 !important', display: 'grid', gridTemplateColumns: '1.1rem 1fr', columnGap: 1.25, fontSize: '0.93rem', lineHeight: 1.5 }}>
            <Box aria-hidden="true" sx={{ width: '0.9rem', height: '0.9rem', mt: '0.3em', borderRadius: '3px', border: '2px solid var(--border-strong)' }} />
            <Box sx={{ overflowWrap: 'anywhere' }}><strong>{who}</strong> <Box component="span" sx={{ color: 'var(--text-muted)' }}>{what}</Box></Box>
          </Box>
        ))}
      </Box>
    </Box>
  );
}

// Items are [name, position, why, rank, flag]. flag is 'smash' or a Darkness Ruling id (C4).
// Usage lines read wk1/wk2/wk3. Games are in kickoff order.
const GAMES = [
  {
    id: 'ind-wsh', slot: 'early', title: 'Colts at Commanders', kick: 'Sun 8:30a', when: 'Sun 8:30a CT · London',
    away: 'IND', home: 'WSH', awayPts: 26, homePts: 22.5, line: 'IND -3.5', total: 48.5, weather: null,
    read: 'Washington allows the most points in the league to wide receivers (rank 1), the second most to quarterbacks and the fewest to running backs (rank 32). Air for Indy, volume for Taylor, and a Washington quarterback nobody can see yet. London kicks first, so there is no pivot cover: check the 7:00a CT inactives.',
    fpa: 'IND offense vs WSH D: QB 2, RB 32, WR 1, TE 2 · WSH offense vs IND D: QB 5, RB 4, WR 12, TE 10',
    start: [
      ['Jonathan Taylor', 'RB', 'c19/24/23, 94% then 85% snaps, proj 19.2. WSH is rank 32 against backs, so volume is the floor, not the ceiling.', 'RB5', 'smash'],
      ['Tyler Warren', 'TE', 't5/7/10, 89-94% snaps, proj 11.6, WSH TE rank 2.', 'TE6'],
      ['Stefon Diggs', 'WR', 't9/6/7, 13.5/19.2/5.3, proj 13.0, IND WR rank 12.', 'WR17'],
      ['Terry McLaurin', 'WR', 'WR3. t4/9/9, 16.7 in wk3, proj 10.9, 75% snaps.', 'WR21'],
    ],
    flex: [
      ['Croskey-Merritt', 'RB', 'c16/12/19, 37-57% snaps, proj 8.1, IND RB rank 4. Low-end RB2 if White is out at 7:00a CT.', 'RB24', 'C18'],
      ['Josh Downs', 'WR', 't4/9/11, 83% then 68% snaps, proj 10.1, WSH WR rank 1. PPR WR3, sit in standard.', 'WR26'],
      ['Keenan Allen', 'WR', 't6/5/9, 15.3 in wk3, proj 9.9, groin, LP Thursday (Q). Rank 1 matchup; confirm he is active.'],
      ['Jayden Daniels', 'QB', 'Flex or streamer if active, not a start: 17.7/14.7, c5/7 rushing, proj 16.2 (low quality), elbow dislocation in a brace. Superflex START.', 'QB13-16', 'C1'],
      ['Marcus Mariota', 'QB', 'If Daniels sits. Real data, not a placeholder: 8.74 on 16 attempts in wk2, 20.42 on 31 attempts and 5 carries in wk3, 100% snaps, proj 13.67. Superflex START, 1QB streamer only.', 'QB15-16', 'C1'],
      ['Daniel Jones', 'QB', 'Streamer only: 9.0/11.4/7.9 on 31/31/36 attempts, proj 13.6 (low quality). Superflex START.'],
    ],
    watch: [
      ['Jayden Daniels', 'QB', 'Quinn decides "by Friday"; clarity may not come until late Saturday or early Sunday. Check 7:00a CT inactives for Daniels and Mariota both.', null, 'C1'],
      ['Mo Alie-Cox', 'TE', 'Illness, DNP Thursday. Warren soaks up the work.'],
    ],
    sit: [
      ['Rachaad White', 'RB', 'OUT. DNP/DNP.', 'OUT', 'C18'],
      ['Ekeler', 'RB', 'Signed Sep 28-29, proj 7.28 (low). Deep-PPR dart at most.'],
      ['IND D/ST', 'DEF', 'Proj 3.4.'],
      ['WSH D/ST', 'DEF', 'Proj 4.1.'],
    ],
    also: 'McGowan (c4 in wk3), Treadwell (t1), A. Williams (t4/3/4), Burks, Kaytron Allen (placeholder projection), Mo Alie-Cox (illness, DNP Thursday), and the WSH tight ends (Bates 2.5, Yankoff 1.6, Okonkwo 6.54, Sinnott 2.34; Okonkwo and Sinnott are Q with LP/LP).',
  },
  {
    id: 'ari-nyg', slot: 'early', title: 'Cardinals at Giants', kick: 'Sun 12:00', when: 'Sun 12:00 CT',
    away: 'ARI', home: 'NYG', awayPts: 23.5, homePts: 21, line: 'ARI -2.5', total: 44.5, weather: '65F, rain 60%', rain: true,
    read: 'Jameis Winston has ranked QB31-32 the last two weeks and completed 51% of his passes. Arizona has the cleaner skill group: Love leads the backfield with Conner and Benson on IR, and McBride is McBride.',
    fpa: 'ARI offense vs NYG D: QB 16, RB 11, WR 14, TE 21 · NYG offense vs ARI D: QB 4, RB 22, WR 2, TE 5',
    start: [
      ['Trey McBride', 'TE', '20.0/14.1/12.0, t13/10/11, 88-91% snaps, proj 18.4 (high quality). The rank 21 TE matchup is irrelevant against that volume.', 'TE1', 'smash'],
      ['Jeremiyah Love', 'RB', 'c11/9/21, 19.4 in wk3 with t5, 64% snaps, proj 13.2. Conner and Benson are on IR.', 'RB12'],
      ['Michael Wilson', 'WR', 't7/7/17, 93-94% snaps, 20.4 in wk3, proj 13.9, NYG WR rank 14.', 'WR15'],
      ['Cam Skattebo', 'RB', 'c18/12/20, about 19 touches a game, proj 13.0 (n=11, low). ARI RB rank 22 and 21.0 implied cap it.', 'RB13', 'C10'],
    ],
    flex: [
      ['Jacoby Brissett', 'QB', 'Streamer: 16.5/6.5/25.6, 52 attempts in wk3, proj 16.9, NYG QB rank 16, rain. Superflex START.'],
      ['Malik Nabers', 'WR', 't9/4/6, 74-78% snaps, proj 9.7 (low). ARI WR rank 2 helps; Winston hurts.'],
      ['Isaiah Likely', 'TE', '23.8/5.8/2.3, t8/10/5, 84% snaps in wk3, proj 9.0, ARI TE rank 5.', 'TE10'],
      ['ARI D/ST', 'DEF', 'Proj 3.4 and a -3 in wk3, but Winston and a 21.0 implied. The DST8 slot is a context call.', 'DST8'],
    ],
    watch: [
      ['Tyrone Tracy Jr.', 'RB', 'Knee, DNP/LP, Q. SIT either way; Skattebo starts.', null, 'C10'],
      ['Andrew Thomas', 'OL', 'NYG left tackle, DNP/DNP, likely out. Pass-protection downgrade for Winston, Nabers and Likely.'],
    ],
    sit: [
      ['Jameis Winston', 'QB', 'AVOID. QB31-32 last two weeks, 51% completions; wk2 2.54, wk3 6.12, proj 9.71.'],
      ['Tyrone Tracy Jr.', 'RB', 'Q, LP Thursday, proj 6.30, 2% snaps in wk2-3.', null, 'C10'],
      ['Marvin Harrison Jr.', 'WR', 't3/1/5, 6.8% target share, flat 6.7 projection.'],
      ['NYG D/ST', 'DEF', 'Sit.'],
    ],
    also: 'Kendrick Bourne (t8/3/3), Allgeier (c2 in wk3, 36% snaps), Najee Harris (c9, 22% snaps), Singletary, Mooney, Fields, Theo Johnson.',
  },
  {
    id: 'dal-hou', slot: 'early', title: 'Cowboys at Texans', kick: 'Sun 12:00', when: 'Sun 12:00 CT · Retractable roof',
    away: 'DAL', home: 'HOU', awayPts: 22.75, homePts: 25.75, line: 'HOU -3', total: 48.5, weather: 'Storms 47% outside, roof status unknown', rain: false,
    read: 'Shootout lean. Houston ranks 25th against the pass (8.1 yards per attempt), gives up the third-most points to wide receivers, and Dallas has allowed 7 passing touchdowns. Roof status is unknown, so nothing here is adjusted for weather.',
    fpa: 'DAL offense vs HOU D: QB 7, RB 31, WR 3, TE 16 · HOU offense vs DAL D: QB 3, RB 8, WR 22, TE 7',
    start: [
      ['CeeDee Lamb', 'WR', '12.9/31.3/16.7, t8/9/8, proj 17.9, HOU WR rank 3.', 'WR5', 'smash'],
      ['Dak Prescott', 'QB', '14.4/29.8/18.9 on 34/31/40 attempts, proj 19.6 (high quality), 730 yards and 7 TD, HOU QB rank 7.', 'QB8'],
      ['George Pickens', 'WR', 't6/8/11 and rising, 85% snaps, proj 12.9, HOU WR rank 3.', 'WR18'],
      ['Javonte Williams', 'RB', 'c12/12/19, 76-80% snaps, proj 14.7. HOU RB rank 31 tempers it; volume stands.', 'RB11'],
      ['Dalton Schultz', 'TE', '5.5/20.0/4.5, t8/14/3, 54-68% snaps, proj 11.5, DAL TE rank 7.', 'TE8'],
    ],
    flex: [
      ['David Montgomery', 'RB', '27.4/3.4/5.8, c20/6/11, 52-63% snaps, proj 10.8, DAL RB rank 8.', 'RB19'],
      ['C.J. Stroud', 'QB', 'Streamer: 16.5/17.0/11.7 on 38/55/27 attempts, proj 15.2 (flat, unreliable). DAL QB rank 3 and 25.75 implied.'],
      ['Jake Ferguson', 'TE', 't2/4/5, 18.3 in wk2, proj 9.7, HOU TE rank 16. Streamer.', 'TE12'],
      ['Xavier Hutchinson', 'WR', 't6/9/6, 81% snaps in wk2, flat 6.8 projection so lean on usage. Dart if Collins is out or doubtful.'],
      ['HOU D/ST', 'DEF', 'Proj 7.1; 10 in wk2, 12 in wk3.'],
    ],
    watch: [
      ['Nico Collins', 'WR', 'START if active as WR2/3, below Nacua. 17.7 on t10 in wk1, missed wk2-3, LP/LP, proj 16.2 (low). Q + Friday LP: start him with a bench swap that plays noon or later, ready at 10:30a CT. Doubtful, or no bench cover: Pickens or Golden is your safe WR3.', 'WR11', 'C5'],
      ['British Brooks', 'RB', 'HOU, DNP Thursday. Out-ish. Marks and Montgomery.'],
      ['Cowboys CB Durant', 'CB', 'Hamstring, DNP Thursday, doubtful per CBS. HOU pass catchers up.'],
    ],
    sit: [
      ['DAL D/ST', 'DEF', 'AVOID. Proj 2.6.'],
      ['Woody Marks', 'RB', 'c5 in wk3.'],
      ['British Brooks', 'RB', 'AVOID. DNP.'],
    ],
    also: 'Flournoy (t4/6/8, flat 6.9), Turpin, Goodson, Demercado, Moreau, Boutte, Noel.',
  },
  {
    id: 'gb-tb', slot: 'early', title: 'Packers at Buccaneers', kick: 'Sun 12:00', when: 'Sun 12:00 CT',
    away: 'GB', home: 'TB', awayPts: 21, homePts: 17.5, line: 'GB -3.5', total: 38.5, weather: '87F sunny', rain: false,
    read: 'Tied for the lowest total on the slate (38.5, with MIA at MIN). Tampa starts undrafted rookie Jalon Daniels, Green Bay\'s backfield is a committee, and the Packers defense is the play.',
    fpa: 'GB offense vs TB D: QB 24, RB 24, WR 24, TE 11 · TB offense vs GB D: QB 22, RB 1, WR 9, TE 17',
    start: [
      ['Christian Watson', 'WR', '29.7/12.1/19.1, t8/11/10, 80-90% snaps, proj 17.1, 17-284-4 (web). Reed is on IR. The 38.5 total is the only drag.', 'WR7'],
      ['Matthew Golden', 'WR', '12.5/7.8/18.5, t12/6/12, 82-86% snaps, proj 10.3.', 'WR19'],
      ['Bucky Irving', 'RB', 'Start as RB2, firm. 16.8/11.0/6.8, c8/17/15, 78% then 52% snaps, proj 12.9 (low), LP/LP. GB RB rank 1 (29.8) is the best RB matchup on the slate and outweighs 17.5 implied and a rookie QB.', 'RB14', 'C12'],
      ['GB D/ST', 'DEF', 'Explicit override of the 3.4 projection and a -5 in wk3: a UDFA rookie\'s first start and TB at 17.5 implied outweigh them.', 'DST5', 'C19'],
    ],
    flex: [
      ['Jordan Love', 'QB', 'Streamer only: 20.5/13.8/18.5 on 42/29/53 attempts, proj 16.9. Fourth-lowest passing success rate (web) in a 38.5 total.'],
      ['Emeka Egbuka', 'WR', 't6/5/9, 8.8/8.8/8.7, proj 10.3, leads TB (13-141). GB WR rank 9. The only TB WR in play.'],
      ['Tucker Kraft', 'TE', 't6/3/8, proj 9.1. No double-digit PPR game yet (web). Streamer.'],
      ['Cade Otton', 'TE', 't5/6/6, 89-94% snaps, proj 8.3.'],
      ['Kenny Gainwell', 'RB', 't1/4/5, proj 8.5. PPR only; a real flex only if Irving is out.'],
    ],
    watch: [
      ['Chris Godwin Jr.', 'WR', 'Ankle, DNP/FP, likely plays. Still a sit.', null, 'C11'],
      ['Baker Mayfield', 'QB', 'Thumb, out 3+ weeks, not on IR. Jalon Daniels makes his first start.'],
    ],
    sit: [
      ['Jalon Daniels', 'QB', 'AVOID. UDFA rookie, first start, no row in our data, projection unknown.'],
      ['Chris Godwin Jr.', 'WR', 'SIT even though he plays: t4/3/4, proj 8.4.', null, 'C11'],
      ['GB RBs', 'RB', 'Jacobs is on the Commissioner\'s Exempt list. Lloyd (c13/6/4, 23-27% snaps, proj 5.4), Brooks (proj 3.1), Kaleb Johnson (AVOID, proj 2.3). A committee with no fantasy role, even against TB at RB rank 24.'],
      ['TB D/ST', 'DEF', 'Proj 5.4.'],
    ],
    also: 'Sean Tucker, Ted Hurst III (n=3), Tez Johnson, Jonnu Smith, Skyy Moore (t7 in wk3, proj 2.6).',
  },
  {
    id: 'jax-cin', slot: 'early', title: 'Jaguars at Bengals', kick: 'Sun 12:00', when: 'Sun 12:00 CT',
    away: 'JAX', home: 'CIN', awayPts: 24.5, homePts: 27, line: 'CIN -2.5', total: 51.5, weather: '66F', rain: false,
    read: 'The highest total on the slate. Both offenses are start-worthy and both defenses are fades.',
    fpa: 'JAX offense vs CIN D: QB 15, RB 20, WR 19, TE 9 · CIN offense vs JAX D: QB 30, RB 26, WR 20, TE 28',
    start: [
      ['Ja\'Marr Chase', 'WR', '2.2/23.0/20.3, t4/9/12, 88-100% snaps, proj 18.5, in the highest total on the board.', 'WR4', 'smash'],
      ['Trevor Lawrence', 'QB', '26.1/6.2/19.8, proj 19.5 (high quality), 7 TD and 2 INT (web), CIN QB rank 15.', 'QB9'],
      ['Joe Burrow', 'QB', '14.2/16.2/22.6 on 35/31/37 attempts, proj 18.4 (low). JAX QB rank 30 is a drag; 27.0 implied outweighs it.', 'QB11'],
      ['Chase Brown', 'RB', 'c16/20/13, 70% snaps, proj 15.1, JAX RB rank 26.', 'RB10'],
      ['Tee Higgins', 'WR', 't6/10/7 (six or more every game), 7.4/12.0/18.0, proj 14.3.', 'WR13'],
      ['Parker Washington', 'WR', 't6/12/5, 81% snaps, 16.8/14.3/11.5, proj 13.9.', 'WR16'],
      ['Jakobi Meyers', 'WR', '11.2/3.3/16.4, t8 in wk3, proj 11.3. Thumb, LP (Q).', 'WR20'],
      ['Bhayshul Tuten', 'RB', 'c15/13/15, about 50% snaps, 38.5 pts, proj 9.9, 323 rushing yards (web), CIN RB rank 20. Slight upgrade in standard.', 'RB17'],
    ],
    flex: [
      ['Mike Gesicki', 'TE', 'Streamer only: 16.3/0/11.2, 35-51% snaps, proj 8.5, JAX TE rank 28.'],
      ['Brenton Strange', 'TE', 't3/2/5, 77-83% snaps, proj 8.0, CIN TE rank 9.'],
    ],
    watch: [
      ['Jakobi Meyers', 'WR', 'Thumb, LP, likely plays. Still a start.'],
      ['LeQuint Allen Jr.', 'RB', 'Hip, Q, LP. 15-18% snaps, zero carries, proj 2.09. Minimal role; not a pivot.'],
    ],
    sit: [
      ['Travis Hunter', 'WR', 't1/0/0 and 8-10% snaps (6 and 5 snaps). The 5.0 and 9.5 points on zero targets in wk2-3 are non-offensive artifacts, not a role.', null, 'C8'],
      ['JAX D/ST', 'DEF', 'Proj 9.1 and 17/3/16 in weeks 1-3, but CIN is 27.0 implied in a 51.5 total. A sit, not a flex.', null, 'C19'],
      ['CIN D/ST', 'DEF', 'Proj 6.4.'],
      ['Josh Cameron', 'WR', '9.5/0/10.2 on t2/0/2, proj 6.0 (n=3). The points did not come from usage.'],
    ],
    also: 'Perine, D. Meyers, Sample, LeQuint Allen Jr. (proj 2.09), Chris Rodriguez Jr. (c8 in wk3, 21% snaps), Abdullah, Morris. Iosivas is on IR to Wk8.',
  },
  {
    id: 'lar-phi', slot: 'early', title: 'Rams at Eagles', kick: 'Sun 12:00', when: 'Sun 12:00 CT',
    away: 'LAR', home: 'PHI', awayPts: 23, homePts: 19.5, line: 'LAR -3.5', total: 42.5, weather: '65F, rain 57%', rain: true,
    read: 'Philadelphia\'s skill group is gutted: Smith and Brown are treated as out and Goedert is gone for weeks. The Rams lean on Stafford, Adams and Kyren, with Nacua a WR2 if he plays.',
    fpa: 'LAR offense vs PHI D: QB 6, RB 21, WR 13, TE 31 · PHI offense vs LAR D: QB 21, RB 27, WR 17, TE 27',
    start: [
      ['Davante Adams', 'WR', '4.1/36.5/17.2, t6/10/13, 83% snaps in wk3, proj 18.3, PHI WR rank 13. Rest DNP/FP, no downgrade.', 'WR6', 'smash'],
      ['Matthew Stafford', 'QB', '4.1/27.0/20.9 on 25/31/55 attempts, proj 19.8 (high quality), PHI QB rank 6. Rain is the only flag.', 'QB7'],
      ['Kyren Williams', 'RB', 'c11/12/15, t3/2/7, 55% then 71% snaps, proj 15.8 (high quality). The wk3 split was 71/29 snaps and 15 carries to 6; weeks 1-2 were close to even (11/10 and 12/12).', 'RB8', 'C13'],
      ['Jalen Hurts', 'QB', '24.7/16.2/12.6, rush c7/5/4, proj 18.3, LAR QB rank 21. Thin WR group; the rush floor holds him.', 'QB12'],
      ['LAR D/ST', 'DEF', 'Proj 6.2, PHI at 19.5 implied, PHI scored 7 in wk3.', 'DST6'],
    ],
    flex: [
      ['Tyler Higbee', 'TE', 'Wk3 16.2 on t11, 71% snaps, proj 8.2. Ferguson and Parkinson are both DNP/DNP. PHI TE rank 31 is the tough part.', 'TE11'],
      ['Saquon Barkley', 'RB', '8.5/2.5/8.5, c15/4/15, 72% snaps in wk3, proj 10.7. Healthy, but 6.5 points a game, LAR RB rank 27, 19.5 implied, rain. A flex, not an RB1.', 'RB21'],
      ['Dontayvion Wicks', 'WR', 't4/6/5, 88% snaps in wk3, proj 8.3. PHI WR1 with Smith out.'],
      ['Konata Mumpfield', 'WR', 'Only if Nacua is doubtful or out: t1/2/8, 17.3 in wk3, proj 5.3.'],
    ],
    watch: [
      ['Puka Nacua', 'WR', 'START as WR2 if active, not WR7. 10.9 on t9 in wk1, missed wk2-3, hip/groin, LP/LP, proj 18.9 (low). McVay says expected. Noon game, no pivot cover: Q + Friday LP, start him with a bench WR who plays noon or later ready to swap at 10:30a CT. Doubtful: sit, Mumpfield flex.', 'WR10', 'C4'],
      ['Terrance Ferguson / Colby Parkinson', 'TE', 'DNP/DNP each. Higbee is the primary TE.'],
    ],
    sit: [
      ['DeVonta Smith', 'WR', 'OUT/AVOID. Hamstring, DNP/DNP, ESPN says not expected to be available.', 'OUT'],
      ['Marquise Brown', 'WR', 'OUT/AVOID. Ankle, DNP/DNP.', 'OUT'],
      ['Dallas Goedert', 'TE', 'AVOID. MCL, out multiple weeks.', 'OUT'],
      ['Blake Corum', 'RB', 'c10/12/6, 29% snaps in wk3, proj 7.1.', null, 'C13'],
      ['PHI D/ST', 'DEF', 'Proj 5.1.'],
    ],
    also: 'Terrance Ferguson, Mundt (proj 2.4), Bigsby (4% snaps), Shipley, Lemon (t4, proj 4.9), Cooper, Atwell. Zack Baun (concussion) and OT Fred Johnson are DNP/DNP, doubtful-ish, a modest lift for the Rams.',
  },
  {
    id: 'ne-buf', slot: 'early', title: 'Patriots at Bills', kick: 'Sun 12:00', when: 'Sun 12:00 CT',
    away: 'NE', home: 'BUF', awayPts: 20.75, homePts: 27.75, line: 'BUF -7', total: 48.5, weather: '66F, rain 33%', rain: true,
    read: 'Buffalo controls this one: Allen and Cook. New England allows the fewest points in the league to tight ends (rank 32), which is why Kincaid is a flex and not a start.',
    fpa: 'NE offense vs BUF D: QB 8, RB 6, WR 6, TE 22 · BUF offense vs NE D: QB 27, RB 17, WR 8, TE 32',
    start: [
      ['Josh Allen', 'QB', '35.7/40.8/17.0, rush c6/14/8, proj 26.2 (low-quality flag), BUF at 27.75. NE QB rank 27 is the only softness.', 'QB1', 'smash'],
      ['James Cook', 'RB', 'c13/21/24, 74% then 67% snaps, proj 16.3, NE RB rank 17. BUF -7 gives him carries.', 'RB7'],
      ['BUF D/ST', 'DEF', 'NE at 20.75 implied, BUF -7.', 'DST4'],
    ],
    flex: [
      ['DJ Moore', 'WR', '18.5/-0.1/10.7, t8/0/10, proj 10.6. Shoulder, LP/LP, played through wk3. NE WR rank 8.', 'WR25', 'C21'],
      ['Khalil Shakir', 'WR', 't6/6/3, proj 8.0. A real flex if Coleman is out.'],
      ['Dalton Kincaid', 'TE', '15.5/19.0/2.8, t6/8/3, proj 11.3 (low). NE TE rank 32 (4.5).', 'TE14'],
      ['Rhamondre Stevenson', 'RB', 'c18/6/7, 36% then 52% snaps, proj 10.8, BUF RB rank 6.', 'RB23'],
      ['TreVeyon Henderson', 'RB', 'Wk2 13.6 (c16), wk3 3.4 (c8), proj 10.7 (low). Split backfield and a trailing script.', 'RB25'],
      ['Mack Hollins', 'WR', 't5/2/9, 11.7 in wk3, proj 8.7, BUF WR rank 6.'],
    ],
    watch: [
      ['Keon Coleman', 'WR', 'Ankle, DNP/LP, likely plays. If he is out, Shakir flexes and Palmer is still a sit (no wk3 row).', null, 'C21'],
      ['BUF CB Benford', 'CB', 'Toe, DNP/DNP, likely out. NE receivers (Hollins, Doubs) get a lift.'],
      ['NE CB Gonzalez / DT Barmore', 'CB/DT', 'DNP/DNP, likely out. BUF offense upgrade.'],
    ],
    sit: [
      ['Keon Coleman', 'WR', 'DNP/LP, t1/6/2, flat 6.9 projection.', null, 'C21'],
      ['Drake Maye', 'QB', '9.8/8.0/4.8 on 33/22/25 attempts, flat 15.2 projection (unreliable), NE at 20.75. FP/FP shoulder. Superflex flex.'],
      ['Hunter Henry', 'TE', 't3/5/2, proj 7.7, BUF TE rank 22.'],
      ['NE D/ST', 'DEF', 'Proj 6.5, 0 in wk3.'],
    ],
    also: 'Ty Johnson (t4, flat 7.3), Kiner, Joshua Palmer (flat 6.8), Romeo Doubs, DeMario Douglas, Knox, Raridon (placeholder projection), Frank Gore Jr. (AVOID, practice squad), A.J. Brown (AVOID, IR, eligible Wk6).',
  },
  {
    id: 'nyj-chi', slot: 'early', title: 'Jets at Bears', kick: 'Sun 12:00', when: 'Sun 12:00 CT',
    away: 'NYJ', home: 'CHI', awayPts: 20, homePts: 23.5, line: 'CHI -3.5', total: 43.5, weather: '61F sunny', rain: false,
    read: 'Caleb Williams is out and Keenum is my call at quarterback for Chicago. Swift is out by default, so Monangai starts, and Hall is out for the Jets. Nobody here gets ranked by a placeholder projection.',
    fpa: 'NYJ offense vs CHI D: QB 17, RB 16, WR 27, TE 26 · CHI offense vs NYJ D: QB 23, RB 9, WR 25, TE 30',
    start: [
      ['Kyle Monangai', 'RB', 'RB2/FLEX start with Swift out by default. c10/10/10, 19.4/6.8/3.1, 31-34% snaps, proj 9.4, NYJ RB rank 9.', 'RB18', 'C9'],
      ['Garrett Wilson', 'WR', '10.9/14.2/21.7, t7/7/13, 88-94% snaps, proj 16.2 (low), CHI WR rank 27. Mitchell doubtful pushes more share his way.', 'WR8'],
      ['CHI D/ST', 'DEF', 'Proj 7.5, 3/11/16 in weeks 1-3, NYJ at 20.0 implied.', 'DST7'],
    ],
    flex: [
      ['Luther Burden III', 'WR', '7.0/4.7/16.3, t5/7/11, 57-61% snaps, proj 10.8, NYJ WR rank 25.', 'WR27'],
      ['Kenyon Sadiq', 'TE', '9.9/2.7/20.0, t3/3/8, proj 11.3 (low). Back, Q, LP Thursday. CHI TE rank 26.', 'TE13'],
      ['Kalif Raymond', 'WR', '12.4/6.5/18.0, t9/5/7, proj 9.9.'],
      ['Rome Odunze', 'WR', 't3/4/6, 84-85% snaps, proj 9.0 (low).'],
      ['Geno Smith', 'QB', 'Streamer: 9.3/15.6/26.0 on 24/41/37 attempts, flat 15.2 projection (unreliable), CHI QB rank 17, NYJ at 20.0.'],
      ['Braelon Allen', 'RB', 'c10/5/4, 31-52% snaps, proj 5.6. A flex with Hall out.'],
      ['Case Keenum', 'QB', 'Superflex flex only (QB18-20). 24.48 on 34 attempts in wk3; his 20.9 projection is a placeholder and ignored.', null, 'C3'],
    ],
    watch: [
      ['D\'Andre Swift', 'RB', 'Out by default. 31.9/10.4/9.8, c18/16/20, proj 15.4 (high). DNP Wednesday (web) and Thursday (our injury feed, knee), no Friday report yet. Friday LP + Q: start Swift with Monangai or another noon-or-later RB on the bench and swap at 10:30a CT. Friday DNP: Monangai starts. If active he sits near RB14.', null, 'C9'],
    ],
    sit: [
      ['Caleb Williams', 'QB', 'AVOID. Grade 2 hamstring, out.', 'OUT', 'C3'],
      ['Breece Hall', 'RB', 'OUT/AVOID. Quad, DNP/DNP, doubtful, week-to-week.', 'OUT'],
      ['Adonai Mitchell', 'WR', 'OUT/AVOID. Finger, DNP/DNP, doubtful.', 'OUT'],
      ['Mason Taylor', 'TE', 'OUT/AVOID. DNP/DNP.', 'OUT'],
      ['Tyson Bagent', 'QB', 'AVOID. 2.16 on 9 attempts in wk2, proj 4.12.', null, 'C3'],
      ['Cole Kmet', 'TE', 'AVOID. 10.5/0/0, t3/1/1, proj 4.4.'],
      ['Colston Loveland', 'TE', 't2/3/4, 79-86% snaps, proj 7.3, NYJ TE rank 30.'],
      ['NYJ D/ST', 'DEF', 'Proj 3.6.'],
    ],
    also: 'Roschon Johnson, Isaiah Davis, Walker, Isaiah Williams (t1/6/2, proj 5.1), Ruckert, Omar Cooper (AVOID, IR).',
  },
  {
    id: 'ten-bal', slot: 'early', title: 'Titans at Ravens', kick: 'Sun 12:00', when: 'Sun 12:00 CT',
    away: 'TEN', home: 'BAL', awayPts: 15.5, homePts: 27, line: 'BAL -11.5', total: 42.5, weather: '66F, rain 59%', rain: true,
    read: 'The biggest spread on the slate. Henry has the script, the Baltimore defense has the script (the projection of 5.3 understates it), and the Tennessee offense is capped.',
    fpa: 'TEN offense vs BAL D: QB 18, RB 15, WR 11, TE 19 · BAL offense vs TEN D: QB 31, RB 10, WR 15, TE 29',
    start: [
      ['Derrick Henry', 'RB', '34.8/16.2/21.4, c24/16/26, 72.4 points, proj 20.2 (high quality), BAL -11.5 at 27.0. Upgrade in standard for the touchdown volume.', 'RB3', 'smash'],
      ['Lamar Jackson', 'QB', '25.0/14.8/20.4, rush c7/4/6, proj 18.2, LP/FP. TEN QB rank 31 and the spread cap his passing volume (20 attempts in wk3). The floor is the rush.', 'QB10'],
      ['Zay Flowers', 'WR', 'Start as WR2, not WR9. 23.5 on t6 in wk1; wk3 12.9 on t6 but only 21 snaps (33%). Hamstring, LP/FP, proj 16.0, rain 59%.', 'WR12', 'C17'],
      ['Wan\'Dale Robinson', 'WR', '6.3/1.4/15.2, t6/1/11, 63% snaps in wk3, proj 11.7. A trailing script gives him volume.', 'WR22'],
      ['BAL D/ST', 'DEF', 'TEN at 15.5 implied, BAL -11.5. Proj 5.3 understates it; 10/7/3 in weeks 1-3.', 'DST2'],
    ],
    flex: [
      ['Pollard', 'RB', 'c7/14/17, 53-55% snaps, proj 9.9, foot, DNP/FP. A negative script is the risk. Spears moves up if he is out.'],
      ['Rashod Bateman', 'WR', '0/19.3/4.7, t1/9/3, 88-93% snaps, proj 7.1.'],
      ['Mark Andrews', 'TE', '6.9/7.9/3.9, t6/7/5, 71% then 52% snaps, proj 8.0, TEN TE rank 29.'],
      ['Carnell Tate', 'WR', 't6/5/9, 88% snaps in wk3, proj 8.7 (n=3).'],
    ],
    watch: [
      ['Zay Flowers', 'WR', 'LP/FP, likely plays. If he is out, Bateman is a flex.', null, 'C17'],
      ['Tony Pollard / Tyjae Spears', 'RB', 'Pollard DNP/FP, Spears DNP/LP, both likely play.'],
    ],
    sit: [
      ['Cam Ward', 'QB', '11.7/20.0/9.4 on 32/20/36 attempts, proj 13.4 (high quality), but BAL QB rank 18 and TEN at 15.5 implied.'],
      ['Tyjae Spears', 'RB', 'c3/7/3, 0.5 in wk3, proj 6.7, DNP/LP.'],
      ['TEN D/ST', 'DEF', 'Proj 4.5.'],
    ],
    also: 'Chris Moore (Q), Walker, Hibner (9.3 on t2 in wk3), Justice Hill (c5), Ayomanor (flat 6.9), Ridley, Helm, Bellinger, Rasheen Ali (AVOID).',
  },
  {
    id: 'mia-min', slot: 'late', title: 'Dolphins at Vikings', kick: 'Sun 3:05p', when: 'Sun 3:05p CT · Dome',
    away: 'MIA', home: 'MIN', awayPts: 14, homePts: 24.5, line: 'MIN -10.5', total: 38.5, weather: 'Dome', rain: false,
    read: 'Miami\'s 14.0 implied is the lowest on the slate and the Minnesota defense is DST1. Justin Jefferson is default OUT in my rankings, and the quarterback is Kyler Murray, not Wentz.',
    fpa: 'MIA offense vs MIN D: QB 26, RB 29, WR 10, TE 25 · MIN offense vs MIA D: QB 9, RB 3, WR 29, TE 6',
    start: [
      ['MIN D/ST', 'DEF', 'DST1. Proj 10.1, 7/21/15 in weeks 1-3, MIA at 14.0 implied, in a dome.', 'DST1'],
      ['Aaron Jones', 'RB', 'c12/23/17, t1/0/6, 80-81% snaps, proj 11.0, MIA RB rank 3. Mason is on IR (eligible Wk7). MIN -10.5 means a lead-protecting script. Rest LP, no downgrade.', 'RB16'],
    ],
    flex: [
      ['Jordan Addison', 'WR', '0/3.1/17.5, t2/5/9, 88-98% snaps, proj 8.8. MIA WR rank 29 is tough; he is the swap and moves up with Jefferson out.'],
      ['T.J. Hockenson', 'TE', '12.6/4.4/2.1, t5/4/4, 85% snaps, proj 7.5, MIA TE rank 6. Oliver is on IR, so he is the only TE.'],
      ['Kyler Murray', 'QB', 'Superflex low flex only. Concussion early in wk1, Wentz started wk2, Murray back in wk3 at 100% snaps: 10.42 on 29 attempts, proj 11.1 (n=24). 1QB sit.', null, 'C14'],
      ['Jauan Jennings', 'WR', 'Only if Jefferson is out: 0.6 in wk3 on 80% snaps, proj 7.1.'],
    ],
    watch: [
      ['Justin Jefferson', 'WR', 'Default OUT. Ankle sprain in wk3 (27.2/7.0/4.2; 7 snaps and t2 after the injury), DNP/DNP, MRI clean, day-to-day, proj 12.7 (low). Friday LP + Q: keep him only with a bench WR who plays 3:05p or later (Addison, Waddle, Sutton) to swap at the 1:35p CT inactives. Friday DNP: pivot now. If he is active he is a WR2, not a WR1.', null, 'C2'],
    ],
    sit: [
      ['Malik Willis', 'QB', '16.7/12.5/10.0 on 27/23/36 attempts, proj 13.7 (low), MIA at 14.0 implied.'],
      ['Ollie Gordon II', 'RB', 'Wk3 13.0 (c17, t3, 84% snaps), proj 5.4 (low). MIN RB rank 29, 14.0 implied, and Wright (LP/FP) returns.'],
      ['Jaylen Wright', 'RB', 'Stinger/foot, LP/FP, likely back. Cuts into Gordon.'],
      ['Malik Washington', 'WR', 't8/5/10, 86% snaps, proj 8.0. Deep-PPR flex only.'],
      ['MIA D/ST', 'DEF', 'AVOID. Proj 3.2.'],
      ['De\'Von Achane', 'RB', 'AVOID. IR, torn ACL, out for the season.', 'OUT'],
    ],
    also: 'Ryan Miller (14.2 on t1), Chris Bell (LP/LP), Caleb Douglas (AVOID, DNP/DNP, placeholder projection), Myles Price, DeeJay Dallas, Greg Dulcich (proj 6.5), Kacmarek (AVOID). Wentz is the backup.',
  },
  {
    id: 'den-sf', slot: 'late', title: 'Broncos at 49ers', kick: 'Sun 3:25p', when: 'Sun 3:25p CT',
    away: 'DEN', home: 'SF', awayPts: 22.25, homePts: 25.25, line: 'SF -3', total: 47.5, weather: '81F sunny', rain: false,
    read: 'The San Francisco defense is thinned (Bosa out, Thompson out, Greenlaw DNP/DNP) while Purdy, McCaffrey and Kittle are healthy. Evans is a sit.',
    fpa: 'DEN offense vs SF D: QB 25, RB 12, WR 23, TE 23 · SF offense vs DEN D: QB 20, RB 5, WR 21, TE 14',
    start: [
      ['Brock Purdy', 'QB', '21.1/28.5/31.3 on 34/22/27 attempts, proj 23.6 (low), 80.9 points in three games. The thin WR group is the risk; Kittle and McCaffrey absorb it.', 'QB2', 'smash'],
      ['Christian McCaffrey', 'RB', '11.3/20.6/19.6, c10/10/15, t8/4/5, 83% snaps in wk3, proj 20.5, DEN RB rank 5. Rest DNP/FP, no downgrade.', 'RB4', 'smash'],
      ['George Kittle', 'TE', '3.2/16.0/23.2, t5/4/7, 85% snaps in wk3, proj 14.7, DEN TE rank 14. Tonges is on IR.', 'TE3', 'smash'],
      ['Deebo Samuel', 'WR', 'The SF WR to hold, in superflex too. 15.0/5.0/15.4, t7/4/0 with c1/1/2 (the wk3 points came with no targets: volatile), 76% snaps, proj 11.6.', 'WR23'],
    ],
    flex: [
      ['Bo Nix', 'QB', 'Best QB streamer on the slate. 5.4/14.1/24.1 on 28/31/34 attempts, proj 17.1 (high quality). SF QB rank 25, but the defense is thinned.', 'QB13'],
      ['RJ Harvey', 'RB', 'Wk3 7.7 on c2/t7, 36% snaps, proj 10.9 (n=19, low). A PPR receiving back; no wk2 row.', 'RB22'],
      ['Jaylen Waddle', 'WR', '0.7/17.8/5.4, t3/10/7, 73% snaps in wk3, proj 10.5, SF WR rank 23.', 'WR29'],
      ['J.K. Dobbins', 'RB', 'c8/10/17, 49% snaps in wk3, 13.0 total, proj 7.5 (flat), FP/FP. Just outside the top 24. In standard he sits above Harvey.'],
      ['Courtland Sutton', 'WR', 't5/4/7, 87% snaps in wk3, proj 9.4.'],
      ['DEN D/ST', 'DEF', 'Proj 8.6 and 3/12/11, but SF at 25.25 implied is a negative matchup for a defense.'],
    ],
    watch: [
      ['Mike Evans', 'WR', 'Ribs, DNP/DNP, "shouldn\'t be long-term". SIT regardless of Friday: 33% of snaps in wk3. Inactives about 1:55p CT.', null, 'C6'],
      ['Brandon Aiyuk', 'WR', 'Listed Out on the ESPN depth chart; no row in our data and no report. Unknown.'],
      ['Nick Bosa / James Thompson Jr.', 'DL', 'Out. A lift for Nix and the Denver offense.'],
    ],
    sit: [
      ['Mike Evans', 'WR', '13.9/6.9/10.9, t7/3/6, only 33% snaps in wk3, proj 11.6 (low). Deep-league flex only.', null, 'C6'],
      ['Jordan Watkins', 'WR', 't2 in wk3, proj 4.9.'],
      ['Evan Engram', 'TE', '12.3/2.2/0, proj 6.1.'],
      ['SF D/ST', 'DEF', 'Proj 5.1.'],
    ],
    also: 'Nate Adkins (t2, proj 5.0), Pat Bryant (13.4 on t2 in wk3, proj 7.1), Troy Franklin, Marvin Mims (one wk1 row, 0 points, proj 4.4), Kaelon Black, Jordan James (placeholder projection), Luke Farrell. Demarcus Robinson (AVOID, IR).',
  },
  {
    id: 'kc-lv', slot: 'late', title: 'Chiefs at Raiders', kick: 'Sun 3:25p', when: 'Sun 3:25p CT · Dome',
    away: 'KC', home: 'LV', awayPts: 26, homePts: 21.5, line: 'KC -4.5', total: 47.5, weather: 'Dome', rain: false,
    read: 'Tough on receivers both ways: Las Vegas allows the second-fewest points to wide receivers (rank 31) and Kansas City the fewest to both wide receivers and quarterbacks (rank 32 on both). The soft spot is tight end, where the Raiders rank 3. That is Kelce.',
    fpa: 'KC offense vs LV D: QB 19, RB 23, WR 31, TE 3 · LV offense vs KC D: QB 32, RB 19, WR 32, TE 13',
    start: [
      ['Patrick Mahomes', 'QB', '21.7/29.0/15.9 on 27/47/24 attempts, proj 21.1 (high quality), KC at 26.0.', 'QB3', 'smash'],
      ['Kenneth Walker III', 'RB', '32.6/20.8/20.3, c23/24/18, t6/10/2, 73-82% snaps, proj 18.1 (high quality), LV RB rank 23.', 'RB6', 'smash'],
      ['Brock Bowers', 'TE', 'Wk3 22.6 on t13, 79% snaps, proj 18.3 (low). No wk1-2 rows in our data; web says he is healthy. KC TE rank 13.', 'TE2', 'smash'],
      ['Ashton Jeanty', 'RB', '29.7/9.3/10.8, c23/21/19, 81-84% snaps, proj 15.9, KC RB rank 19. LV is an underdog at 21.5.', 'RB9'],
      ['Rashee Rice', 'WR', '8.9/10.3/12.3, t2/6/9, 77-79% snaps, proj 14.1 (n=15, low). LV WR rank 31 is the tough side.', 'WR14'],
      ['Travis Kelce', 'TE', '8.6/20.6/12.9, t5/11/2, 79-85% snaps, proj 13.0, LV TE rank 3 (18.7). The wk3 12.9 came on only t2, so it was likely touchdown-dependent.', 'TE5'],
    ],
    flex: [
      ['LV D/ST', 'DEF', 'Proj 8.5 and 17/13/12, but KC at 26.0 implied.'],
    ],
    watch: [
      ['KC LT Simmons / LV G Powers-Johnson', 'OL', 'DNP/DNP, likely out. Line downgrades on both sides.'],
    ],
    sit: [
      ['Kirk Cousins', 'QB', 'Sit in 1QB despite the 16.1 projection: KC QB rank 32 (8.9). Superflex flex.'],
      ['Xavier Worthy', 'WR', 't6/7/2, 83-86% snaps, proj 8.0, LV WR rank 31.'],
      ['Tre Tucker', 'WR', '3.7/20.4/6.3, t4/7/4, 57-59% snaps, proj 10.0, KC WR rank 32.'],
      ['Emmett Johnson', 'RB', 'c6 in wk3, 27% snaps, proj 5.8.'],
      ['KC D/ST', 'DEF', 'Proj 6.1.'],
    ],
    also: 'Thornton, Nailor, Cody White, Noah Gray, Michael Mayer, Mike Washington Jr., Brashard Smith (AVOID), Royals (AVOID), Jack Bech (AVOID, IR). Mahomes and Rice are FP/FP.',
  },
  {
    id: 'lac-sea', slot: 'late', title: 'Chargers at Seahawks', kick: 'Sun 3:25p', when: 'Sun 3:25p CT',
    away: 'LAC', home: 'SEA', awayPts: 17.75, homePts: 24.75, line: 'SEA -7', total: 42.5, weather: '66F sunny', rain: false,
    read: 'Seattle\'s defense allows the fewest points in the league in total (rank 32, 55.6 a game). The Chargers offense is a fade and Jaxon Smith-Njigba is the game.',
    fpa: 'LAC offense vs SEA D: QB 28, RB 28, WR 30, TE 18 · SEA offense vs LAC D: QB 12, RB 14, WR 16, TE 20',
    start: [
      ['Jaxon Smith-Njigba', 'WR', '22.2/38.0/30.4, t11/11/14, 87% snaps in wk3, 90.6 points, proj 25.6.', 'WR1', 'smash'],
      ['SEA D/ST', 'DEF', 'Proj 8.0 and 17/15/5 in weeks 1-3, LAC at 17.75 implied.', 'DST3'],
    ],
    flex: [
      ['Sam Darnold', 'QB', 'Flex or streamer. Glute in wk1, Lock started wk1-2, Darnold back in wk3: 27.66 on 45 attempts, 100% snaps; proj 15.18 (flat, n=36). 1QB start only if your starter is out or ranks below QB12; otherwise sit. Superflex START.', 'QB14', 'C15'],
      ['Omarion Hampton', 'RB', '8.3/16.5/5.6, c12/23/15, t0/2/1, 63% then 42% snaps, proj 12.0 (n=12, low), SEA RB rank 28.', 'RB20'],
      ['AJ Barner', 'TE', '2.3/7.4/9.4, t2/1/9, 91% snaps in wk3, proj 8.1, LAC TE rank 20.'],
      ['Cooper Kupp', 'WR', '4.5/3.0/12.6, t3/2/5, 67% snaps in wk3, proj 7.6.'],
    ],
    watch: [
      ['Ladd McConkey', 'WR', 'Foot, LP Wednesday, DNP Thursday with a limp. Late game, but the ruling is pivot now, not hold. Pivots: Tre\' Harris (flat 6.7, flex only if McConkey is out) and Quentin Johnston, deep flex at most.', null, 'C7'],
      ['Derwin James', 'S', 'LAC safety, LP/DNP, doubtful-ish. A lift for the SEA passing game.'],
      ['Charlie Kolar', 'TE', 'DNP/DNP, likely out. Njoku is on IR, so Gadsden is the tight end.'],
      ['Brenen Thompson', 'WR', 'DNP/DNP, likely out.'],
    ],
    sit: [
      ['Ladd McConkey', 'WR', '16.7/5.0/8.6, t7/3/5, 88% snaps in wk3, proj 11.1. Removed from the WR top 30. SEA WR rank 30.', null, 'C7'],
      ['Justin Herbert', 'QB', 'Matchup override of the 15.6 projection: 13.3/8.9/12.7 on 27/27/34 attempts, SEA QB rank 28, LAC at 17.75.'],
      ['SEA RBs', 'RB', 'Emanuel Wilson (c2/21/9, proj 5.1, healthy), George Holani (c8/4/3, ribs LP/LP, proj 4.8, deep-PPR only), Jadarian Price (chest, DNP Thursday, proj 5.5). Charbonnet is not eligible. Nobody is a start.', null, 'C16'],
      ['LAC D/ST', 'DEF', 'Proj 6.8.'],
    ],
    also: 'Keaton Mitchell (Q, c8 in wk3, proj 5.6), Vidal, Tre\' Harris (t6/3/7), Quentin Johnston (t6/5/6, 81-87% snaps, proj 8.3), Shaheed (6.2), Horton, Saubert, Gadsden (t2/2/3, proj 6.4), Derius Davis (AVOID).',
  },
  {
    id: 'det-car', slot: 'prime', title: 'Lions at Panthers', kick: 'Sun 7:20p', when: 'Sunday Night · 7:20p CT',
    away: 'DET', home: 'CAR', awayPts: 27, homePts: 23.5, line: 'DET -3.5', total: 50.5, weather: '70F, rain 56%', rain: true,
    read: 'The second-highest total on the slate. Detroit allows the most points in the league to quarterbacks and tight ends (rank 1 on both), and Carolina allows the second-most to running backs with cornerbacks Horn and Jackson on IR.',
    fpa: 'DET offense vs CAR D: QB 10, RB 2, WR 28, TE 12 · CAR offense vs DET D: QB 1, RB 18, WR 5, TE 1',
    start: [
      ['Jahmyr Gibbs', 'RB', '31.1/20.3/37.9, c29/16/20, t5/8/8, 83% then 69% snaps, 89.3 points, proj 25.6. Pacheco is on IR; CAR RB rank 2.', 'RB1', 'smash'],
      ['Amon-Ra St. Brown', 'WR', '23.7/30.7/9.9, t14/13/8, 95% then 74% snaps, proj 20.8. Horn and Jackson are on IR despite the WR rank of 28.', 'WR2', 'smash'],
      ['Jared Goff', 'QB', '16.4/29.8/19.4 on 39/38/32 attempts, proj 19.6 (high quality), DET at 27.0.', 'QB4'],
      ['Bryce Young', 'QB', '31.4/24.1/13.6 on 37/36/48 attempts, proj 18.9, DET QB rank 1 (30.0). Knee, FP/FP.', 'QB5'],
      ['Sam LaPorta', 'TE', '7.3/14.2/5.9, t8/7/4, 92-98% snaps, proj 11.1 (low), CAR TE rank 12.', 'TE7'],
      ['Chuba Hubbard', 'RB', '22.2/13.4/13.0, c10/12/19, 65% then 84% snaps, proj 12.4, DET RB rank 18.', 'RB15'],
      ['Tetairoa McMillan', 'WR', 'WR2/3. t8/10/5, 80% then 95% snaps, proj 10.8, WR1 per web, DET WR rank 5.', 'WR24', 'C20'],
    ],
    flex: [
      ['Jameson Williams', 'WR', 't9/4/4, 97% then 82% snaps, proj 10.5.', 'WR28'],
      ['Darren Waller', 'TE', '3.8/16.8/7.6, t2/3/8, 44% then 51% snaps, proj 9.7 (n=12, low), DET TE rank 1 (29.4).', 'TE9', 'C22'],
      ['Jalen Coker', 'WR', 'Flex if active. 29.8/10.6/2.8, t9/9/4, only 28 snaps (36%) in wk3, quad, DNP/LP, proj 12.3 (low).', null, 'C20'],
    ],
    watch: [
      ['Jalen Coker', 'WR', 'Hold through the SNF inactives (about 5:50p CT) only if your bench alternative also plays Sunday night or Monday.', null, 'C20'],
      ['Damien Lewis', 'OL', 'CAR left guard, DNP/DNP, likely out. A lift for the DET pass rush.'],
      ['DET Bartch, D.J. Reed, Wonnum', 'DEF', 'On the report, likely play. All DET skill players are healthy.'],
    ],
    sit: [
      ['Xavier Legette', 'WR', 'OUT. Knee, DNP/DNP, doubtful per ESPN.', 'OUT', 'C20'],
      ['DET D/ST', 'DEF', 'Proj 5.2.'],
      ['CAR D/ST', 'DEF', 'Proj 7.9, but DET is at 27.0 implied.'],
      ['Tremayne', 'WR', '10.3 in wk3 on t6, 81% snaps, proj 3.7.'],
      ['Metchie', 'WR', '8.9 in wk3 on t5, proj 5.7.'],
    ],
    also: 'TeSlaa (t3, proj 5.3), Vaki (c6), Dillon, Tremble, Brock Wright, Jonathon Brooks (AVOID, IR).',
  },
  {
    id: 'atl-no', slot: 'prime', title: 'Falcons at Saints', kick: 'Mon 7:15p', when: 'Monday Night · 7:15p CT · Dome',
    away: 'ATL', home: 'NO', awayPts: 22.5, homePts: 25, line: 'NO -2.5', total: 47.5, weather: 'Dome', rain: false,
    read: 'Etienne is on IR, so Kamara leads the Saints backfield. Bijan and Olave carry the value. New Orleans\' front seven was banged up on Thursday (Elliss, Granderson, Jennings and Werner all DNP). Monday data is Thursday-only, so treat it as soft.',
    fpa: 'ATL offense vs NO D: QB 13, RB 7, WR 18, TE 4 · NO offense vs ATL D: QB 11, RB 30, WR 7, TE 8',
    start: [
      ['Bijan Robinson', 'RB', '27.3/9.6/34.3, c21/16/29, t10/4/2, 72% snaps in wk3, 71.2 points, proj 22.7 (high quality), NO RB rank 7.', 'RB2', 'smash'],
      ['Chris Olave', 'WR', '23.2/18.6/15.2, t13/10/13, 84% snaps, proj 19.6, ATL WR rank 7.', 'WR3', 'smash'],
      ['Tyler Shough', 'QB', '23.2/22.4/23.8 on 56/34/42 attempts, proj 20.2 (high quality, n=14), ATL QB rank 11, dome.', 'QB6'],
      ['Juwan Johnson', 'TE', '12.9/8.6/22.3, t7/4/8, 62% snaps, proj 13.1 (high quality), ATL TE rank 8.', 'TE4'],
      ['Drake London', 'WR', '4.5/8.4/24.9, t4/5/10, 62% then 93% snaps, proj 14.9, NO WR rank 18.', 'WR9'],
    ],
    flex: [
      ['Devaughn Vele', 'WR', '16.4/8.9/5.4, t9/7/6, 88-96% snaps, proj 10.2.', 'WR30'],
      ['Alvin Kamara', 'RB', 'c9/9, t6/1, 29% then 32% snaps, flat 7.9 projection. But Etienne is on IR (earliest return Nov 8), which leaves him the lead. ATL RB rank 30 is the drag. A PPR upgrade. Just outside RB24.'],
      ['Noah Fant', 'TE', '12.3/0/17.3, t8/0/4, 57% snaps in wk3, proj 7.8. Abdomen, LP (Q).'],
    ],
    watch: [
      ['Noah Fant', 'TE', 'Abdomen, LP, likely plays. If he is out, Juwan Johnson holds.'],
      ['NO defense', 'DEF', 'Elliss, Granderson, Jennings and Werner all DNP Thursday. Unresolved. A modest lift for the Atlanta offense.'],
    ],
    sit: [
      ['Michael Penix Jr.', 'QB', 'Did not play wk1-2 (Cooper Rush and Jack Strand); first game back in wk3 was 14.0 on 25 attempts. Proj 14.4 (n=15, low).'],
      ['Brian Robinson Jr.', 'RB', '3.1/7.7/11.0, c10 in wk3, 27% snaps, proj 6.0.'],
      ['Kyle Pitts', 'TE', 't1/3/2, 3.5 points total, 38% and 59% snaps, proj 7.3; web says healthy.'],
      ['NO D/ST', 'DEF', 'Proj 5.4, 2/9/2 in weeks 1-3.'],
      ['ATL D/ST', 'DEF', 'Proj 5.7.'],
    ],
    also: 'Kendre Miller (c4 in wk3, 19% snaps), CJ Donaldson (c1, proj 2.0), Lance, Austin, Dotson, Zaccheaus, Blair, Hooper (t4/2, flat 5.5), Muse. Tyson (AVOID, IR-R).',
  },
];

const SLOT = (slot) => GAMES.filter((g) => g.slot === slot).map((g) => <GameCard key={g.id} g={g} />);

// Injury board rows are [name, position, team, status, pivot, tone, ruling].
const INJ_OUT = [
  ['Rachaad White', 'RB', 'WSH', 'Shoulder, DNP/DNP. London, no pivot cover.', 'Croskey-Merritt (RB24 flex, low-end RB2). Ekeler is a sit.', 'default', 'C18'],
  ['DeVonta Smith', 'WR', 'PHI', 'Hamstring, DNP/DNP. ESPN: not expected to be available. Noon game.', 'Wicks (flex), Lemon, Cooper, E. Moore, Covey.', 'default'],
  ['Marquise Brown', 'WR', 'PHI', 'Ankle, DNP/DNP. Our injury feed lists him Q, DNP Thursday, proj 5.59. Noon game.', 'Wicks, Lemon.', 'default'],
  ['Dallas Goedert', 'TE', 'PHI', 'MCL, out multiple weeks (our injury feed: doubtful).', 'Mundt (proj 2.4), still a sit. Stowers is on IR.', 'out'],
  ['Breece Hall', 'RB', 'NYJ', 'Quad, DNP/DNP, doubtful, week-to-week. Noon game.', 'Braelon Allen (flex), Isaiah Davis (sit).', 'default'],
  ['Adonai Mitchell', 'WR', 'NYJ', 'Finger, DNP/DNP, doubtful. Noon game.', 'Garrett Wilson picks up share. Isaiah Williams is a sit.', 'default'],
  ['Mason Taylor', 'TE', 'NYJ', 'Thumb, DNP/DNP. Our injury feed lists him D, proj 4.89. Noon game.', 'Sadiq (Q, back, LP Thursday), Ruckert (Q, knee, LP Thursday).', 'default'],
  ['D\'Andre Swift', 'RB', 'CHI', 'Knee. DNP Wednesday (web), DNP Thursday (our injury feed). No Friday report yet. Noon game.', 'Monangai starts. Friday LP + Q: Swift with a noon-or-later RB on your bench, swap at 10:30a CT.', 'default', 'C9'],
  ['Caleb Williams', 'QB', 'CHI', 'Grade 2 hamstring, DNP Thursday. Out.', 'Keenum (superflex flex only). Bagent is an avoid.', 'out', 'C3'],
  ['Xavier Legette', 'WR', 'CAR', 'Knee, DNP/DNP, doubtful per ESPN. SNF.', 'McMillan starts. Coker flexes if active.', 'default', 'C20'],
  ['Justin Jefferson', 'WR', 'MIN', 'Ankle sprain from wk3, DNP/DNP, MRI clean, day-to-day. 3:05p game.', 'Addison and Jennings. Friday LP + Q: hold only with a 3:05p-or-later swap (Waddle, Sutton, Addison). Friday DNP: pivot now.', 'default', 'C2'],
];

const INJ_LONDON = [
  ['Jayden Daniels', 'QB', 'WSH', 'Elbow dislocation, brace, LP/LP. Quinn decides "by Friday"; clarity may come late Saturday or early Sunday.', 'Mariota (QB15-16, real data). Daniels is a flex if active, superflex start either way.', 'gtd', 'C1'],
  ['Keenan Allen', 'WR', 'IND', 'Groin, LP Thursday (Q). Likely plays.', 'Downs and Warren.', 'likely'],
  ['Mo Alie-Cox', 'TE', 'IND', 'Illness, DNP Thursday. Doubtful-ish.', 'Warren.', 'gtd'],
  ['Chig Okonkwo / Ben Sinnott', 'TE', 'WSH', 'LP/LP each, both Q. Likely play.', 'Bates (54% snaps in wk3). All WSH tight ends are sits regardless.', 'likely'],
];

const INJ_NOON = [
  ['Nico Collins', 'WR', 'HOU', 'Hamstring, LP/LP, missed wk2-3. "Decent chance" to return.', 'Hutchinson (flex dart). Pickens and Golden are the safe WR3.', 'gtd', 'C5'],
  ['Puka Nacua', 'WR', 'LAR', 'Hip/groin, LP/LP, missed wk2-3. McVay is optimistic.', 'Mumpfield (flex). Adams holds, Higbee.', 'gtd', 'C4'],
  ['Bucky Irving', 'RB', 'TB', 'Glute, LP/LP. Likely plays.', 'Gainwell is a PPR-only flex if he is out. Start Irving as RB2.', 'likely', 'C12'],
  ['Chris Godwin Jr.', 'WR', 'TB', 'Ankle, DNP/FP. Likely plays.', 'Sit either way. Egbuka is the only TB WR in play.', 'sit', 'C11'],
  ['Zay Flowers', 'WR', 'BAL', 'Hamstring, LP/FP. Likely plays.', 'Bateman (flex).', 'likely', 'C17'],
  ['Tony Pollard / Tyjae Spears', 'RB', 'TEN', 'Pollard (foot/ankle) DNP/FP, Spears (ankle) DNP/LP. Both likely play.', 'If Pollard is out, Spears flexes.', 'likely'],
  ['Keon Coleman / DJ Moore', 'WR', 'BUF', 'Coleman (ankle) DNP/LP, likely plays. Moore (shoulder) LP/LP, played through wk3.', 'Moore flex either way. Coleman out: Shakir flex, Palmer still a sit.', 'likely', 'C21'],
  ['Tyrone Tracy Jr.', 'RB', 'NYG', 'Knee, DNP/LP, Q. 2% snaps in wk2-3.', 'Sit either way. Skattebo starts.', 'sit', 'C10'],
  ['Kenyon Sadiq / Ruckert', 'TE', 'NYJ', 'Sadiq (back) and Ruckert (knee), both Q, both LP Thursday.', 'Sadiq is the flex streamer (TE13). Ruckert stays a sit.', 'gtd'],
  ['Jakobi Meyers', 'WR', 'JAX', 'Thumb, LP. Likely plays.', 'Washington and Cameron. Start Meyers (WR20).', 'likely'],
  ['Andrew Thomas', 'OL', 'NYG', 'Left tackle, DNP/DNP. Likely out.', 'Pass-protection downgrade for Winston, Nabers and Likely.', 'gtd'],
];

const INJ_LATE = [
  ['Jaylen Wright', 'RB', 'MIA', 'Stinger/foot, LP/FP. Likely returns after missing wk3. 3:05p.', 'Cuts into Gordon. Both are sits.', 'likely'],
  ['Mike Evans', 'WR', 'SF', 'Ribs, DNP/DNP, "shouldn\'t be long-term". 3:25p.', 'Samuel is the SF WR to hold. Kittle up, Watkins a sit.', 'sit', 'C6'],
  ['Ladd McConkey', 'WR', 'LAC', 'Foot, LP Wednesday, DNP Thursday, limped out. 3:25p.', 'Pivot now. Tre\' Harris and Johnston are deep flex only.', 'sit', 'C7'],
  ['Jadarian Price / George Holani', 'RB', 'SEA', 'Price (chest) LP/DNP, doubtful-ish. Holani (ribs) LP/LP, likely plays. Charbonnet is not eligible.', 'Nobody in the SEA backfield is a start.', 'sit', 'C16'],
  ['Derwin James', 'S', 'LAC', 'Safety, LP/DNP. Doubtful-ish.', 'A modest lift for the SEA passing game.', 'gtd'],
  ['Brandon Aiyuk', 'WR', 'SF', 'Listed Out on the ESPN depth chart. No row in our data, no report. Unknown.', 'Samuel.', 'gtd'],
];

const INJ_NIGHT = [
  ['Jalen Coker', 'WR', 'CAR', 'Quad, DNP/LP. Likely plays. SNF.', 'Flex if active. Hold through SNF inactives only with an SNF or MNF bench alternative.', 'gtd', 'C20'],
  ['Noah Fant', 'TE', 'NO', 'Abdomen, LP (Q). MNF, Thursday data only: soft.', 'Juwan Johnson holds.', 'likely'],
  ['NO defense', 'DEF', 'NO', 'Elliss, Granderson, Jennings and Werner all DNP Thursday. Unresolved. MNF data is Thursday only.', 'A modest lift for the ATL offense.', 'gtd'],
];

const ALREADY_OUT = [
  'Jaxson Dart (NYG QB, out for the season)', 'Brian Burns (NYG, torn ACL)', 'Conner and Benson (ARI RB, IR)',
  'Alec Pierce (IND WR, IR)', 'Baker Mayfield (TB QB, thumb, out 3+ weeks, not on IR)', 'Jalen McMillan (TB WR, IR)',
  'Josh Jacobs (GB RB, Commissioner\'s Exempt list since Aug 30)', 'Jayden Reed (GB WR, IR, neck)', 'Andrei Iosivas (CIN WR, IR to Wk8)',
  'A.J. Brown (NE WR, IR, eligible Wk6)', 'De\'Von Achane (MIA RB, torn ACL, IR)', 'Josh Oliver (MIN TE, torn biceps, IR)',
  'Nick Bosa and James Thompson Jr. (SF, out)', 'Pearsall and Tonges (SF, IR)', 'Jack Bech (LV WR, IR)', 'David Njoku (LAC TE, IR, fibula)',
  'Zach Charbonnet (SEA RB, not eligible Wk4)', 'Isiah Pacheco (DET RB, IR, back surgery)', 'Jaycee Horn and Mike Jackson (CAR CB, IR)',
  'Jonathon Brooks (CAR RB, IR)', 'Travis Etienne Jr. (NO RB, IR, earliest return Nov 8)', 'Jordyn Tyson (NO WR, IR-R)', 'A.J. Terrell (ATL CB, IR)',
];

// Tier rows are [rank, name, team, proj, note].
const QB_ROWS = [
  [1, 'Josh Allen', 'BUF', '26.2', '35.7/40.8/17.0, BUF at 27.75'],
  [2, 'Brock Purdy', 'SF', '23.6', '80.9 points in 3 games'],
  [3, 'Patrick Mahomes', 'KC', '21.1', '47 attempts in wk2'],
  [4, 'Jared Goff', 'DET', '19.6', 'DET at 27.0'],
  [5, 'Bryce Young', 'CAR', '18.9', 'DET QB rank 1'],
  [6, 'Tyler Shough', 'NO', '20.2', '23.2/22.4/23.8'],
  [7, 'Matthew Stafford', 'LAR', '19.8', 'PHI QB rank 6, rain'],
  [8, 'Dak Prescott', 'DAL', '19.6', 'HOU QB rank 7'],
  [9, 'Trevor Lawrence', 'JAX', '19.5', 'Total 51.5'],
  [10, 'Lamar Jackson', 'BAL', '18.2', 'TEN QB rank 31, run-heavy script'],
  [11, 'Joe Burrow', 'CIN', '18.4', 'CIN at 27.0'],
  [12, 'Jalen Hurts', 'PHI', '18.3', 'Rush floor, thin WRs'],
  [13, 'Bo Nix', 'DEN', '17.1', 'Best streamer, thinned SF defense'],
  [14, 'Sam Darnold', 'SEA', '15.18 (flat)', 'Flex/streamer'],
];
const QB_NEXT = 'Brissett 16.9, Love 16.9, Mariota 13.67 (QB15-16 if he starts) and Jayden Daniels 16.2 (QB13-16 if active, in a brace), Cousins 16.1 (matchup override, sit), Herbert 15.6 (matchup override, sit), Keenum (superflex flex, QB18-20), Geno Smith 15.2 (flat), Stroud 15.2 (flat), D. Jones 13.6, Kyler Murray 11.1. Avoid: Winston (wk2 2.54, wk3 6.12, proj 9.71), Bagent (proj 4.12), Jalon Daniels (UDFA rookie).';

const RB_ROWS = [
  [1, 'Jahmyr Gibbs', 'DET', '25.6', 'CAR RB rank 2'],
  [2, 'Bijan Robinson', 'ATL', '22.7', 'c29 in wk3'],
  [3, 'Derrick Henry', 'BAL', '20.2', '-11.5 script'],
  [4, 'Christian McCaffrey', 'SF', '20.5', 'Rest DNP/FP'],
  [5, 'Jonathan Taylor', 'IND', '19.2', 'WSH RB rank 32'],
  [6, 'Kenneth Walker III', 'KC', '18.1', 'c23/24/18'],
  [7, 'James Cook', 'BUF', '16.3', 'BUF at 27.75'],
  [8, 'Kyren Williams', 'LAR', '15.8', 'Backfield trended his way'],
  [9, 'Ashton Jeanty', 'LV', '15.9', 'c23/21/19'],
  [10, 'Chase Brown', 'CIN', '15.1', '27.0 implied'],
  [11, 'Javonte Williams', 'DAL', '14.7', 'c19 in wk3'],
  [12, 'Jeremiyah Love', 'ARI', '13.2', 'c21 in wk3'],
  [13, 'Cam Skattebo', 'NYG', '13.0', 'About 19 touches a game'],
  [14, 'Bucky Irving', 'TB', '12.9', 'RB2, firm. GB RB rank 1'],
  [15, 'Chuba Hubbard', 'CAR', '12.4', 'c19 in wk3, 84% snaps'],
  [16, 'Aaron Jones', 'MIN', '11.0', 'MIA RB rank 3'],
  [17, 'Bhayshul Tuten', 'JAX', '9.9', 'c15/13/15'],
  [18, 'Kyle Monangai', 'CHI', '9.4', 'RB2/flex start with Swift out by default'],
  [19, 'David Montgomery', 'HOU', '10.8', 'c11 in wk3'],
  [20, 'Omarion Hampton', 'LAC', '12.0', 'SEA RB rank 28'],
  [21, 'Saquon Barkley', 'PHI', '10.7', 'LAR RB rank 27'],
  [22, 'RJ Harvey', 'DEN', '10.9', 't7 in wk3'],
  [23, 'Rhamondre Stevenson', 'NE', '10.8', 'BUF RB rank 6'],
  [24, 'Jacory Croskey-Merritt', 'WSH', '8.1', 'Flex either way; low-end RB2 if White is out'],
];
const RB_NEXT = 'Just outside: Henderson (NE, RB25, split backfield), Kamara (NO), Pollard (TEN), Dobbins (DEN), Gainwell (TB, PPR). Swift (CHI) is unranked and default OUT; if he is active he sits near RB14 (proj 15.4). Sit: Wilson, Holani and Price (SEA), Gordon (MIA), Ekeler (WSH, deep-PPR dart), Corum (LAR).';

const WR_ROWS = [
  [1, 'Jaxon Smith-Njigba', 'SEA', '25.6', 't11/11/14'],
  [2, 'Amon-Ra St. Brown', 'DET', '20.8', 'CAR CBs on IR'],
  [3, 'Chris Olave', 'NO', '19.6', 't13/10/13'],
  [4, 'Ja\'Marr Chase', 'CIN', '18.5', 'Total 51.5'],
  [5, 'CeeDee Lamb', 'DAL', '17.9', 'HOU WR rank 3'],
  [6, 'Davante Adams', 'LAR', '18.3', 't13 in wk3'],
  [7, 'Christian Watson', 'GB', '17.1', '60.9 points'],
  [8, 'Garrett Wilson', 'NYJ', '16.2', 't13 in wk3'],
  [9, 'Drake London', 'ATL', '14.9', 't10 in wk3'],
  [10, 'Puka Nacua', 'LAR', '18.9', 'WR2 if active'],
  [11, 'Nico Collins', 'HOU', '16.2', 'WR2/3 if active, below Nacua'],
  [12, 'Zay Flowers', 'BAL', '16.0', 'WR2'],
  [13, 'Tee Higgins', 'CIN', '14.3', 't6+ every game'],
  [14, 'Rashee Rice', 'KC', '14.1', 'LV WR rank 31'],
  [15, 'Michael Wilson', 'ARI', '13.9', 't17 in wk3'],
  [16, 'Parker Washington', 'JAX', '13.9', 't12 in wk2'],
  [17, 'Stefon Diggs', 'WSH', '13.0', 'IND WR rank 12'],
  [18, 'George Pickens', 'DAL', '12.9', 't11 in wk3'],
  [19, 'Matthew Golden', 'GB', '10.3', 't12/6/12'],
  [20, 'Jakobi Meyers', 'JAX', '11.3', 'Thumb, LP'],
  [21, 'Terry McLaurin', 'WSH', '10.9', 't9/9 the last two weeks'],
  [22, 'Wan\'Dale Robinson', 'TEN', '11.7', 't11 in wk3'],
  [23, 'Deebo Samuel', 'SF', '11.6', 'Volatile'],
  [24, 'Tetairoa McMillan', 'CAR', '10.8', 'DET WR rank 5'],
  [25, 'DJ Moore', 'BUF', '10.6', 'Flex'],
  [26, 'Josh Downs', 'IND', '10.1', 'PPR only'],
  [27, 'Luther Burden III', 'CHI', '10.8', 't11 in wk3'],
  [28, 'Jameson Williams', 'DET', '10.5', '97% then 82% snaps'],
  [29, 'Jaylen Waddle', 'DEN', '10.5', 't10 in wk2'],
  [30, 'Devaughn Vele', 'NO', '10.2', '88-96% snaps'],
];
const WR_NEXT = 'Egbuka, Raymond, Keenan Allen, Coker (if active), Sutton. Unranked: Justin Jefferson (default OUT; if active a WR2, not a WR1), Mike Evans (sit, deep-league flex only), Ladd McConkey (sit), Keon Coleman (sit), Xavier Legette (out).';

const TE_ROWS = [
  [1, 'Trey McBride', 'ARI', '18.4', 't13/10/11'],
  [2, 'Brock Bowers', 'LV', '18.3', 't13 in wk3'],
  [3, 'George Kittle', 'SF', '14.7', '23.2 in wk3'],
  [4, 'Juwan Johnson', 'NO', '13.1', '22.3 in wk3'],
  [5, 'Travis Kelce', 'KC', '13.0', 'LV TE rank 3'],
  [6, 'Tyler Warren', 'IND', '11.6', 'WSH TE rank 2'],
  [7, 'Sam LaPorta', 'DET', '11.1', '92-98% snaps'],
  [8, 'Dalton Schultz', 'HOU', '11.5', 't14 in wk2'],
  [9, 'Darren Waller', 'CAR', '9.7', 'DET TE rank 1, 44-51% snaps'],
  [10, 'Isaiah Likely', 'NYG', '9.0', 'ARI TE rank 5'],
  [11, 'Tyler Higbee', 'LAR', '8.2', 'Primary TE, t11 in wk3'],
  [12, 'Jake Ferguson', 'DAL', '9.7', 'HOU TE rank 16'],
  [13, 'Kenyon Sadiq', 'NYJ', '11.3', 'Q (back, LP Thursday); Taylor out; streamer'],
  [14, 'Dalton Kincaid', 'BUF', '11.3', 'NE TE rank 32'],
];
const TE_NEXT = 'Fant, Andrews, Barner, Kraft.';

// No SMASH band for D/ST: the per-game calls start MIN through CHI and flex ARI.
const DST_ROWS = [
  [1, 'MIN', 'vs MIA', '10.1', '-10.5, MIA implied 14.0, dome'],
  [2, 'BAL', 'vs TEN', '5.3', '-11.5, TEN implied 15.5 (the projection understates it)'],
  [3, 'SEA', 'vs LAC', '8.0', '-7, LAC implied 17.75'],
  [4, 'BUF', 'vs NE', '5.7', '-7, NE implied 20.75'],
  [5, 'GB', 'at TB', '3.4', 'UDFA rookie QB\'s first start, TB implied 17.5. Explicit override of the projection'],
  [6, 'LAR', 'at PHI', '6.2', 'PHI implied 19.5, PHI scored 7 in wk3'],
  [7, 'CHI', 'vs NYJ', '7.5', 'NYJ implied 20.0, 3/11/16 in weeks 1-3'],
  [8, 'ARI', 'at NYG', '3.4', 'Winston (QB31-32 last two weeks), NYG implied 21.0. The projection and the wk3 -3 are the doubt'],
];

const SLEEPERS = [
  ['Xavier Hutchinson', 't6/9/6, 81% snaps in wk2. Flex dart if Collins is out or doubtful.', 'WR'],
  ['Jacory Croskey-Merritt', 'c16/12/19, IND RB rank 4. RB24 flex either way, low-end RB2 if White is out at 7:00a CT.', 'RB'],
  ['Dontayvion Wicks', '88% snaps in wk3. The PHI WR1 with Smith treated as out.', 'WR'],
  ['Wan\'Dale Robinson', 't11 in wk3, proj 11.7, BAL WR rank 11. The trailing script is his friend.', 'WR'],
  ['Bo Nix', '17.1 proj against a thin SF pass rush. QB13 streamer.', 'QB'],
  ['Darren Waller', 'DET TE rank 1, proj 9.7. TE9 flex.', 'TE'],
  ['Tyler Higbee', 't11 in wk3, with Ferguson and Parkinson both DNP/DNP.', 'TE'],
  ['Alvin Kamara', 'Etienne is on IR, so he is the lead back.', 'RB'],
  ['Kyle Monangai', 'c10/10/10. RB18, printed as the RB2/flex start with Swift out by default.', 'RB'],
  ['Kenny Gainwell', 't4/5 the last two weeks. PPR-only flex if Irving is out.', 'RB'],
  ['Konata Mumpfield', 't8 in wk3, 17.3 points. Flex if Nacua is doubtful or out.', 'WR'],
];

const FADES = [
  ['Saquon Barkley', '6.5 points a game in weeks 1-3, LAR RB rank 27, PHI at 19.5 implied, rain. A flex, not an RB1.', 'RB'],
  ['Justin Herbert and the LAC offense', 'SEA D total rank 32, LAC at 17.75. Matchup override of his 15.6 projection. Hampton is a flex only.', 'QB'],
  ['Kirk Cousins', 'KC D QB rank 32 (8.9). Matchup override of his 16.1 projection.', 'QB'],
  ['Jefferson, Evans, McConkey', 'Injured late-game receivers. Jefferson is default OUT, Evans a sit, McConkey a sit.', 'WR'],
  ['Xavier Worthy and Tre Tucker', 'Both face WR rank 31-32 defenses.', 'WR'],
  ['Dalton Kincaid', 'NE TE rank 32 (4.5), t3 and 2.8 points in wk3.', 'TE'],
  ['Drake Maye', '7.5 points a game actual; the flat projection is not credible, and NE is at 20.75 on the road.', 'QB'],
  ['Jordan Love', 'Fourth-lowest passing success rate (web), 38.5 total.', 'QB'],
  ['Cam Ward', 'TEN at 15.5 implied as an 11.5-point road underdog.', 'QB'],
  ['Breece Hall', 'DNP/DNP, out.', 'RB'],
  ['DeVonta Smith', 'Out, DNP/DNP.', 'WR'],
  ['Dallas Goedert', 'Out multiple weeks.', 'TE'],
  ['JAX D/ST at CIN', 'Proj 9.1 against CIN at 27.0 implied in a 51.5 total.', 'DEF'],
  ['Travis Hunter', '8-10% snaps. Points on zero targets are not a role.', 'WR'],
];

// [if X, then Y]
const PIVOTS = [
  ['Daniels out', 'Mariota (real data, proj 13.67): QB15-16, superflex START, 1QB streamer only. McLaurin (t9/9) and Diggs (t6/7) hold value. Decide at the 7:00a CT inactives.'],
  ['White out', 'Croskey-Merritt flex (RB20-24), low-end RB2. Ekeler is a sit (proj 7.28, deep-PPR dart).'],
  ['Keenan Allen out', 'Downs (t11 in wk3), Warren, Treadwell.'],
  ['Collins out or doubtful', 'Hutchinson flex dart. Schultz moves up. Lamb and Pickens are unaffected. Pickens or Golden is the safe WR3.'],
  ['Nacua out or doubtful', 'Mumpfield flex. Adams holds. Higbee.'],
  ['Swift out (default)', 'Monangai starts as RB2/flex (c10/10/10).'],
  ['Hall out (already)', 'Braelon Allen flex. Garrett Wilson up.'],
  ['Mitchell out (already)', 'Garrett Wilson, Isaiah Williams.'],
  ['Irving out', 'Gainwell is a PPR-only flex. Tucker is a sit.'],
  ['Godwin (sit whether he plays or not)', 'Egbuka is the only TB WR in play.'],
  ['Flowers out', 'Bateman flex.'],
  ['Jefferson out (default)', 'Addison flex (t9 in wk3), Jennings flex, Aaron Jones leans up.'],
  ['Evans out (sit anyway)', 'Samuel START (the SF WR to hold), Kittle up, Watkins a sit.'],
  ['McConkey out (sit anyway)', 'T. Harris and Johnston are deep flex only. Hampton unchanged.'],
  ['Legette out', 'McMillan START, Coker flex if active, Tremayne and Metchie sits.'],
  ['Fant out', 'Juwan Johnson holds.'],
  ['Coleman out', 'Shakir flex. Palmer is a sit (no wk3 row).'],
  ['Pollard out', 'Spears flex.'],
];

// Rulings are [id, title, ruling, confidence, rule].
const RULINGS = [
  ['C1', 'WSH quarterback: Daniels or Mariota (8:30a, no pivot cover)', 'Daniels is a flex/streamer (QB13-16) if active, not a start, and a superflex START. Mariota has real data (8.74 on 16 attempts in wk2; 20.42 on 31 attempts in wk3 at 100% snaps; proj 13.67, n=15): QB15-16 if Daniels sits, superflex START, 1QB streamer only.', 'Medium', 'Daniels is in a brace after an elbow dislocation and Quinn decides "by Friday", with clarity late Saturday or early Sunday. Check the 7:00a CT inactives before using either.'],
  ['C2', 'Justin Jefferson (MIN, 3:05p)', 'Default OUT in the rankings. If he is active he is a WR2, not a WR1.', 'Medium', 'Friday LP + Questionable: keep him only with a bench WR who plays 3:05p or later (Addison, Waddle, Sutton) to swap at 1:35p CT. Friday DNP: pivot now.'],
  ['C3', 'CHI quarterback', 'Keenum is the call (24.48 on 34 attempts in wk3; his 20.9 projection is a placeholder and ignored). 1QB avoid, superflex flex (QB18-20). Bagent (proj 4.12, 2.16 on 9 attempts in wk2) is an avoid.', 'Medium-high', 'Do not rank any CHI passer by projection.'],
  ['C4', 'Puka Nacua (LAR, noon)', 'START if active as WR2, ranked WR10-14, not WR7.', 'Medium', 'Questionable + Friday LP: start him with a bench WR who plays noon or later ready to swap at 10:30a CT. Doubtful: sit, Mumpfield flex.'],
  ['C5', 'Nico Collins (HOU, noon)', 'START if active as WR2/3, below Nacua (WR11).', 'Medium-low', 'Questionable + Friday LP: start him with a noon-or-later bench swap ready at 10:30a CT. Doubtful, or no bench cover: Pickens or Golden is your safe WR3, Hutchinson a flex dart.'],
  ['C6', 'Mike Evans (SF, 3:25p)', 'SIT regardless of Friday. Ribs, DNP/DNP, 33% of snaps in wk3. Deep-league flex only.', 'Medium-high', 'Samuel is the SF WR to hold, in superflex too.'],
  ['C7', 'Ladd McConkey (LAC, 3:25p)', 'SIT, pivot now. Removed from the WR top 30.', 'Medium-high', 'LP Wednesday, DNP Thursday with a limp, SEA WR rank 30, LAC at 17.75. No hold language.'],
  ['C8', 'Travis Hunter (JAX)', 'SIT.', 'High', '8-10% snaps (6 and 5 snaps). Points on zero targets are non-offensive artifacts, not a role.'],
  ['C9', 'D\'Andre Swift (CHI, noon)', 'Default OUT. Monangai is printed as the RB2/flex start (RB18).', 'Medium', 'The Wednesday DNP comes from the web, the Thursday DNP from our injury feed. Friday LP + Questionable: start Swift with Monangai or another noon-or-later RB on your bench and swap at 10:30a CT. Friday DNP: Monangai starts.'],
  ['C10', 'Tyrone Tracy Jr. (NYG)', 'SIT. Skattebo starts either way.', 'High', 'Q, LP Thursday, proj 6.30, 2% snaps in wk2-3.'],
  ['C11', 'Chris Godwin Jr. (TB)', 'SIT, even though he plays. Egbuka is the only TB WR in play.', 'Medium-high', 'DNP/FP, t4/3/4, proj 8.4.'],
  ['C12', 'Bucky Irving (TB)', 'START as RB2, firm (RB14).', 'Medium', 'GB RB rank 1 (29.8) outweighs 17.5 implied and a rookie quarterback. If he is out, Gainwell is a PPR-only flex.'],
  ['C13', 'Kyren Williams vs Corum (LAR)', 'Kyren START (RB8-10), Corum SIT.', 'Medium-high', 'The backfield trended to Kyren in wk3 (snaps 71/29, carries 15 to 6). That split is wk3 only: weeks 1-2 carries were close to even (11/10 and 12/12).'],
  ['C14', 'MIN quarterback', 'Kyler Murray, named starter Aug 11. Concussion early in wk1, Wentz started wk2, Murray back in wk3 at 100% snaps (10.42 on 29 attempts; proj 11.1, n=24). Wentz is the backup. 1QB sit, superflex low flex.', 'High', null],
  ['C15', 'SEA quarterback', 'Sam Darnold (glute in wk1, Lock started wk1-2, Darnold back in wk3: 27.66 on 45 attempts, 100% snaps; proj 15.18, flat, n=36). QB14 flex/streamer.', 'Medium', '1QB start only for managers whose starter is out or ranks below QB12.'],
  ['C16', 'SEA running backs', 'Wilson SIT, Holani SIT (deep-PPR only), Price SIT. None is a start and none is on the just-outside list.', 'High', null],
  ['C17', 'Zay Flowers (BAL)', 'START as WR2, ranked WR12-15, not WR9.', 'Medium', 'LP/FP, but only 33% of snaps in wk3, and rain at 59%.'],
  ['C18', 'WSH running backs', 'Croskey-Merritt flex (RB20-24) either way, low-end RB2 if White is out at 7:00a CT. Ekeler SIT (proj 7.28, deep-PPR dart).', 'Medium-high', null],
  ['C19', 'D/ST: GB and JAX', 'GB START at DST5 (behind MIN, BAL, SEA, BUF), a stated override of the 3.4 projection: TB at 17.5 implied and a UDFA rookie\'s first start outweigh it. JAX SIT, not flex (CIN at 27.0 implied, 51.5 total).', 'Medium', 'Confidence is Medium on GB, High on JAX.'],
  ['C20', 'CAR receivers (SNF)', 'Legette OUT. McMillan START (WR2/3). Coker flex if active.', 'Medium', 'Hold Coker through the SNF inactives only if your bench alternative also plays Sunday night or Monday.'],
  ['C21', 'BUF receivers', 'DJ Moore flex (WR25-30), Coleman SIT.', 'Medium', 'If Coleman is out, Shakir flexes and Palmer is a sit (no wk3 row).'],
  ['C22', 'Tight end order', 'LaPorta TE7 START, Schultz TE8 START, Waller TE9 FLEX.', 'Medium', null],
];

// [who, what to do]
const CHECK_LONDON = [
  ['Jayden Daniels (WSH QB).', 'Active: flex, superflex start. Out: Mariota, QB15-16, superflex start.'],
  ['Rachaad White (WSH RB).', 'Treated as out. Confirm it, then Croskey-Merritt is a low-end RB2.'],
  ['Keenan Allen (IND WR).', 'Active: flex. Out: Downs and Warren soak up the targets.'],
  ['Mo Alie-Cox (IND TE).', 'Out: Warren.'],
];
const CHECK_NOON = [
  ['Nico Collins (HOU WR).', 'Active: WR2/3 start. Out or doubtful: Pickens or Golden at WR3, Hutchinson a flex dart.'],
  ['Puka Nacua (LAR WR).', 'Active: WR2 start. Doubtful or out: Adams holds, Mumpfield flex.'],
  ['D\'Andre Swift (CHI RB).', 'Active after a Friday LP: start him. Inactive: Monangai starts. Either way keep a noon-or-later RB on the bench.'],
  ['Bucky Irving (TB RB).', 'Active: RB2 start. Out: Gainwell, PPR-only flex.'],
  ['Zay Flowers (BAL WR).', 'Active: WR2. Out: Bateman flex.'],
  ['Pollard and Spears (TEN RB).', 'Pollard active: flex. Pollard out: Spears flex.'],
  ['Coleman and DJ Moore (BUF WR).', 'Moore flexes either way. Coleman out: Shakir flex, Palmer stays benched.'],
  ['Sadiq and Ruckert (NYJ TE).', 'Both Q, both LP Thursday. Sadiq is the flex streamer; Ruckert stays a sit.'],
  ['Jakobi Meyers (JAX WR).', 'Thumb, LP. Active: start.'],
  ['Smith, Brown, Hall, Mitchell, Taylor.', 'Already printed OUT. Confirm, because the noon games have no pivot cover.'],
];
const CHECK_LATE = [
  ['Justin Jefferson (MIN WR), inactives about 1:35p CT.', 'Active after a Friday LP: WR2, if you hold a 3:05p-or-later swap. Out: Addison and Jennings flex, Aaron Jones leans up.'],
  ['Mike Evans (SF WR), about 1:55p CT.', 'A sit regardless. Out: Samuel, Kittle up.'],
  ['Ladd McConkey (LAC WR), about 1:55p CT.', 'Already pivoted. Out: Harris and Johnston are deep flex only.'],
  ['Jaylen Wright (MIA RB).', 'Likely back. Both Miami backs stay on the bench.'],
  ['Brandon Aiyuk (SF WR).', 'Listed Out on ESPN depth, no report. Samuel is the hold.'],
];
const CHECK_SNF = [
  ['Jalen Coker (CAR WR), inactives about 5:50p CT.', 'Active: flex. Hold him only if your bench alternative also plays Sunday night or Monday.'],
  ['Xavier Legette (CAR WR).', 'Out. McMillan starts.'],
];
const CHECK_MNF = [
  ['Noah Fant (NO TE), inactives about 5:45p CT Monday.', 'Out: Juwan Johnson holds. Thursday data only, treat as soft.'],
  ['New Orleans defense.', 'Elliss, Granderson, Jennings and Werner all missed Thursday. A modest lift for the Atlanta offense.'],
];

const Body = () => (
  <>
    <HeroBanner />

    <Lead>
      Three weeks of evidence is enough to stop pretending. Caleb Williams is out, Justin Jefferson&apos;s
      ankle is a Friday problem, Jayden Daniels is playing in a brace if he plays at all, and an
      undrafted rookie makes his first start for Tampa Bay. Fifteen games. Every call. Set your
      pivots before you go to bed Saturday.
    </Lead>

    <Note title="Read this first">
      <strong>Lines are as of Oct 2. Injury notes are Wednesday and Thursday practice reports only.</strong>{' '}
      No Friday designations existed when I wrote this. Re-check the Friday reports and the Sunday
      inactives before you lock anything. Every window below says when the inactives drop.
    </Note>

    <P>
      Scoring is PPR unless I say otherwise; standard and half-PPR only show up where they change a
      verdict. &quot;Proj&quot; is our Week 4 PPR projection. Where the projection is a placeholder or a
      flat number that cannot be trusted, I say so and lean on usage. Kickers are missing: I have no
      kicker data, so I am not making kicker calls.
    </P>
    <RailList
      items={[
        ['Usage lines', 'read wk1/wk2/wk3. c = carries, t = targets, pa = pass attempts. Points lines (like 16.8/11.0/6.8) are PPR points by week.'],
        ['FPA rank', '1 means the defense allows the most points to that position (a good matchup), 32 the fewest (tough). Weeks 1 to 3 only, garbage time included.'],
        ['Tiers', 'QB 1-3 SMASH, 4-12 START, 13-18 FLEX. RB 1-6, 7-18, 19-30. WR 1-6, 7-24, 25-40. TE 1-3, 4-8, 9-14. A written reason beats the rank rule.'],
        ['(n=…, low/medium/high quality)', 'n is the sample size behind a projection, and low, medium or high quality is how far to trust it. Low means lean on usage.'],
        ['Ruling links', 'Where a call is contested, the card links to its Darkness Ruling (C1 to C22) with the confidence and the decision rule.'],
      ]}
    />

    <JumpGrid />

    <H2>The Slate Board</H2>
    <P>
      Every game, in kickoff order: line, total, weather and both implied totals on one scale.
      Filled bars are the favorites. Jacksonville at Cincinnati (51.5) and Detroit at Carolina (50.5)
      are the shootouts. Green Bay at Tampa and Miami at Minnesota sit at 38.5, and Miami&apos;s 14.0 is
      the lowest implied total on the slate. Baltimore (-11.5) and Minnesota (-10.5) are the big
      favorites.
    </P>
    <SlateBoard />
    <P>
      Winds are 1 to 10 mph everywhere, so there are no wind downgrades. The rain flags (in amber) are
      Arizona at the Giants (60%), Tennessee at Baltimore (59%), the Rams at Philadelphia (57%),
      Detroit at Carolina (56%) and New England at Buffalo (33%). I have no number for what rain does
      to a stat line, so there are no point adjustments, only mild tiebreaks toward rushers. Houston
      has a retractable roof with storms at 47% outside, and I do not know which way it will be set.
    </P>

    <H2>The Injury Board</H2>
    <P>
      Practice reports are Wednesday and Thursday. The decision rules are simple, and I apply them the
      same way to every name on this page.
    </P>
    <RailList
      color="var(--warning)"
      items={[
        ['Two DNPs, no Friday report', 'ranked OUT, with the beneficiary printed.'],
        ['Noon-or-earlier players', 'printed OUT outright, because there is no later game to pivot into.'],
        ['Late players with a real role', 'Jefferson keeps the same default rank, with hold-if-Friday-LP language: hold him only with a later-kicking swap. Evans and McConkey are rulings of their own (sit regardless, pivot now).'],
        ['Rest DNPs', 'Adams, McCaffrey and Aaron Jones get no downgrade.'],
        ['Placeholder projections', 'never rank anyone. A newly elevated starter is ranked by role and context, with team implied total as the tiebreaker.'],
        ['A swap only works', 'if your bench player kicks off at or after the player he replaces.'],
      ]}
    />
    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, my: 2 }}>
      <Chip tone="var(--accent)">London: 7:00a CT</Chip>
      <Chip tone="var(--accent)">Noon games: 10:30a CT</Chip>
      <Chip tone="var(--accent)">3:05p / 3:25p: about 1:35p / 1:55p CT</Chip>
      <Chip tone="var(--accent)">SNF: about 5:50p CT</Chip>
      <Chip tone="var(--accent)">MNF: about 5:45p CT Monday</Chip>
    </Box>

    <InjuryGroup title="Out, or treat as out" when="Two DNPs, no Friday report: noon players have no pivot cover, late players listed with their window." rows={INJ_OUT} />
    <InjuryGroup title="London" when="Inactives 7:00a CT" rows={INJ_LONDON} />
    <InjuryGroup title="Noon games" when="Inactives 10:30a CT" rows={INJ_NOON} />
    <InjuryGroup title="Late window" when="Inactives about 1:35p / 1:55p CT" rows={INJ_LATE} />
    <InjuryGroup title="Sunday and Monday night" when="Inactives about 5:50p / 5:45p CT" rows={INJ_NIGHT} />
    <Box component="h3" sx={{ m: '24px 0 8px !important', fontSize: '1.15rem !important' }}>Already out for the week or longer</Box>
    <Box component="p" sx={{ mt: '0 !important', fontSize: '0.92rem', color: 'var(--text-muted)', lineHeight: 1.6 }}>
      {ALREADY_OUT.join('; ')}.
    </Box>

    <H2>Early Window</H2>
    <P>
      London at 8:30a CT, then eight noon games. Nothing kicks between noon and 3:05p, so a noon-game decision needs a
      noon-or-later swap on your bench, and the London game has no pivot cover at all.
    </P>
    {SLOT('early')}

    <H2>Late Window</H2>
    <P>
      Four games at 3:05p and 3:25p. These are pivot-safe after the early slate: you can see the
      noon inactives and the early scores before you decide.
    </P>
    {SLOT('late')}

    <H2>Prime Time</H2>
    <P>
      Sunday night is Detroit at Carolina. Monday night is Atlanta at New Orleans, where my data is
      Thursday-only, so hold it loosely.
    </P>
    {SLOT('prime')}

    <H2>Position Tiers</H2>
    <P>
      The rankings for the Sunday and Monday slate, blended from projection, weeks 1 to 3 usage, FPA
      rank and game total. SMASH means start him and stop thinking. START means he is in your lineup.
      FLEX means a lineup spot only if the matchup or your depth says so. The rank order and the
      projection column do not always agree: the context is the point.
    </P>
    <H3>Quarterback, top 14</H3>
    <TierBoard pos="QB" rows={QB_ROWS} smashMax={3} startMax={12} next={QB_NEXT} />
    <H3>Running back, top 24</H3>
    <TierBoard pos="RB" rows={RB_ROWS} smashMax={6} startMax={18} next={RB_NEXT} />
    <H3>Wide receiver, top 30</H3>
    <TierBoard pos="WR" rows={WR_ROWS} smashMax={6} startMax={24} next={WR_NEXT} />
    <H3>Tight end, top 14</H3>
    <TierBoard pos="TE" rows={TE_ROWS} smashMax={3} startMax={8} next={TE_NEXT} />
    <H3>D/ST, top 8</H3>
    <TierBoard pos="DST" rows={DST_ROWS} smashMax={0} startMax={7} projLabel="Proj" />

    <H2>Sleepers, Fades and Pivots</H2>
    <H3>Sleepers</H3>
    <P>Low-profile usage plays. I do not have ownership percentages, so check your own wire.</P>
    <RailList color="var(--success)" items={SLEEPERS} />
    <H3>Busts and fades</H3>
    <RailList color="var(--danger)" items={FADES} />
    <H3>If he is out, pivot to</H3>
    <P>
      The whole contingency list in one place. If the first name is out at his inactive window, this
      is your next move.
    </P>
    <RailList color="var(--warning)" items={PIVOTS} />

    <H2>The Darkness Rulings</H2>
    <P>
      Twenty-two calls got argued about. Here is each one in short form: the ruling, how sure I am,
      and the rule you can run yourself when the news breaks.
    </P>
    {RULINGS.map((r) => <RulingCard key={r[0]} r={r} />)}

    <H2>Inactives Checklist</H2>
    <P>
      Inactives drop about 90 minutes before each kickoff. Windows are Central time. Set your pivots
      now so you are not guessing at 6:50 in the morning.
    </P>
    <WindowChecklist title="London inactives" time="7:00a CT" rows={CHECK_LONDON} />
    <WindowChecklist title="Noon inactives" time="10:30a CT" rows={CHECK_NOON} />
    <WindowChecklist title="3:05p and 3:25p inactives" time="about 1:35p and 1:55p CT" rows={CHECK_LATE} />
    <WindowChecklist title="Sunday night inactives" time="about 5:50p CT" rows={CHECK_SNF} />
    <WindowChecklist title="Monday night inactives" time="about 5:45p CT Monday" rows={CHECK_MNF} />

    <Quote>
      Start your studs, trust the usage over the name, and set your pivots before you go to bed
      Saturday. Friday&apos;s reports can change any of this, and I will not pretend they cannot.
    </Quote>
  </>
);

export default Body;
