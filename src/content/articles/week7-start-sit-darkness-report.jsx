import React from 'react';
import { Box } from '@mui/material';
import {
  Lead, P, H2, H3, Quote,
  Table, THead, TBody, TR, TH, TD,
} from '../../components/public/kit/Prose';

// Body only: the frontmatter lives in week7-start-sit-darkness-report.meta.js so listings can be
// built without loading this prose; content/articles/index.js loads it on demand.
//
// Every color below the hero is a theme token, so the board, cards and chips read in light and
// dark. The hero is a dark illustration in both themes, like the Week 3 start/sit banner.
//
// Reading key (also printed in the article): FPA rank: 1 = most points allowed (good matchup for the
// opposing position), 32 = fewest (tough). Weeks 1 to 6. Times are Eastern. Verdicts come from docs/editorial/week7-rulings.md.

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
      aria-labelledby="wk7ss-hero-title wk7ss-hero-desc"
    >
      <title id="wk7ss-hero-title">Week 7 Start/Sit: The Darkness Report</title>
      <desc id="wk7ss-hero-desc">
        A night football field in perspective, with yard lines, hash marks and goalposts under a
        floodlight, and a glowing football arcing across the sky over the headline Week 7 Start/Sit.
      </desc>
      <defs>
        <linearGradient id="wk7ss-sky" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#060910" />
          <stop offset="0.55" stopColor="#0c1424" />
          <stop offset="1" stopColor="#1a0f24" />
        </linearGradient>
        <radialGradient id="wk7ss-flood" cx="0.5" cy="0.1" r="0.85">
          <stop offset="0" stopColor="#7eaaff" stopOpacity="0.34" />
          <stop offset="1" stopColor="#7eaaff" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="wk7ss-turf" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#0f3a2a" />
          <stop offset="1" stopColor="#06180f" />
        </linearGradient>
        <linearGradient id="wk7ss-trail" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#2fd97b" stopOpacity="0" />
          <stop offset="1" stopColor="#ffd866" stopOpacity="0.95" />
        </linearGradient>
      </defs>
      <rect width="800" height="300" fill="url(#wk7ss-sky)" />
      <rect width="800" height="300" fill="url(#wk7ss-flood)" />
      <rect x="0" y="150" width="800" height="150" fill="url(#wk7ss-turf)" />
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
      <path d="M96 236 C 190 24, 420 -6, 520 96" fill="none" stroke="url(#wk7ss-trail)" strokeWidth="3" strokeLinecap="round" strokeDasharray="2 9" />
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
      <text x="400" y="244" textAnchor="middle" fill="#ffffff" fontFamily="system-ui, sans-serif" fontWeight="850" fontSize="24" letterSpacing="1">WEEK 7 START / SIT</text>
      <text x="400" y="268" textAnchor="middle" fill="#8badc9" fontFamily="system-ui, sans-serif" fontWeight="600" fontSize="12" letterSpacing="2">WEEK 7 | THURSDAY TO MONDAY | 14 GAMES</text>
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
          <strong>Also:</strong> {g.also}
        </Box>
      ) : null}
    </Box>
  );
}

