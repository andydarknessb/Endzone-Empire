import React from 'react';
import { Box } from '@mui/material';
import {
  Lead, P, H2, H3, Quote,
  Table, THead, TBody, TR, TH, TD,
} from '../../components/public/kit/Prose';

// Body only: the frontmatter lives in week8-start-sit-darkness-report.meta.js so listings can be
// built without loading this prose; content/articles/index.js loads it on demand.
//
// Every color below the hero is a theme token, so the board, cards and chips read in light and
// dark. The hero is a dark illustration in both themes, like the Week 3 start/sit banner.
//
// Reading key (also printed in the article): FPA rank: 1 = most points allowed (good matchup for the
// opposing position), 32 = fewest (tough). Weeks 1 to 7. Times are Eastern. Verdicts come from docs/editorial/week8-rulings.md.

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
      aria-labelledby="wk8ss-hero-title wk8ss-hero-desc"
    >
      <title id="wk8ss-hero-title">Week 8 Start/Sit: The Darkness Report</title>
      <desc id="wk8ss-hero-desc">
        A night football field in perspective, with yard lines, hash marks and goalposts under a
        floodlight, and a glowing football arcing across the sky over the headline Week 8 Start/Sit.
      </desc>
      <defs>
        <linearGradient id="wk8ss-sky" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#060910" />
          <stop offset="0.55" stopColor="#0c1424" />
          <stop offset="1" stopColor="#1a0f24" />
        </linearGradient>
        <radialGradient id="wk8ss-flood" cx="0.5" cy="0.1" r="0.85">
          <stop offset="0" stopColor="#7eaaff" stopOpacity="0.34" />
          <stop offset="1" stopColor="#7eaaff" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="wk8ss-turf" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#0f3a2a" />
          <stop offset="1" stopColor="#06180f" />
        </linearGradient>
        <linearGradient id="wk8ss-trail" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#2fd97b" stopOpacity="0" />
          <stop offset="1" stopColor="#ffd866" stopOpacity="0.95" />
        </linearGradient>
      </defs>
      <rect width="800" height="300" fill="url(#wk8ss-sky)" />
      <rect width="800" height="300" fill="url(#wk8ss-flood)" />
      <rect x="0" y="150" width="800" height="150" fill="url(#wk8ss-turf)" />
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
      <path d="M96 236 C 190 24, 420 -6, 520 96" fill="none" stroke="url(#wk8ss-trail)" strokeWidth="3" strokeLinecap="round" strokeDasharray="2 9" />
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
      <text x="400" y="244" textAnchor="middle" fill="#ffffff" fontFamily="system-ui, sans-serif" fontWeight="850" fontSize="24" letterSpacing="1">WEEK 8 START / SIT</text>
      <text x="400" y="268" textAnchor="middle" fill="#8badc9" fontFamily="system-ui, sans-serif" fontWeight="600" fontSize="12" letterSpacing="2">WEEK 8 | THURSDAY TO MONDAY | 14 GAMES</text>
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
    id: 'car-gb',
    slot: 'thu',
    title: 'Panthers at Packers',
    kick: 'Thu 8:15p',
    when: 'Thursday Night · 8:15p ET',
    away: 'CAR',
    home: 'GB',
    awayPts: 22,
    homePts: 25.5,
    line: 'GB -3.5',
    total: 47.5,
    weather: '53F, wind 7, clear',
    rain: false,
    read: 'Thursday night at Lambeau, and it locks first. The inactives drop about 6:45p ET and there is no pivot cover: whatever you start is final. Both teams carry game designations because they play Thursday, and no Thursday report was published when I wrote this. Green Bay is a 3.5-point favorite implied for 25.5 against Carolina\'s 22.0. Josh Jacobs scored 20.1 in his first game back on 11 carries and 7 targets, and Carolina allows the 2nd-most RB points. Green Bay allows the 6th-most RB points and the 6th-most WR points, which is why Chuba Hubbard, Tetairoa McMillan and Jalen Coker all get calls. Bryce Young is a sit after 5.4 last week, and Matthew Golden (shoulder, foot) is a flex only if he is active.',
    fpa: 'CAR offense vs GB D: QB 28, RB 6, WR 6, TE 31 · GB offense vs CAR D: QB 19, RB 2, WR 26, TE 15',
    start: [
      ['Jordan Love', 'QB', '18.3 a game; Green Bay implied for 25.5 Thursday against Carolina, 14th-fewest QB points allowed.', 'QB8', 'C8'],
      ['Josh Jacobs', 'RB', '20.1 in his first game back (11 carries, 7 targets); Carolina allows the 2nd-most RB points.', 'RB2', 'C24'],
      ['Chuba Hubbard', 'RB', '18.0 a game; Green Bay allows the 6th-most RB points.', 'RB13', 'C35'],
      ['Tetairoa McMillan', 'WR', '26% target share; Green Bay allows the 6th-most WR points.', 'WR8', 'C58'],
      ['Christian Watson', 'WR', '18.5 a game, 8 targets a game Thursday night.', 'WR13', 'C63'],
      ['Tucker Kraft', 'TE', '14.8 last week, 6.1 targets a game.', 'TE10', 'C95'],
    ],
    flex: [
      ['Jalen Coker', 'WR', '23% target share and full practice (shoulder) after 1.9 last week; Green Bay allows the 6th-most WR points.', 'WR22', 'C72'],
    ],
    watch: [
      ['Matthew Golden', 'WR', 'FLEX if active. Questionable Thursday (shoulder, foot), limited Wednesday; 9.9 targets a game.', 'WR23', 'C73'],
    ],
    sit: [
      ['Bryce Young', 'QB', '5.4 last week; Green Bay allows the 5th-fewest QB points.', null, 'C15'],
    ],
    also: 'Evan Williams (GB S) is on the IDP board. Pierre Strong Jr. and MarShawn Lloyd (Jacobs\'s handcuffs) have no ruling.',
  },
  {
    id: 'ari-dal',
    slot: 'one',
    title: 'Cardinals at Cowboys',
    kick: 'Sun 1:00p',
    when: 'Sun 1:00p ET',
    away: 'ARI',
    home: 'DAL',
    awayPts: 23.75,
    homePts: 30.75,
    line: 'DAL -7',
    total: 54.5,
    weather: '78F, wind 5, partly sunny',
    rain: false,
    read: 'A 54.5 total, tied with Baltimore at Buffalo for the highest on the slate, and Dallas is implied for 30.8, the highest team number on the board, against Arizona\'s 23.8. Arizona allows the 2nd-most QB points, so Dak Prescott is a start. Dallas allows the 6th-most QB points, which makes Jacoby Brissett a 2QB start only. Javonte Williams, CeeDee Lamb and George Pickens (limited, shoulder and hamstring) carry the Dallas offense. Trey McBride is the TE1 at a 30% target share, and Michael Wilson (limited, ribs) is a flex only if active. Jeremiyah Love is limited after missing Weeks 6 and 7, and Tyler Allgeier (toe) did not practice, so Love is a sit. Jake Ferguson is a sit after 0.0 last week.',
    fpa: 'ARI offense vs DAL D: QB 6, RB 8, WR 10, TE 17 · DAL offense vs ARI D: QB 2, RB 12, WR 13, TE 7',
    start: [
      ['Dak Prescott', 'QB', 'Dallas implied for 30.8, the highest on the slate; Arizona allows the 2nd-most QB points.', 'QB4', 'C4'],
      ['Javonte Williams', 'RB', '18.6 a game on 15.7 carries; Dallas implied for 30.8.', 'RB8', 'C30'],
      ['CeeDee Lamb', 'WR', '11.6 targets a game; Dallas implied for 30.8.', 'WR3', 'C53'],
      ['Trey McBride', 'TE', '30% target share, 27.1 last week, in a 54.5 total.', 'TE1', 'C86'],
    ],
    flex: [
    ],
    watch: [
      ['George Pickens', 'WR', 'START if active. Limited Wednesday (shoulder, hamstring); Dallas implied for 30.8.', 'WR9', 'C59'],
      ['Michael Wilson', 'WR', 'FLEX if active. Limited Wednesday (ribs); 9.4 targets a game and Dallas allows the 10th-most WR points.', 'WR17', 'C67'],
    ],
    sit: [
      ['Jacoby Brissett', 'QB', '15.4 a game; Dallas allows the 6th-most QB points in a 54.5 total, so a 2QB start only.', null, 'C18'],
      ['Jeremiyah Love', 'RB', 'Limited Wednesday (ankle) after missing Weeks 6 and 7; Tyler Allgeier (toe) did not practice either.', null, 'C48'],
      ['Jake Ferguson', 'TE', '0.0 last week, 6.4 a game, 9% target share.', null, 'C99'],
    ],
    also: 'Bam Knight (ARI RB) is behind Love and Allgeier and has no ruling. Avoid both D/STs here.',
  },
  {
    id: 'atl-tb',
    slot: 'one',
    title: 'Falcons at Buccaneers',
    kick: 'Sun 1:00p',
    when: 'Sun 1:00p ET',
    away: 'ATL',
    home: 'TB',
    awayPts: 21,
    homePts: 23.5,
    line: 'TB -2.5',
    total: 44.5,
    weather: '81F, wind 12, 71% showers and thunderstorms',
    rain: true,
    read: 'Tampa is a 2.5-point favorite implied for 23.5 against Atlanta\'s 21.0, and the weather is the story: 12 mph of wind with a 71% chance of showers and thunderstorms. Bijan Robinson is a start because Brian Robinson Jr. did not practice Wednesday and the work is his, even against Tampa\'s 3rd-fewest RB points allowed. Bucky Irving had 24 carries for 24.0 last week against the 7th-most RB points allowed, and Kenny Gainwell did not practice. Michael Penix Jr. is a sit because Tampa allows the 6th-fewest QB points. Emeka Egbuka (concussion, foot) was limited Wednesday and is a flex only if active.',
    fpa: 'ATL offense vs TB D: QB 27, RB 30, WR 22, TE 8 · TB offense vs ATL D: QB 13, RB 7, WR 11, TE 11',
    start: [
      ['Bijan Robinson', 'RB', '20.8 a game; Brian Robinson Jr. did not practice Wednesday, so the work is his against Tampa\'s 3rd-fewest RB points allowed.', 'RB6', 'C28'],
      ['Bucky Irving', 'RB', '24 carries for 24.0 last week; Atlanta allows the 7th-most RB points and Kenny Gainwell did not practice Wednesday.', 'RB11', 'C33'],
      ['Drake London', 'WR', '29% target share, 19.6 last week.', 'WR10', 'C60'],
      ['Kyle Pitts Sr.', 'TE', '23.0 and 13.2 the last two; Tampa allows the 8th-most TE points.', 'TE6', 'C91'],
      ['Tampa Bay Buccaneers', 'DEF', '29 last week; Atlanta implied for 21.0.', 'DST6', 'C105'],
    ],
    flex: [
    ],
    watch: [
      ['Emeka Egbuka', 'WR', 'FLEX if active. Limited Wednesday (concussion, foot); 26% target share.', 'WR27', 'C77'],
    ],
    sit: [
      ['Michael Penix Jr.', 'QB', '23.1 and 20.4 the last two, but Tampa allows the 6th-fewest QB points and Atlanta is implied for 21.0; QB13.', 'QB13', 'C13'],
    ],
    also: 'Sean Tucker (TB RB) is Irving\'s handcuff and has no ruling. Kendal Daniels, Jessie Bates III (ATL) and the Tampa D/ST are on the streaming boards.',
  },
  {
    id: 'bal-buf',
    slot: 'one',
    title: 'Ravens at Bills',
    kick: 'Sun 1:00p',
    when: 'Sun 1:00p ET',
    away: 'BAL',
    home: 'BUF',
    awayPts: 25.75,
    homePts: 28.75,
    line: 'BUF -3',
    total: 54.5,
    weather: '64F, wind 3, partly sunny',
    rain: false,
    read: 'A 54.5 total, tied for the highest on the slate, with Buffalo a 3-point favorite implied for 28.8 against Baltimore\'s 25.8. Lamar Jackson practiced in full Wednesday on the ankle after missing Weeks 5 to 7, so he is a start if active. Buffalo allows the most WR points, the 4th-most QB points and the 3rd-most RB points, which lifts Jackson, Zay Flowers and Derrick Henry. Josh Allen and James Cook III are starts for the home side, and Keon Coleman is a flex.',
    fpa: 'BAL offense vs BUF D: QB 4, RB 3, WR 1, TE 12 · BUF offense vs BAL D: QB 16, RB 28, WR 8, TE 20',
    start: [
      ['Josh Allen', 'QB', '26.9 a game; Buffalo implied for 28.8 in a 54.5 total, tied for the highest on the slate.', 'QB1', 'C1'],
      ['James Cook III', 'RB', '18.9 a game, Buffalo implied for 28.8; Baltimore allows the 5th-fewest RB points.', 'RB7', 'C29'],
      ['Derrick Henry', 'RB', '21 carries a game; Buffalo allows the 3rd-most RB points, though he scored 5.0 and 5.9 the last two.', 'RB10', 'C32'],
      ['Zay Flowers', 'WR', '31% target share, 27.7 last week; Buffalo allows the most WR points.', 'WR4', 'C54'],
    ],
    flex: [
      ['Keon Coleman', 'WR', 'Buffalo implied for 28.8; Baltimore allows the 8th-most WR points and DJ Moore was limited Wednesday.', 'WR29', 'C79'],
    ],
    watch: [
      ['Lamar Jackson', 'QB', 'START if active. Full practice Wednesday on the ankle after missing Weeks 5 to 7; Buffalo allows the 4th-most QB points in a 54.5 total.', 'QB6', 'C6'],
    ],
    sit: [
      ['Tyler Huntley', 'QB', 'Starts only if Lamar sits; 13.4 and 15.1 in the last two starts make him a 2QB pivot.', null, 'C6'],
    ],
    also: 'Avoid the Buffalo D/ST (3.0 a game).',
  },
  {
    id: 'cle-pit',
    slot: 'one',
    title: 'Browns at Steelers',
    kick: 'Sun 1:00p',
    when: 'Sun 1:00p ET',
    away: 'CLE',
    home: 'PIT',
    awayPts: 18,
    homePts: 21.5,
    line: 'PIT -3.5',
    total: 39.5,
    weather: '67F, wind 2, mostly cloudy',
    rain: false,
    read: 'The lowest total on the slate at 39.5. Pittsburgh is a 3.5-point favorite implied for 21.5, and Cleveland is implied for 18.0, which is why the Pittsburgh D/ST is the top defense on the board. Jaylen Warren is a start at 17.1 a game with 4.9 targets. With Pittman and Roman Wilson on IR, DK Metcalf and Germie Bernard are the Steelers receivers. Quinshon Judkins and KC Concepcion are the Cleveland flexes.',
    fpa: 'CLE offense vs PIT D: QB 29, RB 21, WR 20, TE 25 · PIT offense vs CLE D: QB 25, RB 24, WR 14, TE 13',
    start: [
      ['Jaylen Warren', 'RB', '17.1 a game with 4.9 targets.', 'RB14', 'C36'],
      ['Pittsburgh Steelers', 'DEF', 'Cleveland implied for 18.0 in a 39.5 total, the lowest on the slate.', 'DST1', 'C100'],
    ],
    flex: [
      ['Quinshon Judkins', 'RB', '23.4 last week, 15 carries a game.', 'RB19', 'C41'],
      ['DK Metcalf', 'WR', '8.3 targets a game; Pittman and Roman Wilson are on IR.', 'WR25', 'C75'],
      ['KC Concepcion', 'WR', '23.2 last week with a 22% target share.', 'WR28', 'C78'],
      ['Germie Bernard', 'WR', '6.2 targets a game; 25.7 and 5.7 the last two.', 'WR30', 'C80'],
    ],
    watch: [
    ],
    sit: [
    ],
    also: 'Harold Fannin Jr. (CLE, TE14) is ranked in the tiers without a call. Cleveland D/ST is a streamer (39.5 total). Quincy Williams (CLE LB) and Payton Wilson (PIT LB) are on the IDP board.',
  },
  {
    id: 'ind-jax',
    slot: 'one',
    title: 'Colts at Jaguars',
    kick: 'Sun 1:00p',
    when: 'Sun 1:00p ET',
    away: 'IND',
    home: 'JAX',
    awayPts: 18.25,
    homePts: 28.25,
    line: 'JAX -10',
    total: 46.5,
    weather: '74F, wind 15, 59% showers and thunderstorms likely',
    rain: true,
    read: 'The most wind on the slate: 15 mph of wind with showers and thunderstorms likely. Jacksonville is a 10-point favorite implied for 28.3 against Indianapolis at 18.3, so Trevor Lawrence, Bhayshul Tuten, Parker Washington and the Jaguars D/ST are starts. Jacksonville allows the 2nd-fewest RB points, which makes Jonathan Taylor a volume start (20 carries a game). Keenan Allen is a flex against the 5th-most WR points allowed, with Alec Pierce on IR. Tyler Warren is back at practice, limited on the groin after missing Weeks 6 and 7, and is a start if active. Brenton Strange is a sit.',
    fpa: 'IND offense vs JAX D: QB 20, RB 31, WR 5, TE 22 · JAX offense vs IND D: QB 12, RB 15, WR 25, TE 14',
    start: [
      ['Trevor Lawrence', 'QB', '27.3 before the bye; Jacksonville implied for 28.3 as a 10-point favorite.', 'QB7', 'C7'],
      ['Jonathan Taylor', 'RB', '20 carries a game, 21.1 and 19.0 the last two; Jacksonville allows the 2nd-fewest RB points, so a volume start.', 'RB5', 'C27'],
      ['Bhayshul Tuten', 'RB', '15.7 carries a game, 24.7 before the bye; Jacksonville implied for 28.3 as a 10-point favorite.', 'RB17', 'C39'],
      ['Parker Washington', 'WR', '26% target share, 15.5 a game; Jacksonville implied for 28.3.', 'WR16', 'C66'],
      ['Jacksonville Jaguars', 'DEF', '10-point favorites; Indianapolis implied for 18.3 and Daniel Jones scored 3.6 last week.', 'DST3', 'C102'],
    ],
    flex: [
      ['Keenan Allen', 'WR', 'Jacksonville allows the 5th-most WR points; Alec Pierce is on IR.', 'WR26', 'C76'],
    ],
    watch: [
      ['Tyler Warren', 'TE', 'START if active. Back at practice, limited (groin), after missing Weeks 6 and 7; 21% target share, 14.0 a game.', 'TE8', 'C93'],
    ],
    sit: [
      ['Brenton Strange', 'TE', 'Full practice; 10.0 a game; TE13.', 'TE13', 'C98'],
    ],
    also: 'Avoid the Indianapolis D/ST (3.9 a game).',
  },
  {
    id: 'lv-nyj',
    slot: 'one',
    title: 'Raiders at Jets',
    kick: 'Sun 1:00p',
    when: 'Sun 1:00p ET',
    away: 'LV',
    home: 'NYJ',
    awayPts: 22,
    homePts: 23.5,
    line: 'NYJ -1.5',
    total: 45.5,
    weather: '63F, wind 5, mostly sunny',
    rain: false,
    read: 'New York is a 1.5-point favorite implied for 23.5 against Las Vegas at 22.0. Las Vegas allows the 5th-most QB points, the 5th-most RB points and the 4th-most TE points, so Geno Smith is a 2QB start only, Braelon Allen is a flex if active and Mason Taylor is a start. Kirk Cousins is a start at QB12, and Ashton Jeanty, Tre Tucker, Omar Cooper Jr. and Brock Bowers (limited, calf) all get calls. Breece Hall was limited on the quadriceps after missing Weeks 4 to 7 and is a sit.',
    fpa: 'LV offense vs NYJ D: QB 17, RB 17, WR 19, TE 30 · NYJ offense vs LV D: QB 5, RB 5, WR 17, TE 4',
    start: [
      ['Kirk Cousins', 'QB', '18.8 a game, 18.5 and 20.4 the last two; the Jets allow the 16th-fewest QB points; QB12.', 'QB12', 'C12'],
      ['Ashton Jeanty', 'RB', '17.6 a game with a 17% target share.', 'RB12', 'C34'],
      ['Omar Cooper Jr.', 'WR', '22.3 and 22.5 the last two.', 'WR14', 'C64'],
      ['Tre Tucker', 'WR', '26.7 and 21.3 the last two.', 'WR15', 'C65'],
      ['Mason Taylor', 'TE', '25.2 last week; Las Vegas allows the 4th-most TE points.', 'TE11', 'C96'],
    ],
    flex: [
      ['Garrett Wilson', 'WR', '26% target share, but 8.4 and 4.6 the last two.', 'WR21', 'C71'],
    ],
    watch: [
      ['Braelon Allen', 'RB', 'FLEX if active. Limited Wednesday (ankle); 19.4 last week on 17 carries and 7 targets; Las Vegas allows the 5th-most RB points.', 'RB20', 'C42'],
      ['Brock Bowers', 'TE', 'START if active. Limited Wednesday (calf); 27% target share.', 'TE2', 'C87'],
    ],
    sit: [
      ['Geno Smith', 'QB', '23.5 last week but 15.0 a game; Las Vegas allows the 5th-most QB points, so a 2QB start only.', null, 'C19'],
      ['Breece Hall', 'RB', 'Limited Wednesday (quadriceps) after missing Weeks 4 to 7; three games played.', null, 'C42'],
    ],
    also: 'Isaiah Davis (NYJ RB) has no ruling. Nakobe Dean (LV LB) is on the IDP board.',
  },
  {
    id: 'min-det',
    slot: 'one',
    title: 'Vikings at Lions',
    kick: 'Sun 1:00p',
    when: 'Sun 1:00p ET',
    away: 'MIN',
    home: 'DET',
    awayPts: 21.75,
    homePts: 24.75,
    line: 'DET -3',
    total: 46.5,
    weather: 'Dome',
    rain: false,
    read: 'Indoors, with Detroit a 3-point favorite implied for 24.8 against Minnesota at 21.8. Detroit allows the most QB points (25.6 a game), the most TE points and the 3rd-most WR points, and Minnesota allows the fewest QB, RB and TE points. Kyler Murray is a streamer, not a QB1, and sits after 13.9 last week, while Justin Jefferson and T.J. Hockenson are starts. Jahmyr Gibbs and Amon-Ra St. Brown did not practice Wednesday and are starts if active; Jared Goff, Jameson Williams and Sam LaPorta are starts either way. Update since the waiver column: Aaron Jones Sr. aggravated the knee and did not practice, so Jordan Mason takes the early-down work.',
    fpa: 'MIN offense vs DET D: QB 1, RB 20, WR 3, TE 1 · DET offense vs MIN D: QB 32, RB 32, WR 29, TE 32',
    start: [
      ['Jared Goff', 'QB', '22.2 a game; Minnesota allows the fewest QB points, and Gibbs and St. Brown did not practice Wednesday.', 'QB10', 'C10'],
      ['Justin Jefferson', 'WR', '26% target share; Detroit allows the 3rd-most WR points.', 'WR11', 'C61'],
      ['Jameson Williams', 'WR', '26.1 last week; more of the passing game is his if St. Brown sits.', 'WR12', 'C62'],
      ['T.J. Hockenson', 'TE', 'Detroit allows the most TE points.', 'TE9', 'C94'],
      ['Sam LaPorta', 'TE', '13.2 a game; Minnesota allows the fewest TE points, so TE12.', 'TE12', 'C97'],
      ['Minnesota Vikings', 'DEF', '15.0 a game, the best on the slate; Gibbs and St. Brown did not practice Wednesday.', 'DST5', 'C104'],
    ],
    flex: [
      ['Jordan Mason', 'RB', 'Takes the early-down work with Jones out of practice; 15 carries last week.', 'RB24', 'C46'],
    ],
    watch: [
      ['Jahmyr Gibbs', 'RB', 'START if active. Did not practice Wednesday (shoulder); 28.5 a game on 22.3 carries, so volume beats Minnesota\'s fewest RB points allowed.', 'RB3', 'C25'],
      ['Amon-Ra St. Brown', 'WR', 'START if active. Did not practice Wednesday (ankle); 32% target share.', 'WR5', 'C55'],
    ],
    sit: [
      ['Kyler Murray', 'QB', 'Detroit allows the most QB points (25.6 a game), but he scored 13.9 last week; a streamer, not a QB1.', 'QB14', 'C14'],
      ['Aaron Jones Sr.', 'RB', 'Did not practice Wednesday (knee); 3.6 last week on 25% of the snaps.', null, 'C46'],
    ],
    also: 'Blake Cashman (MIN LB) is on the IDP board.',
  },
  {
    id: 'ten-cin',
    slot: 'one',
    title: 'Titans at Bengals',
    kick: 'Sun 1:00p',
    when: 'Sun 1:00p ET',
    away: 'TEN',
    home: 'CIN',
    awayPts: 18.25,
    homePts: 28.25,
    line: 'CIN -10',
    total: 46.5,
    weather: '68F, wind 3, 35% light rain',
    rain: true,
    read: 'Cincinnati is a 10-point favorite implied for 28.3 against Tennessee at 18.3, with a 35% chance of light rain. Joe Burrow scored 28.9 last week, Tee Higgins is a start and Ja\'Marr Chase (ankle and rest) did not practice Wednesday, so he is a start if active. Tennessee allows the 8th-most WR points. Chase Brown is a start and the Cincinnati D/ST is a start, with Cam Ward under 7 points in each of the last three. Tony Pollard scored 36.5 last week but is a flex into the 4th-fewest RB points allowed, and Carnell Tate did not practice Wednesday (shoulder) and sits. Update since the waiver column: Cincinnati lost TE Erick All to a torn ACL.',
    fpa: 'TEN offense vs CIN D: QB 18, RB 29, WR 15, TE 10 · CIN offense vs TEN D: QB 22, RB 13, WR 8, TE 23',
    start: [
      ['Joe Burrow', 'QB', '28.9 last week, 21.7 a game; Cincinnati implied for 28.3 as a 10-point favorite.', 'QB3', 'C3'],
      ['Chase Brown', 'RB', '5.5 targets a game; Cincinnati implied for 28.3 as a 10-point favorite.', 'RB16', 'C38'],
      ['Tee Higgins', 'WR', '26.8 last week on 8.3 targets a game; Tennessee allows the 8th-most WR points.', 'WR6', 'C56'],
      ['Cincinnati Bengals', 'DEF', '10-point favorites; Tennessee implied for 18.3 and Cam Ward has not reached 7 points in any of the last three.', 'DST4', 'C103'],
    ],
    flex: [
      ['Tony Pollard', 'RB', '36.5 last week on 16 carries a game; Cincinnati allows the 4th-fewest RB points and Tennessee is implied for 18.3.', 'RB18', 'C40'],
    ],
    watch: [
      ['Ja\'Marr Chase', 'WR', 'START if active. Did not practice Wednesday (ankle and rest); 23% target share against Tennessee\'s 8th-most WR points allowed.', 'WR7', 'C57'],
    ],
    sit: [
      ['Carnell Tate', 'WR', 'Did not practice Wednesday (shoulder); Tennessee implied for 18.3.', null, 'C83'],
    ],
    also: '',
  },
  {
    id: 'lac-lar',
    slot: 'late',
    title: 'Chargers at Rams',
    kick: 'Sun 4:05p',
    when: 'Sun 4:05p ET',
    away: 'LAC',
    home: 'LAR',
    awayPts: 19.5,
    homePts: 26,
    line: 'LAR -6.5',
    total: 45.5,
    weather: 'Dome',
    rain: false,
    read: 'Indoors, with the Rams a 6.5-point favorite implied for 26.0 against 19.5. The Chargers allow the 9th-most RB points, so Kyren Williams is a start at 19.7 a game with 5.9 targets. Davante Adams is on IR after hamstring surgery, which the Rams put at 6 to 10 weeks, so Puka Nacua carries the passing game at a 32% target share. Matthew Stafford is a start, and Blake Corum is the No. 2 behind Williams and sits. Nobody from the Chargers is called.',
    fpa: 'LAC offense vs LAR D: QB 15, RB 19, WR 28, TE 29 · LAR offense vs LAC D: QB 26, RB 9, WR 21, TE 24',
    start: [
      ['Matthew Stafford', 'QB', '17.6 a game, Los Angeles implied for 26.0; Puka Nacua carries the passing game with Davante Adams on IR.', 'QB11', 'C11'],
      ['Kyren Williams', 'RB', '19.7 a game with 5.9 targets; the Chargers allow the 9th-most RB points.', 'RB4', 'C26'],
      ['Puka Nacua', 'WR', '32% target share, 12.4 targets a game; Davante Adams is on IR after surgery.', 'WR2', 'C52'],
    ],
    flex: [
    ],
    watch: [
    ],
    sit: [
      ['Blake Corum', 'RB', '14.0 and 17.1 the last two on 9 carries a game; the No. 2 behind Kyren Williams.', null, 'C50'],
      ['Davante Adams', 'WR', 'OUT. On IR after hamstring surgery; the engine still projects 15.0.', 'OUT', 'C84'],
    ],
    also: 'Davante Adams is out; the engine still projects 15.0, so ignore it.',
  },
  {
    id: 'kc-den',
    slot: 'late',
    title: 'Chiefs at Broncos',
    kick: 'Sun 4:25p',
    when: 'Sun 4:25p ET',
    away: 'KC',
    home: 'DEN',
    awayPts: 21,
    homePts: 19.5,
    line: 'KC -1.5',
    total: 40.5,
    weather: '63F, wind 6, mostly cloudy',
    rain: false,
    read: 'Tied for the tightest line on the board: Kansas City is a 1.5-point favorite implied for 21.0 against Denver at 19.5 in a 40.5 total. Kenneth Walker III is a start at 24.6 a game on 20 carries into the 10th-most RB points allowed, and Travis Kelce is a start (full practice) against the 8th-most TE points allowed. Everyone else is hard to trust. Patrick Mahomes scored 10.5 and 6.0 the last two weeks, Bo Nix scored 26.2 last week after 4.5 and faces the 3rd-fewest QB points allowed, and Jaylen Waddle did not practice Wednesday (chest) against the 2nd-fewest WR points allowed. RJ Harvey is a flex.',
    fpa: 'KC offense vs DEN D: QB 24, RB 10, WR 27, TE 8 · DEN offense vs KC D: QB 30, RB 25, WR 31, TE 5',
    start: [
      ['Kenneth Walker III', 'RB', '24.6 a game on 20 carries; Denver allows the 10th-most RB points.', 'RB1', 'C23'],
      ['Travis Kelce', 'TE', '19% target share, full practice; Denver allows the 8th-most TE points.', 'TE7', 'C92'],
    ],
    flex: [
      ['RJ Harvey', 'RB', '14.6 and 14.0 the last two with a 15% target share.', 'RB23', 'C45'],
    ],
    watch: [
    ],
    sit: [
      ['Patrick Mahomes', 'QB', '10.5 and 6.0 the last two; Kansas City implied for 21.0 at Denver.', null, 'C16'],
      ['Bo Nix', 'QB', '26.2 last week after 4.5 the week before; Kansas City allows the 3rd-fewest QB points.', null, 'C17'],
      ['Jaylen Waddle', 'WR', 'Did not practice Wednesday (chest); 9.1 a game and Kansas City allows the 2nd-fewest WR points.', null, 'C82'],
    ],
    also: 'Rashee Rice (KC WR) has no ruling; check him on the 4:25p inactives. Kansas City D/ST at Denver (8.8 a game) and Denver D/ST against Kansas City are streamers. Alex Singleton (DEN LB) is on the IDP board.',
  },
  {
    id: 'ne-mia',
    slot: 'late',
    title: 'Patriots at Dolphins',
    kick: 'Sun 4:25p',
    when: 'Sun 4:25p ET',
    away: 'NE',
    home: 'MIA',
    awayPts: 25.25,
    homePts: 18.25,
    line: 'NE -7',
    total: 43.5,
    weather: '82F, wind 13, 78% showers and thunderstorms',
    rain: true,
    read: 'New England is a 7-point favorite implied for 25.3 against Miami at 18.3, with 13 mph of wind and a 78% chance of showers and thunderstorms. Miami allows the 7th-most QB points, the 4th-most RB points and the 3rd-most TE points, so Drake Maye, Rhamondre Stevenson and Hunter Henry are starts, and the Patriots D/ST is a start. Miami allows the 3rd-fewest WR points, which is why A.J. Brown (limited, knee and ankle) is a sit. With De\'Von Achane on IR, Ollie Gordon II and Caleb Douglas are the Miami flexes, and Malik Willis sits despite 26.0 last week because Miami is implied for only 18.3.',
    fpa: 'NE offense vs MIA D: QB 7, RB 4, WR 30, TE 3 · MIA offense vs NE D: QB 23, RB 22, WR 12, TE 21',
    start: [
      ['Drake Maye', 'QB', '23.8 and 27.4 the last two, full practice; Miami allows the 7th-most QB points and New England is a 7-point favorite.', 'QB2', 'C2'],
      ['Rhamondre Stevenson', 'RB', '22.5 last week; Miami allows the 4th-most RB points and New England is a 7-point favorite.', 'RB15', 'C37'],
      ['Hunter Henry', 'TE', '14.8 and 14.1 the last two; Miami allows the 3rd-most TE points.', 'TE3', 'C88'],
      ['New England Patriots', 'DEF', 'Miami implied for 18.3 as a 7-point underdog.', 'DST7', 'C106'],
    ],
    flex: [
      ['Ollie Gordon II', 'RB', '14.4 carries a game and 17.3 last week; De\'Von Achane is on IR.', 'RB21', 'C43'],
      ['Caleb Douglas', 'WR', '21.0 last week.', 'WR24', 'C74'],
    ],
    watch: [
    ],
    sit: [
      ['Malik Willis', 'QB', '26.0 last week on 5.8 carries a game, but Miami is implied for 18.3.', null, 'C21'],
      ['A.J. Brown', 'WR', 'Limited Wednesday (knee, ankle); 6.4 a game and Miami allows the 3rd-fewest WR points.', null, 'C81'],
    ],
    also: 'Avoid the Miami D/ST (3.2 a game).',
  },
  {
    id: 'phi-was',
    slot: 'prime',
    title: 'Eagles at Commanders',
    kick: 'Sun 8:20p',
    when: 'Sunday Night · 8:20p ET',
    away: 'PHI',
    home: 'WAS',
    awayPts: 17.25,
    homePts: 23.25,
    line: 'WAS -6',
    total: 40.5,
    weather: '56F, wind 3, mostly cloudy',
    rain: false,
    read: 'Sunday night in Washington, a 6-point favorite implied for 23.3 against Philadelphia at 17.3, the lowest implied total on the slate. Philadelphia allows the 9th-most QB points and the 2nd-most WR points, and Washington allows the 2nd-most TE points, so Jayden Daniels and Dallas Goedert are starts. Tanner McKee scored 12.6 and 10.5 in his two starts and sits. Jalen Hurts is on IR with a calf injury and expected to miss the season. Terry McLaurin went on IR Wednesday, and so did Dameon Pierce. Stefon Diggs (did not practice) and DeVonta Smith and Saquon Barkley (both missed Wednesday\'s walkthrough) all turn on the inactives.',
    fpa: 'PHI offense vs WAS D: QB 3, RB 26, WR 7, TE 2 · WAS offense vs PHI D: QB 9, RB 16, WR 2, TE 28',
    start: [
      ['Jayden Daniels', 'QB', '21.4 a game in four starts with 6.3 carries, full practice (elbow); Philadelphia allows the 9th-most QB points.', 'QB5', 'C5'],
      ['Dallas Goedert', 'TE', 'Full practice while Smith and Wicks missed the walkthrough; Washington allows the 2nd-most TE points.', 'TE4', 'C89'],
      ['Washington Commanders', 'DEF', 'Philadelphia implied for 17.3, the lowest on the slate, with McKee starting.', 'DST8', 'C107'],
    ],
    flex: [
      ['Rachaad White', 'RB', 'The lead back with Jacory Croskey-Merritt on IR; 15.7 in Week 6 before the bye, and Washington is a 6-point favorite.', 'RB22', 'C44'],
    ],
    watch: [
      ['Stefon Diggs', 'WR', 'FLEX if active. Did not practice Wednesday (hand, hamstring, rest); Terry McLaurin is on IR and Philadelphia allows the 2nd-most WR points.', 'WR19', 'C69'],
      ['DeVonta Smith', 'WR', 'FLEX if active. Missed Wednesday\'s walkthrough (hamstring); 32% target share, but Philadelphia is implied for 17.3.', 'WR20', 'C70'],
    ],
    sit: [
      ['Tanner McKee', 'QB', '12.6 and 10.5 in his two starts; Philadelphia implied for 17.3, the lowest on the slate.', null, 'C20'],
      ['Jalen Hurts', 'QB', 'OUT. On IR (calf), expected to miss the season; the engine still projects 18.5.', 'OUT', 'C22'],
      ['Saquon Barkley', 'RB', 'Missed Wednesday\'s walkthrough (hamstring, back); 7.6 a game on 15% of the snaps last week.', null, 'C47'],
      ['Terry McLaurin', 'WR', 'OUT. Placed on IR Wednesday (knee); the engine still projects 11.0.', 'OUT', 'C85'],
    ],
    also: 'Elijah Mitchell (PHI RB) is Barkley\'s handcuff and has no ruling; Dameon Pierce, Tank Bigsby and Will Shipley are all on IR.',
  },
  {
    id: 'chi-sea',
    slot: 'prime',
    title: 'Bears at Seahawks',
    kick: 'Mon 8:15p',
    when: 'Monday Night · 8:15p ET',
    away: 'CHI',
    home: 'SEA',
    awayPts: 21.75,
    homePts: 24.75,
    line: 'SEA -3',
    total: 46.5,
    weather: '51F, wind 2, partly sunny',
    rain: false,
    read: 'Monday night is the last window, so there is no later swap. Seattle is a 3-point favorite implied for 24.8 against Chicago at 21.8. Jaxon Smith-Njigba owns a 37% target share and the Seahawks D/ST is a start. Seattle allows the 2nd-fewest QB points and the fewest WR points, so Caleb Williams is a low-end QB1 and Luther Burden III is a flex. D\'Andre Swift is a start with Kyle Monangai on a stationary bike Wednesday (thumb, toe), and Colston Loveland is a start with Cole Kmet on IR.',
    fpa: 'CHI offense vs SEA D: QB 31, RB 18, WR 32, TE 27 · SEA offense vs CHI D: QB 10, RB 27, WR 23, TE 16',
    start: [
      ['Caleb Williams', 'QB', '20.9 a game with 6 carries, 22.1 last week; Seattle allows the 2nd-fewest QB points, so a low-end QB1.', 'QB9', 'C9'],
      ['D\'Andre Swift', 'RB', '22 carries last week (19.0), 17.5 a game; Kyle Monangai was on a bike Wednesday.', 'RB9', 'C31'],
      ['Jaxon Smith-Njigba', 'WR', '37% target share, 28.2 a game.', 'WR1', 'C51'],
      ['Colston Loveland', 'TE', '18.5 and 19.9 the last two with Cole Kmet on IR.', 'TE5', 'C90'],
      ['Seattle Seahawks', 'DEF', '12.3 a game; Chicago implied for 21.8.', 'DST2', 'C101'],
    ],
    flex: [
      ['Luther Burden III', 'WR', '17.5 and 23.7 the last two; Seattle allows the fewest WR points.', 'WR18', 'C68'],
    ],
    watch: [
    ],
    sit: [
      ['Kyle Monangai', 'RB', 'On a stationary bike Wednesday (thumb, toe); Swift has the work.', null, 'C49'],
    ],
    also: 'Zach Charbonnet (SEA RB) is an engine placeholder (10.5 with no snaps this season) and has no ruling. Roschon Johnson (CHI RB) is Swift\'s handcuff and has no ruling.',
  },
];

