import React from 'react';
import { Box } from '@mui/material';
import {
  Lead, P, H2, H3, Quote,
  Table, THead, TBody, TR, TH, TD,
} from '../../components/public/kit/Prose';

// Body only: the frontmatter lives in week5-start-sit-darkness-report.meta.js so listings can be
// built without loading this prose; content/articles/index.js loads it on demand.
//
// Every color below the hero is a theme token, so the board, cards and chips read in light and
// dark. The hero is a dark illustration in both themes, like the Week 3 start/sit banner.
//
// Reading key (also printed in the article): usage lines read wk1/wk2/wk3/wk4. c = carries,
// t = targets, pa = pass attempts. Week-1 snap share is unknown everywhere, so snap lines print
// weeks 2 to 4 only. FPA rank: 1 = most points allowed (good matchup for the opposing position),
// 32 = fewest (tough). Weeks 1 to 4 only.

const POS_COLOR = {
  QB: 'var(--pos-qb)', RB: 'var(--pos-rb)', WR: 'var(--pos-wr)', TE: 'var(--pos-te)',
  DEF: 'var(--pos-def)', K: 'var(--pos-k)', CB: 'var(--pos-idp)', S: 'var(--pos-idp)', LB: 'var(--pos-idp)', DL: 'var(--pos-idp)',
  DB: 'var(--pos-idp)',
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
      aria-labelledby="wk5ss-hero-title wk5ss-hero-desc"
    >
      <title id="wk5ss-hero-title">Week 5 Start/Sit: The Darkness Report</title>
      <desc id="wk5ss-hero-desc">
        A night football field in perspective, with yard lines, hash marks and goalposts under a
        floodlight, and a glowing football arcing across the sky over the headline Week 5 Start/Sit.
      </desc>
      <defs>
        <linearGradient id="wk5ss-sky" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#060910" />
          <stop offset="0.55" stopColor="#0c1424" />
          <stop offset="1" stopColor="#1a0f24" />
        </linearGradient>
        <radialGradient id="wk5ss-flood" cx="0.5" cy="0.1" r="0.85">
          <stop offset="0" stopColor="#7eaaff" stopOpacity="0.34" />
          <stop offset="1" stopColor="#7eaaff" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="wk5ss-turf" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#0f3a2a" />
          <stop offset="1" stopColor="#06180f" />
        </linearGradient>
        <linearGradient id="wk5ss-trail" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#2fd97b" stopOpacity="0" />
          <stop offset="1" stopColor="#ffd866" stopOpacity="0.95" />
        </linearGradient>
      </defs>
      <rect width="800" height="300" fill="url(#wk5ss-sky)" />
      <rect width="800" height="300" fill="url(#wk5ss-flood)" />
      <rect x="0" y="150" width="800" height="150" fill="url(#wk5ss-turf)" />
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
      <path d="M96 236 C 190 24, 420 -6, 520 96" fill="none" stroke="url(#wk5ss-trail)" strokeWidth="3" strokeLinecap="round" strokeDasharray="2 9" />
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
      <text x="400" y="244" textAnchor="middle" fill="#ffffff" fontFamily="system-ui, sans-serif" fontWeight="850" fontSize="24" letterSpacing="1">WEEK 5 START / SIT</text>
      <text x="400" y="268" textAnchor="middle" fill="#8badc9" fontFamily="system-ui, sans-serif" fontWeight="600" fontSize="12" letterSpacing="2">WEEK 5 | THURSDAY TO MONDAY | 15 GAMES</text>
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
  const max = 30;
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
// Usage lines read wk1/wk2/wk3/wk4; snap lines print week 1 as "--" because week-1 snap share is
// unknown everywhere. Games are in kickoff order.
const GAMES = [
  {
    id: 'tb-dal', slot: 'thu', title: 'Buccaneers at Cowboys', kick: 'Thu 7:15p', when: 'Thursday Night · 7:15p CT',
    away: 'TB', home: 'DAL', awayPts: 19.5, homePts: 28, line: 'DAL -8.5', total: 47.5, weather: '82F clear outside, roof status unknown', rain: false,
    read: 'Jalon Daniels makes his second start on a short week against a defense that has allowed the second-most points in the league to quarterbacks (rank 2). The Dallas side is the play, and Dallas is at 28.0. Thursday means no pivot cover: the inactives drop about 5:45p CT, and whatever you start is locked. Tampa is without Winfield, Morrison and Dennis on defense; Dallas is without Durant and Overshown.',
    fpa: 'TB offense vs DAL D: QB 2, RB 14, WR 12, TE 13 · DAL offense vs TB D: QB 25, RB 24, WR 28, TE 8, K 1 (TB allows the most kicker points)',
    start: [
      ['CeeDee Lamb', 'WR', 't8/9/8/21, 15.4/35.3/20.2/41.3, 49% target share in wk4, snaps --/75/82/86%, proj 19.24 (n=33, high). TB WR rank 28 is the soft-pedal; the share and the 28.0 implied outweigh it.', 'WR3', 'smash'],
      ['Dak Prescott', 'QB', 'pa34/31/40/45, 335 yards on 45 attempts in wk4, 20.3 avg, proj 19.35 (n=29, medium). TB QB rank 25 is the one drag; DAL at 28.0 carries him.', 'QB6'],
      ['Javonte Williams', 'RB', 'c12/12/19/19, 24.2/8.0/18.3/31.3, 20.5 avg, snaps --/80/76/74%, proj 15.06 (n=37, medium), TB RB rank 24.', 'RB9'],
      ['DAL D/ST', 'DEF', 'The Thursday streamer, ranked on context. The 0.34 projection is overridden: a rookie quarterback with 2 INT last week, TB at 19.5, and TB\'s offense gives D/STs the second-most points (rank 2). 3.0/3.0/-1.0/1.0, sacks 2/0/0/2.', 'DST6', 'C13'],
    ],
    flex: [
      ['George Pickens', 'WR', 't6/8/11/3 and a 7% target share in wk4 with Lamb at 49%, snaps --/76/85/86%, proj 8.05 (n=35, medium), TB WR rank 28.', 'WR30'],
      ['Jake Ferguson', 'TE', 't2/4/5/4, 2.6/20.3/9.3/4.1, proj 7.74 (n=35, medium), TB TE rank 8.', 'TE15-16'],
      ['Bucky Irving', 'RB', 'c8/17/15/16, t7/4/4/0, 20.3/13.0/7.8/6.1: zero targets and 6.1 in wk4, snaps --/78/52/59%, proj 11.06 (n=31, medium). DAL -8.5 means a negative script for Tampa. A flex, not a start.', 'RB19', 'C13'],
      ['Emeka Egbuka', 'WR', 't6/5/9/4, 3.3 in wk4 with Daniels, snaps --/86/74/94%, proj 8.47 (n=21, medium). Flex only.', 'WR31-34'],
      ['Jalon Daniels', 'QB', 'Superflex flex only. pa--/--/3/27, 148 passing yards and 55 rushing, 1 TD and 2 INT in wk4, proj 8.61. DAL QB rank 2 is the matchup. 1QB sit.', null, 'C13'],
      ['Brandon Aubrey', 'K', 'Dallas kicker: 2.0/16.0/11.0/12.0, proj 10.78 (n=38, medium), TB K rank 1 and DAL at 28.0.', 'K3'],
    ],
    watch: [
      ['Jonathan Mingo', 'WR', 'DAL, illness, DNP Wednesday, Q on the Thursday report. Irrelevant to lineups.'],
      ['Chase McLaughlin', 'K', 'TB kicker, conflicting reports (NFL.com full, RotoBaller groin and hip). Check the report before 5:45p CT; there is no pivot cover.'],
    ],
    sit: [
      ['Jalon Daniels', 'QB', 'AVOID in 1QB: 27 attempts and 2 INT in his debut, proj 8.61.', null, 'C13'],
      ['Chris Godwin Jr.', 'WR', 't4/3/4/7, 8.3/8.8/5.5/9.1, proj 7.09 (n=20, medium).'],
      ['Cade Otton', 'TE', 't5/6/6/6, 7.7 avg, proj 7.52.'],
      ['Kenny Gainwell', 'RB', 'c5/2/3/3, t1/4/5/2, proj 7.00.'],
      ['TB D/ST', 'DEF', 'Proj 6.77 against DAL at 28.0.'],
    ],
    also: 'Tyler Goodson (c6/3), Demercado, Sean Tucker, Ted Hurst III (n=4). Mayfield (thumb) is out until Week 7 at the earliest. There is no pivot cover on Thursday: if a name here is wrong at 5:45p CT, you cannot fix it.',
  },
  {
    id: 'phi-jax', slot: 'early', title: 'Eagles at Jaguars', kick: 'Sun 8:30a', when: 'Sun 8:30a CT · London (Tottenham)',
    away: 'PHI', home: 'JAX', awayPts: 17.25, homePts: 24.25, line: 'JAX -7', total: 41.5, weather: null,
    read: 'Philadelphia goes to London without Barkley (hamstring, DNP Wednesday), Bigsby (IR), DeVonta Smith and Hollywood Brown (both DNP Wednesday), and it is implied for 17.25. Jacksonville is the side. London kicks first, so there is no pivot cover: check the 7:00a CT inactives. I have no forecast for Tottenham.',
    fpa: 'PHI offense vs JAX D: QB 24, RB 23, WR 10, TE 26 · JAX offense vs PHI D: QB 10, RB 12, WR 11, TE 28',
    start: [
      ['Trevor Lawrence', 'QB', 'pa23/29/29/23, 26.1/6.2/19.8/13.1, 16.3 avg, proj 20.53 (n=31, high) is the engine\'s QB2. PHI QB rank 10, JAX at 24.25.', 'QB7'],
      ['Bhayshul Tuten', 'RB', 'c15/13/15/17, 9.8/14.2/17.0/11.1, 13.0 avg, snaps --/51/48/59%, proj 11.16 (n=19, medium), PHI RB rank 12.', 'RB17'],
      ['Will Shipley', 'RB', 'By role, not by projection: c2/7/0/6 and 48% of snaps in wk4. The 2.69 projection is ignored. Barkley is DNP and week-to-week, Bigsby is on IR, and Shipley is the only healthy back on the active roster (Inquirer, Oct 6). Dameon Pierce was signed from the practice squad.', 'RB21', 'C2'],
      ['JAX D/ST', 'DEF', 'Proj 11.78, 17.0/3.0/16.0/6.0, sacks 5/0/2/2, PHI at 17.25 and short its receivers.', 'DST3'],
    ],
    flex: [
      ['Parker Washington', 'WR', 't6/12/5/3, falling, 19.3/17.8/13.0/2.0, snaps --/81/81/80%, proj 11.84 (n=37, medium).', 'WR27'],
      ['Brenton Strange', 'TE', 't3/2/5/8, a 35% target share and 16.5 in wk4, proj 6.88 (n=33, medium), PHI TE rank 28.', 'TE11'],
      ['Dallas Goedert', 'TE', 'If active. Knee, limited Wednesday. With Smith and Brown out he is the target hog: t5/2 in his two games, 23.7/1.4, proj 8.97 (n=27, low). London has no pivot, so pair him with a noon-or-later tight end on your bench.', 'TE12', 'C22'],
      ['Jakobi Meyers', 'WR', 't2/1/8/4, snaps --/90/81/82%, proj 9.66 (n=35, medium). Flex only.', 'WR34-38'],
      ['Dontayvion Wicks', 'WR', 'Flex dart. t4/6/5/5, snaps --/62/88/92%, 4.8 in wk4. The PHI WR1 by default with Smith and Brown out.', 'WR36-40'],
    ],
    watch: [
      ['Saquon Barkley', 'RB', 'Hamstring, DNP Wednesday, week-to-week, and "unlikely" per the Rapoport read. OUT by rule. If he is somehow active at 7:00a CT he is an RB2 flex (RB18-20).', null, 'C2'],
      ['Dallas Goedert', 'TE', 'Limited Wednesday. Inactives at 7:00a CT.', null, 'C22'],
      ['DeVonta Smith', 'WR', 'Hamstring, DNP Wednesday, missed wk4. OUT.'],
      ['Hollywood Brown', 'WR', 'Ankle, DNP Wednesday. OUT.'],
    ],
    sit: [
      ['Jalen Hurts', 'QB', 'Sit in 1QB (QB15-16): pa25/37/25/27, 93 passing yards and 13.5 in wk4, PHI at 17.25 with no receivers. Superflex START.', 'QB15-16', 'C15'],
      ['Saquon Barkley', 'RB', 'OUT by rule. c15/4/15/2 and 7% of snaps in wk4, proj 5.74 (n=36, low).', 'OUT', 'C2'],
      ['DeVonta Smith', 'WR', 'OUT.', 'OUT'],
      ['Hollywood Brown', 'WR', 'OUT.', 'OUT'],
      ['Brian Thomas Jr.', 'WR', 't3/8/1/2, a 9% target share in wk4.'],
      ['Travis Hunter', 'WR', 'Snaps --/10/8/0%. Zero snaps in wk4.'],
      ['PHI D/ST', 'DEF', 'Proj 4.19.'],
    ],
    also: 'Chris Rodriguez Jr. (c6/6/8/6, 22/21/25% snaps, proj 6.26), Cam Little (JAX K, 8.87), Jake Elliott (PHI K, 4.89). Zack Baun (concussion protocol, limited Wednesday) is the IDP note: see the IDP board. Bigsby is on IR with an abdomen injury.',
  },
  {
    id: 'cin-mia', slot: 'early', title: 'Bengals at Dolphins', kick: 'Sun 12:00', when: 'Sun 12:00 CT',
    away: 'CIN', home: 'MIA', awayPts: 24.5, homePts: 18, line: 'CIN -6.5', total: 42.5, weather: '89F, wind 12, 15% storms', rain: false,
    read: 'Chase (concussion protocol) and Higgins (groin and neck, did not practice Wednesday) decide this one, and neither has a designation yet. Noon game, inactives at 10:30a CT. Miami allows the third-fewest points in the league to wide receivers (rank 30) but the third-most to tight ends (rank 3) and gives up the most to opposing D/STs (rank 1), so the Cincinnati defense and Gesicki are starts either way.',
    fpa: 'CIN offense vs MIA D: QB 12, RB 5, WR 30, TE 3 · MIA offense vs CIN D: QB 18, RB 20, WR 21, TE 6',
    start: [
      ['Chase Brown', 'RB', 'c16/20/13/9, t6/5/2/11, 18.8/11.2/8.9/20.1, snaps --/70/70/79%, proj 17.63 (n=37, high), MIA RB rank 5.', 'RB7'],
      ['Joe Burrow', 'QB', 'pa35/31/37/54, 428 yards in wk4 mostly without Chase, 19.2 avg, proj 17.90 (n=29, medium), CIN at 24.5.', 'QB5'],
      ['Mike Gesicki', 'TE', 't7/--/3/5, 3 TD in 3 games, 14.8 avg, snaps --/--/51/62%, proj 8.07 (n=32, low), MIA TE rank 3. TE6 if Chase is out.', 'TE9'],
      ['CIN D/ST', 'DEF', 'Override up. Proj 7.17, 16.0/11.0/2.0/5.0, sacks 4/4/2/4, but MIA is at 18.0 and its offense gives D/STs the most points in the league (rank 1).', 'DST4'],
      ['Ja\'Marr Chase', 'WR', 'ONLY if cleared. Concussion protocol. t4/9/12/3, snaps --/88/100/20% (he left wk4 early), proj 14.06 (n=37, low). Default ranking treats him as OUT.', 'WR9', 'C3'],
      ['Tee Higgins', 'WR', 'If active. Groin and neck, did not practice Wednesday, day-to-day. t6/10/7/16, 11 for 157 and 26.7 in wk4 after Chase left, proj 12.47 (n=31, low). WR7 if he plays and Chase does not.', 'WR12', 'C3'],
    ],
    flex: [
      ['Malik Washington', 'WR', 'MIA. t8/5/10/5, a 29% share in wk4, 9.5 avg, snaps --/73/86/87%, proj 8.52 (n=35, medium). CIN WR rank 21.', 'WR32-35'],
      ['Ollie Gordon II', 'RB', 'By role: c--/3/17/9, 100 rushing yards and 18.0 in wk4, Achane on IR. His 3.77 projection (n=20, medium) is known-wrong and ignored. CIN RB rank 20.', 'RB24'],
      ['Mitchell Tinsley', 'WR', 'Dart only if both CIN receivers are out: t7 and a 13% share in wk4, 53% of snaps.'],
    ],
    watch: [
      ['Ja\'Marr Chase', 'WR', 'Concussion protocol, no clearance reported. Friday clearance plus active at 10:30a CT: WR9, with a noon-or-later bench WR ready.', null, 'C3'],
      ['Tee Higgins', 'WR', 'Did not practice Wednesday. Active with Chase out: WR7.', null, 'C3'],
      ['Caleb Douglas', 'WR', 'MIA, ankle, DNP Wednesday. Sit.'],
    ],
    sit: [
      ['Samaje Perine', 'RB', 'c5/2/3/3, 4.0 avg.'],
      ['Greg Dulcich', 'TE', 't2/3/7/--, proj 6.39 (n=19, low).'],
      ['MIA quarterback', 'QB', 'Not rankable. Malik Willis starts for a team implied at 18.0.'],
      ['MIA D/ST', 'DEF', 'Proj 4.73 against CIN at 24.5.'],
      ['Caleb Douglas', 'WR', 'DNP Wednesday, t7/3 in two games.'],
    ],
    also: 'Dexter Lawrence (Q) and Barrett Carter (Q) are the CIN defensive notes.',
  },
  {
    id: 'cle-nyj', slot: 'early', title: 'Browns at Jets', kick: 'Sun 12:00', when: 'Sun 12:00 CT',
    away: 'CLE', home: 'NYJ', awayPts: 19, homePts: 20.5, line: 'NYJ -1.5', total: 39.5, weather: '69F', rain: false,
    read: 'The lowest total on the slate after Houston at Tennessee. Breece Hall (quad, DNP Wednesday, week-to-week, listed doubtful in our feed) is out by rule, and Judkins against the fourth-most generous run defense is the one clean start. Noon game, no pivot cover.',
    fpa: 'CLE offense vs NYJ D: QB 28, RB 4, WR 25, TE 25 · NYJ offense vs CLE D: QB 9, RB 27, WR 5, TE 10',
    start: [
      ['Quinshon Judkins', 'RB', 'c12/12/18/17, t2/5/2/7, 21.6 in wk4, 12.1 avg, snaps --/67/51/66%, proj 11.10 (n=18, medium), NYJ RB rank 4.', 'RB14'],
      ['Garrett Wilson', 'WR', 't7/7/13/4, 5.7 in wk4 on 15 team attempts, snaps --/88/94/100%, proj 14.52 (n=28, low), CLE WR rank 5.', 'WR13'],
      ['Harold Fannin Jr.', 'TE', 't3/6/9/5, 3 TD, 12.6 avg, proj 10.18 (n=20, medium). NYJ TE rank 25 is the tough side.', 'TE8'],
    ],
    flex: [
      ['Denzel Boston', 'WR', 'Flex-start. t4/7/4/7, 14.1 avg, 13.9 in wk4, snaps --/93/89/95%, proj 11.56 (n=4, medium), NYJ WR rank 25.', 'WR19'],
      ['Kenyon Sadiq', 'TE', 't3/3/8/4, 0.0 in wk4 after 23.5 in wk3. The engine\'s 13.16 (n=4, low) is too high. CLE TE rank 10.', 'TE10'],
      ['Braelon Allen', 'RB', 'Only because Hall is out. c10/5/4/14 and 94% of snaps in wk4, 8.7, proj 4.55 (n=25, low). CLE RB rank 27 is tough.', 'RB25-28', 'C11'],
      ['Deshaun Watson', 'QB', 'CLE starter, snaps --/100/99/100%. pa22/30/30/33, 16.7 avg, proj 14.10 (n=11, medium), NYJ QB rank 28. Superflex START, 1QB streamer.', 'QB16-18'],
      ['Geno Smith', 'QB', 'Superflex flex only: 14.9 avg, 8.8 in wk4 on 15 attempts. CLE QB rank 9.'],
      ['CLE D/ST', 'DEF', 'Borderline. Proj 7.39, sacks 1/3/3/5, NYJ at 20.5.', 'DST9'],
      ['NYJ D/ST', 'DEF', 'Proj 3.83, CLE at 19.0.', 'DST11'],
    ],
    watch: [
      ['Breece Hall', 'RB', 'Quad, DNP Wednesday, week-to-week. OUT.', 'OUT', 'C11'],
      ['Adonai Mitchell', 'WR', 'Finger, DNP, week-to-week. OUT.', 'OUT'],
      ['Mason Taylor', 'TE', 'Full Wednesday (the waiver report had him Out with a thumb as of Tuesday), and only one game of data. Sit.'],
    ],
    sit: [
      ['Breece Hall', 'RB', 'OUT. c22/16/13 through wk3, proj 12.04 (n=35, low).', 'OUT', 'C11'],
      ['Adonai Mitchell', 'WR', 'OUT. t3/12 in two games.', 'OUT'],
      ['KC Concepcion', 'WR', '7.6 avg, t5/6/9/8.'],
      ['Isaiah Davis', 'RB', 'Sit.'],
      ['Raheim Sanders', 'RB', 'c1/2/1/2, proj 4.65.'],
      ['Mason Taylor', 'TE', 'Sit.'],
    ],
    also: 'Jaleel McLaughlin (c1 in wk4, 2% snaps), Chip Trayanum (placeholder projection 7.03, n=0), Tylan Wallace (Q). Szmyt (CLE K, 8.24) and Sanders (NYJ K, 7.16) are not kicker plays.',
  },
  {
    id: 'hou-ten', slot: 'early', title: 'Texans at Titans', kick: 'Sun 12:00', when: 'Sun 12:00 CT',
    away: 'HOU', home: 'TEN', awayPts: 23, homePts: 15.5, line: 'HOU -7.5', total: 38.5, weather: '71F, wind 15, rain 50%', rain: true,
    read: 'Tennessee\'s 15.5 is the lowest implied total on the slate. Houston\'s defense is the start, Collins is the WR1, and the Tennessee side is Carnell Tate against the defense that has allowed the most points in the league to wide receivers (rank 1). Wind at 15 mph and a 50% chance of rain: no point adjustments, only a tiebreak toward rushers.',
    fpa: 'HOU offense vs TEN D: QB 27, RB 16, WR 14, TE 21 · TEN offense vs HOU D: QB 7, RB 28, WR 1, TE 17, K 2',
    start: [
      ['Nico Collins', 'WR', 't10/--/--/8, 118 yards, 2 TD and 30.8 in wk4, 69% of snaps, proj 18.33 (n=29, medium). Listed limited Wednesday with no injury text: treat as active and confirm at 10:30a CT.', 'WR5'],
      ['HOU D/ST', 'DEF', 'Proj 10.30, sacks 2/5/4/3, TEN at 15.5 and its offense gives D/STs the fifth-most points (rank 5). Wind at 15 mph helps.', 'DST2'],
      ['Ka\'imi Fairbairn', 'K', '9.5/8.0/5.0/16.0, proj 10.36 (n=36, medium), TEN K rank 8.', 'K4'],
    ],
    flex: [
      ['Carnell Tate', 'WR', 'Flex-start. t6/5/9/12, a 43% share, 145 yards and 21.5 in wk4, proj 8.32 (n=4, low), HOU WR rank 1.', 'WR21'],
      ['C.J. Stroud', 'QB', 'Streamer. pa38/55/27/31, 347 yards and 23.1 in wk4, 17.1 avg, proj 15.16 (n=35, medium). TEN QB rank 27, wind and rain.', 'QB12'],
      ['David Montgomery', 'RB', 'c20/6/11/10, 11.1 avg, 4.3 in wk4, a goal-line role, proj 6.44 (n=35, medium).', 'RB27-30'],
      ['Wan\'Dale Robinson', 'WR', 't6/1/11/5, snaps --/53/63/67%, proj 11.00 (n=37, medium).', 'WR33-36'],
      ['Tony Pollard', 'RB', 'ONLY if active. Foot, DNP Wednesday. c7/14/17/16, 13.6 and 13.0 the last two, proj 7.74 (n=37, low). HOU RB rank 28.', 'RB26', 'C19'],
      ['Tyjae Spears', 'RB', 'If Pollard is out. c3/7/3/2, 36% of snaps in wk4. A sit-lean either way.', 'RB30-32', 'C19'],
    ],
    watch: [
      ['Tony Pollard', 'RB', 'DNP Wednesday, foot. Noon game, inactives 10:30a CT.', null, 'C19'],
      ['Tank Dell', 'WR', 'IR, practice window opened, "likely won\'t be activated" per Ryans. Not this week.'],
      ['Will Anderson Jr.', 'DL', 'DNP Wednesday, Q. HOU defense and IDP note.'],
    ],
    sit: [
      ['Woody Marks', 'RB', '7.7 avg, c9/8/5/6.'],
      ['Dalton Schultz', 'TE', 't3/2 the last two, 6.0 and 2.9.'],
      ['Xavier Hutchinson', 'WR', '31% of snaps in wk4.'],
      ['Elic Ayomanor', 'WR', 't3/3/3/1, 5.6 avg.'],
      ['TEN quarterback', 'QB', 'Not rankable. TEN is at 15.5 in the wind.'],
      ['TEN D/ST', 'DEF', 'Proj 4.95 against HOU at 23.0.'],
    ],
    also: 'Tank Dell (IR), Jayden Higgins (IR), Joey Slye (TEN K, 4.09). Jeffery Simmons (Q, back) and Amani Hooker (concussion protocol, DNP Wednesday) are the Tennessee defensive notes.',
  },
  {
    id: 'ind-pit', slot: 'early', title: 'Colts at Steelers', kick: 'Sun 12:00', when: 'Sun 12:00 CT',
    away: 'IND', home: 'PIT', awayPts: 21, homePts: 23.5, line: 'PIT -2.5', total: 44.5, weather: '66F, wind 12, rain 76%', rain: true,
    read: 'Rain at 76% and two run games that travel. Taylor is a smash, and Jaylen Warren at 97% of the snaps is an RB2 against the ninth-most generous run defense. The rain gets a tiebreak toward rushers and nothing else.',
    fpa: 'IND offense vs PIT D: QB 30, RB 10, WR 24, TE 22 · PIT offense vs IND D: QB 6, RB 9, WR 13, TE 16, K 6',
    start: [
      ['Jonathan Taylor', 'RB', 'c19/24/23/20, 25.1/29.2/9.2/22.7, 21.6 avg, snaps --/94/85/71%, proj 18.10 (n=35, medium), PIT RB rank 10. Limited Wednesday is rest. Rain helps a runner.', 'RB5', 'smash'],
      ['Jaylen Warren', 'RB', 'c10/11/17/17, t6/4/4/6, 97% of snaps in wk4, 14.1 avg, proj 13.04 (n=35, high), IND RB rank 9.', 'RB12'],
      ['Tyler Warren', 'TE', 't5/7/10/5, 12.1 avg, proj 9.66 (n=21, medium), PIT TE rank 22.', 'TE6'],
      ['Aaron Rodgers', 'QB', 'pa40/39/34/40, 22.7 and 22.0 the last two, proj 17.38 (n=37, high), IND QB rank 6.', 'QB9'],
      ['PIT D/ST', 'DEF', 'Proj 9.94, 22.0/9.0/5.0/6.0, sacks 4/3/1/2, IND at 21.0, rain.', 'DST7'],
      ['Spencer Shrader', 'K', '7.5/14.0/17.0/16.0, proj 12.30 (n=13, low), PIT K rank 9 and IND at 21.0.', 'K2'],
    ],
    flex: [
      ['DK Metcalf', 'WR', 'Flex-start. t10/9/5/9, 115 yards and 16.5 in wk4, snaps --/97/95/97%, proj 9.44 (n=34, medium), IND WR rank 13.', 'WR16'],
      ['Josh Downs', 'WR', 'PPR flex. t4/9/11/4, 4.6 in wk4, snaps --/83/68/77%, proj 9.48 (n=34, medium).', 'WR31-34'],
      ['Keenan Allen', 'WR', 'Flex if active. Groin, limited Wednesday, "resumed." t6/5/9/--, 18.3 in wk3, proj 7.52 (n=35, low).', 'WR33-36'],
      ['Pat Freiermuth', 'TE', 'PIT. 15.6/7.4/5.1/10.7, t5/5/4/5, proj 7.05 (n=36, medium).', 'TE15-16'],
      ['Roman Wilson', 'WR', 'Dart. 15.0 and 17.4 the last two, but his snaps fell to 31% in wk4 (79/39/31%).'],
    ],
    watch: [
      ['Keenan Allen', 'WR', 'Noon, no pivot cover. Confirm at 10:30a CT.'],
      ['Rico Dowdle', 'RB', 'PIT, toe, limited Wednesday. Sit either way.'],
      ['Michael Pittman Jr.', 'WR', 'PIT, foot, limited Wednesday, load management. Sit.'],
      ['Jalen Ramsey', 'CB', 'PIT, wrist, DNP Wednesday. D/ST note.'],
    ],
    sit: [
      ['IND quarterback', 'QB', 'Not ranked: not rankable from our data. Daniel Jones threw 31/31/36/34 attempts.'],
      ['Rico Dowdle', 'RB', 'c8/7 in two games, proj 8.19 (n=35, low). Sit.'],
      ['Michael Pittman Jr.', 'WR', 't3/--/5/4, 8.8/--/3.6/4.5. Sit.'],
      ['Ashton Dulin', 'WR', 'DNP, Q. Sit.'],
      ['IND D/ST', 'DEF', 'Proj 3.78.'],
    ],
    also: 'Slayton (IND, 6.49), Boswell (PIT K, 7.58), Mason Rudolph and Allar (placeholder projection 15.57, n=0). Alec Pierce is on IR. Akeem Davis-Gaither (Q) is the Indianapolis IDP note.',
  },
  {
    id: 'lv-ne', slot: 'early', title: 'Raiders at Patriots', kick: 'Sun 12:00', when: 'Sun 12:00 CT',
    away: 'LV', home: 'NE', awayPts: 21, homePts: 24.5, line: 'NE -3.5', total: 45.5, weather: '67F', rain: false,
    read: 'Jeanty is a full-go RB1. Bowers (knee, limited Wednesday) against the defense that has allowed the fewest tight end points in the league (rank 32) is still a start if he is active. Maye\'s 26.2 was his first good week, and he gets a middle-of-the-pack quarterback defense (LV rank 15).',
    fpa: 'LV offense vs NE D: QB 26, RB 19, WR 8, TE 32 · NE offense vs LV D: QB 15, RB 17, WR 27, TE 7, K 31',
    start: [
      ['Ashton Jeanty', 'RB', 'c23/21/19/15, t6/7/3/8, 32.7/11.3/12.3/18.6, 18.7 avg, snaps --/81/84/67%, proj 12.72 (n=21, medium), NE RB rank 19. Full practice.', 'RB11'],
      ['Brock Bowers', 'TE', 'If active. t13/11 in his two games (wks 3-4), 27.6 and 20.6, snaps 79/82%, proj 14.69 (n=31, low). Knee, limited Wednesday. NE TE rank 32 is the tough side; the share outweighs it. Noon game: keep a noon-or-later tight end as cover.', 'TE3', 'C8'],
      ['Drake Maye', 'QB', 'pa33/22/25/37, 3 TD and 54 rushing yards in wk4 for 26.2, 12.2 avg across four weeks, proj 16.25 (n=34, medium), LV QB rank 15. Full practice, right shoulder.', 'QB8'],
    ],
    flex: [
      ['Rhamondre Stevenson', 'RB', 'If active. Leg and knee, Q; Vrabel is "optimistic he can play." c18/6/7/13, 14.5/3.6/6.8/18.4, snaps --/36/52/66%, proj 10.90 (n=33, low), LV RB rank 17.', 'RB23', 'C9'],
      ['TreVeyon Henderson', 'RB', 'If Stevenson is out. c--/16/8/14, 37% of snaps and 4.2 in wk4. Bench him if Stevenson plays.', 'RB24-27', 'C9'],
      ['Romeo Doubs', 'WR', 'Flex-start. t3/4/4/9, 2 TD and 23.8 in wk4, snaps --/67/73/64%, proj 8.53 (n=33, medium). Hollins is out and A.J. Brown is on IR, which makes Doubs the NE WR1. LV WR rank 27 is tough.', 'WR25'],
      ['Tre Tucker', 'WR', 't4/7/4/8, 11.1 avg, proj 8.59 (n=38, medium), NE WR rank 8.', 'WR29'],
      ['Kirk Cousins', 'QB', 'Streamer. pa30/29/33/52, 22.2 and 22.6 the last two, 19.7 avg, proj 13.73 (n=28, medium), NE QB rank 26. Superflex START.', 'QB13-15'],
      ['Hunter Henry', 'TE', 'NE. t3/5/2/5, 11.2 in wk4, proj 7.95 (n=37, medium), LV TE rank 7.', 'TE13-15'],
      ['LV D/ST', 'DEF', 'Proj 9.68, 17.0/13.0/12.0/1.0, sacks 5/3/2/2, but NE is at 24.5 and its offense gives D/STs the fourth-most points (rank 4).', 'DST9'],
      ['NE D/ST', 'DEF', 'Proj 6.78, LV at 21.0.', 'DST10'],
    ],
    watch: [
      ['Brock Bowers', 'TE', 'Limited Wednesday. Inactives at 10:30a CT; carry a noon-or-later tight end.', null, 'C8'],
      ['Rhamondre Stevenson', 'RB', 'Decide at 10:30a CT. If he sits, Henderson is the flex.', null, 'C9'],
      ['Mack Hollins', 'WR', 'Calf, did not practice Wednesday. OUT.', 'OUT'],
      ['Jalen Nailor', 'WR', 'Concussion, did not practice Wednesday. OUT.', 'OUT'],
    ],
    sit: [
      ['Mack Hollins', 'WR', 'OUT. t5/2/9/4.', 'OUT'],
      ['Jalen Nailor', 'WR', 'OUT.', 'OUT'],
      ['Dont\'e Thornton Jr.', 'WR', 'Designated to return from IR, in his 21-day window.'],
      ['Mike Washington Jr.', 'RB', 'c7/3/5/9, 21% of snaps in wk4.'],
      ['Cody White', 'WR', 'Q. Sit.'],
    ],
    also: 'Matt Gay (LV K, 7.40), Borregales (NE K, 4.61), Kwity Paye (LV DL, IDP board). A.J. Brown (NE WR) is on IR.',
  },
  {
    id: 'min-no', slot: 'early', title: 'Vikings at Saints', kick: 'Sun 12:00', when: 'Sun 12:00 CT · Dome',
    away: 'MIN', home: 'NO', awayPts: 22, homePts: 20.5, line: 'MIN -1.5', total: 42.5, weather: 'Dome', rain: false,
    read: 'Minnesota\'s defense has allowed the fewest points in the league to quarterbacks and running backs (rank 32 on both), and New Orleans has allowed the most to running backs (rank 1). Aaron Jones is the start, Olave is the WR1, Shough takes a matchup downgrade, and the Jefferson, Addison and Hockenson triangle is a ruling.',
    fpa: 'MIN offense vs NO D: QB 16, RB 1, WR 18, TE 9 · NO offense vs MIN D: QB 32, RB 32, WR 19, TE 29',
    start: [
      ['Aaron Jones', 'RB', 'c12/23/17/20, t1/0/6/8, 16.8 in wk4, snaps --/81/80/73%, proj 12.07 (n=33, high), NO RB rank 1. Limited Wednesday is rest.', 'RB10'],
      ['Chris Olave', 'WR', 't13/10/13/12, 22.5 avg, snaps --/84/84/86%, proj 19.26 (n=28, medium). DNP Wednesday is rest.', 'WR6'],
      ['T.J. Hockenson', 'TE', 'Start either way. t4/4/13 in the last three, 13 for 119 and 24.9 in wk4 without Jefferson, a 39% share, 12.1 avg, proj 11.11 (n=29, medium). TE4 if Jefferson is out.', 'TE5', 'C4'],
      ['Juwan Johnson', 'TE', 't7/4/8/8, 14.4/10.6/26.3/11.9, 15.8 avg, proj 12.27 (n=38, medium). MIN TE rank 29 is tough.', 'TE7'],
      ['MIN D/ST', 'DEF', 'The lock. Proj 13.08, 14.5 avg, 7.0/21.0/15.0/15.0, sacks 4/4/6/2, NO at 20.5.', 'DST1'],
      ['Justin Jefferson', 'WR', 'START if active. Ankle, aiming to play; sat out wk4. t9/6/2/--, 31.2/8.5/5.2, snaps --/100/12/--%, proj 11.96 (n=37, low). Noon game: keep a noon-or-later bench WR ready at 10:30a CT. Friday DNP: pivot.', 'WR10', 'C4'],
      ['Will Reichard', 'K', '7.0/10.0/16.0/19.0, 13.0 avg, proj 10.17 (n=34, medium), NO K rank 16.', 'K5'],
    ],
    flex: [
      ['Tyler Shough', 'QB', 'Matchup override down from the engine\'s QB8. pa56/34/42/48, 21.3 avg, proj 18.32 (n=15, low); limited Wednesday with a non-throwing hand injury. MIN QB rank 32. Superflex START, 1QB streamer.', 'QB11', 'C17'],
      ['Devaughn Vele', 'WR', 't9/7/6/9, 13.9 avg, 17.4 in wk4, snaps --/96/88/89%, proj 9.50 (n=26, low).', 'WR30-33'],
      ['Jordan Addison', 'WR', 'Default OUT. Hamstring, DNP Wednesday, "soreness." If active he is a flex: t2/5/9/6, 20.0 in wk3, snaps --/88/98/96%, proj 7.10 (n=33, low).', 'WR30-34', 'C4'],
    ],
    watch: [
      ['Justin Jefferson', 'WR', 'Ankle. Friday LP and he is active: WR10, with a noon-or-later bench WR ready. Friday DNP: pivot.', null, 'C4'],
      ['Jordan Addison', 'WR', 'DNP Wednesday. Default OUT.', null, 'C4'],
      ['Alvin Kamara', 'RB', 'Back, did not participate in the Wednesday walkthrough. Sit even if active.', null, 'C18'],
      ['Tyler Shough', 'QB', 'Non-throwing hand, limited Wednesday. Likely plays.', null, 'C17'],
    ],
    sit: [
      ['Alvin Kamara', 'RB', 'Sit even if active. c--/9/9/7, 22.8 in wk4 on 38% of snaps, proj 8.95 (n=28, low). MIN RB rank 32 is the worst matchup in the league. RB28-30 at best.', 'RB28-30', 'C18'],
      ['MIN quarterback', 'QB', 'Kyler Murray. Not ranked.'],
      ['Kendre Miller', 'RB', 'c9/--/4/6, 26% of snaps in wk4.'],
      ['NO D/ST', 'DEF', 'Proj 4.10.'],
      ['Noah Fant', 'TE', 'Abdomen, limited Wednesday. Sit.'],
    ],
    also: 'CJ Donaldson (c2/1/1/3), Barion Brown, Jordyn Tyson (IR, Week 7 at the earliest), Etienne is on IR. Kaden Elliss (Q) and Carl Granderson (Q) are the New Orleans IDP notes.',
  },
  {
    id: 'nyg-wsh', slot: 'early', title: 'Giants at Commanders', kick: 'Sun 12:00', when: 'Sun 12:00 CT',
    away: 'NYG', home: 'WSH', awayPts: 19, homePts: 22.5, line: 'WSH -3.5', total: 41.5, weather: '66F, rain 63%', rain: true,
    read: 'Jayden Daniels took a full practice Wednesday and is on track to start. His two receivers, McLaurin and Diggs, both sat out Wednesday with hamstrings and are out by rule in a noon game. Nabers (knee, DNP Wednesday) is the other side\'s ruling. Rain 63%, no pivot cover.',
    fpa: 'NYG offense vs WSH D: QB 3, RB 29, WR 3, TE 5, K 4 · WSH offense vs NYG D: QB 20, RB 18, WR 17, TE 15',
    start: [
      ['Dominic Zvada', 'K', '4.0/8.0/12.0/14.0, proj 14.13 (n=4, medium). WSH allows the fourth-most kicker points (rank 4) and NYG is at 19.0.', 'K1'],
    ],
    flex: [
      ['Jayden Daniels', 'QB', 'If he starts. Full practice Wednesday, proj 15.53 (n=26, low). pa34/17 in his two games, 17.7 and 14.7, 16.2 avg, NYG QB rank 20, rain. Superflex START, 1QB streamer.', 'QB13', 'C5'],
      ['Malik Nabers', 'WR', 'If active; hold only if Friday is LP. Knee, DNP Wednesday, "more sore than usual." t9/4/6/7, 112 yards and 23.2 in wk4, snaps --/74/78/76%, proj 10.82 (n=23, low). WSH WR rank 3.', 'WR14', 'C7'],
      ['Cam Skattebo', 'RB', 'If active. Shoulder, limited Wednesday in a red jersey. c18/12/20/18, 11.1 avg, snaps --/59/77/64%, proj 9.27 (n=12, low). WSH RB rank 29 is tough and NYG is at 19.0.', 'RB22', 'C24'],
      ['Isaiah Likely', 'TE', 'If active. Knee and groin, limited Wednesday. t8/10/5/12, 13.6 in wk4, a 41% share, proj 7.97 (n=32, low).', 'TE15-16', 'C24'],
      ['Croskey-Merritt / Rachaad White', 'RB', 'Groin and shoulder, both limited Wednesday. A committee: c16/12/19/9 and c7/7/8/--, projections 5.66 and 7.20. Croskey-Merritt is the lean; both are sit-lean.', 'RB29-32'],
      ['Antonio Williams', 'WR', 'Dart, only if McLaurin and Diggs are out: t4/3/4/8, 69% of snaps in wk4.', 'WR38-40'],
    ],
    watch: [
      ['Jayden Daniels', 'QB', 'Full Wednesday. Inactives at 10:30a CT.', null, 'C5'],
      ['Terry McLaurin', 'WR', 'Hamstring, DNP Wednesday. OUT by rule. If he plays he is a WR flex (WR28-32).', 'OUT', 'C5'],
      ['Stefon Diggs', 'WR', 'Hamstring, DNP Wednesday. OUT by rule. If he plays he is a WR flex (WR30-34).', 'OUT', 'C5'],
      ['Malik Nabers', 'WR', 'Friday LP: start only with a noon-or-later bench WR ready. Friday DNP: sit.', null, 'C7'],
      ['Skattebo and Likely', 'RB', 'Both limited Wednesday. Decide at 10:30a CT.', null, 'C24'],
      ['Andrew Thomas', 'OL', 'NYG left tackle, DNP Wednesday. A protection downgrade.'],
    ],
    sit: [
      ['Jameis Winston', 'QB', 'AVOID. NYG quarterback, not in the top 36 by projection (11.89).'],
      ['Terry McLaurin', 'WR', 'OUT. t4/9/9/--, 3.4/7.0/19.7.', 'OUT', 'C5'],
      ['Stefon Diggs', 'WR', 'OUT. t9/6/7/9, snaps --/51/59/66%.', 'OUT', 'C5'],
      ['Marcus Mariota', 'QB', 'OUT. MCL.', 'OUT'],
      ['Austin Ekeler', 'RB', 'Sit.'],
      ['Najee Harris', 'RB', 'DNP, personal. Sit.'],
      ['Devin Singletary', 'RB', 'Sit.'],
      ['Chig Okonkwo', 'TE', 'Hamstring, limited Wednesday, 3.1 avg.'],
      ['Theo Johnson', 'TE', 'Sit.'],
      ['NYG D/ST', 'DEF', 'Sit. Proj 6.97, 18.0 in wk4, but WSH is at 22.5.'],
    ],
    also: 'WSH D/ST is a next-tier streamer (proj 5.37; Winston and NYG at 19.0). Drew Stevens (WSH K, 8.57). Kaliakmanis is the WSH QB2 if Daniels cannot go (unrankable). Jaxson Dart is on IR.',
  },
  {
    id: 'den-lac', slot: 'late', title: 'Broncos at Chargers', kick: 'Sun 3:05p', when: 'Sun 3:05p CT · Dome',
    away: 'DEN', home: 'LAC', awayPts: 22.5, homePts: 19, line: 'DEN -3.5', total: 41.5, weather: 'Dome', rain: false,
    read: 'McConkey (foot, DNP, week-to-week) is out, Slater and Alt are hurt on the Chargers line, and the Chargers are implied for 19.0. Denver\'s defense is the streamer of the week; the Denver skill group is flex-only. 3:05p is pivot-safe: you will see the noon inactives and scores before you decide.',
    fpa: 'DEN offense vs LAC D: QB 14, RB 11, WR 16, TE 24 · LAC offense vs DEN D: QB 13, RB 7, WR 23, TE 11',
    start: [
      ['DEN D/ST', 'DEF', 'Override up. Proj 7.44, 3.0/12.0/11.0/2.0, sacks 2/2/4/0, LAC at 19.0. LAC\'s offense gives D/STs the third-most points (rank 3), McConkey is out and two tackles are hurt.', 'DST5'],
      ['Omarion Hampton', 'RB', 'c12/23/15/9, 8.3/17.5/5.6/13.3, snaps --/63/42/35% (the worry), proj 12.12 (n=13, low), DEN RB rank 7.', 'RB18'],
    ],
    flex: [
      ['RJ Harvey', 'RB', 'PPR flex. t4/--/7/10, 19.3 in wk4, a 26% share and 44% of snaps, proj 8.12 (n=20, medium), LAC RB rank 11.', 'RB20'],
      ['Jaylen Waddle', 'WR', 't3/10/7/6, 1.2/21.8/6.4/14.5, 11.0 avg, snaps --/61/73/68%, proj 10.49 (n=35, medium), LAC WR rank 16.', 'WR22'],
      ['Bo Nix', 'QB', 'Streamer. pa28/31/34/42, 14.3 avg, proj 14.29 (n=38, medium), LAC QB rank 14. Sit in 1QB.', 'QB14-16'],
      ['Keaton Mitchell', 'RB', 'Dart. c4/5/8/10, t0/1/3/6, 37% of snaps and 11.3 in wk4.', 'RB31-34'],
      ['Oronde Gadsden', 'TE', 't2/2/3/8, a 26% share in wk4, 9.8, proj 5.48 (n=19, medium).', 'TE14-16'],
      ['LAC D/ST', 'DEF', 'Proj 8.97, sacks 1/2/4/3, DEN at 22.5 and its offense gives D/STs the 13th-most points.', 'DST10'],
    ],
    watch: [
      ['Pat Bryant', 'WR', 'DEN, ankle, "a few weeks." OUT.', 'OUT'],
      ['Ladd McConkey', 'WR', 'Foot, week-to-week. OUT.', 'OUT'],
      ['Joe Alt / Rashawn Slater', 'OL', 'LAC tackles, hurt. A lift for Denver\'s pass rush and the D/ST.'],
      ['Derwin James', 'S', 'LAC, DNP Wednesday, Q. IDP note.'],
    ],
    sit: [
      ['Ladd McConkey', 'WR', 'OUT. t7/3/5/2, snaps --/46/88/34%.', 'OUT'],
      ['Pat Bryant', 'WR', 'OUT. t6/1/2/3.', 'OUT'],
      ['Courtland Sutton', 'WR', '4.6 avg, t5/4/7/6.'],
      ['J.K. Dobbins', 'RB', '5.2 avg, 32% of snaps in wk4. RB1 on the depth chart and still a sit.'],
      ['Quentin Johnston', 'WR', '4.5 avg, chest, limited.'],
      ['Tre\' Harris', 'WR', '8.5 avg, t6/3/7/5.'],
      ['LAC quarterback', 'QB', 'Not ranked. Herbert is not in the top 36 by projection (12.03). Sit.'],
    ],
    also: 'Jonah Coleman (DEN RB, IR until mid-October), Cameron Dicker (LAC K, 7.33), Wil Lutz (DEN K, 6.15). Zach Allen is on the DL board.',
  },
  {
    id: 'chi-gb', slot: 'late', title: 'Bears at Packers', kick: 'Sun 3:25p', when: 'Sun 3:25p CT',
    away: 'CHI', home: 'GB', awayPts: 23.5, homePts: 22, line: 'CHI -1.5', total: 45.5, weather: '77F sunny', rain: false,
    read: 'Tyson Bagent starts: Caleb Williams is out with a hamstring, and Keenum is the backup per the Sun-Times on Oct 5. Keenum\'s 19.31 projection is a one-game placeholder (n=1, low). Green Bay has allowed the second-most running back points in the league, so the Bears backfield is the fantasy story, and it is a ruling. 3:25p is pivot-safe: decide at the 1:55p CT inactives.',
    fpa: 'CHI offense vs GB D: QB 21, RB 2, WR 15, TE 19 · GB offense vs CHI D: QB 22, RB 26, WR 29, TE 31',
    start: [
      ['Kyle Monangai', 'RB', 'If Swift is out. c10/10/10/30, 146 yards, 2 TD and 28.0 in wk4, snaps --/34/31/54%, proj 11.48 (n=21, low). Thumb, DNP Wednesday, but Johnson called it "not an issue." GB RB rank 2.', 'RB13', 'C6'],
      ['Christian Watson', 'WR', 'Flex-start. t8/11/10/3, 32.7/14.1/22.6/7.7, 19.3 avg, snaps --/90/80/68%, proj 11.77 (n=29, medium). CHI WR rank 29 is tough.', 'WR17'],
      ['Matthew Golden', 'WR', 'Flex-start. t12/6/12/7, 14.5 avg, proj 10.92 (n=18, medium).', 'WR18'],
    ],
    flex: [
      ['D\'Andre Swift', 'RB', 'ONLY if active, then an RB2 flex. Hip and knee, DNP. c18/16/20/15, 32.4/12.9/10.8/7.4, snaps --/68/69/35%, proj 13.09 (n=37, medium). If he is active it is a split with Monangai, who drops to RB24-26.', 'RB19-21', 'C6'],
      ['Luther Burden III', 'WR', 't5/7/11/6, 11.7 avg, snaps --/57/61/56%, proj 11.26 (n=19, medium), GB WR rank 15.', 'WR23'],
      ['Rome Odunze', 'WR', 't3/4/6/7, 15.4 in wk4, 89% of snaps.', 'WR32-35'],
      ['Tucker Kraft', 'TE', 't6/3/8/7, 17.5 in wk4, proj 7.83 (n=29, low). CHI TE rank 31 is tough.', 'TE13'],
      ['Colston Loveland', 'TE', 't2/3/4/9, a 29% share and 11.7 in wk4, proj 5.28 (n=20, medium).', 'TE14-16'],
      ['Jordan Love', 'QB', 'Streamer. pa42/29/53/30, 16.5 avg, 13.1 in wk4, proj 15.19 (n=34, medium), CHI QB rank 22. Sit in 1QB.', 'QB15-16'],
      ['MarShawn Lloyd', 'RB', 'Dart. c13/6/4/7, 55% of snaps and 9.9 in wk4, proj 3.83 (n=5, low). CHI RB rank 26. A sit.'],
      ['Tyson Bagent', 'QB', 'Superflex flex only. pa--/9/--/34, 100% of snaps in wk4, proj 5.05.', 'QB20-24', 'C14'],
      ['CHI D/ST', 'DEF', 'Proj 8.79, 11.0 avg, 3.0/11.0/16.0/14.0, sacks 2/3/2/3, GB at 22.0.', 'DST9-10'],
    ],
    watch: [
      ['Swift and Monangai', 'RB', 'Decide at 1:55p CT. Pivot-safe, so you can see the noon games first.', null, 'C6'],
      ['Chris Brooks', 'RB', 'GB, ankle, DNP Wednesday, "further testing."'],
    ],
    sit: [
      ['Tyson Bagent', 'QB', 'AVOID in 1QB. 268 yards, 0 TD and 1 INT in wk4, proj 5.05.', null, 'C14'],
      ['Case Keenum', 'QB', 'The backup. His 19.31 is one game (24.5 in wk3).', null, 'C14'],
      ['Kaleb Johnson', 'RB', 'c0/8/4/8, proj 2.75.'],
      ['GB D/ST', 'DEF', 'Proj 4.87. CHI\'s offense gives D/STs the 25th-most points (rank 25) despite the backup quarterback.'],
    ],
    also: 'Roschon Johnson (c4 in wk4), Kalif Raymond (2.6 in wk4), Santos (CHI K, 6.25), Smack (GB K, 5.98). Jacobs is on the Commissioner\'s Exempt list and Reed is on IR.',
  },
  {
    id: 'det-ari', slot: 'late', title: 'Lions at Cardinals', kick: 'Sun 3:25p', when: 'Sun 3:25p CT · Retractable roof',
    away: 'DET', home: 'ARI', awayPts: 30, homePts: 24.5, line: 'DET -5.5', total: 54.5, weather: 'Roof assumed closed; 20 mph wind and storms 69% outside', rain: true,
    read: 'The highest total on the slate, tied with Monday\'s. Detroit\'s defense has allowed the most points in the league to quarterbacks and tight ends and the second-most to receivers; Arizona\'s has allowed the fifth-most to quarterbacks and the fourth-most to tight ends. Start everyone with a pulse. The retractable roof is the unknown: with a 20 mph wind and storms at 69% outside I am assuming it is closed. The one ruling is Love\'s ankle.',
    fpa: 'DET offense vs ARI D: QB 5, RB 31, WR 6, TE 4 · ARI offense vs DET D: QB 1, RB 13, WR 2, TE 1',
    start: [
      ['Jahmyr Gibbs', 'RB', 'c29/16/20/15, 33.6/23.3/41.4/17.7, 29.0 avg, snaps --/83/69/87%, proj 18.44 (n=38, medium). ARI RB rank 31 is tough, but DET is at 30.0.', 'RB2', 'smash'],
      ['Jared Goff', 'QB', 'pa39/38/32/52, 412 yards in wk4, 21.5 avg, proj 19.96 (n=38, high), ARI QB rank 5.', 'QB2', 'smash'],
      ['Amon-Ra St. Brown', 'WR', 't14/13/8/11, 28.7/35.2/11.9/15.5, 22.8 avg, snaps --/95/74/96%, proj 20.96 (n=38, medium), ARI WR rank 6.', 'WR2', 'smash'],
      ['Trey McBride', 'TE', 't13/10/11/12, 24.5/18.1/16.5/10.1, 17.3 avg, snaps --/88/91/97%, proj 18.65 (n=37, high), DET TE rank 1.', 'TE1', 'smash'],
      ['Sam LaPorta', 'TE', 't8/7/4/13, 22.4 in wk4, 14.2 avg, proj 13.14 (n=29, medium), ARI TE rank 4.', 'TE4'],
      ['Michael Wilson', 'WR', 't7/7/17/13, a 37% share in wk4, 14.2 avg, snaps --/94/93/94%, proj 12.93 (n=37, medium), DET WR rank 2.', 'WR11'],
      ['Jameson Williams', 'WR', 't9/4/4/8, 102 yards and 16.2 in wk4, snaps --/97/82/99%, proj 11.94 (n=36, medium).', 'WR15'],
      ['Jeremiyah Love', 'RB', 'If active. Ankle, limited Wednesday; LaFleur said it "shouldn\'t impact" Week 5 prep. c11/9/21/14, 12.2 avg, snaps --/40/64/45%. His 5.85 projection (n=4, low) is ignored. DET RB rank 13, ARI at 24.5.', 'RB16', 'C10'],
      ['Jacoby Brissett', 'QB', 'Streamer. pa37/28/52/35, 14.8 avg, 10.4 and 3 INT in wk4, proj 14.11 (n=26, medium). DET QB rank 1 and a 54.5 total are the override up. Carson Beck\'s 15.65 is a placeholder (n=0); Brissett has 100% of the snaps in wks 2-4.', 'QB10', 'C23'],
      ['Jake Bates', 'K', '7.0/7.0/7.0/18.0, proj 9.92 (n=38, high), ARI K rank 18 and DET at 30.0.', 'K6'],
      ['Chad Ryland', 'K', 'ARI kicker: 16.0/1.5/14.0/8.0, proj 9.02 (n=34, medium), ARI at 24.5 in a 54.5 total. Fine.'],
    ],
    flex: [
      ['Tyler Allgeier', 'RB', 'ONLY if Love is out. The handcuff. c17/5/2/8, 12.9 in wk4, snaps --/64/36/55%, proj 5.54 (n=38, medium).', 'RB20-22', 'C10'],
      ['James Conner', 'RB', 'IR, designated to return and "expected Week 5" per CBS and ESPN, but not confirmed on a practice report. Do not rank him. If he is activated he is a game-time flex and Love drops to RB22-24.'],
    ],
    watch: [
      ['Jeremiyah Love / Tyler Allgeier', 'RB', 'Decide at 1:55p CT. Pivot-safe.', null, 'C10'],
      ['James Conner', 'RB', 'Watch the activation news.'],
    ],
    sit: [
      ['Marvin Harrison Jr.', 'WR', 't3/1/5/4, 5.1 avg, proj 5.25 (n=33, medium).'],
      ['Elijah Higgins', 'TE', 't--/0/3/2.'],
      ['DET D/ST', 'DEF', 'Proj 6.54, 3.3 avg, ARI at 24.5.'],
      ['ARI D/ST', 'DEF', 'Proj 4.69, DET at 30.0.'],
      ['Bam Knight', 'RB', 'c2 in wk2, proj 5.20.'],
    ],
    also: 'Trey Benson and Hunter Long (ARI, IR), Paris Johnson (ARI LT, out for the season), Isiah Pacheco (DET, IR), Isaac TeSlaa. Aidan Hutchinson is on the DL board.',
  },
  {
    id: 'sf-sea', slot: 'late', title: '49ers at Seahawks', kick: 'Sun 3:25p', when: 'Sun 3:25p CT',
    away: 'SF', home: 'SEA', awayPts: 21.25, homePts: 24.25, line: 'SEA -3', total: 45.5, weather: '58F sunny', rain: false,
    read: 'Seattle has allowed the second-fewest quarterback points and the fewest wide receiver points in the league (rank 32), so Purdy and Deebo take a matchup haircut, but Purdy still starts. Emanuel Wilson is the lead back with Charbonnet staying on PUP (Macdonald, Monday) and Price on IR. 3:25p is pivot-safe: inactives about 1:55p CT.',
    fpa: 'SF offense vs SEA D: QB 31, RB 15, WR 32, TE 18 · SEA offense vs SF D: QB 23, RB 8, WR 26, TE 27',
    start: [
      ['Jaxon Smith-Njigba', 'WR', 't11/11/14/6, 26.2/42.5/35.4/12.6, 29.2 avg, snaps --/67/87/88%, proj 21.77 (n=38, medium). DNP Wednesday is rest.', 'WR1', 'smash'],
      ['Christian McCaffrey', 'RB', 'c10/10/15/15, t8/4/5/5, 18.5 avg, snaps --/52/83/74%, proj 19.96 (n=25, medium), SEA RB rank 15. DNP Wednesday is rest.', 'RB4', 'smash'],
      ['Brock Purdy', 'QB', 'pa34/22/27/30, 21.1/28.5/31.3/19.6, 25.1 avg, proj 19.81 (n=28, medium). SEA QB rank 31 is the haircut; he is still QB3 on this slate.', 'QB3', 'C16'],
      ['George Kittle', 'TE', 't5/4/7/6, 4.2/18.0/26.2/17.0, 16.4 avg, 4 TD in 4 games, snaps --/48/85/91%, proj 13.20 (n=30, medium).', 'TE2'],
      ['Emanuel Wilson', 'RB', 'By role. c2/21/9/21, t0/1/0/4, 81 rushing and 39 receiving yards, 2 TD and 28.0 in wk4, snaps --/41/36/60%. His 5.48 projection (n=38, medium) is ignored: Charbonnet is on O/PUP, Price is on IR and Holani is limited with ribs. SF RB rank 8, SEA at 24.25.', 'RB15', 'C21'],
      ['SEA D/ST', 'DEF', 'Override down from the engine\'s DST4. Proj 10.07, 17.0/15.0/5.0/13.0, sacks 3/2/2/4, but SF\'s offense gives D/STs the fewest points in the league (rank 32).', 'DST8'],
    ],
    flex: [
      ['Deebo Samuel', 'WR', 't7/4/0/6, 18.0/6.5/15.4/18.0, 14.5 avg, snaps --/60/76/67%, proj 9.53 (n=35, medium). SEA WR rank 32.', 'WR24'],
      ['Sam Darnold', 'QB', 'pa2/--/45/22; 27.7 and 13.3 in his two full games, proj 15.46 (n=37, medium), SF QB rank 23. Sit in 1QB.', 'QB14'],
      ['Mike Evans', 'WR', 'Deep leagues only, and only if active. Ribs, limited Wednesday. t7/3/6/8, 12.6 in wk4, snaps --/54/33/59%, proj 7.82 (n=26, low).', 'WR34-37', 'C20'],
    ],
    watch: [
      ['Mike Evans', 'WR', 'Inactives about 1:55p CT.', null, 'C20'],
      ['Zach Charbonnet', 'RB', 'Macdonald said Monday he will not be activated from PUP this week.', 'OUT', 'C21'],
      ['Kyle Juszczyk', 'FB', 'SF, out multiple weeks.'],
      ['Nick Bosa', 'DL', 'SF, DNP, unlikely. D/ST note.'],
    ],
    sit: [
      ['Zach Charbonnet', 'RB', 'OUT. O/PUP.', 'OUT', 'C21'],
      ['Rashid Shaheed', 'WR', '6.0 avg.'],
      ['Tory Horton', 'WR', 't--/--/3/1, 17% of snaps in wk4.'],
      ['Kaelon Black', 'RB', 'Illness, limited Wednesday. c14/7/4/6. Stash only.'],
      ['George Holani', 'RB', 'Ribs, limited. Sit.'],
      ['AJ Barner', 'TE', 'Sit. t2/1/9/3.'],
      ['SF D/ST', 'DEF', 'Proj 6.83, SEA at 24.25.'],
    ],
    also: 'Eddy Pineiro (SF K, 6.70), Jason Myers (SEA K, 6.82), Mac Jones (SF QB2), Jordan James (c4 in wk2, proj 4.26), Christian Kirk (SF, IR). Pearsall is on IR and Aiyuk is not an option, per Shanahan.',
  },
  {
    id: 'bal-atl', slot: 'prime', title: 'Ravens at Falcons', kick: 'Sun 7:20p', when: 'Sunday Night · 7:20p CT',
    away: 'BAL', home: 'ATL', awayPts: 20, homePts: 23.5, line: 'ATL -3.5', total: 43.5, weather: '72F', rain: false,
    read: 'Lamar Jackson did not practice Wednesday (ankle) and Tyler Huntley took the first-team reps; Rapoport called it an "outside chance" that Lamar plays. The line moved to Atlanta -3.5. Sunday night is pivot-safe: you will know by 5:50p CT and you can decide after the late games. My default is that Huntley starts.',
    fpa: 'BAL offense vs ATL D: QB 11, RB 25, WR 7, TE 14 · ATL offense vs BAL D: QB 17, RB 22, WR 9, TE 23',
    start: [
      ['Bijan Robinson', 'RB', 'c21/16/29/19, t10/4/2/2, 31.3/11.1/35.3/27.7, 26.4 avg, snaps --/51/72/60%, proj 24.75 (n=38, high), BAL RB rank 22, ATL at 23.5.', 'RB1', 'smash'],
      ['Derrick Henry', 'RB', 'c24/16/26/23, 35.3/17.7/21.9/15.9, 22.7 avg, snaps --/53/67/62%, proj 17.08 (n=38, medium). ATL RB rank 25 is tough, but with Huntley he gets more volume, not less.', 'RB6'],
      ['Drake London', 'WR', 't4/5/10/6, 5.5/10.4/29.4/14.6, 15.0 avg, snaps --/62/93/89%, proj 17.64 (n=33, medium), BAL WR rank 9.', 'WR7'],
      ['Lamar Jackson', 'QB', 'ONLY if active. Ankle, did not practice Wednesday. pa25/31/20/20, 25.0/14.8/20.4/18.9, 19.8 avg, snaps --/100/100/52%, proj 19.20 (n=34, low). Default OUT.', 'QB6', 'C1'],
    ],
    flex: [
      ['Zay Flowers', 'WR', 'Foot, limited Wednesday. t6/--/6/10, 25.8 in wk4, 22.4 avg, snaps --/--/33/73%, proj 16.45 (n=37, low). WR20 with Huntley; WR9 if Lamar plays. ATL WR rank 7.', 'WR20', 'C25'],
      ['Mark Andrews', 'TE', 't6/7/5/6, 13.7 in wk4, 9.7 avg, proj 8.34 (n=38, medium). Full Wednesday.', 'TE14'],
      ['Michael Penix Jr.', 'QB', 'pa--/--/25/20, 13.4 avg in two starts, proj 13.66 (n=16, low), BAL QB rank 17. Sit in 1QB, superflex flex.', 'QB16-18'],
      ['Brian Robinson Jr.', 'RB', 'Dart. c9/11/10/14, 3 TD and 25.7 in wk4 on 42% of snaps.', 'RB30-32'],
      ['Tyler Huntley', 'QB', 'Superflex flex only. pa--/--/--/9 and 48% of snaps in wk4, proj 6.48, a placeholder.', 'QB20-24', 'C1'],
      ['ATL D/ST', 'DEF', 'Streamer only if Lamar is out. Proj 5.05, BAL at 20.0, BAL\'s offense gives D/STs the 29th-most points (rank 29).', 'DST10'],
      ['BAL D/ST', 'DEF', 'Proj 6.77. ATL\'s offense gives D/STs the sixth-most points (rank 6), but ATL is at 23.5.', 'DST11'],
    ],
    watch: [
      ['Lamar Jackson', 'QB', 'Default OUT. Inactives about 5:50p CT.', null, 'C1'],
      ['Zay Flowers', 'WR', 'Limited Wednesday. Likely plays.', null, 'C25'],
      ['Rashod Bateman', 'WR', 'Shoulder, limited Wednesday. Sit.'],
      ['Ronnie Stanley', 'OL', 'BAL left tackle, DNP Wednesday. A protection note.'],
    ],
    sit: [
      ['Tyler Huntley', 'QB', 'Sit in 1QB.', null, 'C1'],
      ['Rashod Bateman', 'WR', '8.8 avg, snaps --/93/88/47%.'],
      ['Chris Moore', 'WR', 'Q. Sit.'],
      ['Kyle Pitts', 'TE', 'Not in the TE top 36. Sit.'],
      ['BAL D/ST', 'DEF', 'See the flex note above.'],
    ],
    also: 'Tyler Loop (BAL K, 9.42, a fine kicker) and Nick Folk (ATL K, 6.32). Kyle Hamilton (Q) is the Baltimore IDP note.',
  },
  {
    id: 'buf-lar', slot: 'prime', title: 'Bills at Rams', kick: 'Mon 7:15p', when: 'Monday Night · 7:15p CT · Dome',
    away: 'BUF', home: 'LAR', awayPts: 25.75, homePts: 28.75, line: 'LAR -3', total: 54.5, weather: 'Dome', rain: false,
    read: 'The other 54.5 and the only Monday game, so every call here is pivot-safe: inactives about 5:45p CT Monday. Allen and Kyren are the smashes. Nacua and Stafford against a Buffalo defense that has allowed the fourth-most points in the league to quarterbacks and to receivers are starts, and the Coleman and Moore split is the ruling.',
    fpa: 'BUF offense vs LAR D: QB 19, RB 30, WR 20, TE 30 · LAR offense vs BUF D: QB 4, RB 6, WR 4, TE 20',
    start: [
      ['Josh Allen', 'QB', 'pa29/31/26/33, 35.7/40.8/17.5/18.5, 28.1 avg, proj 22.73 (n=36, medium). LAR QB rank 19, BUF at 25.75.', 'QB1', 'smash'],
      ['Kyren Williams', 'RB', 'c11/12/15/16, t3/2/7/13, 15.5/15.7/21.8/37.7, 22.7 avg, snaps --/55/71/83%, proj 19.53 (n=37, high), BUF RB rank 6.', 'RB3', 'smash'],
      ['Puka Nacua', 'WR', 't9/--/--/12, 125 yards, a TD and 27.7 in wk4 in his return, 90% of snaps, proj 20.94 (n=29, low). No Week 5 practice entry found: confirm Friday. BUF WR rank 4.', 'WR4'],
      ['Matthew Stafford', 'QB', 'pa25/31/55/51, 15.4 avg, proj 18.13 (n=37, high), BUF QB rank 4, LAR at 28.75.', 'QB4'],
      ['Davante Adams', 'WR', 't6/10/13/9, 5.6/40.5/20.7/7.2, 18.5 avg, proj 16.83 (n=32, high).', 'WR8'],
      ['James Cook', 'RB', 'c13/21/24/12, 9.9/20.9/19.4/16.3, 16.6 avg, snaps --/74/67/59%, proj 15.97 (n=37, medium). LAR RB rank 30 is tough; BUF is at 25.75.', 'RB8'],
    ],
    flex: [
      ['Keon Coleman', 'WR', 'If DJ Moore is out. t1/6/2/7, 116 yards, a TD and 23.6 in wk4 after Moore left, a 23% share, proj 7.21 (n=29, medium). If Moore plays, Coleman drops to WR36-40.', 'WR26', 'C12'],
      ['DJ Moore', 'WR', 'If active. Left shoulder, no Wednesday entry found; Schefter: "not long-term" (the waiver report lists the AC joint). t8/0/10/2, snaps --/31/64/39%, proj 8.24 (n=38, low).', 'WR30-33', 'C12'],
      ['Khalil Shakir', 'WR', 't6/6/3/8, 13.2 in wk4, 7.7 avg, proj 8.97 (n=35, medium).', 'WR28'],
      ['Tyler Higbee', 'TE', '20.2 and 11.7 the last two, t11 and t6, proj 6.99 (n=16, low), BUF TE rank 20.', 'TE15-16'],
    ],
    watch: [
      ['DJ Moore / Keon Coleman', 'WR', 'Inactives about 5:45p CT Monday.', null, 'C12'],
      ['Puka Nacua', 'WR', 'No practice entry. Confirm Friday.'],
    ],
    sit: [
      ['LAR D/ST', 'DEF', 'Proj 8.82 is the engine\'s DST8, but BUF is at 25.75. Consensus sit.'],
      ['BUF D/ST', 'DEF', 'Proj 4.08.'],
      ['Blake Corum', 'RB', 'c10/12/6/5, 15% of snaps in wk4.'],
      ['Ty Johnson', 'RB', 't4/2 in two games.'],
      ['Dalton Kincaid', 'TE', 'Sit-lean. 3.8 and 1.7 the last two.'],
      ['Colby Parkinson', 'TE', 'Q. Sit.'],
    ],
    also: 'Tyler Bass (BUF K, 6.35), Harrison Mevis (LAR K, 5.51). Quentin Lake is on the DB board.',
  },
];

const SLOT = (slot) => GAMES.filter((g) => g.slot === slot).map((g) => <GameCard key={g.id} g={g} />);

// Injury board rows are [name, position, team, status, pivot, tone, ruling].
// Statuses are Wednesday practice reports; only TB and DAL have Thursday final reports.
const INJ_OUT = [
  ['DeVonta Smith', 'WR', 'PHI', 'Hamstring, DNP Wednesday, missed wk4. London, no pivot cover.', 'Wicks (flex dart, 92% of snaps in wk4).', 'out'],
  ['Hollywood Brown', 'WR', 'PHI', 'Ankle, DNP Wednesday. London.', 'Wicks.', 'out'],
  ['Saquon Barkley', 'RB', 'PHI', 'Hamstring, DNP Wednesday, week-to-week; "unlikely" per Rapoport. London.', 'Shipley starts (RB21). If Barkley is active at 7:00a CT he is an RB2 flex.', 'default', 'C2'],
  ['Ja\'Marr Chase', 'WR', 'CIN', 'Concussion protocol, no clearance reported. Noon game.', 'Higgins (WR7 if he plays), Gesicki (TE6), Tinsley dart.', 'default', 'C3'],
  ['Tee Higgins', 'WR', 'CIN', 'Groin and neck, did not practice Wednesday, day-to-day. Noon game.', 'Tinsley dart. Burrow holds QB5.', 'default', 'C3'],
  ['Breece Hall', 'RB', 'NYJ', 'Quad, DNP Wednesday, week-to-week (doubtful in our feed). Noon game.', 'Braelon Allen (RB25-28 flex). Judkins is the start.', 'out', 'C11'],
  ['Adonai Mitchell', 'WR', 'NYJ', 'Finger, week-to-week. Noon game.', 'Garrett Wilson picks up the share.', 'out'],
  ['Terry McLaurin', 'WR', 'WSH', 'Hamstring, DNP Wednesday. Noon game, out by rule.', 'Antonio Williams (dart). If active he is a WR28-32 flex.', 'default', 'C5'],
  ['Stefon Diggs', 'WR', 'WSH', 'Hamstring, DNP Wednesday. Noon game, out by rule.', 'Antonio Williams (dart). If active he is a WR30-34 flex.', 'default', 'C5'],
  ['Jordan Addison', 'WR', 'MIN', 'Hamstring, DNP Wednesday, "soreness." Noon game, default OUT.', 'Hockenson holds. If active, WR30-34 flex.', 'default', 'C4'],
  ['Mack Hollins', 'WR', 'NE', 'Calf, DNP Wednesday. Noon game.', 'Romeo Doubs (WR25), the NE WR1 with A.J. Brown on IR.', 'out'],
  ['Jalen Nailor', 'WR', 'LV', 'Concussion, DNP Wednesday. Noon game.', 'Tre Tucker (WR29 flex).', 'out'],
  ['Caleb Douglas', 'WR', 'MIA', 'Ankle, DNP Wednesday. Noon game.', 'Malik Washington (WR32-35 flex).', 'out'],
  ['Ashton Dulin', 'WR', 'IND', 'DNP Wednesday, Q. Noon game.', 'Josh Downs (WR31-34 PPR flex).', 'out'],
];

const INJ_THU = [
  ['Jonathan Mingo', 'WR', 'DAL', 'Illness, did not practice Wednesday, Questionable on the Thursday report.', 'Irrelevant to lineups. There is no pivot on Thursday.', 'sit'],
  ['Chase McLaughlin', 'K', 'TB', 'Conflicting reports: NFL.com says full, RotoBaller says groin and hip.', 'Check the report before 5:45p CT. Aubrey (DAL) is the kicker to own.', 'gtd'],
  ['Antoine Winfield Jr., Benjamin Morrison, SirVocea Dennis', 'DEF', 'TB', 'Ruled out for Thursday: Winfield (ribs), Morrison (quadriceps), Dennis (ankle).', 'A lift for Lamb, Prescott and Javonte Williams.', 'out'],
  ['Cobie Durant, DeMarvion Overshown', 'DEF', 'DAL', 'Ruled out for Thursday: Durant (hamstring), Overshown (hamstring).', 'A modest lift for the Tampa passing game; Daniels is still an AVOID in 1QB.', 'out'],
  ['Baker Mayfield', 'QB', 'TB', 'Thumb on the throwing hand, Week 7 at the earliest.', 'Jalon Daniels starts again. Superflex flex only.', 'out', 'C13'],
];

const INJ_LONDON = [
  ['Dallas Goedert', 'TE', 'PHI', 'Knee, limited Wednesday. Inactives 7:00a CT; there is no pivot in London.', 'Pair him with a noon-or-later tight end (Kraft TE13 or Andrews TE14). Strange (JAX) is the other tight end in this game.', 'gtd', 'C22'],
  ['Zack Baun', 'LB', 'PHI', 'Concussion protocol, limited Wednesday. Q.', 'IDP only. Jeremiah Trotter Jr. is the consensus PHI linebacker.', 'gtd'],
  ['Josh Hines-Allen', 'DL', 'JAX', 'Groin, limited. Likely plays.', 'IDP only.', 'likely'],
];

const INJ_NOON = [
  ['Nico Collins', 'WR', 'HOU', 'Limited Wednesday with no injury text. Treat as active.', 'Confirm at 10:30a CT. Tate (TEN) is the only other receiver in this game worth a look.', 'likely'],
  ['Tony Pollard', 'RB', 'TEN', 'Foot, DNP Wednesday.', 'Spears (RB30-32) is a sit-lean either way. Montgomery (HOU) is the flex.', 'gtd', 'C19'],
  ['Keenan Allen', 'WR', 'IND', 'Groin, limited Wednesday, "resumed."','Downs (PPR flex) and Metcalf (PIT) in the same game.', 'gtd'],
  ['Brock Bowers', 'TE', 'LV', 'Knee, limited Wednesday.', 'Start him if active; carry a noon-or-later tight end (Kraft, Andrews).', 'gtd', 'C8'],
  ['Rhamondre Stevenson', 'RB', 'NE', 'Leg and knee, Q; Vrabel is optimistic he can play.', 'Henderson (RB24-27) if he sits; bench Henderson if Stevenson plays.', 'gtd', 'C9'],
  ['Justin Jefferson', 'WR', 'MIN', 'Ankle, aiming to play. Missed wk4.', 'Hockenson is TE5 either way (TE4 if Jefferson is out). Friday DNP: pivot.', 'gtd', 'C4'],
  ['Alvin Kamara', 'RB', 'NO', 'Back, did not participate in the Wednesday walkthrough.', 'Sit even if active. MIN RB rank 32.', 'sit', 'C18'],
  ['Tyler Shough', 'QB', 'NO', 'Non-throwing hand, limited Wednesday. Likely plays.', 'Rattler is the QB2 (unranked).', 'likely', 'C17'],
  ['Jayden Daniels', 'QB', 'WSH', 'Full practice Wednesday. On track to start.', 'QB13 if he starts. Kaliakmanis is the QB2 if not (unrankable).', 'likely', 'C5'],
  ['Malik Nabers', 'WR', 'NYG', 'Knee, DNP Wednesday, "more sore than usual."', 'Friday LP: start only with a noon-or-later bench WR ready. Friday DNP: sit.', 'gtd', 'C7'],
  ['Cam Skattebo / Isaiah Likely', 'RB', 'NYG', 'Skattebo (shoulder) and Likely (knee, groin) both limited Wednesday.', 'No NYG back is a pivot (Najee Harris DNP, personal).', 'gtd', 'C24'],
  ['Andrew Thomas', 'OL', 'NYG', 'Left tackle, DNP Wednesday. Likely out.', 'A protection downgrade for Winston, Nabers and Likely.', 'gtd'],
  ['Croskey-Merritt / Rachaad White', 'RB', 'WSH', 'Groin and shoulder, both limited Wednesday.', 'A committee. Both are sit-lean.', 'gtd'],
  ['Rico Dowdle / Michael Pittman Jr.', 'RB', 'PIT', 'Dowdle (toe) and Pittman (foot, load management), both limited Wednesday.', 'Sit either way.', 'sit'],
  ['Mason Taylor', 'TE', 'NYJ', 'Full Wednesday.', 'One game of data. Sit.', 'sit'],
];

const INJ_LATE = [
  ['D\'Andre Swift', 'RB', 'CHI', 'Hip and knee, DNP Wednesday. 3:25p, pivot-safe: hold him to the 1:55p CT inactives only if Friday is LP.','Monangai starts if Swift is out. Both active: Swift RB19-21, Monangai RB24-26.', 'gtd', 'C6'],
  ['Kyle Monangai', 'RB', 'CHI', 'Thumb, DNP Wednesday. Johnson: "not an issue." 3:25p: hold him through a Friday LP.','Starts (RB13) if Swift is out.', 'likely', 'C6'],
  ['Chris Brooks', 'RB', 'GB', 'Ankle, DNP Wednesday, "further testing."', 'Lloyd is a sit.', 'sit'],
  ['Jeremiyah Love', 'RB', 'ARI', 'Ankle, limited Wednesday. LaFleur: "shouldn\'t impact him" in Week 5 prep.', 'Allgeier (RB20-22) if Love sits.', 'gtd', 'C10'],
  ['James Conner', 'RB', 'ARI', 'IR, designated to return; "expected Week 5" per CBS and ESPN, unconfirmed on a practice report.', 'If activated, a game-time flex and Love drops to RB22-24.', 'gtd'],
  ['Mike Evans', 'WR', 'SF', 'Ribs, limited Wednesday. 3:25p.', 'Deep-league flex only. Samuel holds.', 'sit', 'C20'],
  ['Kaelon Black / George Holani', 'RB', 'SF / SEA', 'Black (illness) and Holani (ribs), both limited Wednesday.', 'Sit both. Wilson is the SEA lead back.', 'sit'],
  ['Derwin James', 'S', 'LAC', 'DNP Wednesday, Q. 3:05p.', 'A modest lift for the DEN passing game.', 'gtd'],
  ['Joe Alt', 'OL', 'LAC', 'Hurt. Slater is out for 4 to 6 weeks.', 'A lift for the DEN D/ST (DST5).', 'gtd'],
  ['Nick Bosa', 'DL', 'SF', 'DNP, unlikely. 3:25p.', 'A lift for Seattle\'s offense; the SEA D/ST stays at DST8.', 'gtd'],
];

const INJ_NIGHT = [
  ['Lamar Jackson', 'QB', 'BAL', 'Ankle, did not practice Wednesday; Rapoport: "outside chance." SNF.', 'Huntley is a sit in 1QB. Friday LP plus Questionable: hold only with a Sunday-night-or-Monday bench QB.', 'default', 'C1'],
  ['Zay Flowers', 'WR', 'BAL', 'Foot, limited Wednesday. SNF.', 'WR20 with Huntley, WR9 if Lamar plays.', 'likely', 'C25'],
  ['Rashod Bateman', 'WR', 'BAL', 'Shoulder, limited Wednesday.', 'Sit.', 'sit'],
  ['DJ Moore', 'WR', 'BUF', 'Left shoulder, no Wednesday entry found; Schefter: "not long-term." MNF.', 'Coleman is WR26 if Moore is out and drops to WR36-40 if he plays.', 'gtd', 'C12'],
  ['Puka Nacua', 'WR', 'LAR', 'No Week 5 practice entry. MNF.', 'Start him; confirm Friday. Adams holds.', 'gtd'],
  ['Kyle Hamilton', 'S', 'BAL', 'Q. IDP note.', 'See the DB board.', 'gtd'],
];

const ALREADY_OUT = [
  'Baker Mayfield (TB QB, thumb, Week 7 at the earliest)', 'Caleb Williams (CHI QB, hamstring, week-to-week)',
  'De\'Von Achane (MIA RB, IR)', 'Tank Bigsby (PHI RB, IR, abdomen)', 'Zach Charbonnet (SEA RB, PUP, not this week)',
  'Marcus Mariota (WSH QB, MCL)', 'Ladd McConkey (LAC WR, foot, week-to-week)', 'Pat Bryant (DEN WR, ankle, a few weeks)',
  'Ricky Pearsall (SF WR, IR)', 'Brandon Aiyuk (SF WR, not an option per Shanahan)', 'A.J. Brown (NE WR, IR)',
  'Alec Pierce (IND WR, IR)', 'Travis Etienne Jr. (NO RB, IR)', 'Jordan Mason (MIN RB, IR)',
  'Josh Jacobs (GB RB, Commissioner\'s Exempt list)', 'Jayden Reed (GB WR, IR, neck)', 'Edgerrin Cooper (GB LB, Achilles, IR)',
  'Tank Dell (HOU WR, IR, practice window open, not this week)', 'James Conner (ARI RB, IR, designated to return, unconfirmed)',
  'Jaxson Dart (NYG QB, IR, knee)',
  'Kyle Juszczyk (SF FB, out multiple weeks)', 'Nick Bosa (SF DL, unlikely)', 'Pat Surtain II (DEN CB, ankle, about two weeks)',
  'Rashawn Slater (LAC OT, 4 to 6 weeks)', 'Paris Johnson Jr. (ARI OT, out for the season)', 'Antoine Winfield Jr. (TB S, ribs, 2 to 4 weeks)',
  'Durham Smythe (BAL TE, Achilles, IR)', 'Jalen McMillan (TB WR, IR)',
];

// Tier rows are [rank, name, team, proj, note].
const QB_ROWS = [
  [1, 'Josh Allen', 'BUF', '22.73', 'LAR QB rank 19, BUF at 25.75'],
  [2, 'Jared Goff', 'DET', '19.96', '412 yards in wk4, DET at 30.0'],
  [3, 'Brock Purdy', 'SF', '19.81', 'SEA QB rank 31 haircut, still QB3'],
  [4, 'Matthew Stafford', 'LAR', '18.13', 'pa55 and 51 the last two, LAR at 28.75'],
  [5, 'Joe Burrow', 'CIN', '17.90', '428 yards in wk4'],
  [6, 'Dak Prescott', 'DAL', '19.35', '335 yards in wk4, DAL at 28.0'],
  [7, 'Trevor Lawrence', 'JAX', '20.53', 'Engine QB2, PHI at 17.25'],
  [8, 'Drake Maye', 'NE', '16.25', '26.2 in wk4, LV QB rank 15'],
  [9, 'Aaron Rodgers', 'PIT', '17.38', '22.7 and 22.0 the last two, rain'],
  [10, 'Jacoby Brissett', 'ARI', '14.11', 'Override up: DET QB rank 1, 54.5 total'],
  [11, 'Tyler Shough', 'NO', '18.32', 'Override down: MIN QB rank 32'],
  [12, 'C.J. Stroud', 'HOU', '15.16', '23.1 in wk4, wind and rain'],
  [13, 'Jayden Daniels', 'WSH', '15.53', 'If he starts; full Wednesday'],
  [14, 'Sam Darnold', 'SEA', '15.46', 'SF QB rank 23, sit in 1QB'],
];
const QB_NEXT = 'Lamar Jackson 19.20 (unranked, default OUT; QB6 if active), Love 15.19, Nix 14.29, Cousins 13.73, Watson 14.10, Hurts 15.85 (QB15-16, sit in 1QB), Penix 13.66, Geno Smith 13.37. Superflex only: Jalon Daniels 8.61, Huntley 6.48, Bagent 5.05. Avoid: Winston, Keenum (the backup; his 19.31 is a one-game placeholder) and every n=0 placeholder name.';

const RB_ROWS = [
  [1, 'Bijan Robinson', 'ATL', '24.75', 'c29 in wk3, SNF'],
  [2, 'Jahmyr Gibbs', 'DET', '18.44', 'ARI RB rank 31, DET at 30.0'],
  [3, 'Kyren Williams', 'LAR', '19.53', '37.7 in wk4, MNF'],
  [4, 'Christian McCaffrey', 'SF', '19.96', 'Wednesday DNP is rest'],
  [5, 'Jonathan Taylor', 'IND', '18.10', 'PIT RB rank 10, rain'],
  [6, 'Derrick Henry', 'BAL', '17.08', 'More volume with Huntley'],
  [7, 'Chase Brown', 'CIN', '17.63', 't11 in wk4'],
  [8, 'James Cook', 'BUF', '15.97', 'LAR RB rank 30, BUF at 25.75'],
  [9, 'Javonte Williams', 'DAL', '15.06', 'c19/19, DAL at 28.0'],
  [10, 'Aaron Jones', 'MIN', '12.07', 'NO RB rank 1'],
  [11, 'Ashton Jeanty', 'LV', '12.72', 'c23/21/19/15, full practice'],
  [12, 'Jaylen Warren', 'PIT', '13.04', '97% of snaps in wk4'],
  [13, 'Kyle Monangai', 'CHI', '11.48', 'If Swift is out; GB RB rank 2'],
  [14, 'Quinshon Judkins', 'CLE', '11.10', 'NYJ RB rank 4'],
  [15, 'Emanuel Wilson', 'SEA', '5.48', 'By role: Charbonnet out, Price on IR'],
  [16, 'Jeremiyah Love', 'ARI', '5.85', 'If active, by role'],
  [17, 'Bhayshul Tuten', 'JAX', '11.16', 'c15/13/15/17'],
  [18, 'Omarion Hampton', 'LAC', '12.12', 'Snaps fell to 35% in wk4'],
  [19, 'Bucky Irving', 'TB', '11.06', 'Zero targets in wk4, negative script'],
  [20, 'RJ Harvey', 'DEN', '8.12', 'PPR flex, t10 in wk4'],
  [21, 'Will Shipley', 'PHI', '2.69', 'By role: London, no pivot'],
  [22, 'Cam Skattebo', 'NYG', '9.27', 'If active'],
  [23, 'Rhamondre Stevenson', 'NE', '10.90', 'If active'],
  [24, 'Ollie Gordon II', 'MIA', '3.77', 'By role: Achane on IR'],
];
const RB_NEXT = 'Henderson (RB24-27 if Stevenson is out), Pollard (RB26 if active), Allgeier (RB20-22 if Love is out), Braelon Allen (RB25-28), Montgomery (RB27-30), Kamara (RB28-30 if active; the worst matchup in the league), Croskey-Merritt, Swift (unranked, default OUT; RB19-21 if active), Keaton Mitchell, Brian Robinson Jr., Dobbins, Lloyd, Spears. OUT: Barkley (default), Hall, Charbonnet, Achane, Bigsby.';

const WR_ROWS = [
  [1, 'Jaxon Smith-Njigba', 'SEA', '21.77', 't11/11/14/6'],
  [2, 'Amon-Ra St. Brown', 'DET', '20.96', 'ARI WR rank 6, DET at 30.0'],
  [3, 'CeeDee Lamb', 'DAL', '19.24', '49% target share in wk4'],
  [4, 'Puka Nacua', 'LAR', '20.94', 'MNF; no practice entry, confirm Friday'],
  [5, 'Nico Collins', 'HOU', '18.33', '30.8 in wk4'],
  [6, 'Chris Olave', 'NO', '19.26', 't13/10/13/12'],
  [7, 'Drake London', 'ATL', '17.64', '29.4 and 14.6 the last two'],
  [8, 'Davante Adams', 'LAR', '16.83', 'MNF at 28.75'],
  [9, 'Ja\'Marr Chase', 'CIN', '14.06', 'Only if cleared'],
  [10, 'Justin Jefferson', 'MIN', '11.96', 'If active'],
  [11, 'Michael Wilson', 'ARI', '12.93', 't17 and t13 the last two'],
  [12, 'Tee Higgins', 'CIN', '12.47', 'If active; WR7 if Chase is out'],
  [13, 'Garrett Wilson', 'NYJ', '14.52', 't13 in wk3'],
  [14, 'Malik Nabers', 'NYG', '10.82', 'If active; 23.2 in wk4'],
  [15, 'Jameson Williams', 'DET', '11.94', '16.2 in wk4'],
  [16, 'DK Metcalf', 'PIT', '9.44', '115 yards in wk4'],
  [17, 'Christian Watson', 'GB', '11.77', '19.3 avg'],
  [18, 'Matthew Golden', 'GB', '10.92', 't12/6/12/7'],
  [19, 'Denzel Boston', 'CLE', '11.56', '13.9 in wk4'],
  [20, 'Zay Flowers', 'BAL', '16.45', 'With Huntley; WR9 if Lamar plays'],
  [21, 'Carnell Tate', 'TEN', '8.32', 'HOU WR rank 1'],
  [22, 'Jaylen Waddle', 'DEN', '10.49', 'LAC WR rank 16'],
  [23, 'Luther Burden III', 'CHI', '11.26', 't11 in wk3'],
  [24, 'Deebo Samuel', 'SF', '9.53', 'SEA WR rank 32'],
  [25, 'Romeo Doubs', 'NE', '8.53', '23.8 in wk4; the NE WR1'],
  [26, 'Keon Coleman', 'BUF', '7.21', 'If Moore is out'],
  [27, 'Parker Washington', 'JAX', '11.84', 't3 in wk4, falling'],
  [28, 'Khalil Shakir', 'BUF', '8.97', '13.2 in wk4'],
  [29, 'Tre Tucker', 'LV', '8.59', 'NE WR rank 8'],
  [30, 'George Pickens', 'DAL', '8.05', '7% share in wk4'],
];
const WR_NEXT = 'Egbuka, Downs, Malik Washington, Vele, Odunze, Wan\'Dale Robinson, Keenan Allen (if active), DJ Moore (if active), Evans (deep flex if active), Wicks, Antonio Williams, Roman Wilson, Meyers. Default OUT (DNP Wednesday, noon): McLaurin, Diggs, Addison. OUT: DeVonta Smith, Hollywood Brown, McConkey, Mitchell, Bryant, Nailor, Hollins. Sit: Harrison Jr., Sutton, Brian Thomas Jr., Hunter, Godwin, Quentin Johnston, Bateman.';

const TE_ROWS = [
  [1, 'Trey McBride', 'ARI', '18.65', 't13/10/11/12'],
  [2, 'George Kittle', 'SF', '13.20', '4 TD in 4 games'],
  [3, 'Brock Bowers', 'LV', '14.69', 'If active; NE TE rank 32'],
  [4, 'Sam LaPorta', 'DET', '13.14', 't13 in wk4'],
  [5, 'T.J. Hockenson', 'MIN', '11.11', 'TE4 if Jefferson is out'],
  [6, 'Tyler Warren', 'IND', '9.66', 'PIT TE rank 22'],
  [7, 'Juwan Johnson', 'NO', '12.27', 'MIN TE rank 29'],
  [8, 'Harold Fannin Jr.', 'CLE', '10.18', '3 TD'],
  [9, 'Mike Gesicki', 'CIN', '8.07', 'TE6 if Chase is out'],
  [10, 'Kenyon Sadiq', 'NYJ', '13.16', 'The projection is too high'],
  [11, 'Brenton Strange', 'JAX', '6.88', '35% share in wk4'],
  [12, 'Dallas Goedert', 'PHI', '8.97', 'If active; London'],
  [13, 'Tucker Kraft', 'GB', '7.83', '17.5 in wk4'],
  [14, 'Mark Andrews', 'BAL', '8.34', 'Full Wednesday'],
];
const TE_NEXT = 'Likely (if active), Higbee, Loveland, Hunter Henry, Ferguson, Freiermuth, Gadsden. Sit: Schultz, Kincaid, Otton, Barner, Pitts (unranked), Mason Taylor.';

// All eight D/ST are START; 1 is the lock.
const DST_ROWS = [
  [1, 'MIN', 'at NO', '13.08', 'NO implied 20.5, 14.5 avg'],
  [2, 'HOU', 'at TEN', '10.30', 'TEN implied 15.5, wind 15 mph'],
  [3, 'JAX', 'vs PHI', '11.78', 'PHI implied 17.25, short its receivers'],
  [4, 'CIN', 'at MIA', '7.17', 'Override up: MIA implied 18.0, MIA gives D/STs the most'],
  [5, 'DEN', 'at LAC', '7.44', 'Override up: LAC implied 19.0, the streamer of the week'],
  [6, 'DAL', 'vs TB', '0.34', 'Override up, Thursday: rookie QB, 2 INT last week, TB implied 19.5'],
  [7, 'PIT', 'vs IND', '9.94', 'IND implied 21.0, rain'],
  [8, 'SEA', 'vs SF', '10.07', 'Override down: SF gives D/STs the fewest'],
];

// Kickers: [name, text, 'K'].
const KICKERS = [
  ['1. Dominic Zvada (NYG)', 'Proj 14.13, 4.0/8.0/12.0/14.0 over four weeks. WSH allows the fourth-most kicker points (rank 4). NYG is implied for 19.0.', 'K'],
  ['2. Spencer Shrader (IND)', 'Proj 12.30, 7.5/14.0/17.0/16.0. PIT is K rank 9, IND implied 21.0, rain.', 'K'],
  ['3. Brandon Aubrey (DAL)', 'Proj 10.78, 2.0/16.0/11.0/12.0. TB allows the most kicker points in the league (rank 1) and DAL is at 28.0. Thursday.', 'K'],
  ['4. Ka\'imi Fairbairn (HOU)', 'Proj 10.36, 9.5/8.0/5.0/16.0. TEN is K rank 8, HOU implied 23.0.', 'K'],
  ['5. Will Reichard (MIN)', 'Proj 10.17, 7.0/10.0/16.0/19.0. NO is K rank 16, MIN implied 22.0, dome.', 'K'],
  ['6. Jake Bates (DET)', 'Proj 9.92, 7.0/7.0/7.0/18.0. ARI is K rank 18, DET implied 30.0.', 'K'],
  ['7. Evan McPherson (CIN)', 'Proj 9.49, 20.0/12.0/11.0/6.0. MIA is K rank 11, CIN implied 24.5.', 'K'],
  ['8. Tyler Loop (BAL)', 'Proj 9.42, 15.0/7.0/12.0/8.0. ATL is K rank 25, BAL implied 20.0. Sunday night.', 'K'],
];

// Handcuff rows are [team, starter and status, handcuff, verdict].
const HANDCUFFS = [
  ['PHI', 'Saquon Barkley: hamstring, DNP Wednesday, week-to-week. Bigsby is on IR.', 'Will Shipley', 'START, RB21. Roster him everywhere. Dameon Pierce was signed from the practice squad.'],
  ['CHI', 'D\'Andre Swift: hip and knee, DNP Wednesday.', 'Kyle Monangai', 'RB13 if Swift is out; RB24-26 in a split if both play. GB allows the second-most RB points (rank 2).'],
  ['SEA', 'Charbonnet (PUP, not this week) and Price (IR).', 'Emanuel Wilson', 'START, RB15. Holani (ribs, limited) is the handcuff to Wilson. Charbonnet is possible in Week 6, so Wilson is a rental.'],
  ['ARI', 'Jeremiyah Love: ankle, limited Wednesday.', 'Tyler Allgeier', 'RB20-22 if Love sits. Conner is designated to return and unconfirmed.'],
  ['NE', 'Rhamondre Stevenson: leg and knee, Q, optimism.', 'TreVeyon Henderson', 'RB24-27 if Stevenson sits. Bench if he plays.'],
  ['NYJ', 'Breece Hall: quad, DNP Wednesday, week-to-week.', 'Braelon Allen', 'RB25-28: 94% of snaps in wk4. Isaiah Davis is a sit.'],
  ['TEN', 'Tony Pollard: foot, DNP Wednesday.', 'Tyjae Spears', 'RB30-32, a sit-lean. HOU allows the 28th-most RB points (rank 28).'],
  ['NO', 'Alvin Kamara: back, DNP in the Wednesday walkthrough.', 'Kendre Miller', 'Sit regardless. MIN allows the fewest RB points (rank 32).'],
  ['SF', 'Christian McCaffrey: Wednesday DNP, rest.', 'Kaelon Black', 'Stash only. Illness, limited Wednesday; the consensus "most valuable handcuff in fantasy."'],
  ['DEN', 'Dobbins and Harvey: a committee.', 'RJ Harvey', 'Harvey is the PPR flex, Dobbins is a sit. Jonah Coleman is on IR until mid-October.'],
  ['MIA', 'De\'Von Achane: IR.', 'Ollie Gordon II', 'RB24 by role. His 3.77 projection is known-wrong.'],
  ['BAL / WSH', 'Lamar Jackson (ankle, DNP Wednesday) and Mariota (MCL).', 'Tyler Huntley / Kaliakmanis', 'Huntley is a superflex flex only. Kaliakmanis is the WSH QB2 if Daniels cannot go (unrankable).'],
];

// D/ST streaming rows are [d/st, opp, opp implied, opp DEF-FPA rank, sacks wk1-4, turnovers wk1-4, proj, verdict].
const DST_TABLE = [
  ['MIN', 'at NO', '20.50', '16', '4/4/6/2', '2/2/2/1', '13.08', 'The lock (DST1).'],
  ['HOU', 'at TEN', '15.50', '5', '2/5/4/3', '0/0/3/0', '10.30', 'Start (DST2). The lowest implied total on the slate.'],
  ['JAX', 'vs PHI', '17.25', '7', '5/0/2/2', '2/1/3/2', '11.78', 'Start (DST3). London, no pivot.'],
  ['CIN', 'at MIA', '18.00', '1', '4/4/2/4', '4/0/1/0', '7.17', 'Start (DST4). Override up.'],
  ['DEN', 'at LAC', '19.00', '3', '2/2/4/0', '1/1/2/0', '7.44', 'Start (DST5). Streamer of the week.'],
  ['DAL', 'vs TB', '19.50', '2', '2/0/0/2', '1/1/0/0', '0.34', 'Start (DST6). Thursday streamer; override up.'],
  ['PIT', 'vs IND', '21.00', '14', '4/3/1/2', '2/2/2/2', '9.94', 'Start (DST7). Rain.'],
  ['SEA', 'vs SF', '21.25', '32', '3/2/2/4', '3/1/0/4', '10.07', 'Start (DST8). Override down.'],
  ['LV', 'at NE', '24.50', '4', '5/3/2/2', '2/3/4/0', '9.68', 'Next tier (DST9). NE at 24.5 caps it.'],
  ['CLE', 'at NYJ', '20.50', '17', '1/3/3/5', '0/1/1/2', '7.39', 'Next tier. Borderline; 5 sacks in wk4.'],
  ['CHI', 'at GB', '22.00', '11', '2/3/2/3', '3/0/3/0', '8.79', 'Next tier (DST9-10).'],
  ['NYJ', 'vs CLE', '19.00', '10', '3/3/2/1', '1/1/0/2', '3.83', 'Next tier (DST11). Weak projection.'],
  ['WSH', 'vs NYG', '19.00', '8', '3/2/0/2', '0/0/3/2', '5.37', 'Next tier. Winston and NYG at 19.0.'],
  ['ATL', 'vs BAL', '20.00', '29', '2/2/1/2', '1/0/1/1', '5.05', 'Only if Lamar is out (DST10).'],
  ['LAC', 'vs DEN', '22.50', '13', '1/2/4/3', '0/1/5/1', '8.97', 'Next tier (DST10).'],
];

// IDP rows are [player, team, opp, tackles wk1-4, sacks and big plays, snap %, note].
const IDP_LB = [
  ['Josiah Trotter', 'TB', 'at DAL (Thu)', '11/13/--/9', 'wk1: sack, INT, 2 TFL', '83', 'Full practice Thursday. Winfield and Dennis are out. No pivot on Thursday.'],
  ['Jacob Rodriguez', 'MIA', 'vs CIN', '14/8/5/18', 'INT and 3 TFL in wk3', '97', '18 tackles in wk4.'],
  ['Alex Singleton', 'DEN', 'at LAC', '15/9/8/13', 'PD wk2, TFL wk4', '100', '100% of snaps in wks 2-4.'],
  ['Ernest Jones IV', 'SEA', 'vs SF', '13/8/8/12', 'Sack and INT in wk4', '99', 'Both ways.'],
  ['Anthony Hill Jr.', 'TEN', 'vs HOU', '16/10/8/8', '2 PD in wk1', '100', 'Tackle volume.'],
  ['Jake Hansen', 'HOU', 'at TEN', '2/5/7/12', 'Sack and 2 TFL in wk4', '94', 'Al-Shaair is Q (groin).'],
  ['Payton Wilson', 'PIT', 'vs IND', '13/6/6/9', 'Sack in wk4; TFL 2/1/0/1', '76', 'Snaps 78/70/81% in wks 2-4.'],
  ['Dre Greenlaw', 'SF', 'at SEA', '6/8/8/12', 'FF in wk4', '75', '85% of snaps in wk4.'],
  ['Jamien Sherwood', 'NYJ', 'vs CLE', '4/4/8/13', 'FF in wk4; PD wk2 and wk4', '96', 'Rising.'],
  ['Jack Campbell', 'DET', 'at ARI', '7/6/6/14', 'TFL in wk1', '100', '14 tackles in wk4, in a 54.5 total.'],
  ['Arvell Reese', 'NYG', 'at WSH', '4/7/13/9', 'INT and 3 PD in wk4', '98', 'Both ways.'],
  ['Jeremiah Trotter Jr.', 'PHI', 'at JAX (London)', '--', '--', '--', 'The consensus LB1, with Baun in the concussion protocol (Baun limited Wednesday). Not in our top 60, so I have no numbers.'],
];
const IDP_DL = [
  ['Aidan Hutchinson', 'DET', 'at ARI', '5/3/2/3', 'Sacks 2/1/0.5/0; FF wk2', '92', 'ARI left tackle Paris Johnson is out for the season.'],
  ['DeForest Buckner', 'IND', 'at PIT', '2/5/7/4', 'Sacks 0.5/1/1.5/0', '83', 'Steady snaps.'],
  ['Zach Allen', 'DEN', 'at LAC', '5/1/2/5', 'Sacks 2/0/1/0; TFL 2/0/1/0', '72', 'Slater and Alt are hurt.'],
  ['Will Anderson Jr.', 'HOU', 'at TEN', '3/7/7/5', 'Sacks 0.5/1/2.5/0.5', '79', 'DNP Wednesday (Q). Hold until Friday.'],
  ['Lukas Van Ness', 'GB', 'vs CHI', '4/8/4/4', 'Sacks 1/1.5/0/0', '72', 'Q.'],
  ['Tyree Wilson', 'NO', 'vs MIN', '2/--/--/6', 'Sack in wk4', '54', 'Two games of data.'],
  ['Josh Hines-Allen', 'JAX', 'vs PHI', '5/3/5/2', 'Sacks 1.5/0/0/0; FF wk1', '76', 'Groin, limited.'],
  ['Kwity Paye', 'LV', 'at NE', '5/2/3/--', 'Sacks 2/0/0/--', '57', 'No wk4 row.'],
];
const IDP_DB = [
  ['Minkah Fitzpatrick', 'NYJ', 'vs CLE', '--/--/--/16', 'INT and PD in wk4', '100', 'One game of data: 16 tackles.'],
  ['Evan Williams', 'GB', 'vs CHI', '7/9/10/7', 'Sack and INT in wk4; PD 0/2/0/2', '100', 'Both ways.'],
  ['Reed Blankenship', 'HOU', 'at TEN', '7/5/9/11', 'INT and 2 PD in wk3', '93', 'Rising.'],
  ['Brandon Jones', 'DEN', 'at LAC', '5/5/12/9', 'INT in wk1', '99', '12 tackles in wk3.'],
  ['Dillon Thieneman', 'CHI', 'at GB', '10/7/6/7', 'INT in wk3', '100', 'Floor.'],
  ['Chuck Clark', 'DET', 'at ARI', '3/11/7/7', 'INT wk1; sack and FF wk3', '95', 'DET at 30.0 in a 54.5 total.'],
  ['D.J. Reed', 'DET', 'at ARI', '10/6/8/6', 'PD 1/0/1/0', '97', 'Floor.'],
  ['Caleb Downs', 'DAL', 'vs TB (Thu)', '8/9/3/7', 'Sack wk1; FF wk1 and wk2', '100', 'No pivot on Thursday.'],
  ['Quentin Lake', 'LAR', 'vs BUF', '10/7/6/6', 'INT wk1; PD 3/3/1/0; FF wk2', '100', 'MNF.'],
  ['Dane Belton', 'NYJ', 'vs CLE', '2/6/7/14', 'PD wk3 and wk4', '100', '14 tackles in wk4.'],
];

const SLEEPERS = [
  ['Will Shipley', 'The RB21 by role in London: Barkley is week-to-week, Bigsby is on IR and Shipley is the only healthy back on the roster. Roster him everywhere. No pivot cover.', 'RB'],
  ['Carnell Tate', 't6/5/9/12, 145 yards and 21.5 in wk4, a 43% share, against the defense that allows the most points to receivers (HOU WR rank 1). WR21 flex-start.', 'WR'],
  ['Mike Gesicki', '3 TD in 3 games, 14.8 avg, MIA TE rank 3. TE9, and TE6 if Chase is out.', 'TE'],
  ['Malik Washington', 't8/5/10/5, a 29% share in wk4. WR32-35 flex at MIA.', 'WR'],
  ['Oronde Gadsden', 't8 and a 26% share in wk4, the Chargers tight end with Kolar and Njoku hurt. TE14-16.', 'TE'],
  ['Colston Loveland', 't9, a 29% share and 11.7 in wk4. TE14-16 against a Green Bay defense I do not fear.', 'TE'],
  ['Antonio Williams', 't8 and 69% of snaps in wk4. The WSH dart only if McLaurin and Diggs are both out.', 'WR'],
  ['RJ Harvey', 't7/10, 19.3 and a 26% share in wk4. The Denver back to own in PPR, RB20.', 'RB'],
  ['Braelon Allen', '94% of snaps and c14 in wk4 with Hall out. The Jets back to own: RB25-28.', 'RB'],
  ['Denzel Boston', 't4/7/4/7, 13.9 in wk4, 95% of snaps. WR19 flex-start in a 39.5 total.', 'WR'],
];

const FADES = [
  ['Jalen Hurts', '93 passing yards and 13.5 in wk4, PHI at 17.25 with no receivers. QB15-16, a sit in 1QB.', 'QB'],
  ['Bagent and the Chicago passing game', '268 yards, 0 TD and 1 INT in wk4, proj 5.05. AVOID in 1QB. Keenum is the backup.', 'QB'],
  ['Jalon Daniels', '148 passing yards, 55 rushing, 1 TD and 2 INT in his debut. Superflex flex only.', 'QB'],
  ['Alvin Kamara', 'Sit even if active. MIN allows the fewest RB points in the league (rank 32).', 'RB'],
  ['Bucky Irving', 'Zero targets and 6.1 in wk4, with DAL -8.5 and a negative script. A flex, not a start.', 'RB'],
  ['George Pickens', 't3 and a 7% share in wk4 with Lamb at 49%. WR30, the last name on the board.', 'WR'],
  ['Dalton Schultz', 't3/2 and 6.0/2.9 the last two. A sit.', 'TE'],
  ['Dalton Kincaid', '3.8 and 1.7 the last two. Sit-lean.', 'TE'],
  ['Courtland Sutton and J.K. Dobbins', 'Sutton 4.6 avg, Dobbins 5.2 avg on 32% of snaps. Denver\'s skill group is flex-only.', 'WR'],
  ['The LAR D/ST', 'Proj 8.82 against BUF at 25.75. Consensus sit.', 'DEF'],
];

// [if X, then Y]
const PIVOTS = [
  ['Chase out (default)', 'Higgins WR7 if he plays, Gesicki TE6, Tinsley dart. Burrow holds QB5. Decide at 10:30a CT.'],
  ['Chase and Higgins both out', 'Gesicki TE6, Tinsley dart, Burrow holds QB5 (428 yards without them). Malik Washington is the MIA flex.'],
  ['Barkley out (default)', 'Shipley RB21 starts. London, so check the 7:00a CT inactives; no pivot cover.'],
  ['Goedert out', 'No PHI tight end is rankable. Swap to a noon-or-later tight end: Kraft TE13 (3:25p) or Andrews TE14 (SNF).'],
  ['Hall out (already)', 'Braelon Allen RB25-28 flex. Judkins is the start; Isaiah Davis is a sit.'],
  ['Pollard out', 'Spears RB30-32 is a sit-lean. Montgomery RB27-30 is the HOU flex.'],
  ['Keenan Allen out', 'Downs WR31-34 PPR flex. Metcalf holds WR16.'],
  ['Bowers out', 'Swap to your noon-or-later tight end: Kraft TE13 or Andrews TE14. Tucker and Doubs are unchanged.'],
  ['Stevenson out', 'Henderson RB24-27. Bench Henderson if Stevenson plays.'],
  ['Jefferson out', 'Hockenson TE4 (up from TE5). Aaron Jones holds RB10. Addison is a flex only if active (WR30-34).'],
  ['Daniels out', 'Kaliakmanis is the WSH QB2 and is unrankable. Antonio Williams is a dart only if McLaurin and Diggs are out too.'],
  ['McLaurin and Diggs out (by rule)', 'Antonio Williams WR38-40 dart. If either plays he is a WR flex (McLaurin WR28-32, Diggs WR30-34).'],
  ['Nabers out', 'No NYG receiver is a start. Malachi Fields (t4/6/2/3) is not a pivot.'],
  ['Skattebo out', 'No NYG back is a pivot: Najee Harris was DNP (personal), Singletary is a sit.'],
  ['Swift out (default)', 'Monangai RB13 starts. If both play, Swift is RB19-21 and Monangai RB24-26. Decide at 1:55p CT.'],
  ['Love out', 'Allgeier RB20-22. If Conner is activated he is a game-time flex and Love drops to RB22-24.'],
  ['Evans out', 'Deebo holds WR24. Kittle holds TE2.'],
  ['Lamar out (default)', 'Huntley is a superflex flex only (QB20-24). Henry gains volume, Flowers WR20, Andrews TE14. ATL D/ST is a streamer (DST10).'],
  ['Flowers out', 'Bateman is a sit. Drake London holds WR7 and Andrews holds TE14.'],
  ['Moore out', 'Coleman WR26, Shakir WR28. If Moore plays, Coleman drops to WR36-40.'],
  ['Nacua out', 'Adams holds WR8. Confirm Friday; there is no practice entry yet.'],
];

// Rulings are [id, title, ruling, confidence, rule].
const RULINGS = [
  ['C1', 'Lamar Jackson and Tyler Huntley (SNF)', 'Default OUT. Lamar is QB6 only if he is active. Huntley is a sit in 1QB and a superflex flex (QB20-24). If Huntley starts, Henry gains volume, Flowers is WR20 and Andrews is TE14.', 'Medium', 'Friday LP plus Questionable: hold Lamar only if your bench quarterback plays Sunday night or Monday (Allen, Stafford, Penix), so you can swap at the 5:50p CT inactives. Otherwise pivot to a Sunday starter. Friday DNP: pivot now.'],
  ['C2', 'Barkley OUT, Shipley starts (London)', 'Barkley is OUT by rule: hamstring, DNP Wednesday, week-to-week, and "unlikely" per Rapoport. Shipley is the RB21 by role; his 2.69 projection is ignored.', 'Medium-high', 'London has no pivot cover. Roster Shipley everywhere and check the 7:00a CT inactives. If Barkley is somehow active he is an RB2 flex (RB18-20) and the Shipley call turns into a split.'],
  ['C3', 'Chase and Higgins (noon)', 'The default ranking treats Chase as OUT (concussion protocol, no clearance reported) and Higgins as OUT (did not practice Wednesday). If Chase clears by Friday and is active he is WR9. If Higgins is active and Chase is out, Higgins is WR7. Both active: Chase WR9, Higgins WR12. Both out: Gesicki TE6, Tinsley a dart, Burrow holds QB5.', 'Medium', 'Start either only with a noon-or-later bench receiver ready at the 10:30a CT inactives. No Friday clearance for Chase means you do not start him.'],
  ['C4', 'Jefferson, Addison and Hockenson (noon)', 'Jefferson (ankle, aiming to play) is a START if active, ranked WR10. Addison (hamstring, DNP Wednesday) is default OUT and a WR flex if active. Hockenson is TE5 whatever happens, and TE4 if Jefferson is out.', 'Medium', 'Jefferson LP on Friday: start him with a noon-or-later bench WR ready at 10:30a CT. Friday DNP: pivot. Addison with a Friday DNP stays out.'],
  ['C5', 'Daniels starts, McLaurin and Diggs OUT by rule (noon)', 'Jayden Daniels took a full practice Wednesday and is on track to start: QB13, a superflex START and a 1QB streamer. McLaurin and Diggs both sat out Wednesday with hamstrings and are out by rule in a noon game.', 'Medium', 'The Wednesday DNPs with a noon kickoff mean no pivot cover, so they stay out unless a Friday report says otherwise. If either plays he is a WR flex (McLaurin WR28-32, Diggs WR30-34). Check Daniels at 10:30a CT.'],
  ['C6', 'Swift and Monangai (CHI, 3:25p)', 'Swift (hip and knee, DNP) is default OUT, and Monangai starts at RB13. If Swift is active it is a split: Swift RB19-21, Monangai RB24-26.', 'Medium', '3:25p is pivot-safe. Decide at the 1:55p CT inactives, after you have seen the noon games.'],
  ['C7', 'Malik Nabers (NYG, noon)', 'WR14 if active, with hold-if-Friday-LP language. Knee, DNP Wednesday, "more sore than usual." The noon-DNP rule says OUT; this is the one written override, because he played 76% of the snaps on it last week and the report reads as maintenance, not a new injury.', 'Medium-low', 'Friday LP: start him only with a noon-or-later bench WR ready at 10:30a CT. Friday DNP: sit.'],
  ['C8', 'Brock Bowers (LV, noon)', 'TE3 if active. Knee, limited Wednesday, t13 and t11 in wks 3-4. NE allows the fewest tight end points (rank 32) and the share outweighs it.', 'Medium-high', 'Noon kickoff, so keep a noon-or-later tight end (Kraft at 3:25p, Andrews on SNF) as cover and swap at 10:30a CT if he is inactive. Friday DNP: pivot.'],
  ['C9', 'Stevenson and Henderson (NE, noon)', 'Stevenson is RB23 if active (leg and knee, Vrabel optimistic). Henderson is RB24-27 if Stevenson is out and a bench player if he plays.', 'Medium', 'Decide at 10:30a CT. Do not start Henderson ahead of the inactives.'],
  ['C10', 'Love and Allgeier (ARI, 3:25p)', 'Love is RB16 if active (ankle, limited Wednesday; LaFleur: "shouldn\'t impact" Week 5 prep). Allgeier is RB20-22 only if Love sits. Conner is designated to return and expected in Week 5 per CBS and ESPN, but unconfirmed: do not rank him.', 'Medium-high', 'Decide at the 1:55p CT inactives. If Conner is activated he is a game-time flex and Love drops to RB22-24.'],
  ['C11', 'Hall OUT, Braelon Allen flex (NYJ, noon)', 'Hall is out: quad, DNP Wednesday, week-to-week. Braelon Allen is the RB25-28 flex on 94% of snaps and c14 in wk4.', 'High', 'No decision to run. Judkins is the start and Allen is a flex; do not chase Allen into a start.'],
  ['C12', 'Keon Coleman and DJ Moore (BUF, MNF)', 'If Moore is out, Coleman is WR26 and Shakir WR28. If Moore plays, Moore is a flex at WR30-33 and Coleman drops to WR36-40.', 'Medium', 'Monday is pivot-safe, so decide at the MNF inactives about 5:45p CT. Do not start either before then.'],
  ['C13', 'Jalon Daniels sits in 1QB, Dallas D/ST starts (Thursday)', 'Jalon Daniels is a sit in 1QB and a superflex flex. Dallas D/ST is a START as the Thursday streamer at DST6: the 0.34 projection is overridden by context (a rookie quarterback with 2 INT last week, TB at 19.5, and TB\'s offense gives D/STs the second-most points). Irving is an RB19 flex, not a start.', 'Medium-high', 'Thursday has no pivot cover. Set the D/ST before the 5:45p CT inactives; a late scratch cannot be fixed.'],
  ['C14', 'Bagent AVOID, Keenum is the backup (CHI)', 'Bagent starts and is an AVOID in 1QB, a superflex flex only (QB20-24). Keenum is the backup per the Sun-Times, and his 19.31 projection is a one-game placeholder (n=1, low).', 'High', 'Do not rank any CHI passer by projection.'],
  ['C15', 'Jalen Hurts (PHI, London)', 'Sit in 1QB at QB15-16. 93 passing yards in wk4, PHI at 17.25 with no receivers. A superflex START.', 'Medium-high', 'No decision to run in 1QB. In superflex, start him on rushing alone.'],
  ['C16', 'Purdy starts despite SEA (SF)', 'Purdy is QB3. SEA allows the second-fewest quarterback points (rank 31), which costs him a haircut, but his volume (pa34/22/27/30) and 25.1 average still put him third on this slate.', 'Medium', 'Start him unless you own Allen or Goff. 3:25p is pivot-safe, so check the 1:55p CT inactives for Kittle and Smith-Njigba before you lock.'],
  ['C17', 'Tyler Shough (NO, noon)', 'QB11, a matchup override down from the engine\'s QB8. MIN allows the fewest quarterback points in the league (rank 32). Superflex START, 1QB streamer. Non-throwing hand, limited Wednesday.', 'Medium', 'Start him in superflex. In 1QB use him only as a streamer if your starter is out or ranks below QB12.'],
  ['C18', 'Alvin Kamara (NO, noon)', 'Sit even if active. Back, did not participate in the Wednesday walkthrough, and MIN allows the fewest RB points in the league (rank 32).', 'Medium-high', 'Friday LP does not change the ruling. Start him only if your roster has no other back.'],
  ['C19', 'Pollard and Spears (TEN, noon)', 'Pollard is RB26 only if active (foot, DNP Wednesday). Spears is RB30-32 if Pollard is out, a sit-lean either way. HOU allows the 28th-most RB points (rank 28).', 'Medium', 'Decide at 10:30a CT. Do not start Pollard without a noon-or-later bench back.'],
  ['C20', 'Mike Evans (SF, 3:25p)', 'A deep-league flex only, and only if active. Ribs, limited Wednesday. t7/3/6/8 and 59% of snaps in wk4.', 'Medium-high', 'Samuel is the SF WR to hold. Decide at 1:55p CT.'],
  ['C21', 'Charbonnet OUT, Emanuel Wilson RB15 (SEA)', 'Charbonnet is on the reserve/PUP list and will not be activated this week (Macdonald, Monday). Price is on IR. Wilson is the RB15 by role: c21 in wk4, 2 TD and 28.0. His 5.48 projection is ignored.', 'High', 'No decision to run this week. Wilson is a rental: Charbonnet is possible in Week 6.'],
  ['C22', 'Dallas Goedert (PHI, London)', 'TE12 if active. Knee, limited Wednesday. With Smith and Brown out he is the target hog.', 'Medium-low', 'London has no pivot. Pair him with a noon-or-later tight end on your bench (Kraft TE13, Andrews TE14) and swap at the 7:00a CT inactives only if he is out.'],
  ['C23', 'Jacoby Brissett (ARI, 3:25p)', 'QB10 streamer. DET allows the most quarterback points in the league (rank 1) and the total is 54.5, which is the override up from his 14.11 projection. Carson Beck\'s 15.65 is a placeholder (n=0).', 'Medium', 'Start him as a streamer if your starter is out or ranks below QB10. Check the roof at game time; I assume it is closed.'],
  ['C24', 'Skattebo and Likely (NYG, noon)', 'Skattebo is RB22 if active (shoulder, limited Wednesday). Likely is a TE15-16 flex if active (knee and groin, limited Wednesday).', 'Medium', 'Decide at 10:30a CT. If Skattebo is out there is no NYG back to pivot to.'],
  ['C25', 'Zay Flowers (BAL, SNF)', 'WR20 with Huntley, WR9 if Lamar plays. Foot, limited Wednesday.', 'Medium', 'Decide at the 5:50p CT SNF inactives, after the late games. If Lamar is out, start Flowers as a flex and not a WR2.'],
];

// [who, what to do]
const CHECK_THU = [
  ['Jalon Daniels (TB QB).', 'Starts. Superflex flex only; a sit in 1QB.'],
  ['Jonathan Mingo (DAL WR).', 'Q with an illness. Irrelevant to lineups.'],
  ['Chase McLaughlin (TB K).', 'Conflicting reports. Check the report; Aubrey (DAL) is the kicker to own.'],
  ['Dallas D/ST.', 'Set it. There is no pivot on Thursday.'],
  ['Everyone on the card.', 'Lamb, Prescott and Javonte Williams start. Irving and Pickens are flex-only.'],
];
const CHECK_LONDON = [
  ['Saquon Barkley (PHI RB).', 'Treated as out. Confirm it, then Shipley is the RB21 start.'],
  ['Dallas Goedert (PHI TE).', 'Active: TE12 flex. Out: swap to a noon-or-later tight end.'],
  ['DeVonta Smith and Hollywood Brown (PHI WR).', 'Already printed OUT. Confirm, because London has no pivot cover.'],
  ['Zack Baun (PHI LB).', 'IDP only. Concussion protocol.'],
];
const CHECK_NOON = [
  ['Ja\'Marr Chase (CIN WR).', 'Active: WR9 start. Out: Higgins WR7 if he plays, Gesicki TE6.'],
  ['Tee Higgins (CIN WR).', 'Active: WR12 start (WR7 if Chase is out). Out: Tinsley dart.'],
  ['Nico Collins (HOU WR).', 'Active: WR5 start. Out: there is no HOU receiver pivot.'],
  ['Tony Pollard (TEN RB).', 'Active: RB26 flex. Out: Spears is a sit-lean.'],
  ['Keenan Allen (IND WR).', 'Active: WR33-36 flex. Out: Downs flex.'],
  ['Brock Bowers (LV TE).', 'Active: TE3 start. Out: swap to Kraft or Andrews.'],
  ['Rhamondre Stevenson (NE RB).', 'Active: RB23. Out: Henderson RB24-27.'],
  ['Justin Jefferson (MIN WR).', 'Active: WR10 start. Out: Hockenson TE4.'],
  ['Jordan Addison (MIN WR).', 'Default OUT. Active: a WR30-34 flex.'],
  ['Alvin Kamara (NO RB).', 'A sit even if active.'],
  ['Tyler Shough (NO QB).', 'Active: QB11. Hand injury, likely plays.'],
  ['Jayden Daniels (WSH QB).', 'Active: QB13, superflex start. Out: Kaliakmanis, unrankable.'],
  ['McLaurin and Diggs (WSH WR).', 'Out by rule. If either is active he is a WR flex.'],
  ['Malik Nabers (NYG WR).', 'Friday LP and active: WR14. Otherwise sit.'],
  ['Skattebo and Likely (NYG).', 'Both limited Wednesday. Active: RB22 and TE15-16 flex.'],
  ['Hall, Mitchell, Hollins, Nailor, McLaurin and Diggs.', 'Already printed OUT. Confirm, because the noon games have no pivot cover.'],
];
const CHECK_LATE = [
  ['D\'Andre Swift and Kyle Monangai (CHI RB), inactives about 1:55p CT.', 'Swift out: Monangai RB13. Both active: Swift RB19-21, Monangai RB24-26.'],
  ['Jeremiyah Love and Tyler Allgeier (ARI RB), about 1:55p CT.', 'Love out: Allgeier RB20-22. Conner activated: game-time flex, Love drops to RB22-24.'],
  ['Mike Evans (SF WR), about 1:55p CT.', 'A deep-league flex only. Out: Samuel holds.'],
  ['Chris Brooks (GB RB).', 'Ankle, further testing. Lloyd is a sit either way.'],
  ['Pat Bryant and McConkey (DEN, LAC).', 'Already printed OUT. DEN D/ST stays DST5.'],
  ['Roof at State Farm Stadium (DET at ARI).', 'Assumed closed. Check at game time.'],
];
const CHECK_SNF = [
  ['Lamar Jackson (BAL QB), inactives about 5:50p CT.', 'Active: QB6. Out: Huntley is a superflex flex only, and Flowers is WR20.'],
  ['Zay Flowers (BAL WR).', 'Limited Wednesday. Likely plays: WR20 with Huntley, WR9 if Lamar plays.'],
  ['Rashod Bateman (BAL WR).', 'A sit either way.'],
];
const CHECK_MNF = [
  ['DJ Moore and Keon Coleman (BUF WR), inactives about 5:45p CT Monday.', 'Moore out: Coleman WR26, Shakir WR28. Moore active: Moore WR30-33, Coleman WR36-40.'],
  ['Puka Nacua (LAR WR).', 'No practice entry. Start him; confirm on Friday and again at the inactives.'],
];

const Body = () => (
  <>
    <HeroBanner />

    <Lead>
      Fifteen games, Thursday through Monday, and two teams on bye. Caleb Williams is out, Lamar
      Jackson did not practice Wednesday, Ja&apos;Marr Chase is in the concussion protocol and Saquon
      Barkley is week-to-week. Four weeks of evidence is enough to stop pretending. Every call is
      here. Set your Thursday lineup first, and set your pivots before you go to bed Saturday.
    </Lead>

    <Note title="Read this first">
      <strong>Lines are as of Oct 8. Injury notes are Wednesday practice reports, plus the Thursday
      final report for Tampa Bay at Dallas.</strong>{' '}
      No Friday designations existed when I wrote this, and Friday&apos;s reports can change any of
      it. Re-check the Friday reports and the inactives before you lock anything. Every window below
      says when the inactives drop.
    </Note>

    <P>
      Scoring is PPR unless I say otherwise; standard and half-PPR only show up where they change a
      verdict. &quot;Proj&quot; is our Week 5 PPR projection. Where the projection is a placeholder
      or a number that cannot be trusted, I say so and lean on usage. Carolina and Kansas City are
      on bye, so 30 teams play. Kickers are in this week, because we finally have kicker data.
    </P>
    <RailList
      items={[
        ['Usage lines', 'read wk1/wk2/wk3/wk4. c = carries, t = targets, pa = pass attempts. Points lines (like 16.8/11.0/6.8/6.1) are PPR points by week. Week-1 snap share is unknown everywhere, so snap lines print "--" for week 1.'],
        ['FPA rank', '1 means the defense allows the most points to that position (a good matchup), 32 the fewest (tough). Weeks 1 to 4 only, garbage time included.'],
        ['Tiers', 'QB 1-3 SMASH, 4-12 START, 13-18 FLEX. RB 1-6, 7-18, 19-30. WR 1-6, 7-24, 25-40. TE 1-3, 4-8, 9-14. D/ST 1-8 are all START, with 1 the lock. A written reason beats the rank rule.'],
        ['(n=…, low/medium/high quality)', 'n is the sample size behind a projection, and low, medium or high quality is how far to trust it. Low means lean on usage. A placeholder (n=0 or n=1) never ranks anyone.'],
        ['Ruling links', 'Where a call is contested, the card links to its Darkness Ruling (C1 to C25) with the confidence and the decision rule.'],
      ]}
    />

    <JumpGrid />

    <H2>The Slate Board</H2>
    <P>
      Every game, in kickoff order with Thursday first: line, total, weather and both implied totals
      on one scale. Filled bars are the favorites. Detroit at Arizona and Buffalo at the Rams (54.5
      each) are the shootouts. Houston at Tennessee (38.5) is the lowest total on the slate, and
      Tennessee&apos;s 15.5 is the lowest implied total. Dallas (-8.5, 28.0), Houston (-7.5) and
      Jacksonville (-7) are the big favorites.
    </P>
    <SlateBoard />
    <P>
      The rain flags (in amber) are Indianapolis at Pittsburgh (76%), the Giants at Washington
      (63%), Houston at Tennessee (50%, with a 15 mph wind) and Detroit at Arizona (storms at 69%
      outside, with a 20 mph wind). Arizona has a retractable roof and I am assuming it is closed.
      Tampa Bay at Dallas also has a retractable roof, with 82F and clear outside, and I do not know
      which way it will be set. New Orleans, the Chargers and the Rams play in domes. I have no
      number for what rain does to a stat line, so there are no point adjustments, only a mild
      tiebreak toward rushers.
    </P>

    <H2>The Injury Board</H2>
    <P>
      Practice reports are Wednesday, with a Thursday final report for the two Thursday teams. The
      decision rules are simple, and I apply them the same way to every name on this page.
    </P>
    <RailList
      color="var(--warning)"
      items={[
        ['Wednesday DNP, no later report', 'ranked OUT, with the beneficiary printed. Noon and London players are printed OUT outright, because there is no pivot cover. Late, Sunday-night and Monday-night players carry hold-if-Friday-LP language.'],
        ['Rest DNPs', 'McCaffrey, Taylor, Aaron Jones, Olave, Smith-Njigba, Trent Williams and Heyward get no downgrade.'],
        ['"If active" calls', 'are void if the player does not appear. Every call that turns on a practice report, his or his teammate\'s, carries the injury in its card.'],
        ['Placeholder projections', 'never rank anyone. A newly elevated starter is ranked by role and context, with team implied total as the tiebreaker.'],
        ['A swap only works', 'if your bench player kicks off at or after the player he replaces. Thursday players have no cover at all.'],
      ]}
    />
    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, my: 2 }}>
      <Chip tone="var(--accent)">Thursday: about 5:45p CT</Chip>
      <Chip tone="var(--accent)">London: 7:00a CT</Chip>
      <Chip tone="var(--accent)">Noon games: 10:30a CT</Chip>
      <Chip tone="var(--accent)">3:05p / 3:25p: about 1:35p / 1:55p CT</Chip>
      <Chip tone="var(--accent)">SNF: about 5:50p CT</Chip>
      <Chip tone="var(--accent)">MNF: about 5:45p CT Monday</Chip>
    </Box>

    <InjuryGroup title="Out, or treat as out" when="Wednesday DNPs: London and noon players have no pivot cover." rows={INJ_OUT} />
    <InjuryGroup title="Thursday" when="Final report; inactives about 5:45p CT; no pivot cover" rows={INJ_THU} />
    <InjuryGroup title="London" when="Inactives 7:00a CT" rows={INJ_LONDON} />
    <InjuryGroup title="Noon games" when="Inactives 10:30a CT" rows={INJ_NOON} />
    <InjuryGroup title="Late window" when="Inactives about 1:35p / 1:55p CT" rows={INJ_LATE} />
    <InjuryGroup title="Sunday and Monday night" when="Inactives about 5:50p / 5:45p CT" rows={INJ_NIGHT} />
    <Box component="h3" sx={{ m: '24px 0 8px !important', fontSize: '1.15rem !important' }}>Already out for the week or longer</Box>
    <Box component="p" sx={{ mt: '0 !important', fontSize: '0.92rem', color: 'var(--text-muted)', lineHeight: 1.6 }}>
      {ALREADY_OUT.join('; ')}.
    </Box>

    <H2>Thursday Night</H2>
    <P>
      One game, and it locks first. The inactives drop about 5:45p CT and there is no pivot cover:
      whoever you start Thursday night is locked, and a late scratch cannot be fixed. Set the
      lineup before you do anything else on Thursday.
    </P>
    {SLOT('thu')}

    <H2>Early Window</H2>
    <P>
      London at 8:30a CT, then seven noon games. Nothing kicks between noon and 3:05p, so a
      noon-game decision needs a noon-or-later swap on your bench, and the London game has no pivot
      cover at all.
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
      Sunday night is Baltimore at Atlanta, where Lamar Jackson&apos;s ankle decides the quarterback
      picture. Monday night is Buffalo at the Rams, and my Monday injury data is Wednesday-only, so
      hold it loosely.
    </P>
    {SLOT('prime')}

    <H2>Position Tiers</H2>
    <P>
      The rankings for the Thursday through Monday slate, blended from projection, weeks 1 to 4
      usage, FPA rank and game total. SMASH means start him and stop thinking. START means he is in
      your lineup. FLEX means a lineup spot only if the matchup or your depth says so. The rank
      order and the projection column do not always agree: the context is the point.
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
    <TierBoard pos="DST" rows={DST_ROWS} smashMax={0} startMax={8} projLabel="Proj" />
    <H3>Kickers</H3>
    <P>
      Eight kickers on offenses that score, by projection. McLaughlin (TB) is missing from the
      list because of conflicting injury reports: NFL.com says full, RotoBaller says groin and hip.
    </P>
    <RailList items={KICKERS} />

    <H2>Handcuff Board</H2>
    <P>
      The starter&apos;s report decides the handcuff, so read this beside the Injury Board. The
      verdict is for Week 5 and nothing else.
    </P>
    <Table aria-label="Week 5 handcuff board">
      <THead>
        <TR>
          <TH scope="col">Team</TH><TH scope="col">Starter and status</TH><TH scope="col">Handcuff</TH><TH scope="col">Verdict</TH>
        </TR>
      </THead>
      <TBody>
        {HANDCUFFS.map(([team, starter, cuff, verdict]) => (
          <TR key={team}><TD><strong>{team}</strong></TD><TD>{starter}</TD><TD><strong>{cuff}</strong></TD><TD>{verdict}</TD></TR>
        ))}
      </TBody>
    </Table>
    <P>
      Also on the radar: Corum (behind Kyren Williams), Gainwell (behind Irving), Perine (behind
      Chase Brown), Keaton Mitchell (behind Hampton), Roschon Johnson (CHI RB3) and DeeJay Dallas
      (behind Aaron Jones).
    </P>

    <H2>D/ST Streaming Board</H2>
    <P>
      The top eight plus the next tier. &quot;Opp implied&quot; is the points the opposing offense
      is expected to score. &quot;Opp DEF-FPA rank&quot; ranks that offense by the D/ST points it
      has given up over four weeks: 1 is the most. The streamer of the week is Denver at the
      Chargers (19.0 implied, and the Chargers&apos; offense gives up the third-most D/ST points).
      The Thursday streamer is Dallas.
    </P>
    <Table aria-label="Week 5 D/ST streaming board">
      <THead>
        <TR>
          <TH scope="col">D/ST</TH><TH scope="col">Opponent</TH><TH scope="col">Opp implied</TH><TH scope="col">Opp DEF-FPA rank</TH><TH scope="col">Sacks wk1-4</TH><TH scope="col">Turnovers wk1-4</TH><TH scope="col">Proj</TH><TH scope="col">Verdict</TH>
        </TR>
      </THead>
      <TBody>
        {DST_TABLE.map(([team, opp, imp, rk, sk, to, proj, verdict]) => (
          <TR key={team}><TD><strong>{team}</strong></TD><TD>{opp}</TD><TD>{imp}</TD><TD>{rk}</TD><TD>{sk}</TD><TD>{to}</TD><TD>{proj}</TD><TD>{verdict}</TD></TR>
        ))}
      </TBody>
    </Table>
    <P>
      <strong>Sit the household names:</strong> the Rams (Buffalo at 25.75), Philadelphia (Jacksonville
      at 24.25), Detroit (Arizona at 24.5), Buffalo (the Rams at 28.75), Arizona (Detroit at 30.0),
      Tampa Bay (Dallas at 28.0), San Francisco (Seattle at 24.25) and Green Bay (Chicago at 23.5).
    </P>

    <H2>IDP Streamers</H2>
    <P>
      Weeks 1 to 4 from our database. Tackle volume is the currency at linebacker and safety;
      pressure is the currency on the line. Snap % is the four-week average (week 1 is unknown).
      Rostered percentages are not tracked for IDP, so check your own wire.
    </P>
    <H3>Linebacker</H3>
    <Table aria-label="IDP linebackers">
      <THead>
        <TR>
          <TH scope="col">Player</TH><TH scope="col">Team</TH><TH scope="col">Opp</TH><TH scope="col">Tackles wk1-4</TH><TH scope="col">Sacks/big plays</TH><TH scope="col">Snap %</TH><TH scope="col">Note</TH>
        </TR>
      </THead>
      <TBody>
        {IDP_LB.map(([name, team, opp, tkl, big, snap, note]) => (
          <TR key={name}><TD><strong>{name}</strong></TD><TD>{team}</TD><TD>{opp}</TD><TD>{tkl}</TD><TD>{big}</TD><TD>{snap}</TD><TD>{note}</TD></TR>
        ))}
      </TBody>
    </Table>
    <H3>Defensive line</H3>
    <Table aria-label="IDP defensive line">
      <THead>
        <TR>
          <TH scope="col">Player</TH><TH scope="col">Team</TH><TH scope="col">Opp</TH><TH scope="col">Tackles wk1-4</TH><TH scope="col">Sacks/big plays</TH><TH scope="col">Snap %</TH><TH scope="col">Note</TH>
        </TR>
      </THead>
      <TBody>
        {IDP_DL.map(([name, team, opp, tkl, big, snap, note]) => (
          <TR key={name}><TD><strong>{name}</strong></TD><TD>{team}</TD><TD>{opp}</TD><TD>{tkl}</TD><TD>{big}</TD><TD>{snap}</TD><TD>{note}</TD></TR>
        ))}
      </TBody>
    </Table>
    <P>
      Out or doubtful on the line: Mason Graham (CLE, MCL and ankle, DNP), Jeffery Simmons (TEN,
      back, DNP), Nick Bosa (SF, unlikely) and Dexter Lawrence (CIN, Q).
    </P>
    <H3>Defensive back</H3>
    <Table aria-label="IDP defensive backs">
      <THead>
        <TR>
          <TH scope="col">Player</TH><TH scope="col">Team</TH><TH scope="col">Opp</TH><TH scope="col">Tackles wk1-4</TH><TH scope="col">Sacks/big plays</TH><TH scope="col">Snap %</TH><TH scope="col">Note</TH>
        </TR>
      </THead>
      <TBody>
        {IDP_DB.map(([name, team, opp, tkl, big, snap, note]) => (
          <TR key={name}><TD><strong>{name}</strong></TD><TD>{team}</TD><TD>{opp}</TD><TD>{tkl}</TD><TD>{big}</TD><TD>{snap}</TD><TD>{note}</TD></TR>
        ))}
      </TBody>
    </Table>
    <P>
      Hurt in the secondary: Kyle Hamilton (BAL, Q), Derwin James (LAC, DNP Wednesday), Amani Hooker
      (TEN, concussion protocol, DNP), Marques Sigle (SF, out) and Antoine Winfield Jr. (TB, out
      with ribs).
    </P>

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
      Twenty-five calls got argued about. Here is each one in short form: the ruling, how sure I am,
      and the rule you can run yourself when the news breaks.
    </P>
    {RULINGS.map((r) => <RulingCard key={r[0]} r={r} />)}

    <H2>Inactives Checklist</H2>
    <P>
      Inactives drop about 90 minutes before each kickoff. Windows are Central time. Thursday is the
      first window and the only one with no cover, so start there.
    </P>
    <WindowChecklist title="Thursday inactives" time="about 5:45p CT" rows={CHECK_THU} />
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