// Every game on one board: kickoff, line, total, weather, and both implied totals as bars on a
// shared scale (filled accent is the favorite).
function SlateBoard() {
  const max = 34;
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
            <Box sx={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-muted)' }}>{g.kick} ET</Box>
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

// One position board in bands that follow the written verdicts. Rows are [rank, name, team, note,
// band]; a player with no ruling is ranked without a call.
const BANDS = [
  { key: 'start', label: 'START', color: 'var(--success)' },
  { key: 'flex', label: 'FLEX', color: 'var(--accent)' },
  { key: 'sit', label: 'SIT', color: 'var(--danger)' },
  { key: 'rank', label: 'RANKED, NO CALL', color: 'var(--text-muted)' },
];
function TierBoard({ pos, rows, next }) {
  return (
    <Box sx={{ my: 3 }}>
      {BANDS.map((b) => {
        const inBand = rows.filter((r) => r[4] === b.key);
        if (!inBand.length) return null;
        return (
          <Box key={b.key} sx={{ mb: 1.75, borderLeft: '4px solid', borderLeftColor: b.color, pl: 1.5 }}>
            <Box sx={{ fontSize: '0.72rem', fontWeight: 900, letterSpacing: '0.12em', color: b.color, mb: 0.25 }}>
              {b.label} &middot; {pos} {inBand.map((r) => r[0]).join(', ')}
            </Box>
            {inBand.map(([rk, name, team, note]) => (
              <Box key={`${rk}-${name}`} sx={{ display: 'grid', gridTemplateColumns: '1.9em 1fr', columnGap: 1, alignItems: 'baseline', py: 0.5, borderBottom: '1px solid var(--border-subtle)', fontSize: '0.92rem', lineHeight: 1.4 }}>
                <Box component="span" sx={{ fontWeight: 900, color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>{rk}</Box>
                <Box sx={{ minWidth: 0, overflowWrap: 'anywhere' }}>
                  <strong>{name}</strong> <Box component="span" sx={{ color: 'var(--text-muted)', fontSize: '0.8rem', fontWeight: 700 }}>{team}</Box>
                  {note ? <Box sx={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{note}</Box> : null}
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

const VERDICT_COLOR = {
  START: 'var(--success)', FLEX: 'var(--accent)', SIT: 'var(--danger)', OUT: 'var(--danger)',
};
const verdictColor = (v) => VERDICT_COLOR[String(v).split(' ')[0]];

// Rulings are [id, lines]; lines are [name, position, team, verdict, reason].
function RulingCard({ r: [id, lines] }) {
  return (
    <Box
      id={`ruling-${id.toLowerCase()}`}
      sx={{ my: 1.5, p: { xs: 1.5, sm: 2 }, borderRadius: 'var(--radius-md, 10px)', bgcolor: 'var(--surface-raised)', border: '1px solid var(--border-subtle)', scrollMarginTop: 92 }}
    >
      <Box sx={{ display: 'grid', gridTemplateColumns: '3.2em 1fr', columnGap: 1, rowGap: 1.1 }}>
        <Box sx={{ fontWeight: 900, color: 'var(--accent)' }}>{id}</Box>
        <Box sx={{ display: 'grid', rowGap: 1.1, minWidth: 0 }}>
          {lines.map(([name, pos, team, verdict, reason]) => (
            <Box key={name} sx={{ pl: 1.25, borderLeft: '3px solid', borderColor: verdictColor(verdict), fontSize: '0.95rem', lineHeight: 1.55, overflowWrap: 'anywhere' }}>
              <Pill color={posColor(pos)}>{pos}</Pill>
              <strong>{name}</strong>
              <Box component="span" sx={{ ml: 0.75, fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-muted)' }}>{team}</Box>
              <Box component="span" sx={{ ml: 0.75, fontSize: '0.78rem', fontWeight: 900, letterSpacing: '0.06em', color: verdictColor(verdict) }}>{verdict.toUpperCase()}</Box>
              <Box sx={{ color: 'var(--text-muted)', fontSize: '0.92rem' }}>{reason}</Box>
            </Box>
          ))}
        </Box>
      </Box>
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


// Items are [name, position, why, rank, flag]. flag is a Darkness Ruling id (C4). Games are in kickoff order.


const GAMES = [
  {
    id: 'ne-chi',
    slot: 'thu',
    title: 'Patriots at Bears',
    kick: 'Thu 8:15p',
    when: 'Thursday Night · 8:15p ET',
    away: 'NE',
    home: 'CHI',
    awayPts: 23.75,
    homePts: 26.75,
    line: 'CHI -3',
    total: 50.5,
    weather: '60F, wind 5, mostly clear',
    rain: false,
    read: 'Thursday night at Soldier Field, and it locks first. The inactives drop about 6:45p ET and there is no pivot cover: whatever you start is final. Chicago is implied for 26.8, the second-highest total on the slate. Kyle Monangai is ruled out (thumb, toe), so his 15 carries a game open up for D\'Andre Swift and Roschon Johnson is the No. 2 back. Drake Maye has 31.6 a game over the last two with full practice. Romeo Doubs and Mack Hollins are on IR, which is why DeMario Douglas, A.J. Brown and Hunter Henry all get calls.',
    fpa: 'NE offense vs CHI D: QB 14, RB 30, WR 18, TE 26 · CHI offense vs NE D: QB 27, RB 20, WR 13, TE 27',
    start: [
      ['Drake Maye', 'QB', '31.6 a game over the last two (39.5, 23.8), full practice; Thursday night at Chicago.', 'QB2', 'C2'],
      ['Caleb Williams', 'QB', 'Chicago implied for 26.8, the second-highest total; New England allows the 6th-fewest QB points, so a low-end QB1.', 'QB10', 'C10'],
      ['D\'Andre Swift', 'RB', '20.1 a game over the last two, and Monangai\'s 15 carries a game open up; Chicago implied for 26.8.', 'RB7', 'C25'],
    ],
    flex: [
      ['Roschon Johnson', 'RB', '14.5 on 13 carries last week; the No. 2 back while Monangai is out.', 'RB20', 'C25'],
      ['DeMario Douglas', 'WR', '21.1 a game over the last two; Romeo Doubs and Mack Hollins are on IR.', 'WR23', 'C68'],
      ['Luther Burden III', 'WR', '17.5 last week, 22% target share.', 'WR24', 'C69'],
      ['A.J. Brown', 'WR', '10 targets last week, full practice; Doubs and Hollins are on IR.', 'WR28', 'C73'],
      ['Hunter Henry', 'TE', '14.1 a game over the last two; Doubs and Hollins are on IR.', 'TE10', 'C92'],
    ],
    watch: [],
    sit: [
      ['Kyle Monangai', 'RB', 'OUT. Ruled out for Thursday (thumb, toe); the engine still projects 11.5.', 'OUT', 'C25'],
      ['Rhamondre Stevenson', 'RB', '3.6 last week; Chicago allows the 3rd-fewest RB points.', null, 'C43'],
      ['Rome Odunze', 'WR', '6.0 a game over the last two despite 91% of the snaps.', null, 'C81'],
    ],
    also: 'Chicago D/ST is a streamer tonight (8.7 projected against New England).',
  },
  {
    id: 'pit-no',
    slot: 'paris',
    title: 'Steelers at Saints',
    kick: 'Sun 9:30a',
    when: 'Sun 9:30a ET · Paris (Stade de France)',
    away: 'PIT',
    home: 'NO',
    awayPts: 24,
    homePts: 20.5,
    line: 'PIT -3.5',
    total: 44.5,
    weather: null,
    rain: false,
    read: 'This one is in Paris and kicks off at 9:30a ET, ahead of every other Sunday game. The inactives drop about 8:00a ET and nothing has played before it, so any swap has to come from a bench player in a later game. Pittsburgh is a 3.5-point favorite, implied for 24.0 against 20.5. New Orleans allows the most RB points, so Jaylen Warren is a start, and Pittsburgh allows the 6th-fewest WR points, which makes Chris Olave a lower-end start. With Michael Pittman Jr. and Roman Wilson on IR, DK Metcalf and Germie Bernard are the Steelers receivers.',
    fpa: 'PIT offense vs NO D: QB 15, RB 1, WR 15, TE 7 · NO offense vs PIT D: QB 29, RB 19, WR 27, TE 18',
    start: [
      ['Jaylen Warren', 'RB', 'New Orleans allows the most RB points; 14 carries and 5 targets a game.', 'RB5', 'C23'],
      ['Chris Olave', 'WR', '27% target share; Pittsburgh allows the 6th-fewest WR points, so a lower-end start.', 'WR13', 'C59'],
    ],
    flex: [
      ['Kendre Miller', 'RB', '20 carries last week, 9.0 in each of the last two.', 'RB23', 'C39'],
      ['DK Metcalf', 'WR', '15 targets last week, with Michael Pittman Jr. and Roman Wilson on IR.', 'WR19', 'C65'],
      ['Germie Bernard', 'WR', '25.7 last week on 12 targets; the No. 2 receiver with Pittman out.', 'WR20', 'C65'],
      ['Pat Freiermuth', 'TE', 'New Orleans allows the 7th-most TE points; 21.5 in Week 5.', 'TE9', 'C91'],
    ],
    watch: [],
    sit: [
      ['Alvin Kamara', 'RB', 'Limited Wednesday (back); 7 carries a game.', null, 'C39'],
      ['Juwan Johnson', 'TE', '2.8 a game over the last two.', null, 'C97'],
    ],
    also: 'Rico Dowdle (PIT RB) has no ruling; his report is on the Paris inactives checklist. Ranked in the tiers without a call: Aaron Rodgers (QB14), Pittsburgh Steelers (DST7).',
  },
  {
    id: 'cin-bal',
    slot: 'one',
    title: 'Bengals at Ravens',
    kick: 'Sun 1:00p',
    when: 'Sun 1:00p ET',
    away: 'CIN',
    home: 'BAL',
    awayPts: 25,
    homePts: 23.5,
    line: 'CIN -1.5',
    total: 48.5,
    weather: '62F, wind 2, sunny',
    rain: false,
    read: 'A 48.5 total with Cincinnati a 1.5-point favorite, implied for 25.0 against 23.5. The game turns on Lamar Jackson\'s ankle: he was limited Wednesday after missing Weeks 5 and 6, a step up from last week\'s DNP. Inactives at about 11:30a ET. Derrick Henry and Chase Brown are volume plays into defenses that allow few RB points, and Joe Burrow and the Bengals receivers are starts.',
    fpa: 'CIN offense vs BAL D: QB 23, RB 27, WR 12, TE 25 · BAL offense vs CIN D: QB 16, RB 25, WR 22, TE 8',
    start: [
      ['Joe Burrow', 'QB', '20.2 a game, 24.6 in Week 5 before the bye; Cincinnati implied for 25.0 at Baltimore.', 'QB6', 'C6'],
      ['Derrick Henry', 'RB', '21.7 carries a game; Cincinnati allows the 8th-fewest RB points, so this is a volume start.', 'RB10', 'C28'],
      ['Ja\'Marr Chase', 'WR', '22.7 in Week 5 before the bye; 22% target share.', 'WR6', 'C52'],
      ['Zay Flowers', 'WR', '31% target share, 18.9 a game.', 'WR9', 'C55'],
      ['Tee Higgins', 'WR', '8.6 targets and 15.1 points a game.', 'WR16', 'C62'],
    ],
    flex: [
      ['Chase Brown', 'RB', '14.2 carries and 5.6 targets a game; Baltimore allows the 6th-fewest RB points.', 'RB17', 'C35'],
    ],
    watch: [
      ['Lamar Jackson', 'QB', 'START if active. Limited Wednesday on the ankle after missing Weeks 5 and 6 (a step up from last week\'s DNP); 19.8 a game when he plays.', 'QB8', 'C8'],
    ],
    sit: [
      ['Tyler Huntley', 'QB', 'Starts only if Lamar sits; 24.0 and 13.4 in his two starts make him a 2QB pivot.', null, 'C8'],
    ],
    also: 'Ranked in the tiers without a call: Mike Gesicki (TE13), Mark Andrews (TE14).',
  },
  {
    id: 'cle-ten',
    slot: 'one',
    title: 'Browns at Titans',
    kick: 'Sun 1:00p',
    when: 'Sun 1:00p ET',
    away: 'CLE',
    home: 'TEN',
    awayPts: 19.5,
    homePts: 18,
    line: 'CLE -1.5',
    total: 37.5,
    weather: '71F, wind 0, sunny',
    rain: false,
    read: 'The lowest total on the slate at 37.5, which is why the Cleveland D/ST is the call here: Tennessee is implied for 18.0. Quinshon Judkins is limited on the ankle after missing Week 6, so he is a flex only if active. Tony Pollard is a sit against the 2nd-fewest RB points allowed. Carnell Tate has a 28% target share and is the Titans flex.',
    fpa: 'CLE offense vs TEN D: QB 22, RB 18, WR 8, TE 23 · TEN offense vs CLE D: QB 18, RB 31, WR 11, TE 13',
    start: [
      ['Cleveland Browns', 'DEF', '13 in each of the last two; Tennessee implied for 18.0.', 'DST4', 'C102'],
    ],
    flex: [
      ['Carnell Tate', 'WR', '28% target share, 19.0 last week.', 'WR30', 'C75'],
    ],
    watch: [
      ['Quinshon Judkins', 'RB', 'FLEX if active. Limited Wednesday (ankle) after missing Week 6; 14.6 carries a game.', 'RB19', 'C37'],
    ],
    sit: [
      ['Tony Pollard', 'RB', '8.6 a game; Cleveland allows the 2nd-fewest RB points and Tennessee is implied for 18.0.', null, 'C44'],
    ],
    also: '',
  },
  {
    id: 'ind-min',
    slot: 'one',
    title: 'Colts at Vikings',
    kick: 'Sun 1:00p',
    when: 'Sun 1:00p ET',
    away: 'IND',
    home: 'MIN',
    awayPts: 17.5,
    homePts: 24,
    line: 'MIN -6.5',
    total: 41.5,
    weather: 'Dome',
    rain: false,
    read: 'Indoors, with Minnesota a 6.5-point favorite implied for 24.0 against Indianapolis at 17.5. Minnesota allows the fewest RB points and the fewest TE points, so Jonathan Taylor is a volume start and Tyler Warren is a sit (no practice Wednesday, groin). Justin Jefferson was limited on the ankle and is a start if active. The Minnesota D/ST is the top defense on the board.',
    fpa: 'IND offense vs MIN D: QB 32, RB 32, WR 28, TE 32 · MIN offense vs IND D: QB 11, RB 6, WR 20, TE 16',
    start: [
      ['Jonathan Taylor', 'RB', '20.3 carries a game and 21.1 last week; Minnesota allows the fewest RB points, so this is a volume start.', 'RB8', 'C26'],
      ['Minnesota Vikings', 'DEF', '15.2 a game; Indianapolis implied for 17.5.', 'DST1', 'C99'],
    ],
    flex: [
      ['Aaron Jones Sr.', 'RB', '25 carries in Week 5 before the bye; Indianapolis allows the 6th-most RB points and Minnesota is a 6.5-point favorite. Jordan Mason\'s return window opened Monday.', 'RB13', 'C31'],
      ['Keenan Allen', 'WR', '11 targets last week (16.2); Wednesday\'s DNP carried no injury.', 'WR29', 'C74'],
    ],
    watch: [
      ['Justin Jefferson', 'WR', 'START if active. Limited Wednesday (ankle); 26% target share, 18.8 in Week 5.', 'WR17', 'C63'],
    ],
    sit: [
      ['Tyler Warren', 'TE', 'Did not practice Wednesday (groin) after missing Week 6; Minnesota allows the fewest TE points.', null, 'C95'],
      ['Indianapolis Colts', 'DEF', '2.8 a game, at Minnesota.', null, 'C106'],
    ],
    also: '',
  },
  {
    id: 'mia-nyj',
    slot: 'one',
    title: 'Dolphins at Jets',
    kick: 'Sun 1:00p',
    when: 'Sun 1:00p ET',
    away: 'MIA',
    home: 'NYJ',
    awayPts: 17.5,
    homePts: 22,
    line: 'NYJ -4.5',
    total: 39.5,
    weather: '62F, wind 2, sunny',
    rain: false,
    read: 'New York is a 4.5-point favorite implied for 22.0 against 17.5 in a 39.5 total. Breece Hall did not practice Wednesday, which makes Braelon Allen the lead back, and De\'Von Achane went on IR Monday, which makes Ollie Gordon II a flex. Miami allows the 3rd-fewest WR points, which is why Garrett Wilson is a flex and Omar Cooper Jr. is a sit despite 22.3 last week. The Jets D/ST is a start.',
    fpa: 'MIA offense vs NYJ D: QB 20, RB 14, WR 23, TE 30 · NYJ offense vs MIA D: QB 9, RB 4, WR 30, TE 3',
    start: [
      ['New York Jets', 'DEF', 'Miami implied for 17.5.', 'DST6', 'C104'],
    ],
    flex: [
      ['Braelon Allen', 'RB', 'The lead back with Hall out: 24 and 17 carries the last two weeks; Miami allows the 4th-most RB points.', 'RB15', 'C33'],
      ['Ollie Gordon II', 'RB', 'De\'Von Achane went on IR Monday; Gordon had 18 carries for 14.8 in Week 5.', 'RB18', 'C36'],
      ['Garrett Wilson', 'WR', '29% target share; Miami allows the 3rd-fewest WR points.', 'WR21', 'C66'],
    ],
    watch: [],
    sit: [
      ['Breece Hall', 'RB', 'Did not practice Wednesday (quadriceps); three games played.', null, 'C33'],
      ['Omar Cooper Jr.', 'WR', '22.3 last week, but Miami allows the 3rd-fewest WR points.', null, 'C82'],
    ],
    also: '',
  },
  {
    id: 'nyg-hou',
    slot: 'one',
    title: 'Giants at Texans',
    kick: 'Sun 1:00p',
    when: 'Sun 1:00p ET · in Houston',
    away: 'NYG',
    home: 'HOU',
    awayPts: 16,
    homePts: 26.5,
    line: 'HOU -10.5',
    total: 42.5,
    weather: '78F, wind 10, partly sunny',
    rain: false,
    read: 'In Houston, with the Texans a 10.5-point favorite implied for 26.5 against 16.0, the lowest implied total on the slate. Houston allows the 3rd-most WR points, so Malik Nabers is a start, and Isaiah Likely has 24 targets over the last two weeks. C.J. Stroud and the Houston D/ST are starts. Neither Giants quarterback is a start. David Montgomery and Dalton Schultz both did not practice Wednesday, which leaves Woody Marks as the Houston back.',
    fpa: 'NYG offense vs HOU D: QB 12, RB 24, WR 3, TE 21 · HOU offense vs NYG D: QB 7, RB 15, WR 19, TE 17',
    start: [
      ['C.J. Stroud', 'QB', '22.0 a game over the last two; the Giants allow the 7th-most QB points and Houston is a 10.5-point favorite.', 'QB7', 'C7'],
      ['Malik Nabers', 'WR', '35 targets over the last two weeks, 28.8 a game; Houston allows the 3rd-most WR points.', 'WR5', 'C51'],
      ['Nico Collins', 'WR', '24% target share, Houston implied for 26.5; limited Wednesday with no injury listed.', 'WR15', 'C61'],
      ['Isaiah Likely', 'TE', '24 targets over the last two weeks, 28.1 a game.', 'TE4', 'C86'],
      ['Houston Texans', 'DEF', 'The Giants are implied for 16.0, the lowest implied total on the slate.', 'DST2', 'C100'],
    ],
    flex: [
      ['Woody Marks', 'RB', '15 carries in each of the last two weeks on 78-85% of the snaps; Houston is a 10.5-point favorite.', 'RB16', 'C34'],
    ],
    watch: [],
    sit: [
      ['J.J. McCarthy', 'QB', 'Top of the depth chart after 16.3 in relief in Week 6; the Giants are implied for 16.0, the lowest implied total on the slate.', null, 'C17'],
      ['Jameis Winston', 'QB', 'Played 60% of the Week 6 snaps for 6.5; same 16.0 implied total.', null, 'C17'],
      ['David Montgomery', 'RB', 'Did not practice Wednesday (groin); 1.1 in Week 5, missed Week 6.', null, 'C34'],
      ['Dalton Schultz', 'TE', 'Did not practice Wednesday (quadriceps).', null, 'C96'],
    ],
    also: '',
  },
  {
    id: 'sf-atl',
    slot: 'one',
    title: '49ers at Falcons',
    kick: 'Sun 1:00p',
    when: 'Sun 1:00p ET',
    away: 'SF',
    home: 'ATL',
    awayPts: 26,
    homePts: 23.5,
    line: 'SF -2.5',
    total: 49.5,
    weather: '64F, wind 10, sunny',
    rain: false,
    read: 'San Francisco is a 2.5-point favorite implied for 26.0 against 23.5, and the offense is thin: Deebo Samuel is out and Mike Evans did not practice Wednesday (ribs, Achilles) and is expected to miss time. That runs more of the offense through Christian McCaffrey and George Kittle. Atlanta allows the 10th-most QB points and San Francisco allows the 11th-most RB points, so Brock Purdy and Bijan Robinson are starts, and Drake London and Kyle Pitts are the Falcons plays.',
    fpa: 'SF offense vs ATL D: QB 10, RB 10, WR 6, TE 11 · ATL offense vs SF D: QB 24, RB 11, WR 24, TE 28',
    start: [
      ['Brock Purdy', 'QB', '22.3 points a game; San Francisco implied for 26.0 at Atlanta, which allows the 10th-most QB points.', 'QB1', 'C1'],
      ['Christian McCaffrey', 'RB', '30.7 last week on 10 targets; with Deebo Samuel out and Mike Evans not practicing, more of the offense runs through him.', 'RB2', 'C20'],
      ['Bijan Robinson', 'RB', '21.4 a game; San Francisco allows the 11th-most RB points.', 'RB4', 'C22'],
      ['Drake London', 'WR', '29% target share, 11 and 10 targets the last two weeks.', 'WR14', 'C60'],
      ['George Kittle', 'TE', '17.9 last week; Samuel is out and Evans is not practicing.', 'TE2', 'C84'],
      ['Kyle Pitts Sr.', 'TE', '19.1 a game over the last two.', 'TE8', 'C90'],
    ],
    flex: [],
    watch: [],
    sit: [
      ['Mike Evans', 'WR', 'Did not practice Wednesday (ribs, Achilles) and is expected to miss time.', null, 'C76'],
      ['Deebo Samuel Sr.', 'WR', 'OUT. Hamstring; the engine still projects 11.8.', 'OUT', 'C77'],
    ],
    also: 'San Francisco D/ST at Atlanta (10.0 a game) is a streamer. Kaelon Black (SF RB) is McCaffrey\'s handcuff and has no ruling.',
  },
  {
    id: 'tb-car',
    slot: 'one',
    title: 'Buccaneers at Panthers',
    kick: 'Sun 1:00p',
    when: 'Sun 1:00p ET',
    away: 'TB',
    home: 'CAR',
    awayPts: 20.75,
    homePts: 23.75,
    line: 'CAR -3',
    total: 44.5,
    weather: '64F, wind 10, sunny',
    rain: false,
    read: 'Carolina is a 3-point favorite implied for 23.8, and the Carolina trio of Bryce Young, Chuba Hubbard and Tetairoa McMillan is the play. Tampa is implied for 20.8 with its quarterback undecided: Baker Mayfield had a full practice on the thumb, but Tampa names its starter Friday. Bucky Irving did not practice Wednesday (illness) and Emeka Egbuka did not either (concussion, foot), so both are flexes only if active.',
    fpa: 'TB offense vs CAR D: QB 13, RB 5, WR 21, TE 9 · CAR offense vs TB D: QB 25, RB 29, WR 17, TE 10',
    start: [
      ['Bryce Young', 'QB', '22.1 a game and 20.6 over the last two, full practice.', 'QB9', 'C9'],
      ['Chuba Hubbard', 'RB', '19.6 a game and 28 carries last week (19.1); Wednesday\'s DNP carried no injury.', 'RB11', 'C29'],
      ['Tetairoa McMillan', 'WR', '17.8 a game, 27% target share.', 'WR12', 'C58'],
      ['Jalen Coker', 'WR', '13 targets last week (15.7), 17.0 a game.', 'WR18', 'C64'],
    ],
    flex: [],
    watch: [
      ['Bucky Irving', 'RB', 'FLEX if active. Did not practice Wednesday (illness); Carolina allows the 5th-most RB points.', 'RB14', 'C32'],
      ['Emeka Egbuka', 'WR', 'FLEX if active. Did not practice Wednesday (concussion, foot); 16 targets last week.', 'WR25', 'C70'],
    ],
    sit: [
      ['Baker Mayfield', 'QB', 'Full practice on the thumb, but Tampa names its starter Friday; 11.7 a game in his three starts.', null, 'C16'],
      ['Jalon Daniels', 'QB', 'Started Weeks 5 and 6 (13.9, 11.2); loses the job if Mayfield is cleared.', null, 'C16'],
    ],
    also: 'Carolina D/ST is a streamer (Tampa implied for 20.8, QB undecided). Kenny Gainwell (TB RB) is Irving\'s handcuff and has no ruling.',
  },
  {
    id: 'den-ari',
    slot: 'late',
    title: 'Broncos at Cardinals',
    kick: 'Sun 4:05p',
    when: 'Sun 4:05p ET',
    away: 'DEN',
    home: 'ARI',
    awayPts: 24,
    homePts: 19.5,
    line: 'DEN -4.5',
    total: 43.5,
    weather: '78F, wind 5, sunny',
    rain: false,
    read: 'Denver is a 4.5-point favorite implied for 24.0 against 19.5. Both Denver backs are flexes in a split, Bo Nix is a sit, and Jaylen Waddle was limited Wednesday (chest) and is a sit at 5.6 a game over the last two. Jeremiyah Love did not practice (ankle), so Tyler Allgeier is the Arizona flex against a Denver defense that allows the 8th-most RB points. Trey McBride is a start and the Denver D/ST is a start.',
    fpa: 'DEN offense vs ARI D: QB 4, RB 17, WR 10, TE 5 · ARI offense vs DEN D: QB 21, RB 8, WR 26, TE 14',
    start: [
      ['Trey McBride', 'TE', '30% target share, 17.2 a game.', 'TE1', 'C83'],
      ['Denver Broncos', 'DEF', '16 and 12 the last two weeks; Arizona implied for 19.5.', 'DST5', 'C103'],
    ],
    flex: [
      ['J.K. Dobbins', 'RB', '18 and 17 carries the last two weeks, 14.5 a game.', 'RB21', 'C38'],
      ['RJ Harvey', 'RB', '14.6 last week with a 17% target share; the passing-down half of the split.', 'RB22', 'C38'],
      ['Tyler Allgeier', 'RB', '18 carries last week with Love out; Denver allows the 8th-most RB points.', 'RB24', 'C40'],
      ['Michael Wilson', 'WR', '25% target share, 9.7 targets a game.', 'WR27', 'C72'],
    ],
    watch: [],
    sit: [
      ['Bo Nix', 'QB', '11.6 a game and 6.2 over the last two (7.9, 4.5).', null, 'C14'],
      ['Jeremiyah Love', 'RB', 'Did not practice Wednesday (ankle); missed Week 6.', null, 'C40'],
      ['Jaylen Waddle', 'WR', 'Limited Wednesday (chest); 5.6 a game over the last two.', null, 'C79'],
      ['Courtland Sutton', 'WR', '5.4 a game.', null, 'C80'],
    ],
    also: 'Bam Knight (ARI RB) is behind Love and has no ruling. Avoid the Arizona D/ST (4.5 a game).',
  },
  {
    id: 'gb-det',
    slot: 'late',
    title: 'Packers at Lions',
    kick: 'Sun 4:25p',
    when: 'Sun 4:25p ET',
    away: 'GB',
    home: 'DET',
    awayPts: 25.25,
    homePts: 28.25,
    line: 'DET -3',
    total: 53.5,
    weather: 'Dome',
    rain: false,
    read: 'The highest total on the slate at 53.5, indoors, with Detroit implied for 28.3, the highest number on the board, and Green Bay at 25.3. Detroit allows the most QB points (27.4 a game), the most TE points and the 2nd-most WR points, so Jordan Love, Christian Watson, Matthew Golden and Tucker Kraft all get calls, three of them only if active. Jahmyr Gibbs, Amon-Ra St. Brown, Jared Goff and Sam LaPorta are starts on the other side. Josh Jacobs came off the Commissioner\'s Exempt List Monday and has no snaps this season.',
    fpa: 'GB offense vs DET D: QB 1, RB 22, WR 2, TE 1 · DET offense vs GB D: QB 28, RB 3, WR 14, TE 24',
    start: [
      ['Jared Goff', 'QB', '23.0 a game, Detroit implied for 28.3, the highest total on the slate; Green Bay allows the 5th-fewest QB points, so the volume carries him.', 'QB4', 'C4'],
      ['Jahmyr Gibbs', 'RB', '30.7 a game on 21 carries and 6.8 targets; Detroit implied for 28.3.', 'RB1', 'C19'],
      ['Amon-Ra St. Brown', 'WR', '31% target share; Detroit implied for 28.3.', 'WR3', 'C49'],
      ['Sam LaPorta', 'TE', '19.8 in Week 5; Detroit implied for 28.3.', 'TE5', 'C87'],
      ['Tucker Kraft', 'TE', 'Detroit allows the most TE points.', 'TE7', 'C89'],
    ],
    flex: [
      ['Jameson Williams', 'WR', '18.7 in Week 5; Detroit implied for 28.3.', 'WR22', 'C67'],
    ],
    watch: [
      ['Jordan Love', 'QB', 'START if active. Limited Wednesday (back); Detroit allows the most QB points, 27.4 a game.', 'QB5', 'C5'],
      ['Christian Watson', 'WR', 'START if active. Limited Wednesday (ankle); Detroit allows the 2nd-most WR points.', 'WR7', 'C53'],
      ['Matthew Golden', 'WR', 'START if active. Limited Wednesday (shoulder); 21.4 a game over the last two and 13 targets last week.', 'WR11', 'C57'],
    ],
    sit: [
      ['Josh Jacobs', 'RB', 'Came off the Commissioner\'s Exempt List Monday; no snaps this season and Green Bay has not committed to playing him.', null, 'C42'],
    ],
    also: 'Avoid the Detroit D/ST (4.2 a game).',
  },
  {
    id: 'lar-lv',
    slot: 'late',
    title: 'Rams at Raiders',
    kick: 'Sun 4:25p',
    when: 'Sun 4:25p ET',
    away: 'LAR',
    home: 'LV',
    awayPts: 26,
    homePts: 22.5,
    line: 'LAR -3.5',
    total: 48.5,
    weather: 'Dome',
    rain: false,
    read: 'Indoors, with the Rams a 3.5-point favorite implied for 26.0 against 22.5. Las Vegas allows the 6th-most QB points, the 7th-most RB points and the 6th-most TE points. Davante Adams was placed on IR Tuesday, so Puka Nacua carries the passing game, and Tyler Higbee is a flex. Brock Bowers was limited Wednesday (hamstring, calf) and is a start if active.',
    fpa: 'LAR offense vs LV D: QB 6, RB 7, WR 16, TE 6 · LV offense vs LAR D: QB 17, RB 21, WR 29, TE 31',
    start: [
      ['Matthew Stafford', 'QB', 'Las Vegas allows the 6th-most QB points and the Rams are implied for 26.0 in the dome.', 'QB3', 'C3'],
      ['Kirk Cousins', 'QB', '18.5 a game and 18.5 last week; the Rams allow the 17th-most QB points; QB12.', 'QB12', 'C12'],
      ['Kyren Williams', 'RB', '20.0 a game with 6.5 targets; Las Vegas allows the 7th-most RB points.', 'RB6', 'C24'],
      ['Ashton Jeanty', 'RB', '16.9 a game with a 17% target share.', 'RB12', 'C30'],
      ['Puka Nacua', 'WR', '31% target share, 23.2 a game; Davante Adams is on IR.', 'WR1', 'C46'],
    ],
    flex: [
      ['Tre Tucker', 'WR', '26.7 last week; the Rams allow the 4th-fewest WR points.', 'WR26', 'C71'],
      ['Tyler Higbee', 'TE', 'Las Vegas allows the 6th-most TE points; Adams is on IR.', 'TE12', 'C94'],
    ],
    watch: [
      ['Brock Bowers', 'TE', 'START if active. Limited Wednesday (hamstring, calf); 20.6 a game.', 'TE3', 'C85'],
    ],
    sit: [
      ['Davante Adams', 'WR', 'OUT. Placed on IR Tuesday (hamstring); the engine still projects 15.8.', 'OUT', 'C47'],
    ],
    also: 'Blake Corum (LAR RB) is Kyren Williams\'s handcuff and has no ruling.',
  },
  {
    id: 'kc-sea',
    slot: 'prime',
    title: 'Chiefs at Seahawks',
    kick: 'Sun 8:20p',
    when: 'Sunday Night · 8:20p ET',
    away: 'KC',
    home: 'SEA',
    awayPts: 19.75,
    homePts: 22.75,
    line: 'SEA -3',
    total: 42.5,
    weather: '56F, wind 3, 19% light rain',
    rain: true,
    read: 'Sunday night in Seattle, with a 19% chance of light rain, the only precipitation on the slate. Seattle is a 3-point favorite implied for 22.8 against 19.8. Kansas City allows the fewest WR points and Jaxon Smith-Njigba is a start anyway. Seattle allows the 2nd-fewest QB points, so Patrick Mahomes is a sit. Kenneth Walker III is a start, Rashee Rice did not practice Wednesday (hamstring, knee) and Travis Kelce was limited (ankle). Zach Charbonnet practiced in full Wednesday, which is why Emanuel Wilson is a sit.',
    fpa: 'KC offense vs SEA D: QB 31, RB 13, WR 31, TE 29 · SEA offense vs KC D: QB 30, RB 26, WR 32, TE 4',
    start: [
      ['Kenneth Walker III', 'RB', '27.6 a game on 21.2 carries; Seattle is 13th in RB points allowed.', 'RB3', 'C21'],
      ['Jaxon Smith-Njigba', 'WR', '36% target share, 27.6 a game; Kansas City allows the fewest WR points and it does not matter.', 'WR2', 'C48'],
      ['Seattle Seahawks', 'DEF', '12.0 a game; Kansas City implied for 19.8.', 'DST3', 'C101'],
    ],
    flex: [],
    watch: [
      ['Travis Kelce', 'TE', 'FLEX if active. Limited Wednesday (ankle); Seattle allows the 4th-fewest TE points.', 'TE11', 'C93'],
    ],
    sit: [
      ['Patrick Mahomes', 'QB', 'Seattle allows the 2nd-fewest QB points, Kansas City is implied for 19.8, and he scored 10.5 last week; QB13.', 'QB13', 'C13'],
      ['Emanuel Wilson', 'RB', '5.2 last week on 32% of the snaps; Zach Charbonnet practiced in full Wednesday.', null, 'C45'],
      ['Rashee Rice', 'WR', 'Did not practice Wednesday (hamstring, knee); Seattle allows the 2nd-fewest WR points.', null, 'C78'],
    ],
    also: 'Ranked in the tiers without a call: Kansas City Chiefs (DST8).',
  },
  {
    id: 'dal-phi',
    slot: 'prime',
    title: 'Cowboys at Eagles',
    kick: 'Mon 8:15p',
    when: 'Monday Night · 8:15p ET',
    away: 'DAL',
    home: 'PHI',
    awayPts: 24.5,
    homePts: 20,
    line: 'DAL -4.5',
    total: 44.5,
    weather: '58F, wind 0, mostly clear',
    rain: false,
    read: 'Monday night is the last window, so there is no later swap. Dallas is a 4.5-point favorite implied for 24.5 against 20.0, and Philadelphia allows the 8th-most QB points and the 4th-most WR points. Update since the Tuesday waiver column, which had Saquon Barkley out: Mike Garafolo has since reported that Barkley (hamstring) is in line to play Monday. He is still a sit, because he was 5.8 a game on 32% of the snaps before the injury, and Dameon Pierce is a sit too. Jalen Hurts is on IR with blood clots and out for the season; Tanner McKee is a 2QB start only.',
    fpa: 'DAL offense vs PHI D: QB 8, RB 16, WR 4, TE 19 · PHI offense vs DAL D: QB 5, RB 11, WR 9, TE 15',
    start: [
      ['Dak Prescott', 'QB', 'Philadelphia allows the 8th-most QB points; 17.5 a game despite 11.8 over the last two.', 'QB11', 'C11'],
      ['Javonte Williams', 'RB', '18.2 a game on 78% of the snaps; Philadelphia is 16th in RB points allowed.', 'RB9', 'C27'],
      ['CeeDee Lamb', 'WR', '18 targets last week; Philadelphia allows the 4th-most WR points.', 'WR4', 'C50'],
      ['DeVonta Smith', 'WR', '14 targets in McKee\'s first start (20.5); 32% target share.', 'WR8', 'C54'],
      ['George Pickens', 'WR', '20.6 a game over the last two; Philadelphia allows the 4th-most WR points.', 'WR10', 'C56'],
      ['Dallas Goedert', 'TE', '8 targets in McKee\'s first start.', 'TE6', 'C88'],
    ],
    flex: [],
    watch: [],
    sit: [
      ['Tanner McKee', 'QB', '12.6 in his first start, Philadelphia implied for 20.0; Dallas allows the 5th-most QB points, so he is a 2QB start only.', null, 'C15'],
      ['Jalen Hurts', 'QB', 'OUT. On IR with blood clots, out for the season; the engine still projects 18.5.', 'OUT', 'C18'],
      ['Saquon Barkley', 'RB', 'Hamstring; in line to play Monday per Mike Garafolo, but he was 5.8 a game on 32% of the snaps before it.', null, 'C41'],
      ['Dameon Pierce', 'RB', '95% of the snaps last week (15.0), but Barkley\'s return splits the work and Monday night leaves no pivot.', null, 'C41'],
      ['Jake Ferguson', 'TE', '7.4 a game on a 10% target share.', null, 'C98'],
      ['Dallas Cowboys', 'DEF', '2.0 a game.', null, 'C105'],
    ],
    also: '',
  },
];

const SLOT = (slot) => GAMES.filter((g) => g.slot === slot).map((g) => <GameCard key={g.id} g={g} />);

// Injury board rows are [name, position, team, status, pivot, tone, ruling].
// Statuses are the Wednesday practice reports; no Thursday report existed when this was written.

const INJ_OUT = [
  ['Kyle Monangai', 'RB', 'CHI', 'Thumb and toe, ruled out for Thursday. The engine still projects 11.5; ignore it. No pivot cover on Thursday.', 'D\'Andre Swift (START, RB7) and Roschon Johnson (FLEX, RB20).', 'out', 'C25'],
  ['Jalen Hurts', 'QB', 'PHI', 'On IR with blood clots, out for the season. The engine still projects 18.5; ignore it.', 'Tanner McKee is a 2QB start only (SIT).', 'out', 'C18'],
  ['Davante Adams', 'WR', 'LAR', 'Placed on IR Tuesday (hamstring). The engine still projects 15.8; ignore it.', 'Puka Nacua (START, WR1) and Tyler Higbee (FLEX, TE12).', 'out', 'C47'],
  ['Deebo Samuel Sr.', 'WR', 'SF', 'Hamstring, out. The engine still projects 11.8; ignore it.', 'Christian McCaffrey (START, RB2) and George Kittle (START, TE2).', 'out', 'C77'],
];

const INJ_THU = [
  ['Drake Maye', 'QB', 'NE', 'Full practice. 31.6 a game over the last two (39.5, 23.8).', 'Start him. Thursday has no pivot cover.', 'likely', 'C2'],
  ['D\'Andre Swift', 'RB', 'CHI', 'Monangai is out, so his 15 carries a game open up.', 'Start him. Roschon Johnson (FLEX) is the No. 2 back.', 'likely', 'C25'],
];

const INJ_PARIS = [
  ['Alvin Kamara', 'RB', 'NO', 'Limited Wednesday (back); 7 carries a game.', 'Kendre Miller (FLEX, RB23). Kamara is a sit either way.', 'sit', 'C39'],
];

const INJ_ONE = [
  ['Lamar Jackson', 'QB', 'BAL', 'Limited Wednesday on the ankle after missing Weeks 5 and 6 (a step up from last week\'s DNP). Inactives about 11:30a ET.', 'Tyler Huntley is a sit and a 2QB pivot only (24.0 and 13.4 in his two starts).', 'gtd', 'C8'],
  ['Baker Mayfield', 'QB', 'TB', 'Full practice on the thumb, but Tampa names its starter Friday.', 'Jalon Daniels started Weeks 5 and 6 (13.9, 11.2) and loses the job if Mayfield is cleared. Both are sits.', 'sit', 'C16'],
  ['Bucky Irving', 'RB', 'TB', 'Did not practice Wednesday (illness).', 'Flex only if active. Kenny Gainwell is the handcuff with no ruling.', 'gtd', 'C32'],
  ['Emeka Egbuka', 'WR', 'TB', 'Did not practice Wednesday (concussion, foot); 16 targets last week.', 'Flex only if active. Swap to a later-kickoff flex if he is out.', 'gtd', 'C70'],
  ['Breece Hall', 'RB', 'NYJ', 'Did not practice Wednesday (quadriceps); three games played.', 'Braelon Allen (FLEX, RB15), 24 and 17 carries the last two weeks.', 'sit', 'C33'],
  ['David Montgomery', 'RB', 'HOU', 'Did not practice Wednesday (groin); 1.1 in Week 5, missed Week 6.', 'Woody Marks (FLEX, RB16).', 'sit', 'C34'],
  ['Dalton Schultz', 'TE', 'HOU', 'Did not practice Wednesday (quadriceps).', 'None called. Sit.', 'sit', 'C96'],
  ['Quinshon Judkins', 'RB', 'CLE', 'Limited Wednesday (ankle) after missing Week 6; 14.6 carries a game.', 'Flex only if active. Jaleel McLaughlin is the handcuff with no ruling.', 'gtd', 'C37'],
  ['Justin Jefferson', 'WR', 'MIN', 'Limited Wednesday (ankle); 26% target share, 18.8 in Week 5.', 'Start if active. No Minnesota receiver is called, so carry a 4:05p-or-later swap.', 'gtd', 'C63'],
  ['Tyler Warren', 'TE', 'IND', 'Did not practice Wednesday (groin) after missing Week 6.', 'None called. Sit.', 'sit', 'C95'],
  ['Mike Evans', 'WR', 'SF', 'Did not practice Wednesday (ribs, Achilles) and is expected to miss time.', 'McCaffrey and Kittle (both START).', 'sit', 'C76'],
  ['Keenan Allen', 'WR', 'IND', 'Wednesday\'s DNP carried no injury; 11 targets last week (16.2).', 'Flex.', 'likely', 'C74'],
  ['Chuba Hubbard', 'RB', 'CAR', 'Wednesday\'s DNP carried no injury; 28 carries last week.', 'Start him.', 'likely', 'C29'],
  ['Ollie Gordon II', 'RB', 'MIA', 'De\'Von Achane went on IR Monday (the engine\'s 13.6 for him is a placeholder). Gordon had 18 carries for 14.8 in Week 5.', 'Gordon is the call (FLEX, RB18).', 'likely', 'C36'],
  ['Nico Collins', 'WR', 'HOU', 'Limited Wednesday with no injury listed.', 'Start him.', 'likely', 'C61'],
];

const INJ_LATE = [
  ['Jeremiyah Love', 'RB', 'ARI', 'Did not practice Wednesday (ankle); missed Week 6. Inactives about 2:35p ET.', 'Tyler Allgeier (FLEX, RB24), 18 carries last week with Love out. Bam Knight has no ruling.', 'sit', 'C40'],
  ['Jaylen Waddle', 'WR', 'DEN', 'Limited Wednesday (chest); 5.6 a game over the last two.', 'None. Sit.', 'sit', 'C79'],
  ['Jordan Love', 'QB', 'GB', 'Limited Wednesday (back). Inactives about 2:55p ET.', 'No Green Bay quarterback is called. Stafford and Cousins are starts in the same window.', 'gtd', 'C5'],
  ['Christian Watson', 'WR', 'GB', 'Limited Wednesday (ankle).', 'Start if active. Matthew Golden is also limited.', 'gtd', 'C53'],
  ['Matthew Golden', 'WR', 'GB', 'Limited Wednesday (shoulder); 13 targets last week.', 'Start if active.', 'gtd', 'C57'],
  ['Josh Jacobs', 'RB', 'GB', 'Came off the Commissioner\'s Exempt List Monday; no snaps this season.', 'None. Sit.', 'sit', 'C42'],
  ['Brock Bowers', 'TE', 'LV', 'Limited Wednesday (hamstring, calf); 20.6 a game.', 'Start if active. Carry a later tight end: Kelce (FLEX if active) on Sunday night or Goedert on Monday.', 'gtd', 'C85'],
];

const INJ_NIGHT = [
  ['Travis Kelce', 'TE', 'KC', 'Limited Wednesday (ankle). Inactives about 6:50p ET.', 'Flex if active. Dallas Goedert plays Monday.', 'gtd', 'C93'],
  ['Rashee Rice', 'WR', 'KC', 'Did not practice Wednesday (hamstring, knee).', 'None. Sit.', 'sit', 'C78'],
  ['Zach Charbonnet', 'RB', 'SEA', 'Practiced in full Wednesday; the engine\'s 10.7 comes with a 0% active read, ignore it. No ruling on him.', 'Emanuel Wilson is a sit (5.2 last week on 32% of the snaps).', 'gtd', 'C45'],
  ['Saquon Barkley', 'RB', 'PHI', 'Hamstring. Mike Garafolo has since reported that he is in line to play Monday; the Tuesday waiver column had him out. Inactives about 6:45p ET Monday.', 'Dameon Pierce is a sit too. Monday night leaves no pivot.', 'sit', 'C41'],
];

const ALREADY_OUT = ['Michael Pittman Jr. (PIT WR, IR)', 'Roman Wilson (PIT WR, IR)', 'Romeo Doubs (NE WR, IR)', 'Mack Hollins (NE WR, IR)', 'De\'Von Achane (MIA RB, IR)', 'Travis Etienne Jr. (NO RB, IR)', 'James Conner (ARI RB, IR)'];

// Tier rows are [rank, name, team, note, band]. Bands follow the written verdicts.

const QB_ROWS = [
  [1, 'Brock Purdy', 'SF', '22.3 points a game; San Francisco implied for 26.0 at Atlanta, which allows the 10th-most QB points', 'start'],
  [2, 'Drake Maye', 'NE', '31.6 a game over the last two (39.5, 23.8), full practice; Thursday night at Chicago', 'start'],
  [3, 'Matthew Stafford', 'LAR', 'Las Vegas allows the 6th-most QB points and the Rams are implied for 26.0 in the dome', 'start'],
  [4, 'Jared Goff', 'DET', '23.0 a game, Detroit implied for 28.3, the highest total on the slate; Green Bay allows the 5th-fewest QB points, so the volume carries him', 'start'],
  [5, 'Jordan Love', 'GB', 'If active. Limited Wednesday (back); Detroit allows the most QB points, 27.4 a game', 'start'],
  [6, 'Joe Burrow', 'CIN', '20.2 a game, 24.6 in Week 5 before the bye; Cincinnati implied for 25.0 at Baltimore', 'start'],
  [7, 'C.J. Stroud', 'HOU', '22.0 a game over the last two; the Giants allow the 7th-most QB points and Houston is a 10.5-point favorite', 'start'],
  [8, 'Lamar Jackson', 'BAL', 'If active. Limited Wednesday on the ankle after missing Weeks 5 and 6 (a step up from last week\'s DNP); 19.8 a game when he plays', 'start'],
  [9, 'Bryce Young', 'CAR', '22.1 a game and 20.6 over the last two, full practice', 'start'],
  [10, 'Caleb Williams', 'CHI', 'Chicago implied for 26.8, the second-highest total; New England allows the 6th-fewest QB points, so a low-end QB1', 'start'],
  [11, 'Dak Prescott', 'DAL', 'Philadelphia allows the 8th-most QB points; 17.5 a game despite 11.8 over the last two', 'start'],
  [12, 'Kirk Cousins', 'LV', '18.5 a game and 18.5 last week; the Rams allow the 17th-most QB points; QB12', 'start'],
  [13, 'Patrick Mahomes', 'KC', 'Seattle allows the 2nd-fewest QB points, Kansas City is implied for 19.8, and he scored 10.5 last week; QB13', 'sit'],
  [14, 'Aaron Rodgers', 'PIT', '', 'rank'],
];

const QB_NEXT = 'Sits and unranked: Tyler Huntley (a 2QB pivot behind Lamar), Bo Nix, Tanner McKee (a 2QB start only), Baker Mayfield and Jalon Daniels (Tampa names its starter Friday), J.J. McCarthy and Jameis Winston. Out: Jalen Hurts (IR, the engine still projects 18.5). The engine projects the n=0 backup quarterbacks between 15.4 and 16.6; ignore them.';

const RB_ROWS = [
  [1, 'Jahmyr Gibbs', 'DET', '30.7 a game on 21 carries and 6.8 targets; Detroit implied for 28.3', 'start'],
  [2, 'Christian McCaffrey', 'SF', '30.7 last week on 10 targets; with Deebo Samuel out and Mike Evans not practicing, more of the offense runs through him', 'start'],
  [3, 'Kenneth Walker III', 'KC', '27.6 a game on 21.2 carries; Seattle is 13th in RB points allowed', 'start'],
  [4, 'Bijan Robinson', 'ATL', '21.4 a game; San Francisco allows the 11th-most RB points', 'start'],
  [5, 'Jaylen Warren', 'PIT', 'New Orleans allows the most RB points; 14 carries and 5 targets a game', 'start'],
  [6, 'Kyren Williams', 'LAR', '20.0 a game with 6.5 targets; Las Vegas allows the 7th-most RB points', 'start'],
  [7, 'D\'Andre Swift', 'CHI', '20.1 a game over the last two, and Monangai\'s 15 carries a game open up; Chicago implied for 26.8', 'start'],
  [8, 'Jonathan Taylor', 'IND', '20.3 carries a game and 21.1 last week; Minnesota allows the fewest RB points, so this is a volume start', 'start'],
  [9, 'Javonte Williams', 'DAL', '18.2 a game on 78% of the snaps; Philadelphia is 16th in RB points allowed', 'start'],
  [10, 'Derrick Henry', 'BAL', '21.7 carries a game; Cincinnati allows the 8th-fewest RB points, so this is a volume start', 'start'],
  [11, 'Chuba Hubbard', 'CAR', '19.6 a game and 28 carries last week (19.1); Wednesday\'s DNP carried no injury', 'start'],
  [12, 'Ashton Jeanty', 'LV', '16.9 a game with a 17% target share', 'start'],
  [13, 'Aaron Jones Sr.', 'MIN', '25 carries in Week 5 before the bye; Indianapolis allows the 6th-most RB points and Minnesota is a 6.5-point favorite. Jordan Mason\'s return window opened Monday', 'flex'],
  [14, 'Bucky Irving', 'TB', 'If active. Did not practice Wednesday (illness); Carolina allows the 5th-most RB points', 'flex'],
  [15, 'Braelon Allen', 'NYJ', 'The lead back with Hall out: 24 and 17 carries the last two weeks; Miami allows the 4th-most RB points', 'flex'],
  [16, 'Woody Marks', 'HOU', '15 carries in each of the last two weeks on 78-85% of the snaps; Houston is a 10.5-point favorite', 'flex'],
  [17, 'Chase Brown', 'CIN', '14.2 carries and 5.6 targets a game; Baltimore allows the 6th-fewest RB points', 'flex'],
  [18, 'Ollie Gordon II', 'MIA', 'De\'Von Achane went on IR Monday; Gordon had 18 carries for 14.8 in Week 5', 'flex'],
  [19, 'Quinshon Judkins', 'CLE', 'If active. Limited Wednesday (ankle) after missing Week 6; 14.6 carries a game', 'flex'],
  [20, 'Roschon Johnson', 'CHI', '14.5 on 13 carries last week; the No. 2 back while Monangai is out', 'flex'],
  [21, 'J.K. Dobbins', 'DEN', '18 and 17 carries the last two weeks, 14.5 a game', 'flex'],
  [22, 'RJ Harvey', 'DEN', '14.6 last week with a 17% target share; the passing-down half of the split', 'flex'],
  [23, 'Kendre Miller', 'NO', '20 carries last week, 9.0 in each of the last two', 'flex'],
  [24, 'Tyler Allgeier', 'ARI', '18 carries last week with Love out; Denver allows the 8th-most RB points', 'flex'],
];

const RB_NEXT = 'Sits: Breece Hall, David Montgomery, Alvin Kamara, Jeremiyah Love, Saquon Barkley, Dameon Pierce, Josh Jacobs, Rhamondre Stevenson, Tony Pollard and Emanuel Wilson. Out: Kyle Monangai. The engine placeholders are ignored: Josh Jacobs at 13.0 with no snaps this season, Monangai at 11.5, De\'Von Achane (IR) at 13.6 and Zach Charbonnet at 10.7 with a 0% active read while practicing in full.';

const WR_ROWS = [
  [1, 'Puka Nacua', 'LAR', '31% target share, 23.2 a game; Davante Adams is on IR', 'start'],
  [2, 'Jaxon Smith-Njigba', 'SEA', '36% target share, 27.6 a game; Kansas City allows the fewest WR points and it does not matter', 'start'],
  [3, 'Amon-Ra St. Brown', 'DET', '31% target share; Detroit implied for 28.3', 'start'],
  [4, 'CeeDee Lamb', 'DAL', '18 targets last week; Philadelphia allows the 4th-most WR points', 'start'],
  [5, 'Malik Nabers', 'NYG', '35 targets over the last two weeks, 28.8 a game; Houston allows the 3rd-most WR points', 'start'],
  [6, 'Ja\'Marr Chase', 'CIN', '22.7 in Week 5 before the bye; 22% target share', 'start'],
  [7, 'Christian Watson', 'GB', 'If active. Limited Wednesday (ankle); Detroit allows the 2nd-most WR points', 'start'],
  [8, 'DeVonta Smith', 'PHI', '14 targets in McKee\'s first start (20.5); 32% target share', 'start'],
  [9, 'Zay Flowers', 'BAL', '31% target share, 18.9 a game', 'start'],
  [10, 'George Pickens', 'DAL', '20.6 a game over the last two; Philadelphia allows the 4th-most WR points', 'start'],
  [11, 'Matthew Golden', 'GB', 'If active. Limited Wednesday (shoulder); 21.4 a game over the last two and 13 targets last week', 'start'],
  [12, 'Tetairoa McMillan', 'CAR', '17.8 a game, 27% target share', 'start'],
  [13, 'Chris Olave', 'NO', '27% target share; Pittsburgh allows the 6th-fewest WR points, so a lower-end start', 'start'],
  [14, 'Drake London', 'ATL', '29% target share, 11 and 10 targets the last two weeks', 'start'],
  [15, 'Nico Collins', 'HOU', '24% target share, Houston implied for 26.5; limited Wednesday with no injury listed', 'start'],
  [16, 'Tee Higgins', 'CIN', '8.6 targets and 15.1 points a game', 'start'],
  [17, 'Justin Jefferson', 'MIN', 'If active. Limited Wednesday (ankle); 26% target share, 18.8 in Week 5', 'start'],
  [18, 'Jalen Coker', 'CAR', '13 targets last week (15.7), 17.0 a game', 'start'],
  [19, 'DK Metcalf', 'PIT', '15 targets last week, with Michael Pittman Jr. and Roman Wilson on IR', 'flex'],
  [20, 'Germie Bernard', 'PIT', '25.7 last week on 12 targets; the No. 2 receiver with Pittman out', 'flex'],
  [21, 'Garrett Wilson', 'NYJ', '29% target share; Miami allows the 3rd-fewest WR points', 'flex'],
  [22, 'Jameson Williams', 'DET', '18.7 in Week 5; Detroit implied for 28.3', 'flex'],
  [23, 'DeMario Douglas', 'NE', '21.1 a game over the last two; Romeo Doubs and Mack Hollins are on IR', 'flex'],
  [24, 'Luther Burden III', 'CHI', '17.5 last week, 22% target share', 'flex'],
  [25, 'Emeka Egbuka', 'TB', 'If active. Did not practice Wednesday (concussion, foot); 16 targets last week', 'flex'],
  [26, 'Tre Tucker', 'LV', '26.7 last week; the Rams allow the 4th-fewest WR points', 'flex'],
  [27, 'Michael Wilson', 'ARI', '25% target share, 9.7 targets a game', 'flex'],
  [28, 'A.J. Brown', 'NE', '10 targets last week, full practice; Doubs and Hollins are on IR', 'flex'],
  [29, 'Keenan Allen', 'IND', '11 targets last week (16.2); Wednesday\'s DNP carried no injury', 'flex'],
  [30, 'Carnell Tate', 'TEN', '28% target share, 19.0 last week', 'flex'],
];

const WR_NEXT = 'Sits: Mike Evans, Rashee Rice, Jaylen Waddle, Courtland Sutton, Rome Odunze and Omar Cooper Jr. Out: Davante Adams (15.8) and Deebo Samuel Sr. (11.8), both engine placeholders. Nobody from BUF, JAX, LAC or WAS is ranked.';

const TE_ROWS = [
  [1, 'Trey McBride', 'ARI', '30% target share, 17.2 a game', 'start'],
  [2, 'George Kittle', 'SF', '17.9 last week; Samuel is out and Evans is not practicing', 'start'],
  [3, 'Brock Bowers', 'LV', 'If active. Limited Wednesday (hamstring, calf); 20.6 a game', 'start'],
  [4, 'Isaiah Likely', 'NYG', '24 targets over the last two weeks, 28.1 a game', 'start'],
  [5, 'Sam LaPorta', 'DET', '19.8 in Week 5; Detroit implied for 28.3', 'start'],
  [6, 'Dallas Goedert', 'PHI', '8 targets in McKee\'s first start', 'start'],
  [7, 'Tucker Kraft', 'GB', 'Detroit allows the most TE points', 'start'],
  [8, 'Kyle Pitts Sr.', 'ATL', '19.1 a game over the last two', 'start'],
  [9, 'Pat Freiermuth', 'PIT', 'New Orleans allows the 7th-most TE points; 21.5 in Week 5', 'flex'],
  [10, 'Hunter Henry', 'NE', '14.1 a game over the last two; Doubs and Hollins are on IR', 'flex'],
  [11, 'Travis Kelce', 'KC', 'If active. Limited Wednesday (ankle); Seattle allows the 4th-fewest TE points', 'flex'],
  [12, 'Tyler Higbee', 'LAR', 'Las Vegas allows the 6th-most TE points; Adams is on IR', 'flex'],
  [13, 'Mike Gesicki', 'CIN', '', 'rank'],
  [14, 'Mark Andrews', 'BAL', '', 'rank'],
];

const TE_NEXT = 'Sits: Tyler Warren, Dalton Schultz, Juwan Johnson and Jake Ferguson. Gesicki and Andrews are ranked without a call.';

const DST_ROWS = [
  [1, 'Minnesota Vikings', 'MIN', '15.2 a game; Indianapolis implied for 17.5', 'start'],
  [2, 'Houston Texans', 'HOU', 'The Giants are implied for 16.0, the lowest implied total on the slate', 'start'],
  [3, 'Seattle Seahawks', 'SEA', '12.0 a game; Kansas City implied for 19.8', 'start'],
  [4, 'Cleveland Browns', 'CLE', '13 in each of the last two; Tennessee implied for 18.0', 'start'],
  [5, 'Denver Broncos', 'DEN', '16 and 12 the last two weeks; Arizona implied for 19.5', 'start'],
  [6, 'New York Jets', 'NYJ', 'Miami implied for 17.5', 'start'],
  [7, 'Pittsburgh Steelers', 'PIT', '', 'rank'],
  [8, 'Kansas City Chiefs', 'KC', '', 'rank'],
];

const DST_TIER_NEXT = 'Sits: Dallas (2.0 a game) and Indianapolis (2.8). Pittsburgh and Kansas City are ranked without a call.';

// Handcuff rows are [team, starter and status, handcuff, verdict].

const HANDCUFFS = [
  ['CHI', 'Kyle Monangai: ruled out for Thursday (thumb, toe). D\'Andre Swift is already the lead back.', 'Roschon Johnson', 'FLEX, RB20. 14.5 on 13 carries last week; the No. 2 back while Monangai is out.'],
  ['BAL', 'Lamar Jackson: limited Wednesday on the ankle.', 'Tyler Huntley', 'SIT. A 2QB pivot only: 24.0 and 13.4 in his two starts.'],
  ['NYJ', 'Breece Hall: did not practice Wednesday (quadriceps).', 'Braelon Allen', 'FLEX, RB15. 24 and 17 carries the last two weeks; Miami allows the 4th-most RB points.'],
  ['HOU', 'David Montgomery: did not practice Wednesday (groin).', 'Woody Marks', 'FLEX, RB16. 15 carries in each of the last two weeks on 78-85% of the snaps.'],
  ['NO', 'Alvin Kamara: limited Wednesday (back).', 'Kendre Miller', 'FLEX, RB23. 20 carries last week, 9.0 in each of the last two.'],
  ['SF', 'Christian McCaffrey: a start.', 'Kaelon Black', 'No ruling, no call.'],
  ['CLE', 'Quinshon Judkins: limited Wednesday (ankle).', 'Jaleel McLaughlin', 'No ruling, no call.'],
  ['LAR', 'Kyren Williams: a start.', 'Blake Corum', 'No ruling, no call.'],
  ['PHI', 'Saquon Barkley: hamstring, in line to play Monday per Mike Garafolo.', 'Dameon Pierce', 'SIT. 95% of the snaps last week (15.0), but Barkley\'s return splits the work and Monday night leaves no pivot.'],
  ['ARI', 'Jeremiyah Love: did not practice Wednesday (ankle).', 'Tyler Allgeier and Bam Knight', 'Allgeier is FLEX, RB24: 18 carries last week with Love out. Knight has no ruling, no call.'],
  ['TB', 'Bucky Irving: did not practice Wednesday (illness).', 'Kenny Gainwell', 'No ruling, no call.'],
];

// D/ST rows are [d/st, opponent, opp implied, verdict, why].

const DST_TABLE = [
  ['Minnesota Vikings', 'vs IND', '17.5', 'START (DST1)', '15.2 a game; Indianapolis implied for 17.5.'],
  ['Houston Texans', 'vs NYG', '16.0', 'START (DST2)', 'The Giants are implied for 16.0, the lowest implied total on the slate.'],
  ['Seattle Seahawks', 'vs KC', '19.8', 'START (DST3)', '12.0 a game; Kansas City implied for 19.8.'],
  ['Cleveland Browns', 'at TEN', '18.0', 'START (DST4)', '13 in each of the last two; Tennessee implied for 18.0.'],
  ['Denver Broncos', 'at ARI', '19.5', 'START (DST5)', '16 and 12 the last two weeks; Arizona implied for 19.5.'],
  ['New York Jets', 'vs MIA', '17.5', 'START (DST6)', 'Miami implied for 17.5.'],
  ['Pittsburgh Steelers', 'at NO', '20.5', 'Ranked DST7, no call', ''],
  ['Kansas City Chiefs', 'at SEA', '22.8', 'Ranked DST8, no call', ''],
  ['Chicago Bears', 'vs NE', '23.8', 'Streamer beyond the top eight', '8.7 projected tonight.'],
  ['San Francisco 49ers', 'at ATL', '23.5', 'Streamer beyond the top eight', '10.0 a game.'],
  ['Carolina Panthers', 'vs TB', '20.8', 'Streamer beyond the top eight', 'Tampa implied for 20.8, QB undecided.'],
  ['Dallas Cowboys', 'at PHI', '20.0', 'SIT (avoid)', '2.0 a game.'],
  ['Indianapolis Colts', 'at MIN', '24.0', 'SIT (avoid)', '2.8 a game, at Minnesota.'],
];

// IDP rows are [player, team, position, opponent, note].

const IDP_TABLE = [
  ['Devin Lloyd', 'CAR', 'LB', 'vs TB', '15.6 a game'],
  ['Edgerrin Cooper', 'GB', 'LB', 'at DET', '11.5 a game, in the highest-total game'],
  ['Evan Williams', 'GB', 'S', 'at DET', '12.5 over the last two, in the highest-total game'],
  ['Ernest Jones IV', 'SEA', 'LB', 'vs KC', '10.8 a game'],
  ['Will Anderson Jr.', 'HOU', 'DE', 'vs NYG', '11.2 a game, a 10.5-point favorite'],
  ['Budda Baker', 'ARI', 'S', 'vs DEN', '12.3 over the last two'],
  ['Amani Hooker', 'TEN', 'S', 'vs CLE', '17.0 last week'],
];

const IDP_AVOID = 'Avoid Talanoa Hufanga (4.0 over the last two) and T.J. Watt (1.0 last week) as anything but a name play.';

const SLEEPERS = [
  ['Germie Bernard', 'FLEX, WR20. 25.7 last week on 12 targets; the No. 2 receiver with Pittman out.', 'WR'],
  ['Roschon Johnson', 'FLEX, RB20. 14.5 on 13 carries last week; the No. 2 back while Monangai is out.', 'RB'],
  ['Ollie Gordon II', 'FLEX, RB18. De\'Von Achane went on IR Monday; Gordon had 18 carries for 14.8 in Week 5.', 'RB'],
  ['DeMario Douglas', 'FLEX, WR23. 21.1 a game over the last two; Romeo Doubs and Mack Hollins are on IR.', 'WR'],
  ['Tanner McKee', 'A 2QB sleeper only (SIT in 1QB): 12.6 in his first start, Philadelphia implied for 20.0, and Dallas allows the 5th-most QB points.', 'QB'],
];

const FADES = [
  ['Patrick Mahomes', 'SIT, QB13. Seattle allows the 2nd-fewest QB points, Kansas City is implied for 19.8, and he scored 10.5 last week.', 'QB'],
  ['Bo Nix', 'SIT. 11.6 a game and 6.2 over the last two (7.9, 4.5).', 'QB'],
  ['Rhamondre Stevenson', 'SIT. 3.6 last week; Chicago allows the 3rd-fewest RB points.', 'RB'],
  ['Saquon Barkley', 'SIT. Hamstring; in line to play Monday per Mike Garafolo, but he was 5.8 a game on 32% of the snaps before it.', 'RB'],
  ['Omar Cooper Jr.', 'SIT. 22.3 last week, but Miami allows the 3rd-fewest WR points.', 'WR'],
];

const PIVOTS = [
  ['Lamar out', 'Huntley is a 2QB pivot only (24.0 and 13.4 in his two starts). Henry stays a start. Decide at about 11:30a ET.'],
  ['Tampa quarterback', 'Mayfield and Daniels are both sits. Tampa names its starter Friday; check it again at the 1:00p inactives.'],
  ['Irving or Egbuka out', 'Both are flexes only if active. Swap to a flex who kicks off at 4:05p or later.'],
  ['Jefferson out', 'No Minnesota receiver is called. Swap to a receiver who kicks off at 4:05p or later.'],
  ['Hall out', 'Braelon Allen is a flex, RB15.'],
  ['Montgomery out', 'Woody Marks is a flex, RB16.'],
  ['Monangai out (already)', 'Swift is the start, RB7, and Roschon Johnson is the flex, RB20.'],
  ['Kamara out', 'Kendre Miller is a flex, RB23.'],
  ['Love (ARI) out', 'Tyler Allgeier is a flex, RB24.'],
  ['Jordan Love out', 'No Green Bay quarterback is called. Stafford and Cousins are starts in the same 4:25p window.'],
  ['Watson or Golden out', 'Both are start-if-active calls. Carry a later-window receiver.'],
  ['Bowers out', 'Carry a later tight end: Kelce (FLEX if active) on Sunday night or Goedert on Monday.'],
  ['Adams out (already)', 'Nacua is the start, WR1, and Higbee is the flex, TE12.'],
  ['Samuel out (already), Evans out', 'McCaffrey and Kittle carry the San Francisco offense.'],
  ['Barkley out', 'Pierce is a sit, and Monday night leaves no pivot.'],
];

// Rulings are [id, lines]; lines are [name, position, team, verdict, reason].

const RULINGS = [
  [
    'C1',
    [
      ['Brock Purdy', 'QB', 'SF', 'START', '22.3 points a game; San Francisco implied for 26.0 at Atlanta, which allows the 10th-most QB points'],
    ],
  ],
  [
    'C2',
    [
      ['Drake Maye', 'QB', 'NE', 'START', '31.6 a game over the last two (39.5, 23.8), full practice; Thursday night at Chicago'],
    ],
  ],
  [
    'C3',
    [
      ['Matthew Stafford', 'QB', 'LAR', 'START', 'Las Vegas allows the 6th-most QB points and the Rams are implied for 26.0 in the dome'],
    ],
  ],
  [
    'C4',
    [
      ['Jared Goff', 'QB', 'DET', 'START', '23.0 a game, Detroit implied for 28.3, the highest total on the slate; Green Bay allows the 5th-fewest QB points, so the volume carries him'],
    ],
  ],
  [
    'C5',
    [
      ['Jordan Love', 'QB', 'GB', 'START if active', 'Limited Wednesday (back); Detroit allows the most QB points, 27.4 a game'],
    ],
  ],
  [
    'C6',
    [
      ['Joe Burrow', 'QB', 'CIN', 'START', '20.2 a game, 24.6 in Week 5 before the bye; Cincinnati implied for 25.0 at Baltimore'],
    ],
  ],
  [
    'C7',
    [
      ['C.J. Stroud', 'QB', 'HOU', 'START', '22.0 a game over the last two; the Giants allow the 7th-most QB points and Houston is a 10.5-point favorite'],
    ],
  ],
  [
    'C8',
    [
      ['Lamar Jackson', 'QB', 'BAL', 'START if active', 'Limited Wednesday on the ankle after missing Weeks 5 and 6 (a step up from last week\'s DNP); 19.8 a game when he plays'],
      ['Tyler Huntley', 'QB', 'BAL', 'SIT', 'Starts only if Lamar sits; 24.0 and 13.4 in his two starts make him a 2QB pivot'],
    ],
  ],
  [
    'C9',
    [
      ['Bryce Young', 'QB', 'CAR', 'START', '22.1 a game and 20.6 over the last two, full practice'],
    ],
  ],
  [
    'C10',
    [
      ['Caleb Williams', 'QB', 'CHI', 'START', 'Chicago implied for 26.8, the second-highest total; New England allows the 6th-fewest QB points, so a low-end QB1'],
    ],
  ],
  [
    'C11',
    [
      ['Dak Prescott', 'QB', 'DAL', 'START', 'Philadelphia allows the 8th-most QB points; 17.5 a game despite 11.8 over the last two'],
    ],
  ],
  [
    'C12',
    [
      ['Kirk Cousins', 'QB', 'LV', 'START', '18.5 a game and 18.5 last week; the Rams allow the 17th-most QB points; QB12'],
    ],
  ],
  [
    'C13',
    [
      ['Patrick Mahomes', 'QB', 'KC', 'SIT', 'Seattle allows the 2nd-fewest QB points, Kansas City is implied for 19.8, and he scored 10.5 last week; QB13'],
    ],
  ],
  [
    'C14',
    [
      ['Bo Nix', 'QB', 'DEN', 'SIT', '11.6 a game and 6.2 over the last two (7.9, 4.5)'],
    ],
  ],
  [
    'C15',
    [
      ['Tanner McKee', 'QB', 'PHI', 'SIT', '12.6 in his first start, Philadelphia implied for 20.0; Dallas allows the 5th-most QB points, so he is a 2QB start only'],
    ],
  ],
  [
    'C16',
    [
      ['Baker Mayfield', 'QB', 'TB', 'SIT', 'Full practice on the thumb, but Tampa names its starter Friday; 11.7 a game in his three starts'],
      ['Jalon Daniels', 'QB', 'TB', 'SIT', 'Started Weeks 5 and 6 (13.9, 11.2); loses the job if Mayfield is cleared'],
    ],
  ],
  [
    'C17',
    [
      ['J.J. McCarthy', 'QB', 'NYG', 'SIT', 'Top of the depth chart after 16.3 in relief in Week 6; the Giants are implied for 16.0, the lowest implied total on the slate'],
      ['Jameis Winston', 'QB', 'NYG', 'SIT', 'Played 60% of the Week 6 snaps for 6.5; same 16.0 implied total'],
    ],
  ],
  [
    'C18',
    [
      ['Jalen Hurts', 'QB', 'PHI', 'OUT', 'On IR with blood clots, out for the season; the engine still projects 18.5'],
    ],
  ],
  [
    'C19',
    [
      ['Jahmyr Gibbs', 'RB', 'DET', 'START', '30.7 a game on 21 carries and 6.8 targets; Detroit implied for 28.3'],
    ],
  ],
  [
    'C20',
    [
      ['Christian McCaffrey', 'RB', 'SF', 'START', '30.7 last week on 10 targets; with Deebo Samuel out and Mike Evans not practicing, more of the offense runs through him'],
    ],
  ],
  [
    'C21',
    [
      ['Kenneth Walker III', 'RB', 'KC', 'START', '27.6 a game on 21.2 carries; Seattle is 13th in RB points allowed'],
    ],
  ],
  [
    'C22',
    [
      ['Bijan Robinson', 'RB', 'ATL', 'START', '21.4 a game; San Francisco allows the 11th-most RB points'],
    ],
  ],
  [
    'C23',
    [
      ['Jaylen Warren', 'RB', 'PIT', 'START', 'New Orleans allows the most RB points; 14 carries and 5 targets a game'],
    ],
  ],
  [
    'C24',
    [
      ['Kyren Williams', 'RB', 'LAR', 'START', '20.0 a game with 6.5 targets; Las Vegas allows the 7th-most RB points'],
    ],
  ],
  [
    'C25',
    [
      ['Kyle Monangai', 'RB', 'CHI', 'OUT', 'Ruled out for Thursday (thumb, toe); the engine still projects 11.5'],
      ['D\'Andre Swift', 'RB', 'CHI', 'START', '20.1 a game over the last two, and Monangai\'s 15 carries a game open up; Chicago implied for 26.8'],
      ['Roschon Johnson', 'RB', 'CHI', 'FLEX', '14.5 on 13 carries last week; the No. 2 back while Monangai is out'],
    ],
  ],
  [
    'C26',
    [
      ['Jonathan Taylor', 'RB', 'IND', 'START', '20.3 carries a game and 21.1 last week; Minnesota allows the fewest RB points, so this is a volume start'],
    ],
  ],
  [
    'C27',
    [
      ['Javonte Williams', 'RB', 'DAL', 'START', '18.2 a game on 78% of the snaps; Philadelphia is 16th in RB points allowed'],
    ],
  ],
  [
    'C28',
    [
      ['Derrick Henry', 'RB', 'BAL', 'START', '21.7 carries a game; Cincinnati allows the 8th-fewest RB points, so this is a volume start'],
    ],
  ],
  [
    'C29',
    [
      ['Chuba Hubbard', 'RB', 'CAR', 'START', '19.6 a game and 28 carries last week (19.1); Wednesday\'s DNP carried no injury'],
    ],
  ],
  [
    'C30',
    [
      ['Ashton Jeanty', 'RB', 'LV', 'START', '16.9 a game with a 17% target share'],
    ],
  ],
  [
    'C31',
    [
      ['Aaron Jones Sr.', 'RB', 'MIN', 'FLEX', '25 carries in Week 5 before the bye; Indianapolis allows the 6th-most RB points and Minnesota is a 6.5-point favorite. Jordan Mason\'s return window opened Monday'],
    ],
  ],
  [
    'C32',
    [
      ['Bucky Irving', 'RB', 'TB', 'FLEX if active', 'Did not practice Wednesday (illness); Carolina allows the 5th-most RB points'],
    ],
  ],
  [
    'C33',
    [
      ['Breece Hall', 'RB', 'NYJ', 'SIT', 'Did not practice Wednesday (quadriceps); three games played'],
      ['Braelon Allen', 'RB', 'NYJ', 'FLEX', 'The lead back with Hall out: 24 and 17 carries the last two weeks; Miami allows the 4th-most RB points'],
    ],
  ],
  [
    'C34',
    [
      ['David Montgomery', 'RB', 'HOU', 'SIT', 'Did not practice Wednesday (groin); 1.1 in Week 5, missed Week 6'],
      ['Woody Marks', 'RB', 'HOU', 'FLEX', '15 carries in each of the last two weeks on 78-85% of the snaps; Houston is a 10.5-point favorite'],
    ],
  ],
  [
    'C35',
    [
      ['Chase Brown', 'RB', 'CIN', 'FLEX', '14.2 carries and 5.6 targets a game; Baltimore allows the 6th-fewest RB points'],
    ],
  ],
  [
    'C36',
    [
      ['Ollie Gordon II', 'RB', 'MIA', 'FLEX', 'De\'Von Achane went on IR Monday; Gordon had 18 carries for 14.8 in Week 5'],
    ],
  ],
  [
    'C37',
    [
      ['Quinshon Judkins', 'RB', 'CLE', 'FLEX if active', 'Limited Wednesday (ankle) after missing Week 6; 14.6 carries a game'],
    ],
  ],
  [
    'C38',
    [
      ['J.K. Dobbins', 'RB', 'DEN', 'FLEX', '18 and 17 carries the last two weeks, 14.5 a game'],
      ['RJ Harvey', 'RB', 'DEN', 'FLEX', '14.6 last week with a 17% target share; the passing-down half of the split'],
    ],
  ],
  [
    'C39',
    [
      ['Alvin Kamara', 'RB', 'NO', 'SIT', 'Limited Wednesday (back); 7 carries a game'],
      ['Kendre Miller', 'RB', 'NO', 'FLEX', '20 carries last week, 9.0 in each of the last two'],
    ],
  ],
  [
    'C40',
    [
      ['Jeremiyah Love', 'RB', 'ARI', 'SIT', 'Did not practice Wednesday (ankle); missed Week 6'],
      ['Tyler Allgeier', 'RB', 'ARI', 'FLEX', '18 carries last week with Love out; Denver allows the 8th-most RB points'],
    ],
  ],
  [
    'C41',
    [
      ['Saquon Barkley', 'RB', 'PHI', 'SIT', 'Hamstring; in line to play Monday per Mike Garafolo, but he was 5.8 a game on 32% of the snaps before it'],
      ['Dameon Pierce', 'RB', 'PHI', 'SIT', '95% of the snaps last week (15.0), but Barkley\'s return splits the work and Monday night leaves no pivot'],
    ],
  ],
  [
    'C42',
    [
      ['Josh Jacobs', 'RB', 'GB', 'SIT', 'Came off the Commissioner\'s Exempt List Monday; no snaps this season and Green Bay has not committed to playing him'],
    ],
  ],
  [
    'C43',
    [
      ['Rhamondre Stevenson', 'RB', 'NE', 'SIT', '3.6 last week; Chicago allows the 3rd-fewest RB points'],
    ],
  ],
  [
    'C44',
    [
      ['Tony Pollard', 'RB', 'TEN', 'SIT', '8.6 a game; Cleveland allows the 2nd-fewest RB points and Tennessee is implied for 18.0'],
    ],
  ],
  [
    'C45',
    [
      ['Emanuel Wilson', 'RB', 'SEA', 'SIT', '5.2 last week on 32% of the snaps; Zach Charbonnet practiced in full Wednesday'],
    ],
  ],
  [
    'C46',
    [
      ['Puka Nacua', 'WR', 'LAR', 'START', '31% target share, 23.2 a game; Davante Adams is on IR'],
    ],
  ],
  [
    'C47',
    [
      ['Davante Adams', 'WR', 'LAR', 'OUT', 'Placed on IR Tuesday (hamstring); the engine still projects 15.8'],
    ],
  ],
  [
    'C48',
    [
      ['Jaxon Smith-Njigba', 'WR', 'SEA', 'START', '36% target share, 27.6 a game; Kansas City allows the fewest WR points and it does not matter'],
    ],
  ],
  [
    'C49',
    [
      ['Amon-Ra St. Brown', 'WR', 'DET', 'START', '31% target share; Detroit implied for 28.3'],
    ],
  ],
  [
    'C50',
    [
      ['CeeDee Lamb', 'WR', 'DAL', 'START', '18 targets last week; Philadelphia allows the 4th-most WR points'],
    ],
  ],
  [
    'C51',
    [
      ['Malik Nabers', 'WR', 'NYG', 'START', '35 targets over the last two weeks, 28.8 a game; Houston allows the 3rd-most WR points'],
    ],
  ],
  [
    'C52',
    [
      ['Ja\'Marr Chase', 'WR', 'CIN', 'START', '22.7 in Week 5 before the bye; 22% target share'],
    ],
  ],
  [
    'C53',
    [
      ['Christian Watson', 'WR', 'GB', 'START if active', 'Limited Wednesday (ankle); Detroit allows the 2nd-most WR points'],
    ],
  ],
  [
    'C54',
    [
      ['DeVonta Smith', 'WR', 'PHI', 'START', '14 targets in McKee\'s first start (20.5); 32% target share'],
    ],
  ],
  [
    'C55',
    [
      ['Zay Flowers', 'WR', 'BAL', 'START', '31% target share, 18.9 a game'],
    ],
  ],
  [
    'C56',
    [
      ['George Pickens', 'WR', 'DAL', 'START', '20.6 a game over the last two; Philadelphia allows the 4th-most WR points'],
    ],
  ],
  [
    'C57',
    [
      ['Matthew Golden', 'WR', 'GB', 'START if active', 'Limited Wednesday (shoulder); 21.4 a game over the last two and 13 targets last week'],
    ],
  ],
  [
    'C58',
    [
      ['Tetairoa McMillan', 'WR', 'CAR', 'START', '17.8 a game, 27% target share'],
    ],
  ],
  [
    'C59',
    [
      ['Chris Olave', 'WR', 'NO', 'START', '27% target share; Pittsburgh allows the 6th-fewest WR points, so a lower-end start'],
    ],
  ],
  [
    'C60',
    [
      ['Drake London', 'WR', 'ATL', 'START', '29% target share, 11 and 10 targets the last two weeks'],
    ],
  ],
  [
    'C61',
    [
      ['Nico Collins', 'WR', 'HOU', 'START', '24% target share, Houston implied for 26.5; limited Wednesday with no injury listed'],
    ],
  ],
  [
    'C62',
    [
      ['Tee Higgins', 'WR', 'CIN', 'START', '8.6 targets and 15.1 points a game'],
    ],
  ],
  [
    'C63',
    [
      ['Justin Jefferson', 'WR', 'MIN', 'START if active', 'Limited Wednesday (ankle); 26% target share, 18.8 in Week 5'],
    ],
  ],
  [
    'C64',
    [
      ['Jalen Coker', 'WR', 'CAR', 'START', '13 targets last week (15.7), 17.0 a game'],
    ],
  ],
  [
    'C65',
    [
      ['DK Metcalf', 'WR', 'PIT', 'FLEX', '15 targets last week, with Michael Pittman Jr. and Roman Wilson on IR'],
      ['Germie Bernard', 'WR', 'PIT', 'FLEX', '25.7 last week on 12 targets; the No. 2 receiver with Pittman out'],
    ],
  ],
  [
    'C66',
    [
      ['Garrett Wilson', 'WR', 'NYJ', 'FLEX', '29% target share; Miami allows the 3rd-fewest WR points'],
    ],
  ],
  [
    'C67',
    [
      ['Jameson Williams', 'WR', 'DET', 'FLEX', '18.7 in Week 5; Detroit implied for 28.3'],
    ],
  ],
  [
    'C68',
    [
      ['DeMario Douglas', 'WR', 'NE', 'FLEX', '21.1 a game over the last two; Romeo Doubs and Mack Hollins are on IR'],
    ],
  ],
  [
    'C69',
    [
      ['Luther Burden III', 'WR', 'CHI', 'FLEX', '17.5 last week, 22% target share'],
    ],
  ],
  [
    'C70',
    [
      ['Emeka Egbuka', 'WR', 'TB', 'FLEX if active', 'Did not practice Wednesday (concussion, foot); 16 targets last week'],
    ],
  ],
  [
    'C71',
    [
      ['Tre Tucker', 'WR', 'LV', 'FLEX', '26.7 last week; the Rams allow the 4th-fewest WR points'],
    ],
  ],
  [
    'C72',
    [
      ['Michael Wilson', 'WR', 'ARI', 'FLEX', '25% target share, 9.7 targets a game'],
    ],
  ],
  [
    'C73',
    [
      ['A.J. Brown', 'WR', 'NE', 'FLEX', '10 targets last week, full practice; Doubs and Hollins are on IR'],
    ],
  ],
  [
    'C74',
    [
      ['Keenan Allen', 'WR', 'IND', 'FLEX', '11 targets last week (16.2); Wednesday\'s DNP carried no injury'],
    ],
  ],
  [
    'C75',
    [
      ['Carnell Tate', 'WR', 'TEN', 'FLEX', '28% target share, 19.0 last week'],
    ],
  ],
  [
    'C76',
    [
      ['Mike Evans', 'WR', 'SF', 'SIT', 'Did not practice Wednesday (ribs, Achilles) and is expected to miss time'],
    ],
  ],
  [
    'C77',
    [
      ['Deebo Samuel Sr.', 'WR', 'SF', 'OUT', 'Hamstring; the engine still projects 11.8'],
    ],
  ],
  [
    'C78',
    [
      ['Rashee Rice', 'WR', 'KC', 'SIT', 'Did not practice Wednesday (hamstring, knee); Seattle allows the 2nd-fewest WR points'],
    ],
  ],
  [
    'C79',
    [
      ['Jaylen Waddle', 'WR', 'DEN', 'SIT', 'Limited Wednesday (chest); 5.6 a game over the last two'],
    ],
  ],
  [
    'C80',
    [
      ['Courtland Sutton', 'WR', 'DEN', 'SIT', '5.4 a game'],
    ],
  ],
  [
    'C81',
    [
      ['Rome Odunze', 'WR', 'CHI', 'SIT', '6.0 a game over the last two despite 91% of the snaps'],
    ],
  ],
  [
    'C82',
    [
      ['Omar Cooper Jr.', 'WR', 'NYJ', 'SIT', '22.3 last week, but Miami allows the 3rd-fewest WR points'],
    ],
  ],
  [
    'C83',
    [
      ['Trey McBride', 'TE', 'ARI', 'START', '30% target share, 17.2 a game'],
    ],
  ],
  [
    'C84',
    [
      ['George Kittle', 'TE', 'SF', 'START', '17.9 last week; Samuel is out and Evans is not practicing'],
    ],
  ],
  [
    'C85',
    [
      ['Brock Bowers', 'TE', 'LV', 'START if active', 'Limited Wednesday (hamstring, calf); 20.6 a game'],
    ],
  ],
  [
    'C86',
    [
      ['Isaiah Likely', 'TE', 'NYG', 'START', '24 targets over the last two weeks, 28.1 a game'],
    ],
  ],
  [
    'C87',
    [
      ['Sam LaPorta', 'TE', 'DET', 'START', '19.8 in Week 5; Detroit implied for 28.3'],
    ],
  ],
  [
    'C88',
    [
      ['Dallas Goedert', 'TE', 'PHI', 'START', '8 targets in McKee\'s first start'],
    ],
  ],
  [
    'C89',
    [
      ['Tucker Kraft', 'TE', 'GB', 'START', 'Detroit allows the most TE points'],
    ],
  ],
  [
    'C90',
    [
      ['Kyle Pitts Sr.', 'TE', 'ATL', 'START', '19.1 a game over the last two'],
    ],
  ],
  [
    'C91',
    [
      ['Pat Freiermuth', 'TE', 'PIT', 'FLEX', 'New Orleans allows the 7th-most TE points; 21.5 in Week 5'],
    ],
  ],
  [
    'C92',
    [
      ['Hunter Henry', 'TE', 'NE', 'FLEX', '14.1 a game over the last two; Doubs and Hollins are on IR'],
    ],
  ],
  [
    'C93',
    [
      ['Travis Kelce', 'TE', 'KC', 'FLEX if active', 'Limited Wednesday (ankle); Seattle allows the 4th-fewest TE points'],
    ],
  ],
  [
    'C94',
    [
      ['Tyler Higbee', 'TE', 'LAR', 'FLEX', 'Las Vegas allows the 6th-most TE points; Adams is on IR'],
    ],
  ],
  [
    'C95',
    [
      ['Tyler Warren', 'TE', 'IND', 'SIT', 'Did not practice Wednesday (groin) after missing Week 6; Minnesota allows the fewest TE points'],
    ],
  ],
  [
    'C96',
    [
      ['Dalton Schultz', 'TE', 'HOU', 'SIT', 'Did not practice Wednesday (quadriceps)'],
    ],
  ],
  [
    'C97',
    [
      ['Juwan Johnson', 'TE', 'NO', 'SIT', '2.8 a game over the last two'],
    ],
  ],
  [
    'C98',
    [
      ['Jake Ferguson', 'TE', 'DAL', 'SIT', '7.4 a game on a 10% target share'],
    ],
  ],
  [
    'C99',
    [
      ['Minnesota Vikings', 'DEF', 'MIN', 'START', '15.2 a game; Indianapolis implied for 17.5'],
    ],
  ],
  [
    'C100',
    [
      ['Houston Texans', 'DEF', 'HOU', 'START', 'The Giants are implied for 16.0, the lowest implied total on the slate'],
    ],
  ],
  [
    'C101',
    [
      ['Seattle Seahawks', 'DEF', 'SEA', 'START', '12.0 a game; Kansas City implied for 19.8'],
    ],
  ],
  [
    'C102',
    [
      ['Cleveland Browns', 'DEF', 'CLE', 'START', '13 in each of the last two; Tennessee implied for 18.0'],
    ],
  ],
  [
    'C103',
    [
      ['Denver Broncos', 'DEF', 'DEN', 'START', '16 and 12 the last two weeks; Arizona implied for 19.5'],
    ],
  ],
  [
    'C104',
    [
      ['New York Jets', 'DEF', 'NYJ', 'START', 'Miami implied for 17.5'],
    ],
  ],
  [
    'C105',
    [
      ['Dallas Cowboys', 'DEF', 'DAL', 'SIT', '2.0 a game'],
    ],
  ],
  [
    'C106',
    [
      ['Indianapolis Colts', 'DEF', 'IND', 'SIT', '2.8 a game, at Minnesota'],
    ],
  ],
];

const CHECK_THU = [
  ['Kyle Monangai (CHI RB).', 'Out. D\'Andre Swift is the START and Roschon Johnson the FLEX.'],
  ['Drake Maye (NE QB).', 'Full practice. Start him.'],
  ['Everyone else on the card.', 'No pivot cover on Thursday: set the lineup before the 6:45p ET inactives.'],
];

const CHECK_PARIS = [
  ['Rico Dowdle (PIT RB).', 'Limited Wednesday (knee). No ruling. Jaylen Warren is a START as written.'],
  ['Alvin Kamara (NO RB).', 'A sit either way. Kendre Miller is the FLEX.'],
  ['Everyone on the card.', 'Paris locks first on Sunday and nothing has played before it. Check about 8:00a ET.'],
];

const CHECK_ONE = [
  ['Lamar Jackson (BAL QB), about 11:30a ET.', 'Active: START. Out: Huntley is a 2QB pivot only.'],
  ['Tampa quarterback.', 'Mayfield and Daniels are both sits.'],
  ['Bucky Irving (TB RB) and Emeka Egbuka (TB WR).', 'Active: FLEX. Out: swap to a later-kickoff flex.'],
  ['Breece Hall (NYJ RB).', 'A sit either way. Braelon Allen is the FLEX.'],
  ['David Montgomery (HOU RB).', 'A sit either way. Woody Marks is the FLEX.'],
  ['Justin Jefferson (MIN WR) and Quinshon Judkins (CLE RB).', 'Jefferson active: START. Judkins active: FLEX.'],
  ['Tyler Warren (IND TE).', 'A sit either way.'],
];

const CHECK_LATE = [
  ['Jeremiyah Love (ARI RB) and Jaylen Waddle (DEN WR), about 2:35p ET.', 'Sits either way. Allgeier is the Arizona FLEX.'],
  ['Jordan Love, Christian Watson and Matthew Golden (GB), about 2:55p ET.', 'Each is a START if active.'],
  ['Josh Jacobs (GB RB).', 'A sit either way.'],
  ['Brock Bowers (LV TE).', 'Active: START. Out: swap to a later tight end.'],
];

const CHECK_SNF = [
  ['Travis Kelce (KC TE), about 6:50p ET.', 'Active: FLEX.'],
  ['Rashee Rice (KC WR).', 'A sit either way.'],
  ['Zach Charbonnet (SEA RB).', 'No ruling. Emanuel Wilson is a sit either way.'],
];

const CHECK_MNF = [
  ['Saquon Barkley (PHI RB), about 6:45p ET Monday.', 'A sit, in line to play per Mike Garafolo. Monday night leaves no pivot.'],
  ['Everyone on the card.', 'Monday is the last window, so there is no later swap.'],
];

const Body = () => (
  <>
    <HeroBanner />

    <Lead>
      Fourteen games, Thursday through Monday, and four teams on bye. New England at Chicago kicks
      off Thursday night, Pittsburgh at New Orleans kicks off Sunday at 9:30 a.m. ET in Paris, and
      Dallas at Philadelphia closes it Monday night. Lamar Jackson was limited Wednesday, Kyle
      Monangai is out for Thursday, and Tampa picks its quarterback Friday. Every call is here. Set
      your Thursday lineup first, and set your pivots before you go to bed Saturday.
    </Lead>

    <Note title="Read this first">
      <strong>Lines are our database as of Oct 22, 9:18am ET (8:18am CT) and weather as of 6:43am ET
      (5:43am CT). Injury notes are the Wednesday practice reports, and no Thursday report was
      published when I wrote this.</strong>{' '}
      Friday&apos;s reports can change any of it. Update on Saquon Barkley: the Tuesday waiver
      column had him out, and Mike Garafolo has since reported that he is in line to play Monday. I
      still call him a sit. Re-check the Friday reports and the inactives before you lock anything.
      Every window below says when the inactives drop, and every time on this page is Eastern
      unless it says CT.
    </Note>

    <P>
      Scoring is PPR. Buffalo, Jacksonville, the Chargers and Washington are on bye, so 28 teams
      play, and nobody from those four is ranked or called. Where an engine projection is a
      placeholder (an injured or inactive player the model still scores), I say so and lean on
      usage.
    </P>
    <RailList
      items={[
        ['FPA rank', '1 means the defense allows the most points to that position (a good matchup), 32 the fewest (tough). Weeks 1 to 6, garbage time included.'],
        ['Verdicts', 'START, FLEX, SIT and OUT are the rulings. "If active" calls are void if the player does not appear, and they sit in the game-time group of each card.'],
        ['Tiers', 'QB 14, RB 24, WR 30, TE 14 and D/ST 8, in the order I rank them. A player ranked without a ruling says so.'],
        ['Ruling links', 'Every call on a card links to its Darkness Ruling (C1 to C106) with the reason.'],
      ]}
    />

    <JumpGrid />

    <H2>The Slate Board</H2>
    <P>
      Every game, in kickoff order with Thursday first: line, total, weather and both implied totals
      on one scale. Filled bars are the favorites. Green Bay at Detroit (53.5) is the highest total
      and Detroit (28.3) is the highest implied team, with Chicago (26.8) second. Cleveland at
      Tennessee (37.5) is the lowest total, and the Giants (16.0) are the lowest implied team.
      Houston (-10.5) is the biggest favorite, followed by Minnesota (-6.5).
    </P>
    <SlateBoard />
    <P>
      The weather is calm everywhere. 10 mph is the most wind on the slate (Giants at Houston, 49ers
      at Atlanta, Buccaneers at Carolina), and Seattle has a 19% chance of light rain Sunday night.
      Indianapolis at Minnesota, Green Bay at Detroit and the Rams at Las Vegas are indoors. I have
      no number for what wind does to a stat line, so there are no point adjustments.
    </P>

    <H2>The Injury Board</H2>
    <P>
      Practice reports are Wednesday. The decision rules are simple, and I apply them the same way
      to every name on this page.
    </P>
    <RailList
      color="var(--warning)"
      items={[
        ['Rest days', 'Where Wednesday\'s DNP carried no injury (Hubbard, Keenan Allen), there is no downgrade.'],
        ['"If active" calls', 'are void if the player does not appear. Every call that turns on a practice report, his or his teammate\'s, carries the injury on its card.'],
        ['Engine placeholders', 'never rank anyone. Hurts, Adams, Achane, Samuel, Monangai, Charbonnet and Jacobs all carry a projection and none of them is a call.'],
        ['A swap only works', 'if your bench player kicks off at or after the player he replaces. Thursday and Paris players have no cover at all.'],
        ['Byes', 'Buffalo, Jacksonville, the Chargers and Washington: nobody is ranked or called.'],
      ]}
    />
    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, my: 2 }}>
      <Chip tone="var(--accent)">Thursday: about 6:45p ET</Chip>
      <Chip tone="var(--accent)">Paris: about 8:00a ET</Chip>
      <Chip tone="var(--accent)">1:00p games: about 11:30a ET</Chip>
      <Chip tone="var(--accent)">4:05p / 4:25p: about 2:35p / 2:55p ET</Chip>
      <Chip tone="var(--accent)">SNF: about 6:50p ET</Chip>
      <Chip tone="var(--accent)">MNF: about 6:45p ET Monday</Chip>
    </Box>

    <InjuryGroup title="Out, or treat as out" when="Thursday and Paris players have no pivot cover." rows={INJ_OUT} />
    <InjuryGroup title="Thursday" when="Inactives about 6:45p ET; no pivot cover" rows={INJ_THU} />
    <InjuryGroup title="Paris" when="Inactives about 8:00a ET" rows={INJ_PARIS} />
    <InjuryGroup title="1:00p games" when="Inactives about 11:30a ET" rows={INJ_ONE} />
    <InjuryGroup title="Late window" when="Inactives about 2:35p / 2:55p ET" rows={INJ_LATE} />
    <InjuryGroup title="Sunday and Monday night" when="Inactives about 6:50p ET / 6:45p ET Monday" rows={INJ_NIGHT} />
    <Box component="h3" sx={{ m: '24px 0 8px !important', fontSize: '1.15rem !important' }}>Already out for the week or longer</Box>
    <Box component="p" sx={{ mt: '0 !important', fontSize: '0.92rem', color: 'var(--text-muted)', lineHeight: 1.6 }}>
      {ALREADY_OUT.join('; ')}.
    </Box>

    <H2>Thursday Night</H2>
    <P>
      One game, and it locks first. The inactives drop about 6:45p ET and there is no pivot cover:
      whoever you start Thursday night is locked, and a late scratch cannot be fixed. Set the
      lineup before you do anything else on Thursday.
    </P>
    {SLOT('thu')}

    <H2>Paris</H2>
    <P>
      Pittsburgh at New Orleans is at the Stade de France and kicks off at 9:30a ET Sunday morning,
      before every other Sunday game. The inactives drop about 8:00a ET. Nothing has played before
      it, so a swap has to come from a bench player in a later game.
    </P>
    {SLOT('paris')}

    <H2>The 1:00p Window</H2>
    <P>
      Seven games at 1:00p ET. Nothing kicks between 1:00p and 4:05p, so a 1:00p decision needs a
      4:05p-or-later swap on your bench. Inactives about 11:30a ET.
    </P>
    {SLOT('one')}

    <H2>Late Window</H2>
    <P>
      Three games at 4:05p and 4:25p. These are pivot-safe after the early slate: you can see the
      1:00p inactives and the early scores before you decide.
    </P>
    {SLOT('late')}

    <H2>Prime Time</H2>
    <P>
      Sunday night is Kansas City at Seattle at 8:20p ET. Monday night is Dallas at Philadelphia at
      8:15p ET, and my Monday injury data is Wednesday-only, so hold it loosely.
    </P>
    {SLOT('prime')}

    <H2>Position Tiers</H2>
    <P>
      The rankings for the Thursday through Monday slate. The bands follow my written verdict on
      each player: START, FLEX or SIT. A player I ranked without a ruling is listed under his own
      band. The note under each name is the reason from his ruling.
    </P>
    <H3>Quarterback, top 14</H3>
    <TierBoard pos="QB" rows={QB_ROWS} next={QB_NEXT} />
    <H3>Running back, top 24</H3>
    <TierBoard pos="RB" rows={RB_ROWS} next={RB_NEXT} />
    <H3>Wide receiver, top 30</H3>
    <TierBoard pos="WR" rows={WR_ROWS} next={WR_NEXT} />
    <H3>Tight end, top 14</H3>
    <TierBoard pos="TE" rows={TE_ROWS} next={TE_NEXT} />
    <H3>D/ST, top 8</H3>
    <TierBoard pos="DST" rows={DST_ROWS} next={DST_TIER_NEXT} />

    <H2>Handcuff Board</H2>
    <P>
      The starter&apos;s report decides the handcuff, so read this beside the Injury Board. The
      verdict is for Week 7 and nothing else. A handcuff with no ruling gets no call.
    </P>
    <Table aria-label="Week 7 handcuff board">
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

    <H2>D/ST Streaming Board</H2>
    <P>
      The top eight, with the streamers beyond them. &quot;Opp implied&quot; is the points the
      opposing offense is expected to score. Minnesota at home against Indianapolis (17.5) and
      Houston against the Giants (16.0) are the two best spots on the board.
    </P>
    <Table aria-label="Week 7 D/ST streaming board">
      <THead>
        <TR>
          <TH scope="col">D/ST</TH><TH scope="col">Opponent</TH><TH scope="col">Opp implied</TH><TH scope="col">Verdict</TH><TH scope="col">Why</TH>
        </TR>
      </THead>
      <TBody>
        {DST_TABLE.map(([team, opp, imp, verdict, why]) => (
          <TR key={team}><TD><strong>{team}</strong></TD><TD>{opp}</TD><TD>{imp}</TD><TD>{verdict}</TD><TD>{why}</TD></TR>
        ))}
      </TBody>
    </Table>
    <P>
      Also avoid Arizona (4.5 a game), Miami (3.0) and Detroit (4.2).
    </P>

    <H2>IDP Streamers</H2>
    <P>
      Tackle volume is the currency at linebacker and safety; pressure is the currency on the line.
      Rostered percentages are not tracked for IDP, so check your own wire.
    </P>
    <Table aria-label="IDP streamers">
      <THead>
        <TR>
          <TH scope="col">Player</TH><TH scope="col">Team</TH><TH scope="col">Pos</TH><TH scope="col">Opp</TH><TH scope="col">Note</TH>
        </TR>
      </THead>
      <TBody>
        {IDP_TABLE.map(([name, team, pos, opp, note]) => (
          <TR key={name}><TD><strong>{name}</strong></TD><TD>{team}</TD><TD>{pos}</TD><TD>{opp}</TD><TD>{note}</TD></TR>
        ))}
      </TBody>
    </Table>
    <P>{IDP_AVOID}</P>

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
      One hundred and six rulings, C1 to C106, and 118 calls inside them. Each one is here with its
      reason.
    </P>
    {RULINGS.map((r) => <RulingCard key={r[0]} r={r} />)}

    <H2>Inactives Checklist</H2>
    <P>
      Inactives drop about 90 minutes before each kickoff. Windows are Eastern time. Thursday and
      Paris are the first two windows and the only ones with no cover, so start there.
    </P>
    <WindowChecklist title="Thursday inactives" time="about 6:45p ET" rows={CHECK_THU} />
    <WindowChecklist title="Paris inactives" time="about 8:00a ET" rows={CHECK_PARIS} />
    <WindowChecklist title="1:00p inactives" time="about 11:30a ET" rows={CHECK_ONE} />
    <WindowChecklist title="4:05p and 4:25p inactives" time="about 2:35p and 2:55p ET" rows={CHECK_LATE} />
    <WindowChecklist title="Sunday night inactives" time="about 6:50p ET" rows={CHECK_SNF} />
    <WindowChecklist title="Monday night inactives" time="about 6:45p ET Monday" rows={CHECK_MNF} />

    <Quote>
      Start your studs, trust the usage over the name, and set your pivots before you go to bed
      Saturday. Friday&apos;s reports can change any of this, and I will not pretend they cannot.
    </Quote>
  </>
);

export default Body;