const QB_ROWS = [
  [1, 'Josh Allen', 'BUF', '26.9 a game; Buffalo implied for 28.8 in a 54.5 total, tied for the highest on the slate', 'start'],
  [2, 'Drake Maye', 'NE', '23.8 and 27.4 the last two, full practice; Miami allows the 7th-most QB points and New England is a 7-point favorite', 'start'],
  [3, 'Joe Burrow', 'CIN', '28.9 last week, 21.7 a game; Cincinnati implied for 28.3 as a 10-point favorite', 'start'],
  [4, 'Dak Prescott', 'DAL', 'Dallas implied for 30.8, the highest on the slate; Arizona allows the 2nd-most QB points', 'start'],
  [5, 'Jayden Daniels', 'WAS', '21.4 a game in four starts with 6.3 carries, full practice (elbow); Philadelphia allows the 9th-most QB points', 'start'],
  [6, 'Lamar Jackson', 'BAL', 'If active. Full practice Wednesday on the ankle after missing Weeks 5 to 7; Buffalo allows the 4th-most QB points in a 54.5 total', 'start'],
  [7, 'Trevor Lawrence', 'JAX', '27.3 before the bye; Jacksonville implied for 28.3 as a 10-point favorite', 'start'],
  [8, 'Jordan Love', 'GB', '18.3 a game; Green Bay implied for 25.5 Thursday against Carolina, 14th-fewest QB points allowed', 'start'],
  [9, 'Caleb Williams', 'CHI', '20.9 a game with 6 carries, 22.1 last week; Seattle allows the 2nd-fewest QB points, so a low-end QB1', 'start'],
  [10, 'Jared Goff', 'DET', '22.2 a game; Minnesota allows the fewest QB points, and Gibbs and St. Brown did not practice Wednesday', 'start'],
  [11, 'Matthew Stafford', 'LAR', '17.6 a game, Los Angeles implied for 26.0; Puka Nacua carries the passing game with Davante Adams on IR', 'start'],
  [12, 'Kirk Cousins', 'LV', '18.8 a game, 18.5 and 20.4 the last two; the Jets allow the 16th-fewest QB points; QB12', 'start'],
  [13, 'Michael Penix Jr.', 'ATL', '23.1 and 20.4 the last two, but Tampa allows the 6th-fewest QB points and Atlanta is implied for 21.0; QB13', 'sit'],
  [14, 'Kyler Murray', 'MIN', 'Detroit allows the most QB points (25.6 a game), but he scored 13.9 last week; a streamer, not a QB1', 'sit'],
];

const RB_ROWS = [
  [1, 'Kenneth Walker III', 'KC', '24.6 a game on 20 carries; Denver allows the 10th-most RB points', 'start'],
  [2, 'Josh Jacobs', 'GB', '20.1 in his first game back (11 carries, 7 targets); Carolina allows the 2nd-most RB points', 'start'],
  [3, 'Jahmyr Gibbs', 'DET', 'If active. Did not practice Wednesday (shoulder); 28.5 a game on 22.3 carries, so volume beats Minnesota\'s fewest RB points allowed', 'start'],
  [4, 'Kyren Williams', 'LAR', '19.7 a game with 5.9 targets; the Chargers allow the 9th-most RB points', 'start'],
  [5, 'Jonathan Taylor', 'IND', '20 carries a game, 21.1 and 19.0 the last two; Jacksonville allows the 2nd-fewest RB points, so a volume start', 'start'],
  [6, 'Bijan Robinson', 'ATL', '20.8 a game; Brian Robinson Jr. did not practice Wednesday, so the work is his against Tampa\'s 3rd-fewest RB points allowed', 'start'],
  [7, 'James Cook III', 'BUF', '18.9 a game, Buffalo implied for 28.8; Baltimore allows the 5th-fewest RB points', 'start'],
  [8, 'Javonte Williams', 'DAL', '18.6 a game on 15.7 carries; Dallas implied for 30.8', 'start'],
  [9, 'D\'Andre Swift', 'CHI', '22 carries last week (19.0), 17.5 a game; Kyle Monangai was on a bike Wednesday', 'start'],
  [10, 'Derrick Henry', 'BAL', '21 carries a game; Buffalo allows the 3rd-most RB points, though he scored 5.0 and 5.9 the last two', 'start'],
  [11, 'Bucky Irving', 'TB', '24 carries for 24.0 last week; Atlanta allows the 7th-most RB points and Kenny Gainwell did not practice Wednesday', 'start'],
  [12, 'Ashton Jeanty', 'LV', '17.6 a game with a 17% target share', 'start'],
  [13, 'Chuba Hubbard', 'CAR', '18.0 a game; Green Bay allows the 6th-most RB points', 'start'],
  [14, 'Jaylen Warren', 'PIT', '17.1 a game with 4.9 targets', 'start'],
  [15, 'Rhamondre Stevenson', 'NE', '22.5 last week; Miami allows the 4th-most RB points and New England is a 7-point favorite', 'start'],
  [16, 'Chase Brown', 'CIN', '5.5 targets a game; Cincinnati implied for 28.3 as a 10-point favorite', 'start'],
  [17, 'Bhayshul Tuten', 'JAX', '15.7 carries a game, 24.7 before the bye; Jacksonville implied for 28.3 as a 10-point favorite', 'start'],
  [18, 'Tony Pollard', 'TEN', '36.5 last week on 16 carries a game; Cincinnati allows the 4th-fewest RB points and Tennessee is implied for 18.3', 'flex'],
  [19, 'Quinshon Judkins', 'CLE', '23.4 last week, 15 carries a game', 'flex'],
  [20, 'Braelon Allen', 'NYJ', 'If active. Limited Wednesday (ankle); 19.4 last week on 17 carries and 7 targets; Las Vegas allows the 5th-most RB points', 'flex'],
  [21, 'Ollie Gordon II', 'MIA', '14.4 carries a game and 17.3 last week; De\'Von Achane is on IR', 'flex'],
  [22, 'Rachaad White', 'WAS', 'The lead back with Jacory Croskey-Merritt on IR; 15.7 in Week 6 before the bye, and Washington is a 6-point favorite', 'flex'],
  [23, 'RJ Harvey', 'DEN', '14.6 and 14.0 the last two with a 15% target share', 'flex'],
  [24, 'Jordan Mason', 'MIN', 'Takes the early-down work with Jones out of practice; 15 carries last week', 'flex'],
];

const WR_ROWS = [
  [1, 'Jaxon Smith-Njigba', 'SEA', '37% target share, 28.2 a game', 'start'],
  [2, 'Puka Nacua', 'LAR', '32% target share, 12.4 targets a game; Davante Adams is on IR after surgery', 'start'],
  [3, 'CeeDee Lamb', 'DAL', '11.6 targets a game; Dallas implied for 30.8', 'start'],
  [4, 'Zay Flowers', 'BAL', '31% target share, 27.7 last week; Buffalo allows the most WR points', 'start'],
  [5, 'Amon-Ra St. Brown', 'DET', 'If active. Did not practice Wednesday (ankle); 32% target share', 'start'],
  [6, 'Tee Higgins', 'CIN', '26.8 last week on 8.3 targets a game; Tennessee allows the 8th-most WR points', 'start'],
  [7, 'Ja\'Marr Chase', 'CIN', 'If active. Did not practice Wednesday (ankle and rest); 23% target share against Tennessee\'s 8th-most WR points allowed', 'start'],
  [8, 'Tetairoa McMillan', 'CAR', '26% target share; Green Bay allows the 6th-most WR points', 'start'],
  [9, 'George Pickens', 'DAL', 'If active. Limited Wednesday (shoulder, hamstring); Dallas implied for 30.8', 'start'],
  [10, 'Drake London', 'ATL', '29% target share, 19.6 last week', 'start'],
  [11, 'Justin Jefferson', 'MIN', '26% target share; Detroit allows the 3rd-most WR points', 'start'],
  [12, 'Jameson Williams', 'DET', '26.1 last week; more of the passing game is his if St. Brown sits', 'start'],
  [13, 'Christian Watson', 'GB', '18.5 a game, 8 targets a game Thursday night', 'start'],
  [14, 'Omar Cooper Jr.', 'NYJ', '22.3 and 22.5 the last two', 'start'],
  [15, 'Tre Tucker', 'LV', '26.7 and 21.3 the last two', 'start'],
  [16, 'Parker Washington', 'JAX', '26% target share, 15.5 a game; Jacksonville implied for 28.3', 'start'],
  [17, 'Michael Wilson', 'ARI', 'If active. Limited Wednesday (ribs); 9.4 targets a game and Dallas allows the 10th-most WR points', 'flex'],
  [18, 'Luther Burden III', 'CHI', '17.5 and 23.7 the last two; Seattle allows the fewest WR points', 'flex'],
  [19, 'Stefon Diggs', 'WAS', 'If active. Did not practice Wednesday (hand, hamstring, rest); Terry McLaurin is on IR and Philadelphia allows the 2nd-most WR points', 'flex'],
  [20, 'DeVonta Smith', 'PHI', 'If active. Missed Wednesday\'s walkthrough (hamstring); 32% target share, but Philadelphia is implied for 17.3', 'flex'],
  [21, 'Garrett Wilson', 'NYJ', '26% target share, but 8.4 and 4.6 the last two', 'flex'],
  [22, 'Jalen Coker', 'CAR', '23% target share and full practice (shoulder) after 1.9 last week; Green Bay allows the 6th-most WR points', 'flex'],
  [23, 'Matthew Golden', 'GB', 'If active. Questionable Thursday (shoulder, foot), limited Wednesday; 9.9 targets a game', 'flex'],
  [24, 'Caleb Douglas', 'MIA', '21.0 last week', 'flex'],
  [25, 'DK Metcalf', 'PIT', '8.3 targets a game; Pittman and Roman Wilson are on IR', 'flex'],
  [26, 'Keenan Allen', 'IND', 'Jacksonville allows the 5th-most WR points; Alec Pierce is on IR', 'flex'],
  [27, 'Emeka Egbuka', 'TB', 'If active. Limited Wednesday (concussion, foot); 26% target share', 'flex'],
  [28, 'KC Concepcion', 'CLE', '23.2 last week with a 22% target share', 'flex'],
  [29, 'Keon Coleman', 'BUF', 'Buffalo implied for 28.8; Baltimore allows the 8th-most WR points and DJ Moore was limited Wednesday', 'flex'],
  [30, 'Germie Bernard', 'PIT', '6.2 targets a game; 25.7 and 5.7 the last two', 'flex'],
];

const TE_ROWS = [
  [1, 'Trey McBride', 'ARI', '30% target share, 27.1 last week, in a 54.5 total', 'start'],
  [2, 'Brock Bowers', 'LV', 'If active. Limited Wednesday (calf); 27% target share', 'start'],
  [3, 'Hunter Henry', 'NE', '14.8 and 14.1 the last two; Miami allows the 3rd-most TE points', 'start'],
  [4, 'Dallas Goedert', 'PHI', 'Full practice while Smith and Wicks missed the walkthrough; Washington allows the 2nd-most TE points', 'start'],
  [5, 'Colston Loveland', 'CHI', '18.5 and 19.9 the last two with Cole Kmet on IR', 'start'],
  [6, 'Kyle Pitts Sr.', 'ATL', '23.0 and 13.2 the last two; Tampa allows the 8th-most TE points', 'start'],
  [7, 'Travis Kelce', 'KC', '19% target share, full practice; Denver allows the 8th-most TE points', 'start'],
  [8, 'Tyler Warren', 'IND', 'If active. Back at practice, limited (groin), after missing Weeks 6 and 7; 21% target share, 14.0 a game', 'start'],
  [9, 'T.J. Hockenson', 'MIN', 'Detroit allows the most TE points', 'start'],
  [10, 'Tucker Kraft', 'GB', '14.8 last week, 6.1 targets a game', 'start'],
  [11, 'Mason Taylor', 'NYJ', '25.2 last week; Las Vegas allows the 4th-most TE points', 'start'],
  [12, 'Sam LaPorta', 'DET', '13.2 a game; Minnesota allows the fewest TE points, so TE12', 'start'],
  [13, 'Brenton Strange', 'JAX', 'Full practice; 10.0 a game; TE13', 'sit'],
  [14, 'Harold Fannin Jr.', 'CLE', '', 'rank'],
];

const DST_ROWS = [
  [1, 'Pittsburgh Steelers', 'PIT', 'Cleveland implied for 18.0 in a 39.5 total, the lowest on the slate', 'start'],
  [2, 'Seattle Seahawks', 'SEA', '12.3 a game; Chicago implied for 21.8', 'start'],
  [3, 'Jacksonville Jaguars', 'JAX', '10-point favorites; Indianapolis implied for 18.3 and Daniel Jones scored 3.6 last week', 'start'],
  [4, 'Cincinnati Bengals', 'CIN', '10-point favorites; Tennessee implied for 18.3 and Cam Ward has not reached 7 points in any of the last three', 'start'],
  [5, 'Minnesota Vikings', 'MIN', '15.0 a game, the best on the slate; Gibbs and St. Brown did not practice Wednesday', 'start'],
  [6, 'Tampa Bay Buccaneers', 'TB', '29 last week; Atlanta implied for 21.0', 'start'],
  [7, 'New England Patriots', 'NE', 'Miami implied for 18.3 as a 7-point underdog', 'start'],
  [8, 'Washington Commanders', 'WAS', 'Philadelphia implied for 17.3, the lowest on the slate, with McKee starting', 'start'],
];

const RULINGS = [
  [
    'C1',
    [
      ['Josh Allen', 'QB', 'BUF', 'START', '26.9 a game; Buffalo implied for 28.8 in a 54.5 total, tied for the highest on the slate.'],
    ],
  ],
  [
    'C2',
    [
      ['Drake Maye', 'QB', 'NE', 'START', '23.8 and 27.4 the last two, full practice; Miami allows the 7th-most QB points and New England is a 7-point favorite.'],
    ],
  ],
  [
    'C3',
    [
      ['Joe Burrow', 'QB', 'CIN', 'START', '28.9 last week, 21.7 a game; Cincinnati implied for 28.3 as a 10-point favorite.'],
    ],
  ],
  [
    'C4',
    [
      ['Dak Prescott', 'QB', 'DAL', 'START', 'Dallas implied for 30.8, the highest on the slate; Arizona allows the 2nd-most QB points.'],
    ],
  ],
  [
    'C5',
    [
      ['Jayden Daniels', 'QB', 'WAS', 'START', '21.4 a game in four starts with 6.3 carries, full practice (elbow); Philadelphia allows the 9th-most QB points.'],
    ],
  ],
  [
    'C6',
    [
      ['Lamar Jackson', 'QB', 'BAL', 'START if active', 'Full practice Wednesday on the ankle after missing Weeks 5 to 7; Buffalo allows the 4th-most QB points in a 54.5 total.'],
      ['Tyler Huntley', 'QB', 'BAL', 'SIT', 'Starts only if Lamar sits; 13.4 and 15.1 in the last two starts make him a 2QB pivot.'],
    ],
  ],
  [
    'C7',
    [
      ['Trevor Lawrence', 'QB', 'JAX', 'START', '27.3 before the bye; Jacksonville implied for 28.3 as a 10-point favorite.'],
    ],
  ],
  [
    'C8',
    [
      ['Jordan Love', 'QB', 'GB', 'START', '18.3 a game; Green Bay implied for 25.5 Thursday against Carolina, 14th-fewest QB points allowed.'],
    ],
  ],
  [
    'C9',
    [
      ['Caleb Williams', 'QB', 'CHI', 'START', '20.9 a game with 6 carries, 22.1 last week; Seattle allows the 2nd-fewest QB points, so a low-end QB1.'],
    ],
  ],
  [
    'C10',
    [
      ['Jared Goff', 'QB', 'DET', 'START', '22.2 a game; Minnesota allows the fewest QB points, and Gibbs and St. Brown did not practice Wednesday.'],
    ],
  ],
  [
    'C11',
    [
      ['Matthew Stafford', 'QB', 'LAR', 'START', '17.6 a game, Los Angeles implied for 26.0; Puka Nacua carries the passing game with Davante Adams on IR.'],
    ],
  ],
  [
    'C12',
    [
      ['Kirk Cousins', 'QB', 'LV', 'START', '18.8 a game, 18.5 and 20.4 the last two; the Jets allow the 16th-fewest QB points; QB12.'],
    ],
  ],
  [
    'C13',
    [
      ['Michael Penix Jr.', 'QB', 'ATL', 'SIT', '23.1 and 20.4 the last two, but Tampa allows the 6th-fewest QB points and Atlanta is implied for 21.0; QB13.'],
    ],
  ],
  [
    'C14',
    [
      ['Kyler Murray', 'QB', 'MIN', 'SIT', 'Detroit allows the most QB points (25.6 a game), but he scored 13.9 last week; a streamer, not a QB1.'],
    ],
  ],
  [
    'C15',
    [
      ['Bryce Young', 'QB', 'CAR', 'SIT', '5.4 last week; Green Bay allows the 5th-fewest QB points.'],
    ],
  ],
  [
    'C16',
    [
      ['Patrick Mahomes', 'QB', 'KC', 'SIT', '10.5 and 6.0 the last two; Kansas City implied for 21.0 at Denver.'],
    ],
  ],
  [
    'C17',
    [
      ['Bo Nix', 'QB', 'DEN', 'SIT', '26.2 last week after 4.5 the week before; Kansas City allows the 3rd-fewest QB points.'],
    ],
  ],
  [
    'C18',
    [
      ['Jacoby Brissett', 'QB', 'ARI', 'SIT', '15.4 a game; Dallas allows the 6th-most QB points in a 54.5 total, so a 2QB start only.'],
    ],
  ],
  [
    'C19',
    [
      ['Geno Smith', 'QB', 'NYJ', 'SIT', '23.5 last week but 15.0 a game; Las Vegas allows the 5th-most QB points, so a 2QB start only.'],
    ],
  ],
  [
    'C20',
    [
      ['Tanner McKee', 'QB', 'PHI', 'SIT', '12.6 and 10.5 in his two starts; Philadelphia implied for 17.3, the lowest on the slate.'],
    ],
  ],
  [
    'C21',
    [
      ['Malik Willis', 'QB', 'MIA', 'SIT', '26.0 last week on 5.8 carries a game, but Miami is implied for 18.3.'],
    ],
  ],
  [
    'C22',
    [
      ['Jalen Hurts', 'QB', 'PHI', 'OUT', 'On IR (calf), expected to miss the season; the engine still projects 18.5.'],
    ],
  ],
  [
    'C23',
    [
      ['Kenneth Walker III', 'RB', 'KC', 'START', '24.6 a game on 20 carries; Denver allows the 10th-most RB points.'],
    ],
  ],
  [
    'C24',
    [
      ['Josh Jacobs', 'RB', 'GB', 'START', '20.1 in his first game back (11 carries, 7 targets); Carolina allows the 2nd-most RB points.'],
    ],
  ],
  [
    'C25',
    [
      ['Jahmyr Gibbs', 'RB', 'DET', 'START if active', 'Did not practice Wednesday (shoulder); 28.5 a game on 22.3 carries, so volume beats Minnesota\'s fewest RB points allowed.'],
    ],
  ],
  [
    'C26',
    [
      ['Kyren Williams', 'RB', 'LAR', 'START', '19.7 a game with 5.9 targets; the Chargers allow the 9th-most RB points.'],
    ],
  ],
  [
    'C27',
    [
      ['Jonathan Taylor', 'RB', 'IND', 'START', '20 carries a game, 21.1 and 19.0 the last two; Jacksonville allows the 2nd-fewest RB points, so a volume start.'],
    ],
  ],
  [
    'C28',
    [
      ['Bijan Robinson', 'RB', 'ATL', 'START', '20.8 a game; Brian Robinson Jr. did not practice Wednesday, so the work is his against Tampa\'s 3rd-fewest RB points allowed.'],
    ],
  ],
  [
    'C29',
    [
      ['James Cook III', 'RB', 'BUF', 'START', '18.9 a game, Buffalo implied for 28.8; Baltimore allows the 5th-fewest RB points.'],
    ],
  ],
  [
    'C30',
    [
      ['Javonte Williams', 'RB', 'DAL', 'START', '18.6 a game on 15.7 carries; Dallas implied for 30.8.'],
    ],
  ],
  [
    'C31',
    [
      ['D\'Andre Swift', 'RB', 'CHI', 'START', '22 carries last week (19.0), 17.5 a game; Kyle Monangai was on a bike Wednesday.'],
    ],
  ],
  [
    'C32',
    [
      ['Derrick Henry', 'RB', 'BAL', 'START', '21 carries a game; Buffalo allows the 3rd-most RB points, though he scored 5.0 and 5.9 the last two.'],
    ],
  ],
  [
    'C33',
    [
      ['Bucky Irving', 'RB', 'TB', 'START', '24 carries for 24.0 last week; Atlanta allows the 7th-most RB points and Kenny Gainwell did not practice Wednesday.'],
    ],
  ],
  [
    'C34',
    [
      ['Ashton Jeanty', 'RB', 'LV', 'START', '17.6 a game with a 17% target share.'],
    ],
  ],
  [
    'C35',
    [
      ['Chuba Hubbard', 'RB', 'CAR', 'START', '18.0 a game; Green Bay allows the 6th-most RB points.'],
    ],
  ],
  [
    'C36',
    [
      ['Jaylen Warren', 'RB', 'PIT', 'START', '17.1 a game with 4.9 targets.'],
    ],
  ],
  [
    'C37',
    [
      ['Rhamondre Stevenson', 'RB', 'NE', 'START', '22.5 last week; Miami allows the 4th-most RB points and New England is a 7-point favorite.'],
    ],
  ],
  [
    'C38',
    [
      ['Chase Brown', 'RB', 'CIN', 'START', '5.5 targets a game; Cincinnati implied for 28.3 as a 10-point favorite.'],
    ],
  ],
  [
    'C39',
    [
      ['Bhayshul Tuten', 'RB', 'JAX', 'START', '15.7 carries a game, 24.7 before the bye; Jacksonville implied for 28.3 as a 10-point favorite.'],
    ],
  ],
  [
    'C40',
    [
      ['Tony Pollard', 'RB', 'TEN', 'FLEX', '36.5 last week on 16 carries a game; Cincinnati allows the 4th-fewest RB points and Tennessee is implied for 18.3.'],
    ],
  ],
  [
    'C41',
    [
      ['Quinshon Judkins', 'RB', 'CLE', 'FLEX', '23.4 last week, 15 carries a game.'],
    ],
  ],
  [
    'C42',
    [
      ['Breece Hall', 'RB', 'NYJ', 'SIT', 'Limited Wednesday (quadriceps) after missing Weeks 4 to 7; three games played.'],
      ['Braelon Allen', 'RB', 'NYJ', 'FLEX if active', 'Limited Wednesday (ankle); 19.4 last week on 17 carries and 7 targets; Las Vegas allows the 5th-most RB points.'],
    ],
  ],
  [
    'C43',
    [
      ['Ollie Gordon II', 'RB', 'MIA', 'FLEX', '14.4 carries a game and 17.3 last week; De\'Von Achane is on IR.'],
    ],
  ],
  [
    'C44',
    [
      ['Rachaad White', 'RB', 'WAS', 'FLEX', 'The lead back with Jacory Croskey-Merritt on IR; 15.7 in Week 6 before the bye, and Washington is a 6-point favorite.'],
    ],
  ],
  [
    'C45',
    [
      ['RJ Harvey', 'RB', 'DEN', 'FLEX', '14.6 and 14.0 the last two with a 15% target share.'],
    ],
  ],
  [
    'C46',
    [
      ['Aaron Jones Sr.', 'RB', 'MIN', 'SIT', 'Did not practice Wednesday (knee); 3.6 last week on 25% of the snaps.'],
      ['Jordan Mason', 'RB', 'MIN', 'FLEX', 'Takes the early-down work with Jones out of practice; 15 carries last week.'],
    ],
  ],
  [
    'C47',
    [
      ['Saquon Barkley', 'RB', 'PHI', 'SIT', 'Missed Wednesday\'s walkthrough (hamstring, back); 7.6 a game on 15% of the snaps last week.'],
    ],
  ],
  [
    'C48',
    [
      ['Jeremiyah Love', 'RB', 'ARI', 'SIT', 'Limited Wednesday (ankle) after missing Weeks 6 and 7; Tyler Allgeier (toe) did not practice either.'],
    ],
  ],
  [
    'C49',
    [
      ['Kyle Monangai', 'RB', 'CHI', 'SIT', 'On a stationary bike Wednesday (thumb, toe); Swift has the work.'],
    ],
  ],
  [
    'C50',
    [
      ['Blake Corum', 'RB', 'LAR', 'SIT', '14.0 and 17.1 the last two on 9 carries a game; the No. 2 behind Kyren Williams.'],
    ],
  ],
  [
    'C51',
    [
      ['Jaxon Smith-Njigba', 'WR', 'SEA', 'START', '37% target share, 28.2 a game.'],
    ],
  ],
  [
    'C52',
    [
      ['Puka Nacua', 'WR', 'LAR', 'START', '32% target share, 12.4 targets a game; Davante Adams is on IR after surgery.'],
    ],
  ],
  [
    'C53',
    [
      ['CeeDee Lamb', 'WR', 'DAL', 'START', '11.6 targets a game; Dallas implied for 30.8.'],
    ],
  ],
  [
    'C54',
    [
      ['Zay Flowers', 'WR', 'BAL', 'START', '31% target share, 27.7 last week; Buffalo allows the most WR points.'],
    ],
  ],
  [
    'C55',
    [
      ['Amon-Ra St. Brown', 'WR', 'DET', 'START if active', 'Did not practice Wednesday (ankle); 32% target share.'],
    ],
  ],
  [
    'C56',
    [
      ['Tee Higgins', 'WR', 'CIN', 'START', '26.8 last week on 8.3 targets a game; Tennessee allows the 8th-most WR points.'],
    ],
  ],
  [
    'C57',
    [
      ['Ja\'Marr Chase', 'WR', 'CIN', 'START if active', 'Did not practice Wednesday (ankle and rest); 23% target share against Tennessee\'s 8th-most WR points allowed.'],
    ],
  ],
  [
    'C58',
    [
      ['Tetairoa McMillan', 'WR', 'CAR', 'START', '26% target share; Green Bay allows the 6th-most WR points.'],
    ],
  ],
  [
    'C59',
    [
      ['George Pickens', 'WR', 'DAL', 'START if active', 'Limited Wednesday (shoulder, hamstring); Dallas implied for 30.8.'],
    ],
  ],
  [
    'C60',
    [
      ['Drake London', 'WR', 'ATL', 'START', '29% target share, 19.6 last week.'],
    ],
  ],
  [
    'C61',
    [
      ['Justin Jefferson', 'WR', 'MIN', 'START', '26% target share; Detroit allows the 3rd-most WR points.'],
    ],
  ],
  [
    'C62',
    [
      ['Jameson Williams', 'WR', 'DET', 'START', '26.1 last week; more of the passing game is his if St. Brown sits.'],
    ],
  ],
  [
    'C63',
    [
      ['Christian Watson', 'WR', 'GB', 'START', '18.5 a game, 8 targets a game Thursday night.'],
    ],
  ],
  [
    'C64',
    [
      ['Omar Cooper Jr.', 'WR', 'NYJ', 'START', '22.3 and 22.5 the last two.'],
    ],
  ],
  [
    'C65',
    [
      ['Tre Tucker', 'WR', 'LV', 'START', '26.7 and 21.3 the last two.'],
    ],
  ],
  [
    'C66',
    [
      ['Parker Washington', 'WR', 'JAX', 'START', '26% target share, 15.5 a game; Jacksonville implied for 28.3.'],
    ],
  ],
  [
    'C67',
    [
      ['Michael Wilson', 'WR', 'ARI', 'FLEX if active', 'Limited Wednesday (ribs); 9.4 targets a game and Dallas allows the 10th-most WR points.'],
    ],
  ],
  [
    'C68',
    [
      ['Luther Burden III', 'WR', 'CHI', 'FLEX', '17.5 and 23.7 the last two; Seattle allows the fewest WR points.'],
    ],
  ],
  [
    'C69',
    [
      ['Stefon Diggs', 'WR', 'WAS', 'FLEX if active', 'Did not practice Wednesday (hand, hamstring, rest); Terry McLaurin is on IR and Philadelphia allows the 2nd-most WR points.'],
    ],
  ],
  [
    'C70',
    [
      ['DeVonta Smith', 'WR', 'PHI', 'FLEX if active', 'Missed Wednesday\'s walkthrough (hamstring); 32% target share, but Philadelphia is implied for 17.3.'],
    ],
  ],
  [
    'C71',
    [
      ['Garrett Wilson', 'WR', 'NYJ', 'FLEX', '26% target share, but 8.4 and 4.6 the last two.'],
    ],
  ],
  [
    'C72',
    [
      ['Jalen Coker', 'WR', 'CAR', 'FLEX', '23% target share and full practice (shoulder) after 1.9 last week; Green Bay allows the 6th-most WR points.'],
    ],
  ],
  [
    'C73',
    [
      ['Matthew Golden', 'WR', 'GB', 'FLEX if active', 'Questionable Thursday (shoulder, foot), limited Wednesday; 9.9 targets a game.'],
    ],
  ],
  [
    'C74',
    [
      ['Caleb Douglas', 'WR', 'MIA', 'FLEX', '21.0 last week.'],
    ],
  ],
  [
    'C75',
    [
      ['DK Metcalf', 'WR', 'PIT', 'FLEX', '8.3 targets a game; Pittman and Roman Wilson are on IR.'],
    ],
  ],
  [
    'C76',
    [
      ['Keenan Allen', 'WR', 'IND', 'FLEX', 'Jacksonville allows the 5th-most WR points; Alec Pierce is on IR.'],
    ],
  ],
  [
    'C77',
    [
      ['Emeka Egbuka', 'WR', 'TB', 'FLEX if active', 'Limited Wednesday (concussion, foot); 26% target share.'],
    ],
  ],
  [
    'C78',
    [
      ['KC Concepcion', 'WR', 'CLE', 'FLEX', '23.2 last week with a 22% target share.'],
    ],
  ],
  [
    'C79',
    [
      ['Keon Coleman', 'WR', 'BUF', 'FLEX', 'Buffalo implied for 28.8; Baltimore allows the 8th-most WR points and DJ Moore was limited Wednesday.'],
    ],
  ],
  [
    'C80',
    [
      ['Germie Bernard', 'WR', 'PIT', 'FLEX', '6.2 targets a game; 25.7 and 5.7 the last two.'],
    ],
  ],
  [
    'C81',
    [
      ['A.J. Brown', 'WR', 'NE', 'SIT', 'Limited Wednesday (knee, ankle); 6.4 a game and Miami allows the 3rd-fewest WR points.'],
    ],
  ],
  [
    'C82',
    [
      ['Jaylen Waddle', 'WR', 'DEN', 'SIT', 'Did not practice Wednesday (chest); 9.1 a game and Kansas City allows the 2nd-fewest WR points.'],
    ],
  ],
  [
    'C83',
    [
      ['Carnell Tate', 'WR', 'TEN', 'SIT', 'Did not practice Wednesday (shoulder); Tennessee implied for 18.3.'],
    ],
  ],
  [
    'C84',
    [
      ['Davante Adams', 'WR', 'LAR', 'OUT', 'On IR after hamstring surgery; the engine still projects 15.0.'],
    ],
  ],
  [
    'C85',
    [
      ['Terry McLaurin', 'WR', 'WAS', 'OUT', 'Placed on IR Wednesday (knee); the engine still projects 11.0.'],
    ],
  ],
  [
    'C86',
    [
      ['Trey McBride', 'TE', 'ARI', 'START', '30% target share, 27.1 last week, in a 54.5 total.'],
    ],
  ],
  [
    'C87',
    [
      ['Brock Bowers', 'TE', 'LV', 'START if active', 'Limited Wednesday (calf); 27% target share.'],
    ],
  ],
  [
    'C88',
    [
      ['Hunter Henry', 'TE', 'NE', 'START', '14.8 and 14.1 the last two; Miami allows the 3rd-most TE points.'],
    ],
  ],
  [
    'C89',
    [
      ['Dallas Goedert', 'TE', 'PHI', 'START', 'Full practice while Smith and Wicks missed the walkthrough; Washington allows the 2nd-most TE points.'],
    ],
  ],
  [
    'C90',
    [
      ['Colston Loveland', 'TE', 'CHI', 'START', '18.5 and 19.9 the last two with Cole Kmet on IR.'],
    ],
  ],
  [
    'C91',
    [
      ['Kyle Pitts Sr.', 'TE', 'ATL', 'START', '23.0 and 13.2 the last two; Tampa allows the 8th-most TE points.'],
    ],
  ],
  [
    'C92',
    [
      ['Travis Kelce', 'TE', 'KC', 'START', '19% target share, full practice; Denver allows the 8th-most TE points.'],
    ],
  ],
  [
    'C93',
    [
      ['Tyler Warren', 'TE', 'IND', 'START if active', 'Back at practice, limited (groin), after missing Weeks 6 and 7; 21% target share, 14.0 a game.'],
    ],
  ],
  [
    'C94',
    [
      ['T.J. Hockenson', 'TE', 'MIN', 'START', 'Detroit allows the most TE points.'],
    ],
  ],
  [
    'C95',
    [
      ['Tucker Kraft', 'TE', 'GB', 'START', '14.8 last week, 6.1 targets a game.'],
    ],
  ],
  [
    'C96',
    [
      ['Mason Taylor', 'TE', 'NYJ', 'START', '25.2 last week; Las Vegas allows the 4th-most TE points.'],
    ],
  ],
  [
    'C97',
    [
      ['Sam LaPorta', 'TE', 'DET', 'START', '13.2 a game; Minnesota allows the fewest TE points, so TE12.'],
    ],
  ],
  [
    'C98',
    [
      ['Brenton Strange', 'TE', 'JAX', 'SIT', 'Full practice; 10.0 a game; TE13.'],
    ],
  ],
  [
    'C99',
    [
      ['Jake Ferguson', 'TE', 'DAL', 'SIT', '0.0 last week, 6.4 a game, 9% target share.'],
    ],
  ],
  [
    'C100',
    [
      ['Pittsburgh Steelers', 'DEF', 'PIT', 'START', 'Cleveland implied for 18.0 in a 39.5 total, the lowest on the slate.'],
    ],
  ],
  [
    'C101',
    [
      ['Seattle Seahawks', 'DEF', 'SEA', 'START', '12.3 a game; Chicago implied for 21.8.'],
    ],
  ],
  [
    'C102',
    [
      ['Jacksonville Jaguars', 'DEF', 'JAX', 'START', '10-point favorites; Indianapolis implied for 18.3 and Daniel Jones scored 3.6 last week.'],
    ],
  ],
  [
    'C103',
    [
      ['Cincinnati Bengals', 'DEF', 'CIN', 'START', '10-point favorites; Tennessee implied for 18.3 and Cam Ward has not reached 7 points in any of the last three.'],
    ],
  ],
  [
    'C104',
    [
      ['Minnesota Vikings', 'DEF', 'MIN', 'START', '15.0 a game, the best on the slate; Gibbs and St. Brown did not practice Wednesday.'],
    ],
  ],
  [
    'C105',
    [
      ['Tampa Bay Buccaneers', 'DEF', 'TB', 'START', '29 last week; Atlanta implied for 21.0.'],
    ],
  ],
  [
    'C106',
    [
      ['New England Patriots', 'DEF', 'NE', 'START', 'Miami implied for 18.3 as a 7-point underdog.'],
    ],
  ],
  [
    'C107',
    [
      ['Washington Commanders', 'DEF', 'WAS', 'START', 'Philadelphia implied for 17.3, the lowest on the slate, with McKee starting.'],
    ],
  ],
];

const SLOT = (slot) => GAMES.filter((g) => g.slot === slot).map((g) => <GameCard key={g.id} g={g} />);

const QB_NEXT = 'Sits and unranked: Tyler Huntley (a 2QB pivot behind Lamar), Bryce Young, Patrick Mahomes, Bo Nix, Jacoby Brissett and Geno Smith (both 2QB starts only), Tanner McKee, Malik Willis. Out: Jalen Hurts (IR, the engine still projects 18.5). The engine projects the n=0 backup quarterbacks between 15.0 and 16.6; ignore them.';
const RB_NEXT = 'Sits: Breece Hall, Aaron Jones Sr., Saquon Barkley, Jeremiyah Love, Kyle Monangai and Blake Corum. The engine placeholders are ignored: De\'Von Achane (IR) at 12.8, James Conner (IR) at 11.7, Zach Charbonnet at 10.5 with no snaps this season and Monangai at 11.6 while on a bike.';
const WR_NEXT = 'Sits: A.J. Brown, Jaylen Waddle and Carnell Tate. Out: Davante Adams (15.0) and Terry McLaurin (11.0), both engine placeholders on IR, and Alec Pierce (10.2, IR). Nobody from HOU, NO, NYG or SF is ranked.';
const TE_NEXT = 'Sits: Jake Ferguson. Harold Fannin Jr. is ranked without a call.';
const DST_TIER_NEXT = 'Every D/ST in the top eight has a ruling. Kansas City, Cleveland and Denver are streamers beyond them.';

// Injury board rows are [name, position, team, status, pivot, tone, ruling].
// Statuses are the Wednesday practice reports; no Thursday report existed when this was written.

const INJ_OUT = [
  ['Jalen Hurts', 'QB', 'PHI', 'On IR (calf), expected to miss the season. The engine still projects 18.5; ignore it.', 'Tanner McKee is a sit.', 'out', 'C22'],
  ['Davante Adams', 'WR', 'LAR', 'On IR after hamstring surgery (6 to 10 weeks). The engine still projects 15.0; ignore it.', 'Puka Nacua (START, WR2).', 'out', 'C84'],
  ['Terry McLaurin', 'WR', 'WAS', 'Placed on IR Wednesday (knee). The engine still projects 11.0; ignore it.', 'Stefon Diggs (FLEX if active, WR19) is the Washington receiver call.', 'out', 'C85'],
];

const INJ_THU = [
  ['Matthew Golden', 'WR', 'GB', 'Questionable Thursday (shoulder, foot), limited Wednesday; 9.9 targets a game.', 'Flex only if active. Christian Watson (START, WR13) is the other Green Bay receiver. Thursday has no pivot cover.', 'gtd', 'C73'],
];

const INJ_ONE = [
  ['Lamar Jackson', 'QB', 'BAL', 'Full practice Wednesday on the ankle after missing Weeks 5 to 7. Inactives about 11:30a ET.', 'Tyler Huntley is a sit and a 2QB pivot only (13.4 and 15.1 in the last two starts).', 'gtd', 'C6'],
  ['Jahmyr Gibbs', 'RB', 'DET', 'Did not practice Wednesday (shoulder); 28.5 a game on 22.3 carries.', 'No Detroit back is called. Carry a later-kickoff running back.', 'gtd', 'C25'],
  ['Amon-Ra St. Brown', 'WR', 'DET', 'Did not practice Wednesday (ankle); 32% target share.', 'Jameson Williams (START, WR12) gets more of the passing game if he sits.', 'gtd', 'C55'],
  ['Ja\'Marr Chase', 'WR', 'CIN', 'Did not practice Wednesday (ankle and rest); 23% target share.', 'Tee Higgins (START, WR6).', 'gtd', 'C57'],
  ['George Pickens', 'WR', 'DAL', 'Limited Wednesday (shoulder, hamstring).', 'CeeDee Lamb (START, WR3). Dallas is implied for 30.8.', 'gtd', 'C59'],
  ['Michael Wilson', 'WR', 'ARI', 'Limited Wednesday (ribs); 9.4 targets a game.', 'None called. Swap to a later-kickoff flex.', 'gtd', 'C67'],
  ['Jeremiyah Love', 'RB', 'ARI', 'Limited Wednesday (ankle) after missing Weeks 6 and 7; Tyler Allgeier (toe) did not practice either.', 'None called. Sit. Bam Knight has no ruling.', 'sit', 'C48'],
  ['Braelon Allen', 'RB', 'NYJ', 'Limited Wednesday (ankle); 19.4 last week on 17 carries and 7 targets.', 'Flex only if active.', 'gtd', 'C42'],
  ['Breece Hall', 'RB', 'NYJ', 'Limited Wednesday (quadriceps) after missing Weeks 4 to 7; three games played.', 'Sit either way. Allen is the flex if active.', 'sit', 'C42'],
  ['Aaron Jones Sr.', 'RB', 'MIN', 'Did not practice Wednesday (knee), after aggravating it; 3.6 last week on 25% of the snaps.', 'Jordan Mason (FLEX, RB24).', 'sit', 'C46'],
  ['Brock Bowers', 'TE', 'LV', 'Limited Wednesday (calf); 27% target share.', 'Start if active. Carry a later tight end: Hunter Henry or Travis Kelce at 4:25p, Dallas Goedert on Sunday night.', 'gtd', 'C87'],
  ['Tyler Warren', 'TE', 'IND', 'Back at practice, limited (groin), after missing Weeks 6 and 7; 14.0 a game.', 'Start if active. Carry a later tight end.', 'gtd', 'C93'],
  ['Emeka Egbuka', 'WR', 'TB', 'Limited Wednesday (concussion, foot); 26% target share.', 'Flex only if active. Swap to a later-kickoff flex.', 'gtd', 'C77'],
  ['Carnell Tate', 'WR', 'TEN', 'Did not practice Wednesday (shoulder).', 'Sit either way.', 'sit', 'C83'],
];

const INJ_LATE = [
  ['Jaylen Waddle', 'WR', 'DEN', 'Did not practice Wednesday (chest); 9.1 a game. Inactives about 2:55p ET.', 'None. Sit.', 'sit', 'C82'],
  ['A.J. Brown', 'WR', 'NE', 'Limited Wednesday (knee, ankle); 6.4 a game.', 'None. Sit.', 'sit', 'C81'],
  ['Rashee Rice', 'WR', 'KC', 'On the 4:25p inactives checklist. No ruling.', 'None called.', 'gtd', null],
];

const INJ_NIGHT = [
  ['DeVonta Smith', 'WR', 'PHI', 'Missed Wednesday\'s walkthrough (hamstring); 32% target share. Inactives about 6:50p ET.', 'Flex only if active. Philadelphia is implied for 17.3.', 'gtd', 'C70'],
  ['Stefon Diggs', 'WR', 'WAS', 'Did not practice Wednesday (hand, hamstring, rest); McLaurin is on IR.', 'Flex only if active. Rachaad White (FLEX, RB22) is the other Washington call.', 'gtd', 'C69'],
  ['Saquon Barkley', 'RB', 'PHI', 'Missed Wednesday\'s walkthrough (hamstring, back); 7.6 a game on 15% of the snaps last week.', 'Sit either way. Elijah Mitchell has no ruling.', 'sit', 'C47'],
];

const INJ_MNF = [
  ['Kyle Monangai', 'RB', 'CHI', 'On a stationary bike Wednesday (thumb, toe). The engine projects 11.6; ignore it. Inactives about 6:45p ET Monday.', 'D\'Andre Swift (START, RB9). Monday night leaves no pivot.', 'sit', 'C49'],
  ['Zach Charbonnet', 'RB', 'SEA', 'The engine projects 10.5 with no snaps this season; ignore it. No ruling.', 'None called. Monday night leaves no pivot.', 'sit', null],
];

const ALREADY_OUT = ['Michael Pittman Jr. (PIT WR, IR)', 'Roman Wilson (PIT WR, IR)', 'De\'Von Achane (MIA RB, IR)', 'James Conner (ARI RB, IR)', 'Alec Pierce (IND WR, IR)', 'Cole Kmet (CHI TE, IR)', 'Dameon Pierce (PHI RB, IR)', 'Tank Bigsby (PHI RB, IR)', 'Will Shipley (PHI RB, IR)', 'Edgerrin Cooper (GB LB, IR)', 'Erick All (CIN TE, torn ACL)'];

// Handcuff rows are [team, starter and status, handcuff, verdict].

const HANDCUFFS = [
  ['BAL', 'Lamar Jackson: full practice Wednesday on the ankle.', 'Tyler Huntley', 'SIT. A 2QB pivot only: 13.4 and 15.1 in the last two starts.'],
  ['MIN', 'Aaron Jones Sr.: did not practice Wednesday (knee).', 'Jordan Mason', 'FLEX, RB24. Takes the early-down work with Jones out of practice; 15 carries last week.'],
  ['NYJ', 'Breece Hall: limited Wednesday (quadriceps).', 'Braelon Allen', 'FLEX if active, RB20. Limited (ankle); 19.4 last week on 17 carries and 7 targets. Isaiah Davis has no ruling.'],
  ['LAR', 'Kyren Williams: a start.', 'Blake Corum', 'SIT. 14.0 and 17.1 the last two on 9 carries a game; the No. 2.'],
  ['CHI', 'D\'Andre Swift: a start, with Kyle Monangai on a bike.', 'Roschon Johnson', 'No ruling, no call.'],
  ['ARI', 'Jeremiyah Love and Tyler Allgeier: limited and did not practice.', 'Bam Knight', 'No ruling, no call.'],
  ['TB', 'Bucky Irving: a start, with Kenny Gainwell out of practice.', 'Sean Tucker', 'No ruling, no call.'],
  ['GB', 'Josh Jacobs: a start Thursday.', 'Pierre Strong Jr. and MarShawn Lloyd', 'No ruling, no call.'],
  ['PHI', 'Saquon Barkley: missed Wednesday\'s walkthrough (hamstring, back).', 'Elijah Mitchell', 'No ruling, no call. Dameon Pierce, Tank Bigsby and Will Shipley are all on IR.'],
];

// D/ST rows are [d/st, opponent, opp implied, verdict, why].

const DST_TABLE = [
  ['Pittsburgh Steelers', 'vs CLE', '18.0', 'START (DST1)', 'Cleveland implied for 18.0 in a 39.5 total, the lowest on the slate.'],
  ['Seattle Seahawks', 'vs CHI', '21.8', 'START (DST2)', '12.3 a game; Chicago implied for 21.8.'],
  ['Jacksonville Jaguars', 'vs IND', '18.3', 'START (DST3)', '10-point favorites; Daniel Jones scored 3.6 last week.'],
  ['Cincinnati Bengals', 'vs TEN', '18.3', 'START (DST4)', '10-point favorites; Cam Ward has not reached 7 points in any of the last three.'],
  ['Minnesota Vikings', 'at DET', '24.8', 'START (DST5)', '15.0 a game, the best on the slate; Gibbs and St. Brown did not practice Wednesday.'],
  ['Tampa Bay Buccaneers', 'vs ATL', '21.0', 'START (DST6)', '29 last week; Atlanta implied for 21.0.'],
  ['New England Patriots', 'at MIA', '18.3', 'START (DST7)', 'Miami implied for 18.3 as a 7-point underdog.'],
  ['Washington Commanders', 'vs PHI', '17.3', 'START (DST8)', 'Philadelphia implied for 17.3, the lowest on the slate, with McKee starting.'],
  ['Kansas City Chiefs', 'at DEN', '19.5', 'Streamer beyond the top eight', '8.8 a game; Denver implied for 19.5.'],
  ['Cleveland Browns', 'at PIT', '21.5', 'Streamer beyond the top eight', 'A 39.5 total, the lowest on the slate.'],
  ['Denver Broncos', 'vs KC', '21.0', 'Streamer beyond the top eight', 'Mahomes scored 10.5 and 6.0 the last two.'],
  ['Arizona Cardinals', 'at DAL', '30.8', 'Avoid', '3.9 a game; Dallas implied for 30.8.'],
  ['Dallas Cowboys', 'vs ARI', '23.8', 'Avoid', '2.4 a game.'],
  ['Philadelphia Eagles', 'at WAS', '23.3', 'Avoid', '2.7 a game.'],
  ['Buffalo Bills', 'vs BAL', '25.8', 'Avoid', '3.0 a game.'],
  ['Miami Dolphins', 'vs NE', '25.3', 'Avoid', '3.2 a game.'],
  ['Indianapolis Colts', 'at JAX', '28.3', 'Avoid', '3.9 a game.'],
];

// IDP rows are [player, team, position, opponent, note].

const IDP_TABLE = [
  ['Blake Cashman', 'MIN', 'LB', 'at DET', '23.0 last week, 12.3 a game'],
  ['Alex Singleton', 'DEN', 'LB', 'vs KC', '20.5 last week, 10.9 a game'],
  ['Kendal Daniels', 'ATL', 'LB', 'at TB', '13.0 over the last three'],
  ['Jessie Bates III', 'ATL', 'S', 'at TB', '12.2 over the last three'],
  ['Quincy Williams', 'CLE', 'LB', 'at PIT', '12.2 over the last three'],
  ['Payton Wilson', 'PIT', 'LB', 'vs CLE', '11.2 over the last three'],
  ['Evan Williams', 'GB', 'S', 'vs CAR (Thursday)', '11.0 a game'],
  ['Nakobe Dean', 'LV', 'LB', 'at NYJ', '14.5 last week'],
];

const IDP_AVOID = 'Edgerrin Cooper is on IR. Talanoa Hufanga is questionable (28.5, then 3.0 and 5.0), so treat him as a name play only.';

const SLEEPERS = [
  ['Omar Cooper Jr.', 'START, WR14. 22.3 and 22.5 the last two.', 'WR'],
  ['Jordan Mason', 'FLEX, RB24. Takes the early-down work with Jones out of practice; 15 carries last week.', 'RB'],
  ['Caleb Douglas', 'FLEX, WR24. 21.0 last week.', 'WR'],
  ['Kyler Murray', 'SIT, QB14. Detroit allows the most QB points (25.6 a game), but he scored 13.9 last week; a streamer, not a QB1.', 'QB'],
  ['Mason Taylor', 'START, TE11. 25.2 last week; Las Vegas allows the 4th-most TE points.', 'TE'],
];

const FADES = [
  ['Patrick Mahomes', 'SIT. 10.5 and 6.0 the last two; Kansas City implied for 21.0 at Denver.', 'QB'],
  ['Saquon Barkley', 'SIT. Missed Wednesday\'s walkthrough (hamstring, back); 7.6 a game on 15% of the snaps last week.', 'RB'],
  ['A.J. Brown', 'SIT. Limited Wednesday (knee, ankle); 6.4 a game and Miami allows the 3rd-fewest WR points.', 'WR'],
  ['Tanner McKee', 'SIT. 12.6 and 10.5 in his two starts; Philadelphia implied for 17.3, the lowest on the slate.', 'QB'],
  ['Jake Ferguson', 'SIT. 0.0 last week, 6.4 a game, 9% target share.', 'TE'],
];

const PIVOTS = [
  ['Matthew Golden out', 'Flex only if active. Thursday has no cover, so decide before 6:45p ET.'],
  ['Lamar out', 'Huntley is a 2QB pivot only (13.4 and 15.1 in the last two starts). Henry stays a start. Decide at about 11:30a ET.'],
  ['Gibbs out', 'No Detroit back is called. Swap to a flex who kicks off at 4:05p or later.'],
  ['St. Brown out', 'Jameson Williams is a start, WR12, and gets more of the passing game.'],
  ['Chase out', 'Tee Higgins is a start, WR6.'],
  ['Pickens out', 'CeeDee Lamb is a start, WR3.'],
  ['Wilson (ARI), Egbuka or Allen (NYJ) out', 'All are flexes only if active. Swap to a flex who kicks off at 4:05p or later.'],
  ['Hall out', 'Braelon Allen is a flex if active, RB20, and is limited himself.'],
  ['Aaron Jones out', 'Jordan Mason is a flex, RB24.'],
  ['Bowers or Warren out', 'Carry a later tight end: Henry or Kelce at 4:25p, or Goedert on Sunday night.'],
  ['Adams out (already)', 'Nacua is the start, WR2.'],
  ['McLaurin out (already)', 'Diggs is a flex if active, WR19, and Rachaad White is a flex, RB22.'],
  ['Smith, Diggs or Barkley out', 'Each is a call only if active. Sunday night leaves Monday as the only later window.'],
  ['Monangai out', 'Swift is the start, RB9. Monday night leaves no pivot.'],
];

const CHECK_THU = [
  ['Matthew Golden (GB WR).', 'Questionable. Active: FLEX. Out: Christian Watson stays the START.'],
  ['Everyone else on the card.', 'No pivot cover on Thursday: set the lineup before the 6:45p ET inactives.'],
];

const CHECK_ONE = [
  ['Lamar Jackson (BAL QB).', 'Active: START. Out: Huntley is a 2QB pivot only.'],
  ['Jahmyr Gibbs (DET RB) and Amon-Ra St. Brown (DET WR).', 'Active: START. Out: Jameson Williams stays the START.'],
  ['Ja\'Marr Chase (CIN WR).', 'Active: START. Out: Tee Higgins stays the START.'],
  ['George Pickens (DAL WR) and Michael Wilson (ARI WR).', 'Pickens active: START. Wilson active: FLEX.'],
  ['Jeremiyah Love (ARI RB).', 'A sit either way.'],
  ['Braelon Allen (NYJ RB).', 'Active: FLEX.'],
  ['Breece Hall (NYJ RB).', 'A sit either way.'],
  ['Aaron Jones Sr. (MIN RB).', 'A sit either way. Jordan Mason is the FLEX.'],
  ['Brock Bowers (LV TE) and Tyler Warren (IND TE).', 'Active: START. Out: swap to a later tight end.'],
  ['Emeka Egbuka (TB WR).', 'Active: FLEX. Out: swap to a later-kickoff flex.'],
];

const CHECK_LATE = [
  ['Jaylen Waddle (DEN WR) and Rashee Rice (KC WR), about 2:55p ET.', 'Waddle is a sit either way. Rice has no ruling.'],
  ['A.J. Brown (NE WR).', 'A sit either way.'],
];

const CHECK_SNF = [
  ['DeVonta Smith (PHI WR) and Stefon Diggs (WAS WR), about 6:50p ET.', 'Each is a FLEX if active.'],
  ['Saquon Barkley (PHI RB).', 'A sit either way.'],
];

const CHECK_MNF = [
  ['Kyle Monangai (CHI RB) and Zach Charbonnet (SEA RB), about 6:45p ET Monday.', 'Swift is the START and Charbonnet has no ruling. No pivot is left.'],
  ['Everyone on the card.', 'Monday is the last window, so there is no later swap.'],
];

const Body = () => (
  <>
    <HeroBanner />

    <Lead>
      Fourteen games, Thursday through Monday, and four teams on bye. Carolina at Green Bay kicks
      off Thursday night, Philadelphia at Washington is Sunday night, and Chicago at Seattle closes
      it Monday. Lamar Jackson practiced in full Wednesday, Jahmyr Gibbs and Amon-Ra St. Brown did
      not practice, and three games carry wind and storms. Every call is here. Set your Thursday lineup
      first, and set your pivots before you go to bed Saturday.
    </Lead>

    <Note title="Read this first">
      <strong>Lines are our database as of Oct 29, 9:08am ET and weather as of 6:23am ET. Injury
      notes are the Wednesday practice reports, and no Thursday report was published when I wrote
      this.</strong>{' '}
      Updates since the Tuesday waiver column: Washington put Terry McLaurin on IR Wednesday,
      Philadelphia put Dameon Pierce on IR Wednesday, the Rams said Davante Adams had hamstring
      surgery (6 to 10 weeks), Cincinnati lost TE Erick All to a torn ACL, and Minnesota&apos;s
      Aaron Jones aggravated the knee and did not practice. Jalen Coker, limited on Monday&apos;s
      estimated report, practiced in full Wednesday. Re-check the Friday reports and the inactives
      before you lock anything. Every window below says when the inactives drop. Daylight saving
      ends Sunday, so Sunday and Monday times are EST, and every time on this page is Eastern.
    </Note>

    <P>
      Scoring is PPR. Houston, New Orleans, the Giants and San Francisco are on bye, so 28 teams
      play, and nobody from those four is ranked or called. Where an engine projection is a
      placeholder (an injured or inactive player the model still scores), I say so and lean on
      usage.
    </P>
    <RailList
      items={[
        ['FPA rank', '1 means the defense allows the most points to that position (a good matchup), 32 the fewest (tough). Weeks 1 to 7, garbage time included.'],
        ['Verdicts', 'START, FLEX, SIT and OUT are the rulings. "If active" calls are void if the player does not appear, and they sit in the game-time group of each card.'],
        ['Tiers', 'QB 14, RB 24, WR 30, TE 14 and D/ST 8, in the order I rank them. A player ranked without a ruling says so.'],
        ['Ruling links', 'Every call on a card links to its Darkness Ruling (C1 to C107) with the reason.'],
      ]}
    />

    <JumpGrid />

    <H2>The Slate Board</H2>
    <P>
      Every game, in kickoff order with Thursday first: line, total, weather and both implied totals
      on one scale. Filled bars are the favorites. Arizona at Dallas and Baltimore at Buffalo (54.5)
      are the highest totals, and Dallas (30.8) is the highest implied team, followed by Buffalo
      (28.8). Cleveland at Pittsburgh (39.5) is the lowest total, and Philadelphia (17.3) is the
      lowest implied team. Jacksonville and Cincinnati (-10) are the biggest favorites.
    </P>
    <SlateBoard />
    <P>
      Three Florida-area games have weather: Indianapolis at Jacksonville has 15 mph of wind with
      showers and thunderstorms likely, Atlanta at Tampa has 12 mph with a chance of storms, and
      New England at Miami has 13 mph with storms. Tennessee at Cincinnati has a 35% chance of
      light rain. Everywhere else is calm, at 7 mph or less. Minnesota at Detroit and the Chargers
      at the Rams are indoors. I have no number for what wind does to a stat line, so there are no
      point adjustments.
    </P>

    <H2>The Injury Board</H2>
    <P>
      Practice reports are Wednesday. The decision rules are simple, and I apply them the same way
      to every name on this page.
    </P>
    <RailList
      color="var(--warning)"
      items={[
        ['"If active" calls', 'are void if the player does not appear. Every call that turns on a practice report, his or his teammate\'s, carries the injury on its card.'],
        ['Engine placeholders', 'never rank anyone. Hurts, Adams, McLaurin, Achane, Conner, Alec Pierce, Charbonnet and Monangai all carry a projection and none of them is a call.'],
        ['A swap only works', 'if your bench player kicks off at or after the player he replaces. Thursday players have no cover at all.'],
        ['Byes', 'Houston, New Orleans, the Giants and San Francisco: nobody is ranked or called.'],
      ]}
    />
    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, my: 2 }}>
      <Chip tone="var(--accent)">Thursday: about 6:45p ET</Chip>
      <Chip tone="var(--accent)">1:00p games: about 11:30a ET</Chip>
      <Chip tone="var(--accent)">4:05p / 4:25p: about 2:35p / 2:55p ET</Chip>
      <Chip tone="var(--accent)">SNF: about 6:50p ET</Chip>
      <Chip tone="var(--accent)">MNF: about 6:45p ET Monday</Chip>
    </Box>

    <InjuryGroup title="Out, or treat as out" when="Engine projections for these players are placeholders." rows={INJ_OUT} />
    <InjuryGroup title="Thursday" when="Inactives about 6:45p ET; no pivot cover" rows={INJ_THU} />
    <InjuryGroup title="1:00p games" when="Inactives about 11:30a ET" rows={INJ_ONE} />
    <InjuryGroup title="Late window" when="Inactives about 2:35p / 2:55p ET" rows={INJ_LATE} />
    <InjuryGroup title="Sunday night" when="Inactives about 6:50p ET" rows={INJ_NIGHT} />
    <InjuryGroup title="Monday night" when="Inactives about 6:45p ET Monday; no later window" rows={INJ_MNF} />
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

    <H2>The 1:00p Window</H2>
    <P>
      Eight games at 1:00p ET. Nothing kicks between 1:00p and 4:05p, so a 1:00p decision needs a
      4:05p-or-later swap on your bench. Inactives about 11:30a ET.
    </P>
    {SLOT('one')}

    <H2>Late Window</H2>
    <P>
      Three games, one at 4:05p and two at 4:25p. These are pivot-safe after the early slate: you
      can see the 1:00p inactives and the early scores before you decide.
    </P>
    {SLOT('late')}

    <H2>Prime Time</H2>
    <P>
      Sunday night is Philadelphia at Washington at 8:20p ET. Monday night is Chicago at Seattle at
      8:15p ET, the last window, and my Monday injury data is Wednesday-only, so hold it loosely.
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
      verdict is for Week 8 and nothing else. A handcuff with no ruling gets no call.
    </P>
    <Table aria-label="Week 8 handcuff board">
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
      opposing offense is expected to score. Pittsburgh against Cleveland (18.0) and Washington
      against Philadelphia (17.3) are the two lowest opposing totals on the board.
    </P>
    <Table aria-label="Week 8 D/ST streaming board">
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
      One hundred and seven rulings, C1 to C107, and 110 calls inside them. Each one is here with
      its reason.
    </P>
    {RULINGS.map((r) => <RulingCard key={r[0]} r={r} />)}

    <H2>Inactives Checklist</H2>
    <P>
      Inactives drop about 90 minutes before each kickoff. Windows are Eastern time. Thursday is the
      first window and the only one with no cover, so start there.
    </P>
    <WindowChecklist title="Thursday inactives" time="about 6:45p ET" rows={CHECK_THU} />
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
